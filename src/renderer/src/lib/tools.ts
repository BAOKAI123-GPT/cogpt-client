// 资源库工具：只保留经实测、真正可用、可离线的工具。
import { Shapes, Ruler } from 'lucide-react'

export type ToolId = 'scaler' | 'vector'

export interface ToolDef {
  id: ToolId
  name: string
  desc: string
  icon: typeof Shapes
  source: string
  badges: string[]
  alwaysReady: boolean
  status: 'ready'
}

export const TOOLS: ToolDef[] = [
  {
    id: 'scaler',
    name: '像素缩放 / 放大',
    desc: '只改图片像素尺寸，不改动画面内容；从原图直接缩放、不丢细节。完全离线。',
    icon: Ruler,
    source: 'sharp (Lanczos)',
    badges: ['本地免费', '离线', '不改画面'],
    alwaysReady: true,
    status: 'ready'
  },
  {
    id: 'vector',
    name: '矢量化（放大不糊）',
    desc: '把 Logo、图标、文字、扁平图形转成矢量(SVG)，无限放大都清晰锐利、可印刷。注：照片类复杂图不适用。',
    icon: Shapes,
    source: 'VTracer (MIT)',
    badges: ['本地免费', '离线', '印刷级'],
    alwaysReady: true,
    status: 'ready'
  }
]

export function toolById(id: ToolId): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id)
}
