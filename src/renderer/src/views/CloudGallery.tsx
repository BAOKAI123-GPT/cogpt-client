import { useEffect, useState } from 'react'
import { Loader2, Download, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'

// 云作品库：同账号在网页端 / 桌面端生成的图都会写入腾讯云 COS，本视图拉取 /api/history 跨设备展示。
// 展示用 <img src=签名URL>（不受 CORS/防盗链影响）；保存走主进程 image:downloadUrl 下载（绕开渲染层 CORS）。
interface GItem { url: string; prompt: string; model: string; ratio: string; at: number }

export function CloudGallery(): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(true)
  const [items, setItems] = useState<GItem[]>([])
  const [view, setView] = useState<string | null>(null) // 放大查看的图

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const r = await api.history()
      if (!r.ok) { setEnabled(false); setItems([]); return }
      setEnabled(r.data.enabled !== false)
      setItems((r.data.items || []) as GItem[])
    } catch {
      setEnabled(false); setItems([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  return (
    <div className="h-full flex flex-col">
      <div className="h-12 shrink-0 border-b border-edge flex items-center gap-3 px-6">
        <h2 className="text-sm font-medium">我的云作品库</h2>
        <span className="text-xs text-gray-500 hidden sm:inline">同账号在网页/客户端生成的图，跨设备自动同步</span>
        <button onClick={() => void load()} disabled={loading} className="ml-auto btn-soft py-1 px-2.5 text-xs inline-flex items-center gap-1 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>
      <div className="flex-1 overflow-auto px-6 py-5">
        {loading ? (
          <div className="h-full grid place-items-center text-gray-500"><Loader2 className="animate-spin" size={20} /></div>
        ) : !enabled ? (
          <div className="h-full grid place-items-center text-center text-gray-500"><p>云端作品库尚未开启<br /><span className="text-xs">（后端未配置对象存储）</span></p></div>
        ) : items.length === 0 ? (
          <div className="h-full grid place-items-center text-center text-gray-500"><p>还没有云端作品<br /><span className="text-xs">在「对话生图」生成的图会自动同步到这里，换设备登录同账号即可看到</span></p></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((it, i) => (
              <div key={i} className="group relative rounded-xl overflow-hidden border border-edge bg-black/30">
                <img src={it.url} loading="lazy" className="w-full aspect-square object-cover cursor-zoom-in" onClick={() => setView(it.url)} title={it.prompt} />
                <div className="absolute bottom-0 inset-x-0 flex gap-1.5 p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => void window.api.image.downloadUrl({ url: it.url, defaultName: `cogpt-${it.at}.jpg` })}
                    className="btn-soft py-1 px-2 text-xs inline-flex items-center gap-1"
                  >
                    <Download size={13} /> 保存
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {view && (
        <div className="fixed inset-0 z-50 bg-black/85 grid place-items-center p-8" onClick={() => setView(null)}>
          <img src={view} className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  )
}
