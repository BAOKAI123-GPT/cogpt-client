import { LogOut, ShieldCheck } from 'lucide-react'
import { useApp } from '../store/app'
import type { AppSettings } from '@shared/types'

export function SettingsView(): JSX.Element {
  const account = useApp((s) => s.account)
  const settings = useApp((s) => s.settings)
  const saveSettings = useApp((s) => s.saveSettings)
  const logout = useApp((s) => s.logout)
  const q = account?.quota

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
        {/* 账号 */}
        <section className="card p-5">
          <h2 className="font-medium mb-3">账号</h2>
          <div className="text-sm text-gray-300">手机号：{account?.phone}</div>
          <div className="text-sm text-gray-400 mt-1">
            {q?.memberActive
              ? `会员 ${q.memberTier} · 剩余 ${q.memberCredits} 次`
              : `免费用户 · 今日剩余 ${q?.freeRemaining ?? 0}/${q?.freeDaily ?? 0} 次`}
          </div>
          <button className="btn-soft mt-3" onClick={logout}>
            <LogOut size={15} /> 退出登录
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
