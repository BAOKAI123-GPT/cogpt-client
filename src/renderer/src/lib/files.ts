/** File/Blob → dataURL */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

/** 从拖拽/粘贴事件里提取图片文件，转成 dataURL 数组 */
export async function extractImages(
  dt: DataTransfer | null,
  max = 6
): Promise<string[]> {
  if (!dt) return []
  const out: string[] = []
  const files = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'))
  for (const f of files) {
    if (out.length >= max) break
    out.push(await fileToDataUrl(f))
  }
  // 兜底：从 items 里取（部分来源只在 items 中提供图片）
  if (out.length === 0 && dt.items) {
    for (const it of Array.from(dt.items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) out.push(await fileToDataUrl(f))
      }
    }
  }
  return out
}
