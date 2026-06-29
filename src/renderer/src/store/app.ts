import { create } from 'zustand'
import type { AppSettings, ChatMessage } from '@shared/types'
import { api, setToken, getToken, type Quota, type ModelMeta, type ModelMetaItem, type Pricing } from '../lib/api'
import { modelSizeFor, qualityLongEdge, ratioSupported, DEFAULT_RATIO, nearestRatioKey } from '../lib/genOptions'

// 「原比例」：按第一张参考图的原始宽高比取最近预设尺寸；无参考图/读取失败回退默认比例。
async function resolveOrigSize(first?: string): Promise<string> {
  if (!first) return modelSizeFor(DEFAULT_RATIO)
  try {
    const dim = await new Promise<{ w: number; h: number }>((res, rej) => {
      const im = new Image()
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
      im.onerror = rej
      im.src = first
    })
    return modelSizeFor(nearestRatioKey(dim.w, dim.h))
  } catch {
    return modelSizeFor(DEFAULT_RATIO)
  }
}

export type Tier = 'standard' | 'quality'
const DEFAULT_META: ModelMetaItem = { mode: 'quality', credits: 1, ref: true }
// 可中止等待：点中止后立即结束等待，不必干等满 3 秒(问题二A：终止后尽快解锁)。
const waitAbortable = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((res) => {
  if (signal?.aborted) return res()
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true })
})

// 单张异步生成（提交→轮询），供设计工坊逐张生成复用。reqBody.reqId 必填。
async function genOneJob(
  reqBody: { prompt: string; model: string; size?: string; reqId: string; initImages?: string[] },
  ac: AbortController
): Promise<{ img?: string; quota?: Quota; err?: string; needRecharge?: boolean }> {
  // 问题二A/B：中止时通知后端取消该后台任务，释放并发槽、杜绝幽灵继续跑并扣费(并发池下每张各自 reqId)。
  ac.signal.addEventListener('abort', () => { void api.cancelGenerate(reqBody.reqId) }, { once: true })
  let sub: Awaited<ReturnType<typeof api.generate>>
  try {
    // noFallback：设计批量是精确任务，某张失败就如实失败(不扣费、可重生成)，不静默换兜底模型补近似图还扣费。
    sub = await api.generate({ ...reqBody, async: true, noFallback: true }, ac.signal)
  } catch {
    return { err: '网络异常' }
  }
  if (ac.signal.aborted) return { err: 'aborted' }
  if (sub.status === 402 || sub.data?.needRecharge) return { err: '点数不足', needRecharge: true }
  if (sub.status === 429) return { err: sub.data?.error || '繁忙，请稍后' }
  if (sub.status === 200 && sub.data?.images?.length) return { img: sub.data.images[0], quota: sub.data.quota }
  if (!(sub.status === 202 || (sub.data as { accepted?: boolean })?.accepted)) return { err: sub.data?.error || '提交失败' }
  const t0 = Date.now()
  while (!ac.signal.aborted && Date.now() - t0 < 315_000) {
    await waitAbortable(3000, ac.signal)
    if (ac.signal.aborted) return { err: 'aborted' }
    let st: Awaited<ReturnType<typeof api.generateStatus>>
    try {
      st = await api.generateStatus(reqBody.reqId, ac.signal)
    } catch {
      continue
    }
    if (ac.signal.aborted) return { err: 'aborted' }
    if (st.data?.state === 'done') {
      const d = st.data.result || {}
      if (st.data.status === 402 || d.needRecharge) return { err: '点数不足', needRecharge: true }
      return d.images?.length ? { img: d.images[0], quota: d.quota } : { err: d.error || '生成失败' }
    }
    if (st.data?.state === 'missing') return { err: '任务丢失' }
  }
  return { err: 'aborted' }
}

// 按档位筛选模型：standard 档=mode 为 standard 的模型；quality 档=其余（GPT/Nano Banana 等）
function modelsOfTier(models: string[], meta: ModelMeta, t: Tier): string[] {
  return t === 'standard'
    ? models.filter((m) => meta[m]?.mode === 'standard')
    : models.filter((m) => meta[m]?.mode !== 'standard')
}
// 登录/初始化时挑默认模型与档位：优先标准档（便宜、最快），无标准档则退到高质量。
function initialModelTier(models: string[], meta: ModelMeta): { model: string; tier: Tier } {
  const std = modelsOfTier(models, meta, 'standard')
  if (std.length) return { model: std[0], tier: 'standard' }
  return { model: models[0] || '', tier: 'quality' }
}

export type View = 'chat' | 'library' | 'editor' | 'settings' | 'gallery'
const TOKEN_KEY = 'cogpt_token'

interface Account {
  phone: string
  quota: Quota
}

export interface UpdateInfo {
  version: string
  current: string
  url: string
  notes: string
  force: boolean
}

// 简单语义化版本比较：latest 是否比 current 新
function isNewer(latest: string, current: string): boolean {
  const a = String(latest).split('.').map((n) => parseInt(n, 10) || 0)
  const b = String(current).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export interface ConvMeta {
  id: string
  title: string
  at: number
}
const uid = (): string => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now() + Math.random().toString(36).slice(2))

// 对话本地存储（IndexedDB，Electron 渲染层可用；按设备保存，零服务器成本）
function openConvDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open('cogpt', 1)
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' }); if (!db.objectStoreNames.contains('full')) db.createObjectStore('full', { keyPath: 'id' }) }
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    } catch (e) { rej(e) }
  })
}
async function convSave(c: { id: string; title: string; at: number; msgs: ChatMessage[] }): Promise<void> {
  try { const db = await openConvDB(); await new Promise((res) => { const tx = db.transaction(['meta', 'full'], 'readwrite'); tx.objectStore('meta').put({ id: c.id, title: c.title, at: c.at }); tx.objectStore('full').put({ id: c.id, msgs: c.msgs }); tx.oncomplete = () => res(null); tx.onerror = () => res(null) }) } catch { /* ignore */ }
}
async function convMetas(): Promise<ConvMeta[]> {
  try { const db = await openConvDB(); return await new Promise((res) => { const tx = db.transaction('meta', 'readonly'); const rq = tx.objectStore('meta').getAll(); rq.onsuccess = () => res((rq.result || []).sort((a: ConvMeta, b: ConvMeta) => b.at - a.at)); rq.onerror = () => res([]) }) } catch { return [] }
}
async function convLoad(id: string): Promise<ChatMessage[]> {
  try { const db = await openConvDB(); return await new Promise((res) => { const tx = db.transaction('full', 'readonly'); const rq = tx.objectStore('full').get(id); rq.onsuccess = () => res(rq.result ? rq.result.msgs : []); rq.onerror = () => res([]) }) } catch { return [] }
}
async function convDel(id: string): Promise<void> {
  try { const db = await openConvDB(); await new Promise((res) => { const tx = db.transaction(['meta', 'full'], 'readwrite'); tx.objectStore('meta').delete(id); tx.objectStore('full').delete(id); tx.oncomplete = () => res(null); tx.onerror = () => res(null) }) } catch { /* ignore */ }
}

interface AppStore {
  ready: boolean
  account: Account | null
  models: string[]
  modelMeta: ModelMeta // 后端 /api/models meta：每个模型的档位/扣点数/是否支持参考图
  pricing: Pricing | null // 后端 /api/models pricing：多参考图/高清动态加点规则，用于 UI 估算
  selectedModel: string
  tier: Tier // 当前质量档位：标准 / 高质量（即梦式两档）
  settings: AppSettings
  view: View

  // 对话
  messages: ChatMessage[]
  generating: boolean // chat/设计工坊/拆解等"整体阻塞"操作用
  activeGen: number // 问题二B：普通生图并发任务数(允许 ≤MAX_CONCURRENT 同时生)
  genStatus: string
  needRecharge: boolean
  editorImage?: string
  update: UpdateInfo | null

  // 对话历史（会员专享）
  convId: string
  convList: ConvMeta[]
  historyOpen: boolean
  loadHistory: () => Promise<void>
  newConversation: () => Promise<void>
  openConversation: (id: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  setHistoryOpen: (v: boolean) => void
  persistConv: () => Promise<void>

  init: () => Promise<void>
  checkUpdate: () => Promise<void>
  dismissUpdate: () => void
  sendCode: (phone: string) => Promise<{ ok: boolean; error?: string }>
  loginWithCode: (phone: string, code: string, invite?: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => void
  refreshMe: () => Promise<void>

  setView: (v: View) => void
  setSelectedModel: (m: string) => void
  setTier: (t: Tier) => void // 切档：标准→选 standard 模型并清参考图；高质量→选可用质量模型
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>

  generate: (
    prompt: string,
    opts?: { initImage?: string; initImages?: string[]; mask?: string; ratioKey?: string; qualityKey?: string; modelOverride?: string }
  ) => Promise<void>
  clearChat: () => void
  setNeedRecharge: (v: boolean) => void
  sendToEditor: (dataUrl: string) => void

  // 对话模式（GPT 沟通创意，按点数计费，由服务端权威扣点）
  chatMode: boolean
  setChatMode: (v: boolean) => void
  chatSend: (text: string, refs?: string[]) => Promise<void>

  // 设计工坊（对话拆解项目 → 预览确认 → 逐张异步生成推送）
  designMode: boolean
  setDesignMode: (v: boolean) => void
  runDesign: (brief: string, preview: boolean, refs?: string[]) => Promise<void>
  genDesign: (items: { title: string; prompt: string; ratio: string }[]) => Promise<void>
  regenMessage: (idx: number) => Promise<void> // 需求1：对失败消息原位重生该项
  replanDesign: (brief: string, count: number, adjust: string, refCount: number) => Promise<{ title: string; prompt: string; ratio: string }[] | null>
  addAssistantImage: (dataUrl: string) => void // 局部重绘结果同步进聊天

  // 从应用任意位置拖入的图片（App 根级 drop 收集），待 ChatView 消费为参考图
  pendingRefs: string[]
  addPendingRefs: (urls: string[]) => void
  clearPendingRefs: () => void

  canAbort: boolean // 生图进行中、可中止
  abortGenerate: () => void
  abortOne: (reqId: string) => void
}

let genAC: AbortController | null = null // 设计工坊整批的中止控制器
let designRefs: string[] = [] // 设计工坊本次上传的参考图（整套设计沿用；预览确认/续生成共用）
// 问题二B(桌面)：普通生图并发任务的中止器(reqId→cancel)，供「全部中止」。
const genJobs = new Map<string, () => void>()
// 普通生图前端并发上限(与后端 user_concurrency 默认一致；后端为权威，超出 429 兜底)。
export const MAX_CONCURRENT = 3

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  account: null,
  models: [],
  modelMeta: {},
  pricing: null,
  selectedModel: '',
  tier: 'standard',
  settings: { defaultFormat: 'png', customFonts: [] },
  view: 'chat',
  messages: [],
  generating: false,
  activeGen: 0,
  genStatus: '',
  needRecharge: false,
  editorImage: undefined,
  update: null,
  chatMode: false,
  designMode: false,
  canAbort: false,
  pendingRefs: [],
  convId: uid(),
  convList: [],
  historyOpen: false,

  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  async loadHistory() { set({ convList: await convMetas() }) },
  async persistConv() {
    const { messages, convId } = get()
    if (!messages.length) return
    const title = (messages.find((m) => m.role === 'user')?.content || '新对话').slice(0, 24)
    // 不持久化「生成中」占位：避免重载后留下永远转圈的占位条
    const msgs = messages.filter((m) => !m.pending)
    if (!msgs.length) return
    await convSave({ id: convId, title, at: Date.now(), msgs })
    set({ convList: await convMetas() })
  },
  async newConversation() {
    if (get().activeGen > 0 || get().generating) return // 问题二B：有图在并发生成中，禁止切/建会话，否则在飞任务完成后会把图落入新会话造成错乱
    // 免费用户不保留多段历史：开新对话时删掉旧的
    if (!get().account?.quota.memberActive) await convDel(get().convId)
    set({ convId: uid(), messages: [], historyOpen: false, view: 'chat' })
    set({ convList: await convMetas() })
  },
  async openConversation(id) {
    if (get().activeGen > 0 || get().generating) return // 问题二B：生图并发中禁止切会话(防在飞任务把图落入别的会话)
    const msgs = await convLoad(id)
    set({ convId: id, messages: msgs, historyOpen: false, view: 'chat' })
  },
  async deleteConversation(id) {
    if (get().activeGen > 0 || get().generating) return // 生图并发中暂不删会话(防误删当前会话清空在飞结果)
    await convDel(id)
    const list = await convMetas()
    set({ convList: list })
    if (id === get().convId) set({ convId: uid(), messages: [] })
  },

  async checkUpdate() {
    let cur = ''
    try {
      cur = await window.api.app.getVersion()
    } catch {
      return
    }
    if (!cur) return
    // 重试若干次：冷启动/网络抖动时单次请求可能失败，导致"有时不弹更新提示"。拿到明确结果才停。
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await api.appVersion()
        if (r.ok && r.data.version) {
          if (isNewer(r.data.version, cur)) {
            set({
              update: {
                version: r.data.version,
                current: cur,
                url: r.data.url || 'https://cogpt.art/download',
                notes: r.data.notes || '',
                force: !!r.data.force
              }
            })
          }
          return
        }
      } catch {
        /* 网络抖动，稍后重试 */
      }
      await new Promise((res) => setTimeout(res, 3000))
    }
  },
  dismissUpdate: () => set({ update: null }),

  async init() {
    void get().checkUpdate()
    const settings = await window.api.config.getSettings()
    const saved = localStorage.getItem(TOKEN_KEY)
    if (saved) {
      setToken(saved)
      const me = await api.me()
      if (me.ok) {
        const m = await api.models()
        const models = m.data.models || []
        const modelMeta = m.data.meta || {}
        const pricing = m.data.pricing || null
        const pick = initialModelTier(models, modelMeta)
        const metas = await convMetas()
        const recent = metas[0]
        const recentMsgs = recent ? await convLoad(recent.id) : []
        set({
          account: { phone: me.data.phone, quota: me.data },
          models,
          modelMeta,
          pricing,
          selectedModel: pick.model,
          tier: pick.tier,
          settings,
          ready: true,
          convList: metas,
          convId: recent ? recent.id : get().convId,
          messages: recentMsgs
        })
        return
      }
      // token 失效
      localStorage.removeItem(TOKEN_KEY)
      setToken(null)
    }
    set({ settings, ready: true })
  },

  async sendCode(phone) {
    const r = await api.sendCode(phone)
    return r.ok ? { ok: true } : { ok: false, error: r.data?.error || '发送失败' }
  },

  async loginWithCode(phone, code, invite) {
    const r = await api.login(phone, code, invite)
    if (!r.ok || !r.data?.token) return { ok: false, error: r.data?.error || '登录失败' }
    localStorage.setItem(TOKEN_KEY, r.data.token)
    setToken(r.data.token)
    const me = await api.me()
    const m = await api.models()
    const models = m.data.models || []
    const modelMeta = m.data.meta || {}
    const pricing = m.data.pricing || null
    const pick = initialModelTier(models, modelMeta)
    set({
      account: me.ok ? { phone: me.data.phone, quota: me.data } : { phone, quota: me.data },
      models,
      modelMeta,
      pricing,
      selectedModel: pick.model,
      tier: pick.tier
    })
    return { ok: true }
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    set({ account: null, messages: [] })
  },

  async refreshMe() {
    if (!getToken()) return
    const me = await api.me()
    if (me.ok) set({ account: { phone: me.data.phone, quota: me.data } })
  },

  setView: (view) => set({ view }),
  // 在高质量档内切具体模型（GPT / Nano Banana）。tier 同步成该模型的档位。
  setSelectedModel: (selectedModel) =>
    set({
      selectedModel,
      tier: (get().modelMeta[selectedModel]?.mode === 'standard' ? 'standard' : 'quality') as Tier
    }),
  // 切档：标准→选 mode=standard 的模型（并由 generate 时隐藏参考图、锁 3 画幅）；
  // 高质量→选可用的质量模型（保留当前若已是质量档）。没有对应模型则不动。
  setTier(t) {
    const { models, modelMeta, selectedModel } = get()
    const list = modelsOfTier(models, modelMeta, t)
    // 当前模型已属于目标档，仅切换 tier 标记即可
    if (list.includes(selectedModel)) { set({ tier: t }); return }
    if (!list.length) { set({ tier: t }); return } // 该档无模型：只切标记，UI 自行提示
    set({ tier: t, selectedModel: list[0] })
  },

  async saveSettings(patch) {
    const settings = await window.api.config.setSettings(patch)
    set({ settings })
  },

  async generate(prompt, opts) {
    const trimmed = prompt.trim()
    // 对话带参考图时可强制用支持参考图的模型（modelOverride）；否则用所选模型
    const model = opts?.modelOverride || get().selectedModel
    if (!model) {
      set((s) => ({ messages: [...s.messages, { role: 'assistant', content: '暂无可用模型，请稍后重试' }] }))
      return
    }
    if (get().activeGen >= MAX_CONCURRENT) return // 问题二B：达并发上限，先等一张完成
    // 按 meta 收口：标准档（或模型不支持参考图）一律丢弃参考图，并把不支持的画幅回退到 1:1。
    const meta = get().modelMeta[model] || DEFAULT_META
    let refImages = opts?.initImages?.length ? opts.initImages : opts?.initImage ? [opts.initImage] : []
    if (!meta.ref) refImages = []
    let ratioKey = opts?.ratioKey
    if (ratioKey && !ratioSupported(model, ratioKey)) ratioKey = DEFAULT_RATIO
    if (!trimmed && refImages.length === 0) return

    const userMsg: ChatMessage = { role: 'user', content: trimmed, images: refImages.length ? refImages : undefined }
    // 问题二B：并发生图——本任务独立 reqId/AbortController，记入 genJobs 供「全部中止」，用 activeGen 计数(不占全局 generating)。
    // 所有消息更新一律用函数式 set((s)=>...)，避免多张并发时 [...get().messages] 读旧值互相覆盖。
    const ac = new AbortController()
    const reqId = crypto.randomUUID()
    genJobs.set(reqId, () => { void api.cancelGenerate(reqId); ac.abort() })
    // 每张生成各自占位(带独立中止)，落在那条请求下面；多张并发可单独中止其中一两张。
    set((s) => ({ messages: [...s.messages, userMsg, { role: 'assistant', pending: true, genReqId: reqId, content: '' }], activeGen: s.activeGen + 1 }))
    // 用 genReqId 把结果/错误替换回该次生成的占位条(多张并发各归各位)。
    const rep = (m: ChatMessage): void => set((s) => ({ messages: s.messages.map((x) => (x.genReqId === reqId ? m : x)) }))
    try {
      const size = ratioKey === 'orig' ? await resolveOrigSize(refImages[0]) : ratioKey ? modelSizeFor(ratioKey) : undefined
      const hdEdge = opts?.qualityKey ? qualityLongEdge(opts.qualityKey) : undefined
      const reqBody = {
        prompt: trimmed, size, model,
        initImages: refImages.length ? refImages : undefined,
        mask: opts?.mask, reqId, hdEdge,
        // 局部重绘=精确改图：失败不静默换兜底模型补近似图。
        noFallback: opts?.mask ? true : undefined
      }
      type GenRes = Awaited<ReturnType<typeof api.generate>>
      let res: GenRes | null = null
      let lastErr = '生成失败，请稍后再试'
      let busyMsg = ''
      let sub: GenRes
      try {
        sub = await api.generate({ ...reqBody, async: true }, ac.signal)
      } catch {
        sub = { ok: false, status: 0, data: { error: '网络异常，无法连接服务器' } } as GenRes
      }
      if (!ac.signal.aborted) {
        if (sub.status === 429) busyMsg = sub.data?.error || '当前同时生成的张数已达上限，请等其中一张完成再试'
        else if (sub.status === 200 && sub.data?.images?.length) res = sub
        else if (sub.status === 202 || (sub.data as { accepted?: boolean })?.accepted) {
          const t0 = Date.now()
          while (!ac.signal.aborted && Date.now() - t0 < 315_000) {
            await waitAbortable(3000, ac.signal)
            if (ac.signal.aborted) break
            let st: Awaited<ReturnType<typeof api.generateStatus>>
            try { st = await api.generateStatus(reqId, ac.signal) } catch { continue }
            if (ac.signal.aborted) break
            const state = st.data?.state
            if (state === 'done') { res = { ok: st.data.status === 200, status: st.data.status ?? 0, data: st.data.result || {} } as GenRes; break }
            if (state === 'missing') { lastErr = '生成任务已丢失，请重试'; break }
          }
          if (!res && !ac.signal.aborted && lastErr === '生成失败，请稍后再试') lastErr = '生成超时了，请重试或换个模型'
        } else lastErr = sub.data?.error || lastErr
      }
      // 用户中止：未出图不计费；刷新额度如实显示
      if (ac.signal.aborted) {
        rep({ role: 'assistant', content: '已中止生成（未出图，不计费）' })
        await get().refreshMe()
        return
      }
      if (busyMsg) { rep({ role: 'assistant', content: `${busyMsg}` }); return }
      if (res && (res.status === 402 || res.data?.needRecharge)) {
        rep({ role: 'assistant', content: '额度已用完，请开通或升级会员后再试。' })
        set({ needRecharge: true })
        return
      }
      if (res && res.status === 400) { rep({ role: 'assistant', content: `${res.data?.error ?? '请求有误，请修改后重试'}` }); return }
      const success = !!(res && res.ok && res.data.images && res.data.images.length)
      if (!success) {
        // 问题一：网络/超时类失败——这张可能已在后台生成完成(进云作品库且已扣额度)，提示去云库查看并刷新额度；确定性失败保留原文案。
        const networky = !res && /网络|超时|timeout/i.test(lastErr)
        const msg = networky ? '网络不稳定，这张可能已在后台生成完成——请到「云作品库」查看；若没有再点重新生成。' : `${res?.data?.error || lastErr}`
        rep({ role: 'assistant', content: msg, retry: opts?.mask ? undefined : { kind: 'gen', prompt: trimmed, refs: refImages.length ? refImages : undefined, ratio: ratioKey, model } })
        void get().refreshMe()
        return
      }
      let images = res!.data.images as string[]
      // 高清化（本地 Lanczos 按长边等比放大，绝不裁切）
      if (opts?.qualityKey && images.length) {
        const long = qualityLongEdge(opts.qualityKey)
        if (long > 1536) {
          images = await Promise.all(images.map(async (d) => { const r = await window.api.image.process({ dataUrl: d, width: long, height: long, fit: 'inside' }); return r.ok && r.dataUrl ? r.dataUrl : d }))
        }
      }
      const note = res!.data.fallback ? (res!.data.approx ? '参考图通道繁忙，已根据图片描述生成「近似图」（非精确改图，仅供参考）' : '高质量模型当前繁忙，已用「极速」模型为你生成（风格可能略有不同）') : undefined
      const assistant: ChatMessage = { role: 'assistant', content: res!.data.text ?? '', images, note, src: { prompt: trimmed, refs: refImages.length ? refImages : undefined, ratio: ratioKey } }
      const quota = res!.data.quota
      rep(assistant)
      if (quota) set((s) => (s.account ? { account: { ...s.account, quota } } : {}))
      void get().persistConv()
    } finally {
      set((s) => ({ activeGen: Math.max(0, s.activeGen - 1) }))
      genJobs.delete(reqId)
    }
  },

  clearChat: () => { void get().newConversation() },
  setNeedRecharge: (needRecharge) => set({ needRecharge }),
  sendToEditor: (dataUrl) => set({ editorImage: dataUrl, view: 'editor' }),

  setChatMode: (chatMode) => set({ chatMode, designMode: false }),
  setDesignMode: (designMode) => set({ designMode, chatMode: false }),

  async runDesign(brief, preview, refs) {
    const p = brief.trim()
    const curRefs = refs || []
    if ((!p && curRefs.length === 0) || get().generating) return
    if (get().activeGen > 0) { set((s) => ({ messages: [...s.messages, { role: 'assistant', content: '当前还有图在生成中，请等它完成后再启动设计工坊。' }] })); return } // 防：生图飞行时拆解会扣额度却静默不出图
    designRefs = curRefs // 整套设计沿用这批参考图
    set({ messages: [...get().messages, { role: 'user', content: p || '（参考图设计）', images: curRefs.length ? curRefs : undefined }], generating: true, genStatus: '正在拆解设计需求…' })
    let r: Awaited<ReturnType<typeof api.designPlan>>
    try {
      r = await api.designPlan(p, curRefs.length)
    } catch {
      r = { ok: false, status: 0, data: { error: '网络异常，无法连接服务器' } }
    }
    set({ generating: false, genStatus: '' })
    if (r.status === 402 || r.data?.needRecharge) {
      set({ messages: [...get().messages, { role: 'assistant', content: '点数已用完，请开通/升级或邀请好友得免费点数。' }], needRecharge: true })
      return
    }
    if (!r.ok || !r.data?.items?.length) {
      set({ messages: [...get().messages, { role: 'assistant', content: `${r.data?.error || '没能拆解需求，请把项目描述得更具体些'}` }] })
      return
    }
    await get().refreshMe()
    const items = r.data.items
    if (preview) set({ messages: [...get().messages, { role: 'assistant', content: '', design: items, brief: p }] })
    else await get().genDesign(items)
  },

  // 设计工坊"让 AI 补足/重排到 N 张"：带 count+adjust 重新拆解，返回新清单给方案卡替换（不直接改 messages）。
  async replanDesign(brief, count, adjust, refCount) {
    let r: Awaited<ReturnType<typeof api.designPlan>>
    try { r = await api.designPlan(brief, refCount, count, adjust) } catch { return null }
    if (r.status === 402 || r.data?.needRecharge) { set({ needRecharge: true }); return null }
    if (!r.ok || !r.data?.items?.length) return null
    await get().refreshMe()
    return r.data.items
  },

  async genDesign(items) {
    if (get().generating || get().activeGen > 0) return
    const { models, modelMeta, selectedModel } = get()
    // 有参考图：用支持参考图的模型，让整套图基于上传的 logo/产品图等保持一致
    const useModel = designRefs.length
      ? (models.find((m) => modelMeta[m]?.ref) || models.find((m) => modelMeta[m]?.mode !== 'standard') || selectedModel)
      : (models.find((m) => modelMeta[m]?.mode !== 'standard') || selectedModel || models[0] || 'gpt-image-2')
    const ac = new AbortController()
    genAC = ac
    set({ generating: true, canAbort: true, genStatus: '正在生成…' })
    let doneN = 0
    let paused = false
    // 问题二B：设计工坊小并发池——每批 MAX_CONCURRENT 张并行(批间串行)，提速又不打爆中转站/触发熔断；保住"点数不足即暂停"。
    for (let i = 0; i < items.length && !ac.signal.aborted && !paused; i += MAX_CONCURRENT) {
      const batch = items.slice(i, i + MAX_CONCURRENT)
      set({ genStatus: `正在并行生成第 ${i + 1}–${Math.min(i + MAX_CONCURRENT, items.length)}/${items.length} 张…（可中止）` })
      const results = await Promise.all(batch.map((it) => genOneJob({ prompt: it.prompt, model: useModel, size: modelSizeFor(it.ratio), reqId: crypto.randomUUID(), initImages: designRefs.length ? designRefs : undefined }, ac)))
      if (ac.signal.aborted) break
      const shortfall: { title: string; prompt: string; ratio: string }[] = []
      for (let j = 0; j < results.length; j++) {
        const r = results[j], it = batch[j]
        if (r.needRecharge) { shortfall.push(it); continue }
        if (r.img) { const img = r.img; set((s) => ({ messages: [...s.messages, { role: 'assistant', content: '', images: [img], note: `【${it.title}】${it.ratio}`, src: { prompt: it.prompt, refs: designRefs.length ? designRefs : undefined, ratio: it.ratio } }] })); doneN++ }
        else set((s) => ({ messages: [...s.messages, { role: 'assistant', content: `第 ${i + j + 1} 张「${it.title}」生成失败：${r.err}`, retry: { kind: 'design', prompt: it.prompt, refs: designRefs.length ? designRefs : undefined, ratio: it.ratio, model: useModel } }] }))
      }
      if (shortfall.length) {
        paused = true
        const remaining = [...shortfall, ...items.slice(i + MAX_CONCURRENT)]
        set((s) => ({ messages: [...s.messages, { role: 'assistant', content: `点数不足，本套设计已暂停（还剩 ${remaining.length} 张未生成）。请到「会员」充值/升级或邀请好友，然后点下方按钮继续。` }, { role: 'assistant', content: '', design: remaining, resume: true }], needRecharge: true }))
      }
    }
    genAC = null
    set({ generating: false, canAbort: false, genStatus: '' })
    await get().refreshMe()
    if (!paused) {
      set((s) => ({ messages: [...s.messages, { role: 'assistant', content: ac.signal.aborted ? `已中止（已完成 ${doneN}/${items.length} 张）` : `这套设计已生成完毕（共 ${doneN}/${items.length} 张）。` }] }))
    }
  },
  // 需求1：对某条失败消息重生该项（普通生图/设计工坊单张），原位替换结果，不影响其它项。问题二B：算一个并发任务、不占全局 generating。
  async regenMessage(idx) {
    if (get().generating || get().activeGen >= MAX_CONCURRENT) return
    const rt = get().messages[idx]?.retry
    if (!rt) return
    const ac = new AbortController()
    const reqId = crypto.randomUUID()
    genJobs.set(reqId, () => ac.abort()) // 中止仅断本地；后端取消由 genOneJob 的 abort 监听以同一 reqId 触发，避免重复 cancel
    set((s) => ({ activeGen: s.activeGen + 1 }))
    try {
      const r = await genOneJob({ prompt: rt.prompt, model: rt.model || get().selectedModel, size: rt.ratio ? modelSizeFor(rt.ratio) : undefined, reqId, initImages: rt.refs?.length ? rt.refs : undefined }, ac)
      if (ac.signal.aborted) return
      if (r.needRecharge) { set((s) => ({ messages: s.messages.map((x, j) => (j === idx ? { ...x, content: '额度已用完，请开通或升级会员后再试。', retry: rt } : x)), needRecharge: true })); return }
      if (r.img) {
        const img = r.img
        set((s) => ({ messages: s.messages.map((x, j) => (j === idx ? { role: 'assistant', content: '', images: [img], note: rt.kind === 'design' ? '已重新生成' : undefined, src: { prompt: rt.prompt, refs: rt.refs, ratio: rt.ratio } } : x)) }))
        const q = r.quota; if (q) set((s) => (s.account ? { account: { ...s.account, quota: q } } : {}))
        void get().persistConv()
      } else {
        set((s) => ({ messages: s.messages.map((x, j) => (j === idx ? { ...x, content: '重新生成失败：' + (r.err || '请重试'), retry: rt } : x)) }))
      }
    } finally {
      set((s) => ({ activeGen: Math.max(0, s.activeGen - 1) }))
      genJobs.delete(reqId)
    }
  },
  abortGenerate: () => { genJobs.forEach((fn) => fn()); genAC?.abort() },
  abortOne: (reqId) => { genJobs.get(reqId)?.() }, // 单独中止某一张并发生成

  // 局部重绘结果同步进聊天框，保存记录
  addAssistantImage: (dataUrl) => {
    set({ messages: [...get().messages, { role: 'assistant', content: '（局部重绘）', images: [dataUrl] }] })
    void get().persistConv()
  },

  // 全局拖入图片：收集后切到对话生图页（关对话模式），由 ChatView 消费为参考图
  addPendingRefs: (urls) => { if (urls.length) set({ pendingRefs: [...get().pendingRefs, ...urls].slice(-8), view: 'chat', chatMode: false }) },
  clearPendingRefs: () => set({ pendingRefs: [] }),

  async chatSend(input, refs) {
    const p = input.trim()
    if (!p || get().generating) return
    // 回复"生成"等 → 用沟通好的提示词直接出图（带参考图则自动用支持参考图的模型）
    if (/^(生成|出图|生成图片|开始生成|画吧|可以了|可以生成)$/.test(p)) {
      const msgs = get().messages
      let gp = ''
      for (let i = msgs.length - 1; i >= 0 && !gp; i--) {
        const m = msgs[i]
        if (m.role === 'assistant' && m.content) { const mm = /\[\[生图提示词\]\]\s*(.+)/.exec(m.content); if (mm) gp = mm[1].trim() }
      }
      if (!gp) for (let i = msgs.length - 1; i >= 0 && !gp; i--) { if (msgs[i].role === 'user' && msgs[i].content) gp = msgs[i].content.trim() }
      if (gp) {
        const refModel = refs?.length ? get().models.find((m) => get().modelMeta[m]?.ref) : undefined
        await get().generate(gp, refs?.length ? { initImages: refs, modelOverride: refModel } : undefined)
        return
      }
    }
    const msgs = get().messages
    const history = [
      ...msgs.filter((m) => !!m.content).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: p }
    ].slice(-12)
    set({ messages: [...msgs, { role: 'user', content: p }], generating: true, genStatus: '正在思考…' })
    let r: Awaited<ReturnType<typeof api.chat>>
    try {
      r = await api.chat(history)
    } catch {
      r = { ok: false, status: 0, data: { error: '网络异常' } }
    }
    if (r.status === 402 || r.data?.needRecharge) {
      set({ messages: [...get().messages, { role: 'assistant', content: '点数已用完，请开通/升级或邀请好友得免费点数。' }], generating: false, genStatus: '', needRecharge: true })
      return
    }
    if (r.ok && r.data?.reply) {
      const patch: Partial<AppStore> = { messages: [...get().messages, { role: 'assistant', content: r.data.reply }], generating: false, genStatus: '' }
      if (r.data.quota) { const acc = get().account; if (acc) patch.account = { ...acc, quota: r.data.quota } }
      set(patch)
      void get().persistConv()
    } else {
      set({ messages: [...get().messages, { role: 'assistant', content: `${r.data?.error || '对话失败'}` }], generating: false, genStatus: '' })
    }
  }
}))
