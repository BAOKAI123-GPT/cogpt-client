import { useEffect, useRef, useState } from 'react'
import { Brush, Eraser, RotateCcw, Download, Wand2, X, Loader2, Sparkles, ZoomIn, ZoomOut } from 'lucide-react'
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
  const addAssistantImage = useApp((s) => s.addAssistantImage)
  const format = useApp((s) => s.settings.defaultFormat)

  const [working, setWorking] = useState(dataUrl)
  const [nat, setNat] = useState({ w: 0, h: 0 })
  const [maskMode, setMaskMode] = useState(false)
  const [brush, setBrush] = useState(40)
  const [strokes, setStrokes] = useState<MaskStroke[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [scale, setScale] = useState(1) // 用户缩放（在 fit 基础上）

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null) // 滚动容器，承载放大后的图
  const drawing = useRef(false)
  // 双指 pinch：记录起始两指距离与起始 scale；pinch 期间不涂抹
  const pinch = useRef<{ dist: number; scale: number } | null>(null)

  // 载入自然尺寸；换图后重置缩放与笔画
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

  // 重绘蒙版叠层（画笔坐标/线宽都用实际显示缩放 show，strokes 内部存的是原图全分辨率坐标）
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
      ctx.lineWidth = s.size * show
      const p = s.points
      if (p.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(p[0] * show, p[1] * show)
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * show, p[i + 1] * show)
      ctx.stroke()
    }
  }, [strokes, dispW, dispH, show])

  // 原图全分辨率坐标 = (clientX - canvasRect.left) / 实际显示缩放。
  // canvas 自身 rect 随滚动条移动而更新，故只需把 show 计入分母即可包含缩放与滚动偏移。
  function imgCoord(clientX: number, clientY: number): { x: number; y: number } {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: (clientX - r.left) / show, y: (clientY - r.top) / show }
  }

  function zoomBy(factor: number): void {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(s * factor).toFixed(3))))
  }

  // 滚轮缩放（ctrl+滚轮 或 直接滚轮都缩放；阻止默认避免页面滚动）
  function onWheel(e: React.WheelEvent): void {
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12)
  }

  // —— 触摸手势：单指=涂抹（涂抹模式下）；双指=pinch 缩放 ——
  function touchDist(t: React.TouchList): number {
    const dx = t[0].clientX - t[1].clientX
    const dy = t[0].clientY - t[1].clientY
    return Math.hypot(dx, dy)
  }
  function onTouchStart(e: React.TouchEvent): void {
    if (e.touches.length >= 2) {
      // 双指：进入缩放，取消可能在进行的涂抹
      drawing.current = false
      pinch.current = { dist: touchDist(e.touches), scale }
      return
    }
    if (!maskMode) return
    drawing.current = true
    const c = imgCoord(e.touches[0].clientX, e.touches[0].clientY)
    setStrokes((p) => [...p, { points: [c.x, c.y], size: brush }])
  }
  function onTouchMove(e: React.TouchEvent): void {
    if (e.touches.length >= 2 && pinch.current) {
      e.preventDefault()
      const ratio = touchDist(e.touches) / (pinch.current.dist || 1)
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(pinch.current.scale * ratio).toFixed(3))))
      return
    }
    if (!maskMode || !drawing.current) return
    e.preventDefault()
    const c = imgCoord(e.touches[0].clientX, e.touches[0].clientY)
    setStrokes((p) => {
      const n = p.slice()
      const last = n[n.length - 1]
      if (last) last.points = [...last.points, c.x, c.y]
      return n
    })
  }
  function onTouchEnd(e: React.TouchEvent): void {
    if (e.touches.length < 2) pinch.current = null
    if (e.touches.length === 0) drawing.current = false
  }

  async function runInpaint(): Promise<void> {
    if (!selectedModel || !prompt.trim() || strokes.length === 0) return
    const mask = buildMaskDataUrl(nat.w, nat.h, strokes)
    const reqId = crypto.randomUUID()
    // 局部重绘按原图尺寸出图，不放大；故不传 hdEdge，避免触发高清加点。
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
      setMaskMode(false)
      setPrompt('')
      setScale(1)
      addAssistantImage(res.data.images[0]) // 重绘结果同步进聊天框保存
      refreshMe()
    } else {
      alert(`${lastErr}（已自动重试 ${MAX} 次仍失败）`)
    }
  }

  async function save(): Promise<void> {
    const r = await window.api.image.save({ dataUrl: working, format, defaultName: nextImgName(format) })
    if (r.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={onClose}>
      <div
        className="card p-4 max-w-[95vw] max-h-[95vh] overflow-hidden flex gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 图 + 蒙版层：固定视口包裹滚动容器，busy 遮罩盖在视口上不随内容滚动 */}
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
                  cursor: maskMode ? 'crosshair' : 'default',
                  // 涂抹模式下接管触摸（单指涂抹/双指缩放），交由我们的手势处理；
                  // 非涂抹模式下让滚动容器自由滑动浏览长图。
                  touchAction: maskMode ? 'none' : 'auto',
                  pointerEvents: maskMode ? 'auto' : 'none'
                }}
                onPointerDown={(e) => {
                  // 仅鼠标走 pointer 事件；触摸交给 onTouch* 以正确区分单指/双指
                  if (e.pointerType === 'touch' || !maskMode) return
                  drawing.current = true
                  const c = imgCoord(e.clientX, e.clientY)
                  setStrokes((p) => [...p, { points: [c.x, c.y], size: brush }])
                }}
                onPointerMove={(e) => {
                  if (e.pointerType === 'touch' || !maskMode || !drawing.current) return
                  const c = imgCoord(e.clientX, e.clientY)
                  setStrokes((p) => {
                    const n = p.slice()
                    const last = n[n.length - 1]
                    if (last) last.points = [...last.points, c.x, c.y]
                    return n
                  })
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
            <span className="text-sm font-medium">编辑图片</span>
            <button className="text-gray-500 hover:text-gray-200" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          {/* 缩放控制（滚轮 / 双指 pinch 也可缩放，长图放大后可滑动到底部精确涂抹） */}
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
