import { Sparkles, Download, X } from 'lucide-react'
import type { UpdateInfo } from '../store/app'

export function UpdateModal({ info, onClose }: { info: UpdateInfo; onClose: () => void }): JSX.Element {
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 grid place-items-center p-4">
      <div
        className="card p-6 w-[420px] max-w-[95vw]"
        style={{ background: 'linear-gradient(160deg,#241b3d 0%,#1c1d22 60%)' }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles size={20} className="text-brand" /> 发现新版本
          </h2>
          {!info.force && (
            <button className="text-gray-400 hover:text-gray-200" onClick={onClose}>
              <X size={20} />
            </button>
          )}
        </div>

        <div className="text-sm text-gray-300">
          当前版本 <span className="text-gray-400">v{info.current}</span> → 最新版本{' '}
          <span className="text-brand font-semibold">v{info.version}</span>
        </div>

        {info.notes && (
          <div className="mt-3 rounded-xl border border-edge p-3 text-sm text-gray-300 whitespace-pre-wrap max-h-48 overflow-auto">
            {info.notes}
          </div>
        )}

        {info.force && (
          <p className="mt-3 text-xs text-amber-300">本次为重要更新，请更新到最新版后继续使用。</p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            className="btn-primary flex-1"
            onClick={() => window.open(info.url, '_blank')}
          >
            <Download size={16} /> 前往下载更新
          </button>
          {!info.force && (
            <button className="btn-soft px-4" onClick={onClose}>
              稍后再说
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-500 mt-3 text-center">
          点「前往下载」将在浏览器打开官网下载页，下载安装即可更新。
        </p>
      </div>
    </div>
  )
}
