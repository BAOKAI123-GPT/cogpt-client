export interface MaskStroke {
  points: number[] // [x1,y1,x2,y2,...] 全分辨率坐标
  size: number
}

/**
 * 把用户涂抹的笔画合成为 OpenAI 图像编辑接口要求的 mask：
 * 不透明=保留，透明=要重绘的区域。我们先铺满不透明黑，再用 destination-out
 * 在涂抹处“擦出”透明洞，得到要重绘的区域。
 */
export function buildMaskDataUrl(w: number, h: number, strokes: MaskStroke[]): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,1)'
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes) {
    const p = s.points
    if (p.length < 2) continue
    ctx.lineWidth = s.size
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    if (p.length === 2) ctx.lineTo(p[0] + 0.01, p[1] + 0.01)
    else for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1])
    ctx.stroke()
  }
  return c.toDataURL('image/png')
}
