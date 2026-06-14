import { Check, Wrench, Sparkles } from 'lucide-react'
import { useApp } from '../store/app'
import { TOOLS } from '../lib/tools'

export function ResourceLibrary(): JSX.Element {
  const setView = useApp((s) => s.setView)

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-brand/20 grid place-items-center text-brand">
            <Wrench size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">资源库</h1>
            <p className="text-sm text-gray-400">
              经实测可用、可离线的免费开源工具。在「编辑区」导入图片后即可使用。
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          {TOOLS.map((t) => {
            const Icon = t.icon
            return (
              <div key={t.id} className="card p-4 flex flex-col">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-white/5 grid place-items-center text-brand shrink-0">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium">{t.name}</h3>
                    <div className="text-[11px] text-gray-500 mt-0.5">开源：{t.source}</div>
                  </div>
                </div>

                <p className="text-xs text-gray-400 mt-2.5 flex-1">{t.desc}</p>

                <div className="flex flex-wrap gap-1 mt-2.5">
                  {t.badges.map((b) => (
                    <span
                      key={b}
                      className="text-[10px] bg-white/5 border border-edge rounded px-1.5 py-0.5 text-gray-400"
                    >
                      {b}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-2 mt-3">
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <Check size={14} /> 已内置
                  </span>
                  <button className="btn-primary py-1.5 px-3 text-xs ml-auto" onClick={() => setView('editor')}>
                    <Sparkles size={14} /> 去使用
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <p className="text-xs text-gray-600 mt-6">
          更多工具会在开源社区中核验稳定可用后再上线，不可用的不会添加。
        </p>
      </div>
    </div>
  )
}
