import { configStore } from './store'
import { classifyModels, pickSuggestions } from '../shared/modelHeuristics'
import { normalizeBaseUrl } from '../shared/url'
import { log } from './logger'
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ScanModelsResult,
  GeneratedImage
} from '../shared/types'

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
}

async function withTimeout<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** data:image/png;base64,xxxx → { mime, buffer } */
function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!m) throw new Error('无效的图片数据')
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') }
}

function bufferToDataUrl(buf: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  const mime = res.headers.get('content-type') || 'image/png'
  const buf = Buffer.from(await res.arrayBuffer())
  return bufferToDataUrl(buf, mime)
}

/** 取出本次请求的所有参考图（兼容单图 initImage 与多图 initImages） */
function reqImages(req: GenerateImageRequest): string[] {
  if (req.initImages && req.initImages.length) return req.initImages
  if (req.initImage) return [req.initImage]
  return []
}

const GEN_TIMEOUT = 300000 // 生图超时 5 分钟（部分中转站较慢）

// ---------------------------------------------------------------------------
// 扫描模型
// ---------------------------------------------------------------------------
export async function scanModels(
  baseUrl: string,
  apiKey: string
): Promise<ScanModelsResult> {
  const url = `${normalizeBaseUrl(baseUrl)}/v1/models`
  try {
    const res = await withTimeout(20000, (signal) =>
      fetch(url, { headers: authHeaders(apiKey), signal })
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        ok: false,
        models: [],
        error: `中转站返回 ${res.status}：${body.slice(0, 200) || res.statusText}`
      }
    }
    const json: any = await res.json()
    const ids: string[] = Array.isArray(json?.data)
      ? json.data.map((m: any) => m?.id).filter((x: any) => typeof x === 'string')
      : Array.isArray(json)
        ? json.map((m: any) => m?.id ?? m).filter((x: any) => typeof x === 'string')
        : []
    if (ids.length === 0) {
      return { ok: false, models: [], error: '该中转站 /v1/models 没有返回任何模型' }
    }
    const models = classifyModels(ids)
    const suggestions = pickSuggestions(models)
    return {
      ok: true,
      models,
      suggestedImageModel: suggestions.image,
      suggestedChatModel: suggestions.chat
    }
  } catch (e: any) {
    return {
      ok: false,
      models: [],
      error:
        e?.name === 'AbortError'
          ? '连接超时，请检查中转站 URL 是否正确、网络是否通畅'
          : `无法连接中转站：${e?.message ?? e}`
    }
  }
}

// ---------------------------------------------------------------------------
// 文生图 / 图生图 / 局部重绘
// ---------------------------------------------------------------------------

/** 标准图像接口：/v1/images/generations 或 /v1/images/edits */
async function generateViaImagesApi(
  baseUrl: string,
  apiKey: string,
  model: string,
  req: GenerateImageRequest
): Promise<GenerateImageResult> {
  const size = req.size || '1024x1024'
  const n = req.n || 1

  const imgs = reqImages(req)
  // 有输入图 → 走 edits（图生图 / 参考图 / 局部重绘）
  if (imgs.length) {
    const url = `${baseUrl}/v1/images/edits`
    const form = new FormData()
    if (imgs.length === 1) {
      const init = parseDataUrl(imgs[0])
      form.append('image', new Blob([init.buffer], { type: init.mime }), 'image.png')
    } else {
      // 多张参考图：按 OpenAI gpt-image-1 规范用 image[]
      imgs.forEach((d, i) => {
        const p = parseDataUrl(d)
        form.append('image[]', new Blob([p.buffer], { type: p.mime }), `image_${i}.png`)
      })
    }
    if (req.mask) {
      const mask = parseDataUrl(req.mask)
      form.append('mask', new Blob([mask.buffer], { type: mask.mime }), 'mask.png')
    }
    form.append('model', model)
    form.append('prompt', req.prompt)
    form.append('size', size)
    form.append('n', String(n))

    const res = await withTimeout(GEN_TIMEOUT, (signal) =>
      fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal
      })
    )
    return parseImagesResponse(res, 'images')
  }

  // 否则 → generations（文生图）
  const url = `${baseUrl}/v1/images/generations`
  const res = await withTimeout(GEN_TIMEOUT, (signal) =>
    fetch(url, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ model, prompt: req.prompt, size, n }),
      signal
    })
  )
  return parseImagesResponse(res, 'images')
}

async function parseImagesResponse(
  res: Response,
  usedFlow: 'images' | 'chat'
): Promise<GenerateImageResult> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return {
      ok: false,
      images: [],
      error: `生图失败 ${res.status}：${body.slice(0, 300) || res.statusText}`
    }
  }
  const json: any = await res.json()
  const data: any[] = Array.isArray(json?.data) ? json.data : []
  const images: GeneratedImage[] = []
  for (const item of data) {
    if (item?.b64_json) {
      images.push({ dataUrl: bufferToDataUrl(Buffer.from(item.b64_json, 'base64')) })
    } else if (item?.url) {
      try {
        images.push({ dataUrl: await urlToDataUrl(item.url) })
      } catch {
        /* 跳过取不到的 url */
      }
    }
  }
  if (images.length === 0) {
    return {
      ok: false,
      images: [],
      error: '中转站没有返回可用图片（可能该模型不支持图像接口，可在设置里切换为“对话流”）'
    }
  }
  return { ok: true, images, usedFlow }
}

/** 对话式生图：/v1/chat/completions，从回复里提取图片 */
async function generateViaChatApi(
  baseUrl: string,
  apiKey: string,
  model: string,
  req: GenerateImageRequest
): Promise<GenerateImageResult> {
  const url = `${baseUrl}/v1/chat/completions`
  const userContent: any[] = [{ type: 'text', text: req.prompt }]
  for (const d of reqImages(req)) {
    userContent.push({ type: 'image_url', image_url: { url: d } })
  }
  const res = await withTimeout(GEN_TIMEOUT, (signal) =>
    fetch(url, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: userContent }],
        stream: false
      }),
      signal
    })
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return {
      ok: false,
      images: [],
      error: `生图失败 ${res.status}：${body.slice(0, 300) || res.statusText}`
    }
  }
  const json: any = await res.json()
  const msg = json?.choices?.[0]?.message
  let text = ''
  const rawParts: string[] = []
  if (typeof msg?.content === 'string') {
    text = msg.content
    rawParts.push(msg.content)
  } else if (Array.isArray(msg?.content)) {
    for (const part of msg.content) {
      if (part?.type === 'text' && part.text) {
        text += part.text
        rawParts.push(part.text)
      }
      if (part?.type === 'image_url' && part.image_url?.url) {
        rawParts.push(part.image_url.url)
      }
    }
  }
  // 从文本中提取 markdown 图片 / 裸 url / data url
  const found = new Set<string>()
  const combined = rawParts.join('\n')
  const urlRe = /(data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)|(https?:\/\/[^\s)"']+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s)"']*)?)|(https?:\/\/[^\s)"']*?(?:image|img|dalle|oaidalleapi|file)[^\s)"']*)/gi
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(combined))) found.add(m[0])

  const images: GeneratedImage[] = []
  for (const u of found) {
    try {
      images.push({ dataUrl: u.startsWith('data:') ? u : await urlToDataUrl(u) })
    } catch {
      /* 忽略取不到的 */
    }
  }
  if (images.length === 0) {
    return {
      ok: false,
      images: [],
      text,
      error:
        '这条回复里没有解析到图片。该模型可能不是生图模型，或返回格式特殊；可在设置里切换流或更换模型。'
    }
  }
  return { ok: true, images, text, usedFlow: 'chat' }
}

export async function generateImage(
  req: GenerateImageRequest
): Promise<GenerateImageResult> {
  const profile = configStore.getRawProfile(req.profileId)
  if (!profile) return { ok: false, images: [], error: '找不到该中转站配置' }
  if (!profile.apiKey) return { ok: false, images: [], error: '该中转站还没有填写 API Key' }
  const baseUrl = normalizeBaseUrl(profile.baseUrl)
  const imageModel = profile.imageModel
  const chatModel = profile.chatModel || profile.imageModel

  // 决定走哪条流
  const flow = profile.flow
  const refCount = reqImages(req).length
  log(
    'info',
    `生图请求 站点=${profile.name} 模型=${imageModel || '?'} 流=${flow} 尺寸=${req.size || '默认'} 参考图=${refCount} mask=${req.mask ? '有' : '无'}`
  )
  try {
    let result: GenerateImageResult
    if (flow === 'chat') {
      result = await generateViaChatApi(baseUrl, profile.apiKey, chatModel || '', req)
    } else if (flow === 'images') {
      result = await generateViaImagesApi(baseUrl, profile.apiKey, imageModel || '', req)
    } else {
      // auto：先按模型名猜，gpt-4o-image / 4o 系倾向对话流，其余走图像接口；失败则回退另一条
      const looksChat = /4o.*image|image.*4o|gpt-4o/i.test(imageModel || '')
      const first = looksChat
        ? () => generateViaChatApi(baseUrl, profile.apiKey, imageModel || chatModel || '', req)
        : () => generateViaImagesApi(baseUrl, profile.apiKey, imageModel || '', req)
      const second = looksChat
        ? () => generateViaImagesApi(baseUrl, profile.apiKey, imageModel || '', req)
        : () => generateViaChatApi(baseUrl, profile.apiKey, imageModel || chatModel || '', req)
      const r1 = await first()
      result = r1.ok ? r1 : (await second()).ok ? await second() : r1
    }
    if (result.ok) log('info', `生图成功 流=${result.usedFlow ?? flow} 张数=${result.images.length}`)
    else log('error', `生图失败：${result.error ?? '未知'}`)
    return result
  } catch (e: any) {
    const msg =
      e?.name === 'AbortError'
        ? '生图超时（图像生成有时较慢，可重试或换更快的模型）'
        : `生图出错：${e?.message ?? e}`
    log('error', `生图异常：${msg}`)
    return {
      ok: false,
      images: [],
      error: msg
    }
  }
}
