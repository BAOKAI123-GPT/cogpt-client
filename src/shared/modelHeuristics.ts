import type { ModelInfo, ModelKind } from './types'

// 各家中转站给 gpt 生图模型起的名字五花八门，无法 100% 猜准。
// 这里用关键词启发式给每个模型打一个“像不像生图模型”的分，
// 让 UI 自动高亮最可能的那个；用户始终可以手动改。

interface Rule {
  // 命中即加分
  test: RegExp
  score: number
  reason: string
  kind?: ModelKind
}

// 强信号：明确是图像生成模型
const IMAGE_RULES: Rule[] = [
  { test: /gpt-image/i, score: 100, reason: 'gpt-image 系列（OpenAI 官方生图模型）', kind: 'image' },
  { test: /gpt-4o.*image|image.*gpt-4o|4o-image/i, score: 95, reason: 'gpt-4o 对话式生图', kind: 'image' },
  { test: /dall-?e/i, score: 80, reason: 'DALL·E 生图模型', kind: 'image' },
  { test: /\bflux\b/i, score: 70, reason: 'FLUX 生图模型', kind: 'image' },
  { test: /stable-?diffusion|\bsd[-_]?(xl|3|1\.5)?\b/i, score: 65, reason: 'Stable Diffusion 生图模型', kind: 'image' },
  { test: /midjourney|\bmj\b/i, score: 60, reason: 'Midjourney 风格生图', kind: 'image' },
  { test: /seedream|kolors|cogview|hunyuan-image|wanx|qwen-image|doubao.*image/i, score: 60, reason: '国产生图模型', kind: 'image' },
  { test: /imagen/i, score: 60, reason: 'Google Imagen 生图', kind: 'image' },
  // 兜底：名字里含 image / draw / paint，但不是 embedding/vision-only
  { test: /\b(image|draw|paint|art)\b/i, score: 30, reason: '名称含生图关键词', kind: 'image' }
]

// 反信号：明显不是生图（embedding / 语音 / 重排 / 审核等）
const NEGATIVE_RULES: Rule[] = [
  { test: /embedding|embed|rerank|moderation|whisper|tts|audio|speech|realtime|vision-only/i, score: -200, reason: '非生图模型' }
]

// 聊天/对话模型识别（用于自动选 chatModel）
const CHAT_RULES: Rule[] = [
  { test: /gpt-4o(?!.*image)|gpt-4\.1|gpt-4-turbo|o[1-9]|chatgpt/i, score: 90, reason: 'GPT 对话模型', kind: 'chat' },
  { test: /claude/i, score: 80, reason: 'Claude 对话模型', kind: 'chat' },
  { test: /gemini(?!.*image)/i, score: 70, reason: 'Gemini 对话模型', kind: 'chat' },
  { test: /deepseek|qwen(?!-image)|glm|moonshot|kimi|yi-|grok(?!-video)/i, score: 60, reason: '对话模型', kind: 'chat' }
]

export function classifyModel(id: string): ModelInfo {
  let imageScore = 0
  let chatScore = 0
  let reason: string | undefined

  for (const r of NEGATIVE_RULES) {
    if (r.test.test(id)) {
      return { id, kind: 'unknown', imageScore: -1, reason: r.reason }
    }
  }

  for (const r of IMAGE_RULES) {
    if (r.test.test(id)) {
      if (r.score > imageScore) {
        imageScore = r.score
        reason = r.reason
      }
    }
  }
  for (const r of CHAT_RULES) {
    if (r.test.test(id) && r.score > chatScore) chatScore = r.score
  }

  let kind: ModelKind = 'unknown'
  if (imageScore >= chatScore && imageScore > 0) kind = 'image'
  else if (chatScore > 0) kind = 'chat'

  return { id, kind, imageScore, reason }
}

export function classifyModels(ids: string[]): ModelInfo[] {
  return ids
    .map(classifyModel)
    .sort((a, b) => b.imageScore - a.imageScore || a.id.localeCompare(b.id))
}

/** 从分类结果里挑出最推荐的生图 / 对话模型 id */
export function pickSuggestions(models: ModelInfo[]): {
  image?: string
  chat?: string
} {
  const image = models.find((m) => m.kind === 'image' && m.imageScore > 0)?.id
  const chat = [...models].sort((a, b) => {
    const sa = a.kind === 'chat' ? 1 : 0
    const sb = b.kind === 'chat' ? 1 : 0
    return sb - sa
  }).find((m) => m.kind === 'chat')?.id
  return { image, chat }
}
