import { useEffect, useState } from 'react'
import { ImagePlus, Download, Loader2, Ruler, Sparkles, Maximize2, Shapes } from 'lucide-react'
import { useEditor } from '../store/editor'
import { useApp } from '../store/app'

export function EditorView(): JSX.Element {
  const ed = useEditor()
  const appEditorImage = useApp((s) => s.editorImage)
  const setView = useApp((s) => s.setView)
  const settings = useApp((s) => s.settings)
  const [width, setWidth] = useState('')
  const [vector, setVector] = useState<{ svg: string } | null>(null)
  const [vecWidth, setVecWidth] = useState('2048')

  useEffect(() => {
    if (appEditorImage && appEditorImage !== ed.original) ed.setBase(appEditorImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appEditorImage])

  useEffect(() => {
    if (ed.baseW) setWidth(String(ed.baseW))
  }, [ed.baseW])

  async function importFromDisk(): Promise<void> {
    const r = await window.api.image.openMany()
    if (r.ok && r.images[0]) {
      setVector(null)
      await ed.setBase(r.images[0].dataUrl)
    }
  }

  async function doExport(): Promise<void> {
    if (!ed.base) return
    await window.api.image.save({ dataUrl: ed.base, format: settings.defaultFormat })
  }

  async function runVectorize(): Promise<void> {
    if (!ed.base) return
    ed.setBusy('正在矢量化（转成可无限放大的矢量图）…')
    const r = await window.api.image.vectorize(ed.base)
    ed.setBusy(null)
    if (r.ok && r.svg) setVector({ svg: r.svg })
    else alert(r.error ?? '矢量化失败')
  }

  async function exportSvg(): Promise<void> {
    if (vector) await window.api.image.saveSvg({ svg: vector.svg })
  }
  async function exportHiResPng(): Promise<void> {
    if (!vector) return
    const w = parseInt(vecWidth) || 2048
    ed.setBusy('正在从矢量渲染高清 PNG…')
    const r = await window.api.image.rasterizeSvg({ svg: vector.svg, width: w })
    ed.setBusy(null)
    if (r.ok && r.dataUrl) await window.api.image.save({ dataUrl: r.dataUrl, format: 'png' })
  }

  if (!ed.base) {
    return (
      <div
        className="h-full grid place-items-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'))
          if (f) {
            const r = new FileReader()
            r.onload = () => ed.setBase(r.result as string)
            r.readAsDataURL(f)
          }
        }}
      >
        <div className="text-center">
          <ImagePlus size={30} className="text-brand mx-auto mb-3" />
          <p className="text-gray-400 mb-1">把图片拖进来，或导入本地图片</p>
          <p className="text-xs text-gray-600 mb-4">在这里缩放/导出图片，或转成矢量图</p>
          <div className="flex gap-2 justify-center">
            <button className="btn-primary" onClick={importFromDisk}>
              <ImagePlus size={16} /> 导入本地图片
            </button>
            <button className="btn-soft" onClick={() => setView('chat')}>
              <Sparkles size={16} /> 去对话生成
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 relative bg-[#15161a] flex flex-col">
        <div className="h-11 shrink-0 border-b border-edge flex items-center justify-between px-4">
          <span className="text-xs text-gray-500">
            {ed.baseW}×{ed.baseH}px（原图 {ed.origW}×{ed.origH}）
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost py-1.5 px-2.5 text-xs" onClick={importFromDisk}>
              <ImagePlus size={14} /> 换图
            </button>
            <button className="btn-primary py-1.5 px-3 text-xs" onClick={doExport}>
              <Download size={14} /> 导出
            </button>
          </div>
        </div>
        <div className="flex-1 grid place-items-center overflow-hidden p-6">
          <img
            src={ed.base}
            className="max-w-full max-h-full object-contain rounded-lg"
            style={{ boxShadow: '0 8px 40px rgba(0,0,0,.5)' }}
          />
        </div>
        {ed.busy && (
          <div className="absolute inset-0 grid place-items-center bg-black/40 z-20">
            <div className="flex items-center gap-2 text-sm bg-panel border border-edge rounded-lg px-4 py-3">
              <Loader2 className="animate-spin" size={16} /> {ed.busy}
            </div>
          </div>
        )}
      </div>

      {/* 工具面板 */}
      <div className="w-72 shrink-0 border-l border-edge overflow-auto p-3 space-y-4">
        {/* 像素缩放 */}
        <div className="card p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-300 mb-2">
            <Ruler size={14} className="text-brand" /> 像素缩放 / 放大
          </div>
          <label className="label">目标宽度 (px，高按比例)</label>
          <div className="flex gap-2">
            <input className="field" value={width} onChange={(e) => setWidth(e.target.value)} />
            <button className="btn-soft px-3" onClick={() => ed.scaleToWidth(parseInt(width) || ed.baseW)}>
              应用
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <button className="btn-ghost text-xs py-1.5" onClick={() => ed.scaleByFactor(0.5)}>
              缩小 50%
            </button>
            <button className="btn-ghost text-xs py-1.5" onClick={() => ed.scaleByFactor(2)}>
              <Maximize2 size={12} /> 2x
            </button>
            <button className="btn-ghost text-xs py-1.5" onClick={() => ed.scaleByFactor(4)}>
              <Maximize2 size={12} /> 4x
            </button>
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">
            始终从原图重采样：先缩小再放大也不会变糊。仅改像素、不改画面、离线可用。
          </p>
        </div>

        {/* 矢量化 */}
        <div className="card p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-gray-300 mb-2">
            <Shapes size={14} className="text-brand" /> 矢量化（放大不糊）
          </div>
          {!vector ? (
            <>
              <button className="btn-soft w-full" onClick={runVectorize}>
                <Shapes size={14} /> 转成矢量图
              </button>
              <p className="text-[10px] text-gray-600 mt-1.5">
                适合 Logo / 图标 / 文字 / 扁平图形，转成矢量后无限放大都清晰。照片类不适用。
              </p>
            </>
          ) : (
            <>
              <div className="text-xs text-emerald-400 mb-2">✓ 矢量化完成</div>
              <button className="btn-primary w-full text-xs mb-2" onClick={exportSvg}>
                <Download size={14} /> 导出矢量 SVG（印刷/AI 可用）
              </button>
              <label className="label">或导出高清 PNG，宽度 (px)</label>
              <div className="flex gap-2">
                <input className="field" value={vecWidth} onChange={(e) => setVecWidth(e.target.value)} />
                <button className="btn-soft px-3 text-xs" onClick={exportHiResPng}>
                  导出
                </button>
              </div>
              <button className="text-[11px] text-gray-500 hover:text-gray-300 mt-2" onClick={() => setVector(null)}>
                重新矢量化
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
