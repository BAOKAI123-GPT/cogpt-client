// cogpt 后端 API 客户端。客户端只跟 https://cogpt.art 通信，永远拿不到中转站密钥。
const BASE = 'https://cogpt.art'

let token: string | null = null
export function setToken(t: string | null): void {
  token = t
}
export function getToken(): string | null {
  return token
}

async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers as any) }
  if (token) headers['authorization'] = `Bearer ${token}`
  const r = await fetch(BASE + path, { ...opts, headers })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}

// 每个模型的元信息：档位(standard/quality)、本次扣额度、是否支持参考图。
// 由后端 /api/models 的 meta 字段驱动，前端据此做两档 UI、额度提示与参考图入口显隐。
export interface ModelMetaItem {
  mode: 'standard' | 'quality'
  credits: number
  ref: boolean
}
export type ModelMeta = Record<string, ModelMetaItem>

export interface Quota {
  memberActive: boolean
  memberTier: string
  memberCredits: number
  memberExpiresAt: string | null
  bonusCredits: number
  freeRemaining: number
  freeDaily: number
  canGenerate: boolean
  source: 'member' | 'bonus' | 'free' | null
  inviteCode?: string
  inviteCount?: number
}

export const api = {
  sendCode: (phone: string) =>
    req('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone }) }),
  login: (phone: string, code: string, invite?: string) =>
    req('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone, code, invite }) }),
  me: (): Promise<{ ok: boolean; status: number; data: { phone: string } & Quota }> => req('/api/me'),
  chat: (
    messages: { role: string; content: string }[]
  ): Promise<{ ok: boolean; status: number; data: { reply?: string; quota?: Quota; error?: string; needRecharge?: boolean } }> =>
    req('/api/chat', { method: 'POST', body: JSON.stringify({ messages }) }),
  cancelGenerate: (reqId: string): Promise<{ ok: boolean; status: number; data: any }> =>
    req('/api/generate/cancel', { method: 'POST', body: JSON.stringify({ reqId }) }),
  models: (): Promise<{ ok: boolean; data: { models: string[]; meta?: ModelMeta } }> =>
    req('/api/models'),
  tiers: (): Promise<{
    ok: boolean
    data: { tiers: { id: string; name: string; priceCents: number; quota: number }[] }
  }> => req('/api/tiers'),
  generate: (body: {
    prompt: string
    size?: string
    model: string
    initImages?: string[]
    mask?: string
    reqId?: string
  }, signal?: AbortSignal): Promise<{
    ok: boolean
    status: number
    data: { ok?: boolean; images?: string[]; text?: string; quota?: Quota; error?: string; needRecharge?: boolean }
  }> => req('/api/generate', { method: 'POST', body: JSON.stringify(body), signal }),
  payCreate: (
    tier: string
  ): Promise<{
    ok: boolean
    data: {
      payUrl?: string
      qrcode?: string
      img?: string
      qrImg?: string
      outTradeNo?: string
      amount?: string
      error?: string
    }
  }> => req('/api/pay/create', { method: 'POST', body: JSON.stringify({ tier }) }),
  payStatus: (
    outTradeNo: string
  ): Promise<{ ok: boolean; data: { status?: string; paid?: boolean; error?: string } }> =>
    req('/api/pay/status?outTradeNo=' + encodeURIComponent(outTradeNo)),
  appVersion: (): Promise<{
    ok: boolean
    data: { version?: string; url?: string; notes?: string; force?: boolean }
  }> => req('/api/app-version')
}
