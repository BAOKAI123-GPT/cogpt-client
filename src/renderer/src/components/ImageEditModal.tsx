import { useEffect, useRef, useState } from 'react'
import { Brush, Eraser, RotateCcw, Download, Wand2, X, Loader2, Sparkles } from 'lucide-react'
import { useApp } from '../store/app'
import { api } from '../lib/api'
import { buildMaskDataUrl, type MaskStroke } from './canvas/mask'

const MAX_W = 900
const MAX_H = 560

export function ImageEditModal({
  dataUrl,
  onClose
}: {
  dataUrl: string
  onClose: () => void
}): JSX.Element {
  const selectedModel = useApp((s) => s.selectedModel)
  const refreshMe = useApp((s) => s.refreshMe)
  const sendToEditor = useApp((s) => s.sendToEditor)
  const format = useApp((s) => s.settings.defaultFormat)

  const [working, setWorking] = useState(dataUrl)
  const [nat, setNat] = useState({ w: 0, h: 0 })
  const [maskMode, setMaskMode] = useState(false)
  const [brush, setBrush] = useState(40)
  const [strokes, setStrokes] = useState<MaskStroke[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  // 载入自然尺寸
  useEffect(() => {
    const img = new Image()
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = working
  }, [working])

  const fit = nat.w && nat.h ? Math.min(MAX_W / nat.w, MAX_H / nat.h, 1) : 1
  const dispW = Math.round(nat.w * fit)
  const dispH = Math.round(nat.h * fit)

  // 重绘蒙版叠层
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = dispW
    c.height = dispH
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, dispW, dispH)
    ctx.strokeStyle = 'rgba(255,80,80,0.55)'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of strokes) {
      ctx.lineWidth = s.size * fit
      const p = s.points
      if (p.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(p[0] * fit, p[1] * fit)
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * fit, p[i + 1] * fit)
      ctx.stroke()
    }
  }, [strokes, dispW, dispH, fit])

  function imgCoord(e: React.PointerEvent): { x: number; y: number } {
    const r = (e.target as HTMLElement).getBoundingClientRect()
    return { x: (e.clientX - r.left) / fit, y: (e.clientY - r.top) / fit }
  }

  async function runInpaint(): Promise<void> {
    if (!selectedModel || !prompt.trim() || strokes.length === 0) return
    const mask = buildMaskDataUrl(nat.w, nat.h, strokes)
    const reqId = crypto.randomUUID()
    const reqBody = {
      prompt: prompt.trim(),
      size: `${nat.w}x${nat.h}`,
      model: selectedModel,
      initImages: [working],
      mask,
      reqId
    }
    // 失败自动重试，最多 3 次；额度不足不重试
    const MAX = 3
    type GenRes = Awaited<ReturnType<typeof api.generate>>
    let res: GenRes | null = null
    let lastErr = '重绘失败'
    for (let attempt = 1; attempt <= MAX; attempt++) {
      setBusy(attempt === 1 ? '正在重绘选中区域…' : `重绘失败，正在自动重试 (${attempt}/${MAX})…`)
      try {
        res = await api.generate(reqBody)
      } catch {
        res = { ok: false, status: 0, data: { error: '网络异常，无法连接服务器' } } as GenRes
      }
      if (res.status === 402 || res.data?.needRecharge) {
        setBusy(null)
        alert('额度已用完，请到会员中心充值后再试。')
        return
      }
      if (res.ok && res.data.images && res.data.images[0]) break
      lastErr = res.data?.error ?? '重绘失败'
    }
    setBusy(null)
    if (res && res.ok && res.data.images && res.data.images[0]) {
      setWorking(res.data.images[0])
      setStrokes([])
      setMaskMode(false)
      setPrompt('')
      refreshMe()
    } else {
      alert(`${lastErr}（已自动重试 ${MAX} 次仍失败）`)
    }
  }

  async function save(): Promise<void> {
    const r = await window.api.image.save({ dataUrl: working, format })
    if (r.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={onClose}>
      <div
        className="card p-4 max-w-[95vw] max-h-[95vh] overflow-auto flex gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 图 + 蒙版层 */}
        <div className="relative shrink-0" style={{ width: dispW, height: dispH }}>
          <img src={working} width={dispW} height={dispH} className="rounded-lg block select-none" />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 rounded-lg"
            style={{
              width: dispW,
              height: dispH,
              cursor: maskMode ? 'crosshair' : 'default',
              pointerEvents: maskMode ? 'auto' : 'none'
            }}
            onPointerDown={(e) => {
              if (!maskMode) return
              drawing.current = true
              const c = imgCoord(e)
              setStrokes((p) => [...p, { points: [c.x, c.y], size: brush }])
            }}
            onPointerMove={(e) => {
              if (!maskMode || !drawing.current) return
              const c = imgCoord(e)
              setStrokes((p) => {
                const n = p.slice()
                const last = n[n.length - 1]
                if (last) last.points = [...last.points, c.x, c.y]
                return n
              })
            }}
            onPointerUp={() => (drawing.current = false)}
          />
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/40 rounded-lg">
              <div className="flex items-center gap-2 text-sm bg-panel border border-edge rounded-lg px-3 py-2">
                <Loader2 className="animate-spin" size={15} /> {busy}
              </div>
            </div>
          )}
        </div>

        {/* 工具 */}
        <div className="w-64 shrink-0 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">编辑图片</span>
            <button className="text-gray-500 hover:text-gray-200" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          {/* 局部重绘 */}
          <div className="card p-3 mb-3">
            <button
              className={`w-full btn ${maskMode ? 'bg-brand text-white' : 'bg-edge/60 text-gray-200'} mb-2`}
              onClick={() => setMaskMode((v) => !v)}
            >
              <Brush size={15} /> {maskMode ? '正在圈选（涂抹要改的区域）' : '画笔圈选局部重绘'}
            </button>
            {maskMode && (
              <>
                <label className="label">画笔大小 {brush}px</label>
                <input
                  type="range"
                  min={8}
                  max={200}
                  value={brush}
                  onChange={(e) => setBrush(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="grid grid-cols-2 gap-2 my-2">
                  <button className="btn-ghost text-xs py-1.5" onClick={() => setStrokes([])}>
                    <Eraser size={13} /> 清除
                  </button>
                  <button
                    className="btn-ghost text-xs py-1.5"
                    onClick={() => setStrokes((p) => p.slice(0, -1))}
                  >
                    <RotateCcw size={13} /> 撤销
                  </button>
                </div>
                <textarea
                  className="field resize-none h-16"
                  placeholder="描述这块区域要改成什么，例如：换成一只白猫"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <button
                  className="btn-primary w-full mt-2"
                  disabled={!prompt.trim() || strokes.length === 0}
                  onClick={runInpaint}
                >
                  <Wand2 size={15} /> 重绘选中区域
                </button>
              </>
            )}
          </div>

          <p className="text-[11px] text-gray-600 mb-3">
            需要放大尺寸、转矢量等，可点「去编辑区」使用相应工具。
          </p>

          <div className="flex-1" />
          <div className="flex gap-2">
            <button className="btn-soft flex-1" onClick={save}>
              {saved ? '已保存 ✓' : (
                <>
                  <Download size={15} /> 保存
                </>
              )}
            </button>
            <button
              className="btn-primary flex-1"
              onClick={() => {
                sendToEditor(working)
                onClose()
              }}
            >
              <Sparkles size={15} /> 去编辑区
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
