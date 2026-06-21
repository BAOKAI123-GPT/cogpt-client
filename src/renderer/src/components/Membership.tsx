import { useEffect, useState } from 'react'
import { X, Crown, Check, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useApp } from '../store/app'
import { api } from '../lib/api'

interface Tier {
  id: string
  name: string
  priceCents: number
  quota: number
}
interface PayPanel {
  name: string
  amount: string
  qrImg?: string
  payUrl?: string
  outTradeNo: string
}

export function Membership({ onClose }: { onClose: () => void }): JSX.Element {
  const account = useApp((s) => s.account)
  const refreshMe = useApp((s) => s.refreshMe)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [pay, setPay] = useState<PayPanel | null>(null)
  const [creating, setCreating] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)
  const [err, setErr] = useState('')
  const q = account?.quota

  useEffect(() => {
    api.tiers().then((r) => r.ok && setTiers(r.data.tiers))
    refreshMe()
  }, [refreshMe])

  // 展示二维码后轮询订单状态，付款成功 → 自动到账 + 刷新额度
  useEffect(() => {
    if (!pay || paid) return
    let stopped = false
    const timer = setInterval(async () => {
      const r = await api.payStatus(pay.outTradeNo)
      if (!stopped && r.ok && r.data.paid) {
        clearInterval(timer)
        setPaid(true)
        refreshMe()
      }
    }, 3000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [pay, paid, refreshMe])

  async function startPay(t: Tier): Promise<void> {
    setErr('')
    setCreating(t.id)
    const r = await api.payCreate(t.id)
    setCreating(null)
    if (r.ok && (r.data.qrImg || r.data.payUrl) && r.data.outTradeNo) {
      setPaid(false)
      setPay({
        name: t.name,
        amount: r.data.amount || (t.priceCents / 100).toFixed(2),
        qrImg: r.data.qrImg,
        payUrl: r.data.payUrl,
        outTradeNo: r.data.outTradeNo
      })
    } else {
      setErr(r.data?.error || '下单失败，请稍后再试')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={onClose}>
      <div
        className="card p-6 w-[560px] max-w-[95vw] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'linear-gradient(160deg,#241b3d 0%,#1c1d22 60%)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Crown size={20} className="text-amber-300" /> 会员中心
          </h2>
          <button className="text-gray-400 hover:text-gray-200" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div
          className="rounded-2xl p-5 mb-5 text-white"
          style={{ background: 'linear-gradient(120deg,#7b5cff 0%,#b06cff 50%,#16a5c9 100%)' }}
        >
          {q?.memberActive ? (
            <>
              <div className="text-sm opacity-90">会员 · {q.memberTier}</div>
              <div className="text-3xl font-bold mt-1">
                {q.memberCredits}
                <span className="text-base font-normal opacity-90"> 点剩余</span>
              </div>
              {q.memberExpiresAt && (
                <div className="text-xs opacity-80 mt-1">
                  到期：{new Date(q.memberExpiresAt).toLocaleDateString()}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-sm opacity-90">免费用户</div>
              <div className="text-3xl font-bold mt-1">
                {q?.freeRemaining ?? 0}
                <span className="text-base font-normal opacity-90"> / {q?.freeDaily ?? 0} 点今日免费</span>
              </div>
              <div className="text-xs opacity-80 mt-1">开通会员获得更多点数 · 生图失败不扣点</div>
            </>
          )}
        </div>

        {pay ? (
          <PayView pay={pay} paid={paid} onBack={() => { setPay(null); setPaid(false) }} onClose={onClose} />
        ) : (
          <>
            <div className="text-sm font-medium mb-2">开通 / 续费会员（支付宝扫码）</div>
            <div className="space-y-2">
              {tiers.length === 0 && (
                <div className="text-xs text-gray-500 flex items-center gap-2">
                  <Loader2 className="animate-spin" size={13} /> 加载套餐…
                </div>
              )}
              {tiers.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-xl border border-edge p-3 hover:border-brand transition-colors"
                >
                  <Check size={16} className="text-brand" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{t.name}</div>
                    <div className="text-[11px] text-gray-500">每月 {t.quota} 点</div>
                  </div>
                  <div className="text-sm text-gray-200">¥{(t.priceCents / 100).toFixed(2)}/月</div>
                  <button
                    className="btn-primary py-1.5 px-3 text-xs"
                    disabled={creating === t.id}
                    onClick={() => startPay(t)}
                  >
                    {creating === t.id ? <Loader2 className="animate-spin" size={14} /> : '去支付'}
                  </button>
                </div>
              ))}
            </div>
            {err && <p className="text-xs text-red-400 mt-2">{err}</p>}
            <p className="text-[11px] text-gray-500 mt-3">
              点「去支付」用支付宝扫码付款，到账后点数自动发放。生图失败不扣点。
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function PayView({
  pay,
  paid,
  onBack,
  onClose
}: {
  pay: PayPanel
  paid: boolean
  onBack: () => void
  onClose: () => void
}): JSX.Element {
  if (paid) {
    return (
      <div className="flex flex-col items-center text-center py-6">
        <CheckCircle2 size={56} className="text-emerald-400 mb-3" />
        <div className="text-lg font-semibold">支付成功</div>
        <div className="text-sm text-gray-400 mt-1">会员点数已到账，开始生图吧！</div>
        <button className="btn-primary mt-5 px-6" onClick={onClose}>
          完成
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center text-center">
      <button
        className="self-start text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1 mb-2"
        onClick={onBack}
      >
        <ArrowLeft size={14} /> 返回套餐
      </button>
      <div className="text-sm text-gray-300">{pay.name}</div>
      <div className="text-3xl font-bold text-white my-1">¥{pay.amount}</div>
      {pay.qrImg ? (
        <img src={pay.qrImg} width={240} height={240} alt="支付二维码" className="rounded-xl bg-white p-2" />
      ) : (
        <button className="btn-primary mt-3" onClick={() => pay.payUrl && window.open(pay.payUrl, '_blank')}>
          打开支付页
        </button>
      )}
      <div className="flex items-center gap-2 text-sm text-gray-300 mt-3">
        <Loader2 className="animate-spin" size={14} /> 请用支付宝扫一扫付款，等待到账…
      </div>
      {pay.qrImg && pay.payUrl && (
        <button
          className="text-[11px] text-gray-500 underline mt-2"
          onClick={() => window.open(pay.payUrl!, '_blank')}
        >
          无法扫码？在浏览器打开
        </button>
      )}
    </div>
  )
}
