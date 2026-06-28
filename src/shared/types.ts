// 在主进程与渲染进程之间共享的类型定义

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** 附带的图片 dataURL（用户上传或助手返图） */
  images?: string[]
  /** 醒目提示（如所选模型繁忙、已用兜底模型补出图时的说明），渲染在结果图上方 */
  note?: string
  /** 设计工坊：拆解出的待生成图片清单（渲染成预览确认卡） */
  design?: { title: string; prompt: string; ratio: string }[]
  /** 设计工坊：该卡是「点数不足后续生成」卡（充值后继续生成剩余） */
  resume?: boolean
  /** 一键重新生成：生成这张图所用的提示词/参考图/比例，点按钮即回填输入框复用 */
  src?: { prompt: string; refs?: string[]; ratio?: string }
  /** 设计工坊该套方案的原始需求文字，供"让 AI 补足/重排到 N 张"复用 */
  brief?: string
  /** 需求1：失败消息携带重生该项所需参数，供失败气泡「重新生成」原位重生 */
  retry?: { kind: 'gen' | 'design'; prompt: string; refs?: string[]; ratio?: string; model?: string }
}

export interface AppSettings {
  exportDir?: string
  defaultFormat: 'png' | 'jpeg' | 'webp'
  /** 用户导入的本地字体文件路径 */
  customFonts: CustomFont[]
  /** 已“部署”到软件的资源库工具 id 列表 */
  deployedTools?: string[]
}

export interface CustomFont {
  family: string
  path: string
}

/** 本地图像处理：缩放/放大/格式转换/压缩 */
export interface ProcessImageRequest {
  dataUrl: string
  /** 目标宽（像素）；不传表示按比例或不变 */
  width?: number
  height?: number
  /** Lanczos 放大倍数（与 width/height 二选一），如 2 表示放大 2 倍 */
  scale?: number
  /** 缩放适配方式：fill=拉伸，cover=按比例裁切填满(用于固定比例高清图)，inside=按比例不裁切 */
  fit?: 'fill' | 'cover' | 'inside'
  format?: 'png' | 'jpeg' | 'webp'
  /** jpeg/webp 质量 1-100 */
  quality?: number
}

export interface ProcessImageResult {
  ok: boolean
  dataUrl?: string
  width?: number
  height?: number
  bytes?: number
  error?: string
}

export interface ImageInfo {
  width: number
  height: number
  format: string
  bytes: number
}
