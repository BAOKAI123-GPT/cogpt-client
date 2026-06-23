// 在主进程与渲染进程之间共享的类型定义

/** 生图走哪条接口流 */
export type RelayFlow = 'auto' | 'images' | 'chat'

/** 一个中转站配置（返回给渲染进程时 apiKey 被掩码，原始 key 只存在主进程） */
export interface RelayProfile {
  id: string
  name: string
  baseUrl: string
  /** 掩码后的 key，例如 sk-Gi••••cd49，仅用于显示 */
  apiKeyMasked: string
  /** 是否已配置 key */
  hasKey: boolean
  imageModel?: string
  chatModel?: string
  flow: RelayFlow
  /** 默认出图尺寸，如 1024x1024 */
  defaultSize: string
  createdAt: number
}

/** 保存配置时渲染进程发来的载荷；apiKey 仅在用户输入了新值时携带 */
export interface RelayProfileInput {
  id?: string
  name: string
  baseUrl: string
  /** 明文 key；为空表示沿用已有 key（编辑场景） */
  apiKey?: string
  imageModel?: string
  chatModel?: string
  flow: RelayFlow
  defaultSize: string
}

export type ModelKind = 'image' | 'chat' | 'unknown'

export interface ModelInfo {
  id: string
  kind: ModelKind
  /** 越高越可能是“gpt 生图”模型，用于自动高亮 */
  imageScore: number
  /** 命中的判定原因，便于在 UI 上解释 */
  reason?: string
}

export interface ScanModelsResult {
  ok: boolean
  models: ModelInfo[]
  /** 推荐默认选中的生图模型 id */
  suggestedImageModel?: string
  suggestedChatModel?: string
  error?: string
}

export interface GenerateImageRequest {
  profileId: string
  prompt: string
  size?: string
  n?: number
  /** 图生图/局部重绘时的单张输入图（dataURL）——用于 mask 局部重绘 */
  initImage?: string
  /** 参考图（dataURL，可多张）——对标 GPT 识图生图 */
  initImages?: string[]
  /** 局部重绘的 mask（dataURL，透明处=要重绘的区域） */
  mask?: string
}

export interface GeneratedImage {
  /** data URL（image/png 等） */
  dataUrl: string
}

export interface GenerateImageResult {
  ok: boolean
  images: GeneratedImage[]
  /** 对话流可能附带的文字回复 */
  text?: string
  error?: string
  /** 实际使用的流，便于 UI 提示 */
  usedFlow?: 'images' | 'chat'
}

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

/** 会员/计费（当前为本地实现，预留接口对接后台） */
export interface Billing {
  plan: string
  monthlyQuota: number
  credits: number
  period: string // YYYY-MM
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
