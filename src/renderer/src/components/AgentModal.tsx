import { useEffect, useState } from 'react'
import { X, Coins, CheckCircle2 } from 'lucide-react'
import { api, type AgentMe } from '../lib/api'

// 「我要做代理/赚钱」全屏面板：未登记→招募+登记；已登记→佣金仪表盘 + 申请结算(待结归零) + 运营微信二维码。
export function AgentModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [data, setData] = useState<AgentMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [method, setMethod] = useState('alipay')
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [reqBusy, setReqBusy] = useState(false)
  const [reqDone, setReqDone] = useState(false)
  async function load(): Promise<void> {
    setLoading(true)
    const r = await api.agentMe()
    setData(r.ok ? r.data : null)
    setLoading(false)
  }
  useEffect(() => { void load() }, [])
  const yuan = (c?: number): string => '¥' + ((c || 0) / 100).toFixed(2)
  const methodLabel = (m?: string | null): string => (m === 'wechat' ? '微信' : m === 'bank' ? '银行卡' : '支付宝')
  async function enroll(): Promise<void> {
    if (!name.trim() || !account.trim()) { alert('请填写真实姓名和收款账号'); return }
    setBusy(true)
    const r = await api.agentEnroll(name.trim(), method, account.trim())
    setBusy(false)
    if (r.ok) void load(); else alert(r.data?.error || '提交失败')
  }
  async function requestSettle(): Promise<void> {
    setReqBusy(true)
    const r = await api.agentRequestPayout()
    setReqBusy(false)
    if (r.ok) { setReqDone(true); void load() } else alert(r.data?.error || '申请失败')
  }
  function copyPromo(): void {
    const c = data?.inviteCode || ''
    const txt = `我在用 CoGPT —— 好用的 AI 生图工具，对话一句话就能出图。你注册时填我的邀请码 ${c}，咱俩都得免费额度；国内直接打开就能用：https://cogpt.art/app`
    try { void navigator.clipboard.writeText(txt) } catch { /* ignore */ }
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  const lbl = 'text-xs text-gray-400 mb-1 mt-2'
  const proc = data?.stats?.processingCents ?? 0
  const pend = data?.stats?.pendingCents ?? 0
  return (
    <div className="fixed inset-0 z-50 bg-[#0b0814] text-gray-100 flex flex-col">
      <div className="flex items-center gap-3 px-5 h-14 border-b border-edge shrink-0">
        <button className="btn-soft py-1.5 px-3 text-sm" onClick={onClose}>‹ 返回</button>
        <b className="flex-1 text-center">我要做代理 / 赚钱</b>
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-white"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <div className="max-w-xl mx-auto space-y-3">
          {loading ? (
            <div className="text-center text-gray-400 py-10">加载中…</div>
          ) : !data ? (
            <div className="text-center text-gray-400 py-10">加载失败，请重试</div>
          ) : !data.enabled ? (
            <div className="text-center text-gray-400 py-10">代理通道暂未开放</div>
          ) : !data.isAgent ? (
            <>
              <div className="card p-4">
                <div className="font-bold text-base mb-2 flex items-center gap-1.5"><Coins size={18} className="text-amber-300" /> 成为推广代理，长期赚钱</div>
                <div className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">{data.terms}</div>
                <div className="text-amber-300 text-sm mt-2.5">佣金比例：推广用户每次充值金额的 <b>{data.commissionPct}%</b>（现金，复充持续返）· 满 {yuan(data.payoutMinCents)} 可申请结算</div>
              </div>
              <div className="card p-4">
                <div className="font-medium mb-1">登记成为代理（填收款方式即可）</div>
                <div className={lbl}>真实姓名（结算转账用）</div>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 张三" maxLength={40} />
                <div className={lbl}>收款方式</div>
                <div className="flex gap-2 mb-1">{([['alipay', '支付宝'], ['wechat', '微信'], ['bank', '银行卡']] as const).map(([k, l]) => (<button key={k} onClick={() => setMethod(k)} className={`flex-1 py-2 rounded-lg text-sm border border-edge ${method === k ? 'bg-brand text-white' : 'bg-white/5'}`}>{l}</button>))}</div>
                <div className={lbl}>收款账号 / 收款码备注</div>
                <input className="field" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="支付宝/微信账号或姓名，便于核对转账" maxLength={200} />
                <button className="btn-primary w-full mt-3" disabled={busy} onClick={enroll}>{busy ? '提交中…' : '登记成为代理'}</button>
              </div>
            </>
          ) : (
            <>
              <div className="card p-4">
                <div className="font-bold mb-1.5">我的推广码（分享给好友注册时填）</div>
                <div className="font-mono text-2xl tracking-widest font-bold bg-white/5 border border-edge rounded-lg py-3 text-center">{data.inviteCode || '——'}</div>
                <button className="btn-primary w-full mt-2.5" onClick={copyPromo}>{copied ? '已复制，去分享吧' : '复制推广文案'}</button>
              </div>
              <div className="card p-4">
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div><div className="text-gray-400 text-xs">推广用户</div><div className="text-lg font-bold">{data.stats?.referredCount ?? 0} 人</div></div>
                  <div><div className="text-gray-400 text-xs">累计充值</div><div className="text-lg font-bold">{yuan(data.stats?.rechargedCents)}</div></div>
                  <div><div className="text-gray-400 text-xs">累计佣金</div><div className="text-lg font-bold">{yuan(data.stats?.earnedCents)}</div></div>
                  <div><div className="text-gray-400 text-xs">已结算</div><div className="text-lg font-bold">{yuan(data.stats?.paidCents)}</div></div>
                </div>
                <div className="mt-3 text-center bg-brand/15 border border-edge rounded-xl p-3.5">
                  <div className="text-gray-400 text-[13px]">可结算余额</div>
                  <div className="text-3xl font-extrabold text-amber-300">{yuan(pend)}</div>
                  {proc > 0 && <div className="text-sky-300 text-[13px] mt-1">结算处理中（运营转账中）：{yuan(proc)}</div>}
                  <button className="btn-primary w-full mt-2.5" disabled={reqBusy || pend < data.payoutMinCents} onClick={requestSettle}>{reqBusy ? '提交中…' : pend >= data.payoutMinCents ? `申请结算 ${yuan(pend)}` : `满 ${yuan(data.payoutMinCents)} 可申请结算`}</button>
                </div>
                {data.wechatQr && (
                  <div className="mt-3 text-center card p-3.5">
                    <div className={`font-bold mb-1 inline-flex items-center gap-1.5 ${reqDone || proc > 0 ? 'text-emerald-400' : ''}`}>{reqDone ? (<><CheckCircle2 size={16} /> 结算申请已提交！</>) : '联系运营微信'}</div>
                    <div className="text-gray-400 text-[13px] mb-2.5">{reqDone || proc > 0 ? '请扫码加运营微信，核对后会尽快微信转账给你' : '结算 / 咨询请扫码加运营微信'}</div>
                    <img src={data.wechatQr} alt="运营微信二维码" className="w-48 max-w-[70%] mx-auto rounded-lg bg-white p-1.5" />
                  </div>
                )}
                <div className="mt-2.5 text-[13px] text-gray-400 leading-relaxed">佣金比例：每次充值金额的 <b className="text-white">{data.commissionPct}%</b>；收款方式：{methodLabel(data.payMethod)} {data.payAccount}。<br />结算流程：点「申请结算」→ 扫码加运营微信 → 运营核对后微信转账到账。</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
