import { useState } from 'react'
import { LogOut, ShieldCheck, Gift } from 'lucide-react'
import { useApp } from '../store/app'
import type { AppSettings } from '@shared/types'

export function SettingsView(): JSX.Element {
  const account = useApp((s) => s.account)
  const settings = useApp((s) => s.settings)
  const saveSettings = useApp((s) => s.saveSettings)
  const logout = useApp((s) => s.logout)
  const q = account?.quota
  const [copied, setCopied] = useState(false)
  const code = q?.inviteCode || ''
  const promo = `最近在用一个 AI 生图工具，挺惊艳的——用的是 GPT-image2，出图质量是真高。价格也不贵，现在有个 9.9 的套餐挺超值。你注册的时候填我的邀请码 ${code}，咱俩各得 10 次（100 点）免费额度；你之后充值，我还能再得你充值额度的 10%。国内直接打开就能用，不用翻墙：https://cogpt.art/app`
  async function copyPromo(): Promise<void> {
    try {
      await navigator.clipboard.writeText(promo)
    } catch {
      const t = document.createElement('textarea')
      t.value = promo
      document.body.appendChild(t)
      t.select()
      document.execCommand('copy')
      t.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
        {/* 账号 */}
        <section className="card p-5">
          <h2 className="font-medium mb-3">账号</h2>
          <div className="text-sm text-gray-300">手机号：{account?.phone}</div>
          <div className="text-sm text-gray-400 mt-1">
            {q?.memberActive
              ? `会员 ${q.memberTier} · 剩余 ${q.memberCredits} 点`
              : `免费用户 · 今日剩余 ${q?.freeRemaining ?? 0}/${q?.freeDaily ?? 0} 点`}
            {q?.bonusCredits ? ` · 赠送 ${q.bonusCredits} 点` : ''}
          </div>
          <button className="btn-soft mt-3" onClick={logout}>
            <LogOut size={15} /> 退出登录
          </button>
        </section>

        {/* 邀请好友 */}
        <section className="card p-5">
          <h2 className="font-medium mb-1 flex items-center gap-2">
            <Gift size={16} className="text-brand" /> 邀请好友 · 双方各得免费点数
          </h2>
          <p className="text-sm text-gray-400 mb-3">
            朋友注册时填你的邀请码：<b className="text-gray-200">双方各得 10 次（100 点）免费额度</b>；
            <b className="text-gray-200">TA 充值后，你再得其充值额度的 10%</b>。已成功邀请{' '}
            <b className="text-brand">{q?.inviteCount ?? 0}</b> 人。
          </p>
          <div className="font-mono text-2xl font-bold tracking-widest text-center py-3 rounded-xl bg-white/5 border border-white/10">
            {code || '——'}
          </div>
          <button className="btn-primary w-full mt-3" onClick={copyPromo}>
            {copied ? '已复制，去粘贴给朋友吧' : '一键复制邀请文案'}
          </button>
        </section>

        {/* 导出设置 */}
        <section className="card p-5">
          <h2 className="font-medium mb-3">导出设置</h2>
          <label className="label">默认导出格式</label>
          <select
            className="field max-w-xs"
            value={settings.defaultFormat}
            onChange={(e) => saveSettings({ defaultFormat: e.target.value as AppSettings['defaultFormat'] })}
          >
            <option value="png">PNG（无损，支持透明）</option>
            <option value="jpeg">JPG（体积小，适合照片）</option>
            <option value="webp">WebP（更小，现代格式）</option>
          </select>
        </section>

        {/* 安全说明 */}
        <section className="card p-4 flex items-start gap-2 text-sm">
          <ShieldCheck size={17} className="text-emerald-400 mt-0.5 shrink-0" />
          <span className="text-gray-400">
            生图全部由 Co-GPT 云端代为完成，模型与密钥仅在服务器，客户端不接触任何接口密钥，安全可靠。
          </span>
        </section>
      </div>
    </div>
  )
}
