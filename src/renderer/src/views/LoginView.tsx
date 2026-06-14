import { useState, useEffect } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { useApp } from '../store/app'

export function LoginView(): JSX.Element {
  const sendCode = useApp((s) => s.sendCode)
  const loginWithCode = useApp((s) => s.loginWithCode)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const phoneOk = /^1[3-9]\d{9}$/.test(phone)

  async function onSend(): Promise<void> {
    if (!phoneOk || countdown > 0) return
    setErr('')
    setBusy(true)
    const r = await sendCode(phone)
    setBusy(false)
    if (r.ok) {
      setSent(true)
      setCountdown(60)
    } else setErr(r.error || '发送失败')
  }
  async function onLogin(): Promise<void> {
    if (!phoneOk || code.length < 4) return
    if (!agreed) {
      setErr('请先勾选同意《用户协议》与《隐私政策》')
      return
    }
    setErr('')
    setBusy(true)
    const r = await loginWithCode(phone, code)
    setBusy(false)
    if (!r.ok) setErr(r.error || '登录失败')
  }

  return (
    <div className="h-full grid place-items-center app-bg">
      <div className="card p-6 w-[360px]">
        <div className="flex items-center gap-3 mb-1">
          <div
            className="w-11 h-11 rounded-2xl grid place-items-center text-white"
            style={{ background: 'linear-gradient(135deg,#8b7bff,#16a5c9)' }}
          >
            <Sparkles size={22} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Co-GPT</h1>
            <p className="text-xs text-gray-400">手机号登录 / 注册</p>
          </div>
        </div>

        <label className="label mt-4">手机号</label>
        <input
          className="field"
          placeholder="请输入手机号"
          value={phone}
          maxLength={11}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
        />

        <label className="label mt-3">验证码</label>
        <div className="flex gap-2">
          <input
            className="field"
            placeholder="6 位验证码"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <button
            className="btn-soft whitespace-nowrap px-3"
            disabled={!phoneOk || countdown > 0 || busy}
            onClick={onSend}
          >
            {countdown > 0 ? `${countdown}s` : sent ? '重新发送' : '发送验证码'}
          </button>
        </div>

        {err && <p className="text-sm text-red-400 mt-2">{err}</p>}

        <label className="flex items-start gap-2 mt-3 text-[11px] text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            我已阅读并同意
            <a
              className="text-brand hover:underline"
              onClick={(e) => {
                e.preventDefault()
                window.open('https://cogpt.art/terms', '_blank')
              }}
            >
              《用户协议》
            </a>
            和
            <a
              className="text-brand hover:underline"
              onClick={(e) => {
                e.preventDefault()
                window.open('https://cogpt.art/privacy', '_blank')
              }}
            >
              《隐私政策》
            </a>
          </span>
        </label>

        <button
          className="btn-primary w-full mt-3"
          disabled={!phoneOk || code.length < 4 || busy || !agreed}
          onClick={onLogin}
        >
          {busy ? <Loader2 className="animate-spin" size={16} /> : null}
          登录 / 注册
        </button>
        <p className="text-[11px] text-gray-500 mt-3 text-center">未注册的手机号将自动创建账号</p>
      </div>
    </div>
  )
}
