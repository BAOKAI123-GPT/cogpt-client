// 比例与画质预设。
//
// 关键事实（实测中转站）：
//  - gpt-image-2 / gpt-image-2-all 支持「任意比例」——直接把目标尺寸发给模型，模型返回对应比例的真图。
//  - gpt-image-1 / 1.5 / mini 等只支持 1024×1024 / 1024×1536 / 1536×1024 三种（1:1 / 2:3 / 3:2）。
// 因此：按所选模型的能力开放比例；模型出不了的比例直接禁选。
// **永不本地裁切**：模型出多大比例就是多大；高清化只用 Lanczos 按长边等比放大（不裁、不变形）。

import type { Pricing } from './api'

export interface RatioOption {
  key: string
  label: string
  size: string // 直接发给模型的尺寸（gpt-image-2 会按此比例出图）
  group: '方形' | '竖版' | '横版'
}

export const RATIOS: RatioOption[] = [
  { key: '1:1', label: '1:1 方形', size: '1024x1024', group: '方形' },
  { key: '4:5', label: '4:5 竖', size: '1024x1280', group: '竖版' },
  { key: '3:4', label: '3:4 竖', size: '1080x1440', group: '竖版' },
  { key: '2:3', label: '2:3 竖', size: '1024x1536', group: '竖版' },
  { key: '9:16', label: '9:16 竖', size: '1080x1920', group: '竖版' },
  { key: '5:4', label: '5:4 横', size: '1280x1024', group: '横版' },
  { key: '4:3', label: '4:3 横', size: '1440x1080', group: '横版' },
  { key: '3:2', label: '3:2 横', size: '1536x1024', group: '横版' },
  { key: '16:9', label: '16:9 横', size: '1920x1080', group: '横版' }
]

// 严格模型只支持的三种原生比例
const STRICT_RATIOS = ['1:1', '2:3', '3:2']

/** 该模型是否支持任意比例。
 *  gpt-image-2 / gpt-image-2-all 与 gemini(Nano Banana) 支持全部画幅；
 *  但 gpt-image-2-light（标准档）只支持通用 3 档，故用负向断言排除 light。 */
export function modelSupportsAnyRatio(model: string): boolean {
  const m = model || ''
  return /gemini/i.test(m) || /gpt-image-2(?!-?light)/i.test(m)
}

/** 某模型是否支持某比例 */
export function ratioSupported(model: string, ratioKey: string): boolean {
  return modelSupportsAnyRatio(model) || STRICT_RATIOS.includes(ratioKey)
}

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

/** 该比例直接发给模型的尺寸 */
export function modelSizeFor(ratioKey: string): string {
  return ratioByKey(ratioKey).size
}

/** 画质对应的长边像素（本地等比放大用，不裁切；也作为 /api/generate 的 hdEdge 传给后端计高清加点） */
export function qualityLongEdge(qualityKey: string): number {
  return qualityByKey(qualityKey).longEdge
}

/** 高清加点：按所选画质长边 hdEdge，取 pricing.hdSurcharge 中 hdEdge≥阈值的最大加点。
 *  与服务端规则保持一致（服务端为权威，这里仅用于 UI 估算）。 */
export function hdSurchargeFor(hdEdge: number, pricing?: Pricing): number {
  if (!pricing?.hdSurcharge) return 0
  let add = 0
  for (const [edge, points] of Object.entries(pricing.hdSurcharge)) {
    if (hdEdge >= Number(edge)) add = Math.max(add, Number(points) || 0)
  }
  return add
}

/** 估算本次扣点 = 基础点(meta.credits) + 多参考图(>1 张时每多 1 张 +refExtraPoints) + 高清加点(按 hdEdge)。
 *  服务端为权威计费，这里仅用于 UI 展示「本次约扣 N 点」。 */
export function estimatePoints(opts: {
  baseCredits: number
  refCount?: number
  hdEdge?: number
  pricing?: Pricing
}): number {
  const { baseCredits, refCount = 0, hdEdge = 0, pricing } = opts
  const refExtra = refCount > 1 && pricing ? (refCount - 1) * (pricing.refExtraPoints || 0) : 0
  return baseCredits + refExtra + hdSurchargeFor(hdEdge, pricing)
}
