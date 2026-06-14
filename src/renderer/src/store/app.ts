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

  init: () => Promise<void>
  sendCode: (phone: string) => Promise<{ ok: boolean; error?: string }>
  loginWithCode: (phone: string, code: string) => Promise<{ ok: boolean; error?: string }>
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

  async init() {
    const settings = await window.api.config.getSettings()
    const saved = localStorage.getItem(TOKEN_KEY)
    if (saved) {
      setToken(saved)
      const me = await api.me()
      if (me.ok) {
        const m = await api.models()
        set({
          account: { phone: me.data.phone, quota: me.data },
          models: m.data.models || [],
          selectedModel: (m.data.models || [])[0] || '',
          settings,
          ready: true
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

  async loginWithCode(phone, code) {
    const r = await api.login(phone, code)
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
  },

  clearChat: () => set({ messages: [] }),
  setNeedRecharge: (needRecharge) => set({ needRecharge }),
  sendToEditor: (dataUrl) => set({ editorImage: dataUrl, view: 'editor' })
}))
