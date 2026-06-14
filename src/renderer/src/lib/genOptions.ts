// 比例与画质预设，以及把它们换算成「发给模型的尺寸」和「本地高清化的目标尺寸」。
//
// 现实约束：gpt-image 类模型只支持三种尺寸（1024×1024 / 1024×1536 / 1536×1024），
// 即只有 1:1 / 2:3 / 3:2 三种原生比例，没有 3:4、9:16 等。
// 因此只提供这三种「所见即所得」的比例，绝不再裁切内容；
// 高清化只用 Lanczos 按长边等比放大（本地免费、不依赖中转站，可用于打印），不裁、不变形。

export interface RatioOption {
  key: string
  label: string
  w: number
  h: number
  group: '方形' | '竖版' | '横版'
}

// 只保留 gpt-image 原生支持的三种比例，避免本地裁切导致内容缺失。
export const RATIOS: RatioOption[] = [
  { key: '1:1', label: '1:1 方形', w: 1, h: 1, group: '方形' },
  { key: '2:3', label: '2:3 竖版', w: 2, h: 3, group: '竖版' },
  { key: '3:2', label: '3:2 横版', w: 3, h: 2, group: '横版' }
]

export interface QualityOption {
  key: string
  label: string
  longEdge: number
  hint: string
}

export const QUALITIES: QualityOption[] = [
  { key: 'std', label: '标准', longEdge: 1024, hint: '约 1K，出图最快' },
  { key: 'hd', label: '高清', longEdge: 1536, hint: '约 1.5K' },
  { key: '2k', label: '2K', longEdge: 2048, hint: '本地高清放大到 2K' },
  { key: '4k', label: '4K', longEdge: 4096, hint: '本地高清放大到 4K，可打印' }
]

export const DEFAULT_RATIO = '1:1'
export const DEFAULT_QUALITY = 'hd'

function ratioByKey(key: string): RatioOption {
  return RATIOS.find((r) => r.key === key) ?? RATIOS[0]
}
function qualityByKey(key: string): QualityOption {
  return QUALITIES.find((q) => q.key === key) ?? QUALITIES[1]
}

/** 选最接近的模型可用尺寸 */
export function modelSizeFor(ratioKey: string): string {
  const r = ratioByKey(ratioKey)
  if (r.w === r.h) return '1024x1024'
  return r.w > r.h ? '1536x1024' : '1024x1536'
}

/** 画质对应的长边像素（本地等比放大用，不裁切） */
export function qualityLongEdge(qualityKey: string): number {
  return qualityByKey(qualityKey).longEdge
}

/** 目标高清尺寸（按比例 × 画质长边） */
export function finalSizeFor(ratioKey: string, qualityKey: string): { width: number; height: number } {
  const r = ratioByKey(ratioKey)
  const long = qualityByKey(qualityKey).longEdge
  let width: number
  let height: number
  if (r.w === r.h) {
    width = height = long
  } else if (r.w > r.h) {
    width = long
    height = Math.round((long * r.h) / r.w)
  } else {
    height = long
    width = Math.round((long * r.w) / r.h)
  }
  // 取偶数，避免某些编码器报错
  return { width: width - (width % 2), height: height - (height % 2) }
}
