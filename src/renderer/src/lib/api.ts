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

// 每个模型的元信息：档位(standard/quality)、本次扣点数、是否支持参考图。
// 由后端 /api/models 的 meta 字段驱动，前端据此做两档 UI、点数提示与参考图入口显隐。
// credits 为点数制（标准=10、高质量GPT=20、Gemini/NanoBanana=30）。
export interface ModelMetaItem {
  mode: 'standard' | 'quality'
  credits: number
  ref: boolean
  // 后端 Config 驱动的友好名（如「极速(约6秒)」「通义·中文准」「高质量GPT」）。优先用它展示。
  label?: string
}
export type ModelMeta = Record<string, ModelMetaItem>

// 动态扣点定价规则（后端 /api/models 的 pricing 字段）。
//  - refExtraPoints：多张参考图时，每多 1 张（>1 张）加的点数。
//  - hdSurcharge：高清加点，key 为长边阈值（字符串像素值），value 为加点；
//    按所选画质长边 hdEdge，取 hdEdge≥阈值的最大加点。
export interface Pricing {
  refExtraPoints: number
  hdSurcharge: Record<string, number>
}

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

// 代理/分销（现金佣金 + 申请结算）数据
export interface AgentMe {
  enabled: boolean
  isAgent: boolean
  commissionPct: number
  payoutMinCents: number
  terms: string
  wechatQr: string
  inviteCode: string
  agentName?: string | null
  payMethod?: string | null
  payAccount?: string | null
  stats?: { referredCount: number; rechargedCents: number; earnedCents: number; paidCents: number; processingCents: number; pendingCents: number }
  commissions?: { id: string; createdAt: string; orderAmountCents: number; commissionCents: number }[]
  payouts?: { id: string; createdAt: string; amountCents: number; status: string }[]
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
  // 异步生图轮询：提交(async:true)后每隔几秒查状态。state: running / done(带 status+result) / missing。
  generateStatus: (
    reqId: string,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; status: number; data: { state?: 'running' | 'done' | 'missing'; status?: number; result?: any } }> =>
    req('/api/generate/status', { method: 'POST', body: JSON.stringify({ reqId }), signal }),
  // 设计工坊：把项目需求拆解成多张图的清单（gpt-5.1 回退 gpt-4o，后端处理）。
  // count：指定目标张数（"让 AI 补足/重排到 N 张"）；adjust：新增/删减/风格等调整意见。
  designPlan: (
    brief: string,
    refCount?: number,
    count?: number,
    adjust?: string
  ): Promise<{ ok: boolean; status: number; data: { ok?: boolean; items?: { title: string; prompt: string; ratio: string }[]; quota?: Quota; error?: string; needRecharge?: boolean } }> =>
    req('/api/design/plan', { method: 'POST', body: JSON.stringify({ brief, refCount: refCount || 0, count: count || 0, adjust: adjust || '' }) }),
  models: (): Promise<{ ok: boolean; data: { models: string[]; meta?: ModelMeta; pricing?: Pricing } }> =>
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
    hdEdge?: number // 所选画质长边像素，服务端据此计算高清加点；局部重绘按原图尺寸故不传
    async?: boolean // true=提交后台+轮询(穿透 Cloudflare ~100s)；不传=同步
    noFallback?: boolean // true=失败如实失败、不静默换兜底模型补近似图再扣费（设计批量/局部重绘等精确任务）
  }, signal?: AbortSignal): Promise<{
    ok: boolean
    status: number
    // fallback：所选模型繁忙失败、后端自动用「极速」模型补出了这张图；fallbackModel：实际出图的模型 id。
    // approx：带参考图失败时，按图片描述生成的「近似图」（非精确改图）。
    data: { ok?: boolean; images?: string[]; text?: string; quota?: Quota; error?: string; needRecharge?: boolean; fallback?: boolean; fallbackModel?: string; approx?: boolean }
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
  }> => req('/api/app-version'),
  // —— 代理/分销 ——
  agentMe: (): Promise<{ ok: boolean; status: number; data: AgentMe }> => req('/api/agent/me'),
  agentEnroll: (
    name: string,
    method: string,
    account: string
  ): Promise<{ ok: boolean; status: number; data: { ok?: boolean; inviteCode?: string; error?: string } }> =>
    req('/api/agent/enroll', { method: 'POST', body: JSON.stringify({ name, method, account }) }),
  agentRequestPayout: (): Promise<{ ok: boolean; status: number; data: { ok?: boolean; amountCents?: number; wechatQr?: string; error?: string } }> =>
    req('/api/agent/payout', { method: 'POST' })
}
