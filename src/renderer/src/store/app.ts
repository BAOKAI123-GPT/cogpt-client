import { create } from 'zustand'
import type { AppSettings, ChatMessage } from '@shared/types'
import { api, setToken, getToken, type Quota, type ModelMeta, type ModelMetaItem, type Pricing } from '../lib/api'
import { modelSizeFor, qualityLongEdge, ratioSupported, DEFAULT_RATIO } from '../lib/genOptions'

export type Tier = 'standard' | 'quality'
const DEFAULT_META: ModelMetaItem = { mode: 'quality', credits: 1, ref: true }

// 单张异步生成（提交→轮询），供设计工坊逐张生成复用。reqBody.reqId 必填。
async function genOneJob(
  reqBody: { prompt: string; model: string; size?: string; reqId: string },
  ac: AbortController
): Promise<{ img?: string; quota?: Quota; err?: string; needRecharge?: boolean }> {
  let sub: Awaited<ReturnType<typeof api.generate>>
  try {
    sub = await api.generate({ ...reqBody, async: true }, ac.signal)
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
    await new Promise((r) => setTimeout(r, 3000))
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

export type View = 'chat' | 'library' | 'editor' | 'settings'
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
  generating: boolean
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
  runDesign: (brief: string, preview: boolean) => Promise<void>
  genDesign: (items: { title: string; prompt: string; ratio: string }[]) => Promise<void>
  addAssistantImage: (dataUrl: string) => void // 局部重绘结果同步进聊天

  // 从应用任意位置拖入的图片（App 根级 drop 收集），待 ChatView 消费为参考图
  pendingRefs: string[]
  addPendingRefs: (urls: string[]) => void
  clearPendingRefs: () => void

  canAbort: boolean // 生图进行中、可中止
  abortGenerate: () => void
}

let genAC: AbortController | null = null // 当前生图请求的中止控制器
let genReqId: string | null = null // 当前生图的 reqId（用于通知服务端中止）

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
    await convSave({ id: convId, title, at: Date.now(), msgs: messages })
    set({ convList: await convMetas() })
  },
  async newConversation() {
    // 免费用户不保留多段历史：开新对话时删掉旧的
    if (!get().account?.quota.memberActive) await convDel(get().convId)
    set({ convId: uid(), messages: [], historyOpen: false, view: 'chat' })
    set({ convList: await convMetas() })
  },
  async openConversation(id) {
    const msgs = await convLoad(id)
    set({ convId: id, messages: msgs, historyOpen: false, view: 'chat' })
  },
  async deleteConversation(id) {
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
      set({ messages: [...get().messages, { role: 'assistant', content: '⚠️ 暂无可用模型，请稍后重试' }] })
      return
    }
    // 按 meta 收口：标准档（或模型不支持参考图）一律丢弃参考图，并把不支持的画幅回退到 1:1。
    // 这样即使 UI 残留了参考图/比例，也不会发出该模型拒绝的请求。
    const meta = get().modelMeta[model] || DEFAULT_META
    let refImages = opts?.initImages?.length ? opts.initImages : opts?.initImage ? [opts.initImage] : []
    if (!meta.ref) refImages = []
    let ratioKey = opts?.ratioKey
    if (ratioKey && !ratioSupported(model, ratioKey)) ratioKey = DEFAULT_RATIO
    if (!trimmed && refImages.length === 0) return

    const userMsg: ChatMessage = { role: 'user', content: trimmed, images: refImages.length ? refImages : undefined }
    const ac = new AbortController()
    genAC = ac
    set({ messages: [...get().messages, userMsg], generating: true, genStatus: '正在生成…', canAbort: true })

    const size = ratioKey ? modelSizeFor(ratioKey) : undefined
    // 所选画质长边：传给后端计高清加点（hdEdge≥阈值时按 pricing.hdSurcharge 加点）
    const hdEdge = opts?.qualityKey ? qualityLongEdge(opts.qualityKey) : undefined
    // 稳定的 reqId：3 次重试共用同一个，服务端据此幂等去重，避免重复扣费
    const reqId = crypto.randomUUID()
    genReqId = reqId
    const reqBody = {
      prompt: trimmed,
      size,
      model,
      initImages: refImages.length ? refImages : undefined,
      mask: opts?.mask,
      reqId,
      hdEdge
    }

    // 异步保活：提交后台生成 → 每 3s 轮询，单次持续直到出图/失败/取消（取消多次重试，穿透 Cloudflare ~100s）。
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
      if (sub.status === 429) busyMsg = sub.data?.error || '上一张还在收尾，请等几秒再试'
      else if (sub.status === 200 && sub.data?.images?.length) res = sub // 提交即命中缓存
      else if (sub.status === 202 || (sub.data as { accepted?: boolean })?.accepted) {
        const t0 = Date.now()
        while (!ac.signal.aborted && Date.now() - t0 < 315_000) {
          await new Promise((r) => setTimeout(r, 3000))
          if (ac.signal.aborted) break
          set({ genStatus: `正在生成…（已 ${Math.round((Date.now() - t0) / 1000)}s，通常 1–3 分钟）· 可中止` })
          let st: Awaited<ReturnType<typeof api.generateStatus>>
          try {
            st = await api.generateStatus(reqId, ac.signal)
          } catch {
            continue
          }
          if (ac.signal.aborted) break
          const state = st.data?.state
          if (state === 'done') {
            res = { ok: st.data.status === 200, status: st.data.status ?? 0, data: st.data.result || {} } as GenRes
            break
          }
          if (state === 'missing') {
            lastErr = '生成任务已丢失，请重试'
            break
          }
        }
        if (!res && !ac.signal.aborted && lastErr === '生成失败，请稍后再试') lastErr = '生成超时了，请重试或换个模型'
      } else lastErr = sub.data?.error || lastErr
    }

    genAC = null
    // 用户中止：未出图不计费（服务端在出图后才扣，中止即不扣）；刷新额度如实显示
    if (ac.signal.aborted) {
      set({
        messages: [...get().messages, { role: 'assistant', content: '已中止生成（未出图，不计费）' }],
        generating: false,
        genStatus: '',
        canAbort: false
      })
      await get().refreshMe()
      return
    }
    set({ canAbort: false })
    // 忙（上一张还在收尾，达并发上限）
    if (busyMsg) {
      set({ messages: [...get().messages, { role: 'assistant', content: `⚠️ ${busyMsg}` }], generating: false, genStatus: '', canAbort: false })
      return
    }
    // 额度不足
    if (res && (res.status === 402 || res.data?.needRecharge)) {
      set({ messages: [...get().messages, { role: 'assistant', content: '⚠️ 额度已用完，请开通或升级会员后再试。' }], generating: false, genStatus: '', canAbort: false, needRecharge: true })
      return
    }
    // 校验/审核类错误
    if (res && res.status === 400) {
      set({ messages: [...get().messages, { role: 'assistant', content: `⚠️ ${res.data?.error ?? '请求有误，请修改后重试'}` }], generating: false, genStatus: '', canAbort: false })
      return
    }
    const success = !!(res && res.ok && res.data.images && res.data.images.length)
    if (!success) {
      set({
        messages: [...get().messages, { role: 'assistant', content: `⚠️ ${res?.data?.error || lastErr}` }],
        generating: false,
        genStatus: ''
      })
      return
    }

    let images = res!.data.images as string[]
    // 高清化（本地 Lanczos 按长边等比放大，保持原图比例，绝不裁切）
    if (opts?.qualityKey && images.length) {
      const long = qualityLongEdge(opts.qualityKey)
      // 只有当目标长边大于模型出图(约 1024/1536)时才放大，避免无谓处理
      if (long > 1536) {
        set({ genStatus: '正在生成高清大图…' })
        images = await Promise.all(
          images.map(async (d) => {
            const r = await window.api.image.process({ dataUrl: d, width: long, height: long, fit: 'inside' })
            return r.ok && r.dataUrl ? r.dataUrl : d
          })
        )
      }
    }
    // 后端返回 fallback=true 时：所选模型繁忙失败、已自动用「极速」模型补出这张图。
    // approx=true 表示是「按参考图描述生成的近似图」（参考图通道都失败的兜底，非精确改图）。
    const note = res!.data.fallback
      ? res!.data.approx
        ? '⚡ 参考图通道繁忙，已根据图片描述生成「近似图」（非精确改图，仅供参考）'
        : '⚡ 高质量模型当前繁忙，已用「极速」模型为你生成（风格可能略有不同）'
      : undefined
    const assistant: ChatMessage = { role: 'assistant', content: res!.data.text ?? '', images, note }
    const patch: Partial<AppStore> = { messages: [...get().messages, assistant], generating: false, genStatus: '' }
    if (res!.data.quota) {
      const acc = get().account
      if (acc) patch.account = { ...acc, quota: res!.data.quota }
    }
    set(patch)
    void get().persistConv()
  },

  clearChat: () => { void get().newConversation() },
  setNeedRecharge: (needRecharge) => set({ needRecharge }),
  sendToEditor: (dataUrl) => set({ editorImage: dataUrl, view: 'editor' }),

  setChatMode: (chatMode) => set({ chatMode, designMode: false }),
  setDesignMode: (designMode) => set({ designMode, chatMode: false }),

  async runDesign(brief, preview) {
    const p = brief.trim()
    if (!p || get().generating) return
    set({ messages: [...get().messages, { role: 'user', content: p }], generating: true, genStatus: '正在拆解设计需求…' })
    let r: Awaited<ReturnType<typeof api.designPlan>>
    try {
      r = await api.designPlan(p)
    } catch {
      r = { ok: false, status: 0, data: { error: '网络异常，无法连接服务器' } }
    }
    set({ generating: false, genStatus: '' })
    if (r.status === 402 || r.data?.needRecharge) {
      set({ messages: [...get().messages, { role: 'assistant', content: '⚠️ 点数已用完，请开通/升级或邀请好友得免费点数。' }], needRecharge: true })
      return
    }
    if (!r.ok || !r.data?.items?.length) {
      set({ messages: [...get().messages, { role: 'assistant', content: `⚠️ ${r.data?.error || '没能拆解需求，请把项目描述得更具体些'}` }] })
      return
    }
    await get().refreshMe()
    const items = r.data.items
    if (preview) set({ messages: [...get().messages, { role: 'assistant', content: '', design: items }] })
    else await get().genDesign(items)
  },

  async genDesign(items) {
    if (get().generating) return
    const { models, modelMeta, selectedModel } = get()
    const useModel = models.find((m) => modelMeta[m]?.mode !== 'standard') || selectedModel || models[0] || 'gpt-image-2'
    const ac = new AbortController()
    genAC = ac
    set({ generating: true, canAbort: true, genStatus: '正在生成…' })
    let doneN = 0
    let paused = false
    for (let i = 0; i < items.length; i++) {
      if (ac.signal.aborted) break
      set({ genStatus: `正在生成第 ${i + 1}/${items.length} 张：${items[i].title}…（可中止）` })
      const reqId = crypto.randomUUID()
      genReqId = reqId
      const r = await genOneJob({ prompt: items[i].prompt, model: useModel, size: modelSizeFor(items[i].ratio), reqId }, ac)
      if (ac.signal.aborted) break
      if (r.needRecharge) {
        paused = true
        const remaining = items.slice(i)
        set({
          messages: [
            ...get().messages,
            { role: 'assistant', content: `⚠️ 点数不足，本套设计已暂停（还剩 ${remaining.length} 张未生成）。请到「会员」充值/升级或邀请好友，然后点下方按钮继续。` },
            { role: 'assistant', content: '', design: remaining, resume: true }
          ],
          needRecharge: true
        })
        break
      }
      if (r.img) {
        set({ messages: [...get().messages, { role: 'assistant', content: '', images: [r.img], note: `【${items[i].title}】${items[i].ratio}` }] })
        doneN++
      } else {
        set({ messages: [...get().messages, { role: 'assistant', content: `⚠️ 第 ${i + 1} 张「${items[i].title}」生成失败：${r.err}` }] })
      }
    }
    genAC = null
    set({ generating: false, canAbort: false, genStatus: '' })
    await get().refreshMe()
    if (!paused) {
      set({ messages: [...get().messages, { role: 'assistant', content: ac.signal.aborted ? `已中止（已完成 ${doneN}/${items.length} 张）` : `✅ 这套设计已生成完毕（共 ${doneN}/${items.length} 张）。` }] })
    }
  },
  abortGenerate: () => { if (genReqId) void api.cancelGenerate(genReqId); genAC?.abort() },

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
      set({ messages: [...get().messages, { role: 'assistant', content: '⚠️ 点数已用完，请开通/升级或邀请好友得免费点数。' }], generating: false, genStatus: '', needRecharge: true })
      return
    }
    if (r.ok && r.data?.reply) {
      const patch: Partial<AppStore> = { messages: [...get().messages, { role: 'assistant', content: r.data.reply }], generating: false, genStatus: '' }
      if (r.data.quota) { const acc = get().account; if (acc) patch.account = { ...acc, quota: r.data.quota } }
      set(patch)
      void get().persistConv()
    } else {
      set({ messages: [...get().messages, { role: 'assistant', content: `⚠️ ${r.data?.error || '对话失败'}` }], generating: false, genStatus: '' })
    }
  }
}))
