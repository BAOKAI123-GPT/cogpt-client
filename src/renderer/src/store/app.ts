import { create } from 'zustand'
import type { AppSettings, ChatMessage } from '@shared/types'
import { api, setToken, getToken, type Quota } from '../lib/api'
import { modelSizeFor, qualityLongEdge } from '../lib/genOptions'

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
  selectedModel: string
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
  recharge: (tier: string) => Promise<void>

  setView: (v: View) => void
  setSelectedModel: (m: string) => void
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>

  generate: (
    prompt: string,
    opts?: { initImage?: string; initImages?: string[]; mask?: string; ratioKey?: string; qualityKey?: string }
  ) => Promise<void>
  clearChat: () => void
  setNeedRecharge: (v: boolean) => void
  sendToEditor: (dataUrl: string) => void
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  account: null,
  models: [],
  selectedModel: '',
  settings: { defaultFormat: 'png', customFonts: [] },
  view: 'chat',
  messages: [],
  generating: false,
  genStatus: '',
  needRecharge: false,
  editorImage: undefined,
  update: null,
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
    try {
      const cur = await window.api.app.getVersion()
      const r = await api.appVersion()
      if (r.ok && r.data.version && isNewer(r.data.version, cur)) {
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
    } catch {
      /* 离线/接口异常则不打扰 */
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
        const metas = await convMetas()
        const recent = metas[0]
        const recentMsgs = recent ? await convLoad(recent.id) : []
        set({
          account: { phone: me.data.phone, quota: me.data },
          models: m.data.models || [],
          selectedModel: (m.data.models || [])[0] || '',
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
    set({
      account: me.ok ? { phone: me.data.phone, quota: me.data } : { phone, quota: me.data },
      models: m.data.models || [],
      selectedModel: (m.data.models || [])[0] || ''
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

  async recharge(tier) {
    const r = await api.payCreate(tier)
    if (r.ok && r.data.payUrl) window.open(r.data.payUrl, '_blank')
    else alert(r.data?.error || '下单失败')
  },

  setView: (view) => set({ view }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),

  async saveSettings(patch) {
    const settings = await window.api.config.setSettings(patch)
    set({ settings })
  },

  async generate(prompt, opts) {
    const trimmed = prompt.trim()
    const refImages = opts?.initImages?.length ? opts.initImages : opts?.initImage ? [opts.initImage] : []
    if (!trimmed && refImages.length === 0) return
    const model = get().selectedModel
    if (!model) {
      set({ messages: [...get().messages, { role: 'assistant', content: '⚠️ 暂无可用模型，请稍后重试' }] })
      return
    }

    const userMsg: ChatMessage = { role: 'user', content: trimmed, images: refImages.length ? refImages : undefined }
    set({ messages: [...get().messages, userMsg], generating: true, genStatus: '正在生成…' })

    const size = opts?.ratioKey ? modelSizeFor(opts.ratioKey) : undefined
    // 稳定的 reqId：3 次重试共用同一个，服务端据此幂等去重，避免重复扣费
    const reqId = crypto.randomUUID()
    const reqBody = {
      prompt: trimmed,
      size,
      model,
      initImages: refImages.length ? refImages : undefined,
      mask: opts?.mask,
      reqId
    }

    // 失败自动重试，最多 3 次；额度不足不重试、立即提示充值。
    const MAX = 3
    type GenRes = Awaited<ReturnType<typeof api.generate>>
    let res: GenRes | null = null
    let lastErr = '生成失败，请稍后再试'
    for (let attempt = 1; attempt <= MAX; attempt++) {
      if (attempt > 1) set({ genStatus: `生成失败，正在自动重试 (${attempt}/${MAX})…` })
      try {
        res = await api.generate(reqBody)
      } catch {
        res = { ok: false, status: 0, data: { error: '网络异常，无法连接服务器' } } as GenRes
      }
      // 额度不足：不重试，直接提示
      if (res.status === 402 || res.data?.needRecharge) {
        set({
          messages: [...get().messages, { role: 'assistant', content: '⚠️ 额度已用完，请开通或升级会员后再试。' }],
          generating: false,
          genStatus: '',
          needRecharge: true
        })
        return
      }
      // 校验/审核类错误（如提示词为空、内容违规）：重试也没用，直接提示
      if (res.status === 400) {
        set({
          messages: [...get().messages, { role: 'assistant', content: `⚠️ ${res.data?.error ?? '请求有误，请修改后重试'}` }],
          generating: false,
          genStatus: ''
        })
        return
      }
      if (res.ok && res.data.images && res.data.images.length) break // 成功，结束重试
      lastErr = res.data?.error || '生成失败，请稍后再试'
    }

    const success = !!(res && res.ok && res.data.images && res.data.images.length)
    if (!success) {
      set({
        messages: [
          ...get().messages,
          { role: 'assistant', content: `⚠️ ${lastErr}（已自动重试 ${MAX} 次仍失败，请稍后再试）` }
        ],
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
    const assistant: ChatMessage = { role: 'assistant', content: res!.data.text ?? '', images }
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
  sendToEditor: (dataUrl) => set({ editorImage: dataUrl, view: 'editor' })
}))
