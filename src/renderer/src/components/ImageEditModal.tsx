import { useEffect, useRef, useState } from 'react'
import { Brush, Eraser, RotateCcw, Download, Wand2, X, Loader2, Sparkles, ZoomIn, ZoomOut, Pencil, Eye, Check } from 'lucide-react'
import { useApp } from '../store/app'
import { api } from '../lib/api'
import { nextImgName } from '../lib/imgname'
import { buildMaskDataUrl, type MaskStroke } from './canvas/mask'

// 基准展示框：图先按 fit 缩进这个框（不放大原图），用户再用 scale 在此基础上自由放大。
// 放大后的图由 overflow:auto 滚动容器承载，可纵向/双向滑动浏览（长图也能滚到底部精确涂抹）。
const BASE_W = 760
const BASE_H = 560
const MIN_SCALE = 1
const MAX_SCALE = 6

// 三态：浏览（缩放/拖动/滑动查看）/ 局部重绘（涂 mask + 文字重绘）/ 绘制（自由画线合进图）
type Mode = 'view' | 'mask' | 'draw'
type DrawStroke = { points: number[]; size: number; color: string; erase: boolean }
const DRAW_COLORS = ['#ff3b30', '#ffffff', '#111111', '#ffd60a', '#34c759', '#0a84ff']

export function ImageEditModal({
  dataUrl,
  onClose
}: {
  dataUrl: string
  onClose: () => void
}): JSX.Element {
  const selectedModel = useApp((s) => s.selectedModel)
  const models = useApp((s) => s.models)
  const modelMeta = useApp((s) => s.modelMeta)
  // 局部重绘必须用支持改图的模型(高质量GPT)，与当前所选模型无关
  const editModel = models.find((m) => modelMeta[m]?.ref) || selectedModel || 'gpt-image-2'
  const refreshMe = useApp((s) => s.refreshMe)
  const sendToEditor = useApp((s) => s.sendToEditor)
  const addAssistantImage = useApp((s) => s.addAssistantImage)
  const format = useApp((s) => s.settings.defaultFormat)

  const [working, setWorking] = useState(dataUrl)
  const [nat, setNat] = useState({ w: 0, h: 0 })
  const [mode, setMode] = useState<Mode>('view') // 默认浏览，编辑需点上方按钮（避免点图误触进编辑）
  const [brush, setBrush] = useState(40)
  const [strokes, setStrokes] = useState<MaskStroke[]>([])
  const [drawStrokes, setDrawStrokes] = useState<DrawStroke[]>([])
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0])
  const [drawSize, setDrawSize] = useState(6)
  const [erase, setErase] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [scale, setScale] = useState(1) // 用户缩放（在 fit 基础上）

  const maskMode = mode === 'mask'
  const drawMode = mode === 'draw'
  const painting = maskMode || drawMode // 涂抹/绘制态：接管手势；浏览态让滚动容器自由滑动

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null) // 滚动容器，承载放大后的图
  const drawing = useRef(false)
  // 双指 pinch：记录起始两指距离与起始 scale；pinch 期间不涂抹
  const pinch = useRef<{ dist: number; scale: number } | null>(null)

  // 载入自然尺寸；换图后重置缩放
  useEffect(() => {
    const img = new Image()
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = working
  }, [working])

  // fit：把整图缩进基准框（不放大）。show = fit × scale 为实际显示缩放（坐标/画笔统一用它）。
  const fit = nat.w && nat.h ? Math.min(BASE_W / nat.w, BASE_H / nat.h, 1) : 1
  const show = fit * scale
  const dispW = Math.round(nat.w * show)
  const dispH = Math.round(nat.h * show)

  // 叠层重绘：mask 模式画红色半透明选区；draw 模式画彩色笔迹（橡皮 destination-out 在笔迹层擦除）。
  // strokes/drawStrokes 内部都存原图全分辨率坐标，渲染时乘 show 缩放到显示尺寸。
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = dispW
    c.height = dispH
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, dispW, dispH)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (maskMode) {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = 'rgba(255,80,80,0.55)'
      for (const s of strokes) {
        const p = s.points
        if (p.length < 2) continue
        ctx.lineWidth = s.size * show
        ctx.beginPath()
        ctx.moveTo(p[0] * show, p[1] * show)
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * show, p[i + 1] * show)
        ctx.stroke()
      }
    } else if (drawMode) {
      for (const s of drawStrokes) {
        const p = s.points
        if (p.length < 2) continue
        ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
        ctx.strokeStyle = s.color
        ctx.lineWidth = s.size * show
        ctx.beginPath()
        ctx.moveTo(p[0] * show, p[1] * show)
        if (p.length === 2) ctx.lineTo(p[0] * show + 0.01, p[1] * show + 0.01)
        else for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * show, p[i + 1] * show)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
    }
  }, [strokes, drawStrokes, dispW, dispH, show, maskMode, drawMode])

  // 原图全分辨率坐标 = (clientX - canvasRect.left) / 实际显示缩放。
  function imgCoord(clientX: number, clientY: number): { x: number; y: number } {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: (clientX - r.left) / show, y: (clientY - r.top) / show }
  }

  // 起笔/续笔：按当前模式写入对应笔画数组
  function strokeStart(clientX: number, clientY: number): void {
    const c = imgCoord(clientX, clientY)
    if (maskMode) setStrokes((p) => [...p, { points: [c.x, c.y], size: brush }])
    else if (drawMode) setDrawStrokes((p) => [...p, { points: [c.x, c.y], size: drawSize, color: drawColor, erase }])
  }
  function strokeMove(clientX: number, clientY: number): void {
    const c = imgCoord(clientX, clientY)
    const append = (pts: number[]): number[] => [...pts, c.x, c.y]
    if (maskMode) setStrokes((p) => { const n = p.slice(); const l = n[n.length - 1]; if (l) l.points = append(l.points); return n })
    else if (drawMode) setDrawStrokes((p) => { const n = p.slice(); const l = n[n.length - 1]; if (l) l.points = append(l.points); return n })
  }

  function zoomBy(factor: number): void {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(s * factor).toFixed(3))))
  }

  // 滚轮缩放（阻止默认避免页面滚动）
  function onWheel(e: React.WheelEvent): void {
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12)
  }

  // —— 触摸手势：单指=涂抹/绘制（编辑态下）；双指=pinch 缩放；浏览态单指交给滚动容器滑动 ——
  function touchDist(t: React.TouchList): number {
    const dx = t[0].clientX - t[1].clientX
    const dy = t[0].clientY - t[1].clientY
    return Math.hypot(dx, dy)
  }
  function onTouchStart(e: React.TouchEvent): void {
    if (e.touches.length >= 2) {
      drawing.current = false
      pinch.current = { dist: touchDist(e.touches), scale }
      return
    }
    if (!painting) return
    drawing.current = true
    strokeStart(e.touches[0].clientX, e.touches[0].clientY)
  }
  function onTouchMove(e: React.TouchEvent): void {
    if (e.touches.length >= 2 && pinch.current) {
      e.preventDefault()
      const ratio = touchDist(e.touches) / (pinch.current.dist || 1)
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(pinch.current.scale * ratio).toFixed(3))))
      return
    }
    if (!painting || !drawing.current) return
    e.preventDefault()
    strokeMove(e.touches[0].clientX, e.touches[0].clientY)
  }
  function onTouchEnd(e: React.TouchEvent): void {
    if (e.touches.length < 2) pinch.current = null
    if (e.touches.length === 0) drawing.current = false
  }

  async function runInpaint(): Promise<void> {
    if (!editModel || !prompt.trim() || strokes.length === 0) return
    const mask = buildMaskDataUrl(nat.w, nat.h, strokes)
    const reqId = crypto.randomUUID()
    // 局部重绘按原图尺寸出图，不放大；故不传 hdEdge，避免触发高清加点。
    const reqBody = {
      prompt: prompt.trim(),
      size: `${nat.w}x${nat.h}`,
      model: editModel,
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
        alert('点数已用完，请到会员中心充值后再试。')
        return
      }
      if (res.status === 400) {
        setBusy(null)
        alert(res.data?.error ?? '请求有误，请修改后重试')
        return
      }
      if (res.ok && res.data.images && res.data.images[0]) break
      lastErr = res.data?.error ?? '重绘失败'
    }
    setBusy(null)
    if (res && res.ok && res.data.images && res.data.images[0]) {
      setWorking(res.data.images[0])
      setStrokes([])
      setMode('view')
      setPrompt('')
      setScale(1)
      addAssistantImage(res.data.images[0]) // 重绘结果同步进聊天框保存
      refreshMe()
    } else {
      alert(`${lastErr}（已自动重试 ${MAX} 次仍失败）`)
    }
  }

  // 把彩色笔迹合成进图片：先在透明笔迹层画线（橡皮 destination-out 只擦笔迹、不伤底图），再叠到底图上。
  function applyDraw(): void {
    if (!drawStrokes.length || !nat.w) return
    const layer = document.createElement('canvas')
    layer.width = nat.w
    layer.height = nat.h
    const lc = layer.getContext('2d')!
    lc.lineCap = 'round'
    lc.lineJoin = 'round'
    for (const st of drawStrokes) {
      const p = st.points
      if (p.length < 2) continue
      lc.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over'
      lc.strokeStyle = st.color
      lc.lineWidth = st.size
      lc.beginPath()
      lc.moveTo(p[0], p[1])
      if (p.length === 2) lc.lineTo(p[0] + 0.01, p[1] + 0.01)
      else for (let i = 2; i < p.length; i += 2) lc.lineTo(p[i], p[i + 1])
      lc.stroke()
    }
    const out = document.createElement('canvas')
    out.width = nat.w
    out.height = nat.h
    const oc = out.getContext('2d')!
    const im = new Image()
    im.onload = () => {
      oc.drawImage(im, 0, 0, nat.w, nat.h)
      oc.drawImage(layer, 0, 0)
      const url = out.toDataURL('image/png')
      setWorking(url)
      setDrawStrokes([])
      setScale(1)
      addAssistantImage(url) // 绘制结果同步进聊天框保存
    }
    im.src = working
  }

  async function save(): Promise<void> {
    const r = await window.api.image.save({ dataUrl: working, format, defaultName: nextImgName(format) })
    if (r.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  // 点同一模式按钮再次=回到浏览
  function toggleMode(m: Mode): void {
    setMode((cur) => (cur === m ? 'view' : m))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={onClose}>
      <div
        className="card p-4 max-w-[95vw] max-h-[95vh] overflow-hidden flex gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 图 + 叠层：固定视口包裹滚动容器，busy 遮罩盖在视口上不随内容滚动 */}
        <div className="relative shrink-0" style={{ width: BASE_W, height: BASE_H }}>
          <div
            ref={scrollRef}
            className="absolute inset-0 overflow-auto rounded-lg bg-black/20"
            onWheel={onWheel}
          >
            <div className="relative" style={{ width: dispW, height: dispH }}>
              <img src={working} width={dispW} height={dispH} className="block select-none" draggable={false} />
              <canvas
                ref={canvasRef}
                className="absolute inset-0"
                style={{
                  width: dispW,
                  height: dispH,
                  cursor: painting ? 'crosshair' : 'default',
                  // 编辑态接管触摸（单指涂抹/绘制、双指缩放）；浏览态让滚动容器自由滑动浏览长图。
                  touchAction: painting ? 'none' : 'auto',
                  pointerEvents: painting ? 'auto' : 'none'
                }}
                onPointerDown={(e) => {
                  // 仅鼠标走 pointer 事件；触摸交给 onTouch* 以正确区分单指/双指
                  if (e.pointerType === 'touch' || !painting) return
                  drawing.current = true
                  strokeStart(e.clientX, e.clientY)
                }}
                onPointerMove={(e) => {
                  if (e.pointerType === 'touch' || !painting || !drawing.current) return
                  strokeMove(e.clientX, e.clientY)
                }}
                onPointerUp={() => (drawing.current = false)}
                onPointerLeave={() => (drawing.current = false)}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
              />
            </div>
          </div>
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/40 rounded-lg">
              <div className="flex items-center gap-2 text-sm bg-panel border border-edge rounded-lg px-3 py-2">
                <Loader2 className="animate-spin" size={15} /> {busy}
              </div>
            </div>
          )}
        </div>

        {/* 工具 */}
        <div className="w-64 shrink-0 flex flex-col overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">查看 / 编辑图片</span>
            <button className="text-gray-500 hover:text-gray-200" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          {/* 模式切换（醒目）：浏览 / 局部重绘 / 绘制 */}
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            <button
              className={`btn text-xs py-2 ${mode === 'view' ? 'bg-brand text-white' : 'bg-edge/60 text-gray-200'}`}
              onClick={() => setMode('view')}
            >
              <Eye size={14} /> 浏览
            </button>
            <button
              className={`btn text-xs py-2 ${maskMode ? 'bg-brand text-white' : 'bg-edge/60 text-gray-200'}`}
              onClick={() => toggleMode('mask')}
            >
              <Brush size={14} /> 局部重绘
            </button>
            <button
              className={`btn text-xs py-2 ${drawMode ? 'bg-brand text-white' : 'bg-edge/60 text-gray-200'}`}
              onClick={() => toggleMode('draw')}
            >
              <Pencil size={14} /> 绘制
            </button>
          </div>

          {/* 缩放控制（滚轮 / 双指 pinch 也可缩放，长图放大后可滑动浏览） */}
          <div className="card p-2 mb-3 flex items-center gap-2">
            <button className="btn-ghost text-xs py-1.5 px-2" onClick={() => zoomBy(1 / 1.25)} title="缩小">
              <ZoomOut size={14} />
            </button>
            <span className="text-xs text-gray-400 flex-1 text-center tabular-nums">{Math.round(scale * 100)}%</span>
            <button className="btn-ghost text-xs py-1.5 px-2" onClick={() => zoomBy(1.25)} title="放大">
              <ZoomIn size={14} />
            </button>
            <button
              className="btn-ghost text-xs py-1.5 px-2"
              onClick={() => setScale(1)}
              title="复位"
              disabled={scale === 1}
            >
              1:1
            </button>
          </div>

          {/* 浏览态提示 */}
          {mode === 'view' && (
            <p className="text-[11px] text-gray-500 mb-3 leading-snug">
              拖动 / 滚轮 / 双指可缩放查看大图；要修改图片，点上方「局部重绘」（涂抹区域用 AI 重画）或「绘制」（在图上自由画线标注）。
            </p>
          )}

          {/* 局部重绘工具 */}
          {maskMode && (
            <div className="card p-3 mb-3">
              <p className="text-[11px] text-gray-500 mb-2 leading-snug">
                单指/鼠标涂抹要改的区域；双指捏合或滚轮可缩放，放大后滑动浏览长图。
              </p>
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
                <button className="btn-ghost text-xs py-1.5" onClick={() => setStrokes((p) => p.slice(0, -1))}>
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
            </div>
          )}

          {/* 自由绘制工具 */}
          {drawMode && (
            <div className="card p-3 mb-3">
              <p className="text-[11px] text-gray-500 mb-2 leading-snug">
                在图上自由画线/标注；可选颜色、粗细，橡皮可擦掉画错的，完成后点「应用到图片」合进画面。
              </p>
              <label className="label">颜色</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {DRAW_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setDrawColor(c); setErase(false) }}
                    className={`w-7 h-7 rounded-full border-2 grid place-items-center ${drawColor === c && !erase ? 'border-brand' : 'border-white/20'}`}
                    style={{ background: c }}
                    title={c}
                  >
                    {drawColor === c && !erase && <Check size={13} className={c === '#ffffff' || c === '#ffd60a' ? 'text-black' : 'text-white'} />}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  className={`btn text-xs py-1.5 ${!erase ? 'bg-brand text-white' : 'bg-edge/60 text-gray-200'}`}
                  onClick={() => setErase(false)}
                >
                  <Pencil size={13} /> 画笔
                </button>
                <button
                  className={`btn text-xs py-1.5 ${erase ? 'bg-brand text-white' : 'bg-edge/60 text-gray-200'}`}
                  onClick={() => setErase(true)}
                >
                  <Eraser size={13} /> 橡皮
                </button>
              </div>
              <label className="label">粗细 {drawSize}px</label>
              <input
                type="range"
                min={1}
                max={60}
                value={drawSize}
                onChange={(e) => setDrawSize(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="grid grid-cols-2 gap-2 my-2">
                <button className="btn-ghost text-xs py-1.5" onClick={() => setDrawStrokes([])}>
                  <Eraser size={13} /> 清除
                </button>
                <button className="btn-ghost text-xs py-1.5" onClick={() => setDrawStrokes((p) => p.slice(0, -1))}>
                  <RotateCcw size={13} /> 撤销
                </button>
              </div>
              <button className="btn-primary w-full mt-1" disabled={!drawStrokes.length} onClick={applyDraw}>
                <Check size={15} /> 应用到图片
              </button>
            </div>
          )}

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
