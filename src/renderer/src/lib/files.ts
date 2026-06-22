/** File/Blob → dataURL */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function dataUrlBytes(d: string): number { const i = d.indexOf(','); return i < 0 ? 0 : Math.floor((d.length - i - 1) * 0.75) }
/** 把图片压到「长边≤maxEdge 且 体积≤maxKB」：先等比缩放，再逐步降质达标。
 *  参考图统一压缩，避免大图把请求体撑大、拖慢上传、逼近超时。失败则原样返回。 */
export function compressDataUrl(src: string, maxEdge = 1024, maxKB = 600): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d'); if (!ctx) return resolve(src)
      ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h)
      let q = 0.82, out = c.toDataURL('image/jpeg', q)
      while (dataUrlBytes(out) > maxKB * 1024 && q > 0.45) { q -= 0.12; out = c.toDataURL('image/jpeg', q) }
      resolve(out)
    }
    img.onerror = () => resolve(src)
    img.src = src
  })
}

/** 从拖拽/粘贴事件里提取图片文件，压缩后转成 dataURL 数组 */
export async function extractImages(
  dt: DataTransfer | null,
  max = 8
): Promise<string[]> {
  if (!dt) return []
  const out: string[] = []
  const files = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'))
  for (const f of files) {
    if (out.length >= max) break
    out.push(await compressDataUrl(await fileToDataUrl(f)))
  }
  // 兜底：从 items 里取（部分来源只在 items 中提供图片）
  if (out.length === 0 && dt.items) {
    for (const it of Array.from(dt.items)) {
      if (out.length >= max) break
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) out.push(await compressDataUrl(await fileToDataUrl(f)))
      }
    }
  }
  return out
}
