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

export interface Quota {
  memberActive: boolean
  memberTier: string
  memberCredits: number
  memberExpiresAt: string | null
  freeRemaining: number
  freeDaily: number
  canGenerate: boolean
  source: 'member' | 'free' | null
}

export const api = {
  sendCode: (phone: string) =>
    req('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone }) }),
  login: (phone: string, code: string) =>
    req('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone, code }) }),
  me: (): Promise<{ ok: boolean; status: number; data: { phone: string } & Quota }> => req('/api/me'),
  models: (): Promise<{ ok: boolean; data: { models: string[] } }> => req('/api/models'),
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
  }): Promise<{
    ok: boolean
    status: number
    data: { ok?: boolean; images?: string[]; text?: string; quota?: Quota; error?: string; needRecharge?: boolean }
  }> => req('/api/generate', { method: 'POST', body: JSON.stringify(body) }),
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
