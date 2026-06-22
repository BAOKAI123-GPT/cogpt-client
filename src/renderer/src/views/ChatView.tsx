import { useEffect, useRef, useState } from 'react'
import {
  Send,
  Loader2,
  Download,
  Wand2,
  Trash2,
  ImagePlus,
  RefreshCw,
  X,
  SlidersHorizontal,
  MessageSquareQuote,
  Image as ImageIcon
} from 'lucide-react'
import { useApp } from '../store/app'
import type { ChatMessage } from '@shared/types'
import type { ModelMeta } from '../lib/api'
import { extractImages, compressDataUrl } from '../lib/files'
import { nextImgName } from '../lib/imgname'
import { ImageEditModal } from '../components/ImageEditModal'
import {
  RATIOS,
  QUALITIES,
  DEFAULT_RATIO,
  DEFAULT_QUALITY,
  ratioSupported,
  modelSupportsAnyRatio,
  qualityLongEdge,
  estimatePoints
} from '../lib/genOptions'

const SUGGESTIONS = [
  '一只戴着圆框眼镜的柴犬，扁平插画风格，米色背景',
  '夏季促销海报背景，清新薄荷绿，留白给标题，电商风',
  '极简 logo：一只展翅的纸飞机，单色线条',
  '赛博朋克城市夜景，霓虹反射在湿润街道上，电影感'
]

// 模型友好名。优先用后端 meta 驱动的友好名（避免后端上新模型显示裸 id），
// 找不到再回退本地映射，最后回退裸 id。
const MODEL_LABELS: Record<string, string> = {
  'gemini-2.5-flash-image': 'Nano Banana',
  'gpt-image-1-mini': '快速',
  'gpt-image-2': '高质量GPT',
  'gpt-image-2-all': '高质量GPT',
  'gpt-image-2-light': '标准',
  'gpt-image-1': '标准',
  'gpt-image-1.5': '高清'
}
function modelLabel(m: string, meta?: ModelMeta): string {
  // 优先用后端 Config 驱动的友好名（label），新上的 z-image-turbo / qwen-image-max 等据此显示。
  // 后端没给 label 时，回退本地映射；再按 mode 给「标准 / 高质量」兜底；最后回退裸 id。
  const lbl = meta?.[m]?.label
  if (lbl) return lbl
  if (MODEL_LABELS[m]) return MODEL_LABELS[m]
  const mode = meta?.[m]?.mode
  if (mode === 'standard') return '标准'
  if (mode === 'quality') return '高质量'
  return m
}

export function ChatView(): JSX.Element {
  const messages = useApp((s) => s.messages)
  const generating = useApp((s) => s.generating)
  const genStatus = useApp((s) => s.genStatus)
  const generate = useApp((s) => s.generate)
  const clearChat = useApp((s) => s.clearChat)
  const setView = useApp((s) => s.setView)
  const models = useApp((s) => s.models)
  const modelMeta = useApp((s) => s.modelMeta)
  const pricing = useApp((s) => s.pricing)
  const selectedModel = useApp((s) => s.selectedModel)
  const setSelectedModel = useApp((s) => s.setSelectedModel)
  const tier = useApp((s) => s.tier)
  const setTier = useApp((s) => s.setTier)
  const chatMode = useApp((s) => s.chatMode)
  const setChatMode = useApp((s) => s.setChatMode)
  const chatSend = useApp((s) => s.chatSend)
  const canAbort = useApp((s) => s.canAbort)
  const abortGenerate = useApp((s) => s.abortGenerate)
  const pendingRefs = useApp((s) => s.pendingRefs)
  const clearPendingRefs = useApp((s) => s.clearPendingRefs)

  const [text, setText] = useState('')
  const [continueEdit, setContinueEdit] = useState(false)
  const [refs, setRefs] = useState<string[]>([])
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [quality, setQuality] = useState(DEFAULT_QUALITY)
  const [dragOver, setDragOver] = useState(false)
  // 即梦式：单行控件 + 点开「设置」弹层放详细项（档位/模型/比例/画质）
  const [panel, setPanel] = useState<'set' | null>(null)
  const [editImage, setEditImage] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: { label: string; fn: () => void }[] } | null>(null)
  const format = useApp((s) => s.settings.defaultFormat)
  const scrollRef = useRef<HTMLDivElement>(null)

  // —— 即梦式两档：标准(扁平/便宜/无参考图/锁3画幅) / 高质量(可切 GPT·Nano、参考图、全比例) ——
  const curMeta = modelMeta[selectedModel] || { mode: 'quality', credits: 1, ref: true }
  const isStd = curMeta.mode === 'standard'
  const refAllowed = !!curMeta.ref
  // 高质量档下的可选模型（GPT / Nano Banana 等）
  const qModels = models.filter((m) => modelMeta[m]?.mode !== 'standard')

  function onContextText(e: React.MouseEvent, text: string): void {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '引用这段文字到输入框', fn: () => setText((t) => (t ? `${t} ${text}` : text)) },
        { label: '复制文字', fn: () => navigator.clipboard.writeText(text) }
      ]
    })
  }
  function onContextImage(e: React.MouseEvent, dataUrl: string): void {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '引用为参考图重新生成', fn: () => addRefs([dataUrl]) },
        { label: '编辑 / 局部重绘', fn: () => setEditImage(dataUrl) },
        { label: '保存图片', fn: () => window.api.image.save({ dataUrl, format, defaultName: nextImgName(format) }) }
      ]
    })
  }

  const lastAssistantImage = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.images?.length)?.images?.[0]

  // 估算本次扣点：基础点(meta.credits) + 多参考图加点 + 高清加点（按所选画质长边）。
  // 实际计费以服务端为准；这里仅用于「本次约扣 N 点」提示。
  const refCount = refs.length + (continueEdit && lastAssistantImage ? 1 : 0)
  const estPoints = estimatePoints({
    baseCredits: curMeta.credits,
    refCount: refAllowed ? refCount : 0,
    hdEdge: qualityLongEdge(quality),
    pricing: pricing ?? undefined
  })
  const hasExtra = estPoints > curMeta.credits
  // 设置按钮上的摘要：档位 · 比例 · 画质（如「高质量 · 1:1 · 高清」）
  const qualityLabel = (QUALITIES.find((q) => q.key === quality) ?? QUALITIES[1]).label
  const setSummary = `${isStd ? '标准' : '高质量'} · ${ratio} · ${qualityLabel}`

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, generating])

  // 切换模型后，若当前比例该模型不支持，自动回退到方形，避免选了出不了的比例
  useEffect(() => {
    if (selectedModel && !ratioSupported(selectedModel, ratio)) setRatio(DEFAULT_RATIO)
  }, [selectedModel, ratio])

  // 标准档（不支持参考图的模型）下，清掉已选的参考图，避免发出会被拒绝的请求
  useEffect(() => {
    if (!refAllowed && refs.length) setRefs([])
  }, [refAllowed, refs.length])

  // 消费从应用任意位置拖入的图片（App 根级 drop 收集）：标准档先切到高质量档，再加入参考图
  useEffect(() => {
    if (!pendingRefs.length) return
    if (!refAllowed) { setTier('quality'); return }
    addRefs(pendingRefs)
    clearPendingRefs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRefs, refAllowed])

  function addRefs(urls: string[]): void {
    if (!urls.length) return
    // 统一压缩后入参考图（openMany/拖拽/粘贴/引用 都经此），上限 8 张
    void Promise.all(urls.map((u) => compressDataUrl(u))).then((cs) => setRefs((prev) => [...prev, ...cs].slice(0, 8)))
  }

  async function pickRefs(): Promise<void> {
    const r = await window.api.image.openMany()
    if (r.ok) addRefs(r.images.map((i) => i.dataUrl))
  }

  async function send(prompt?: string): Promise<void> {
    const p = (prompt ?? text).trim()
    // 必须有文字描述（即使带了参考图，gpt-image 也要求描述想要的画面，否则会报错）
    if (!p || generating) return
    // 对话模式：走 GPT 沟通（按点数计费，由服务端权威扣点）
    if (chatMode) { setText(''); await chatSend(p); return }
    const initImages = [
      ...(continueEdit && lastAssistantImage ? [lastAssistantImage] : []),
      ...refs
    ]
    setText('')
    setRefs([])
    await generate(p, {
      initImages: initImages.length ? initImages : undefined,
      ratioKey: ratio,
      qualityKey: quality
    })
  }

  if (!selectedModel) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <p className="text-gray-400">暂无可用生图模型，请稍后再试（或联系管理员配置）。</p>
      </div>
    )
  }

  return (
    <div
      className="h-full flex flex-col relative"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false)
      }}
      onDrop={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(false)
        addRefs(await extractImages(e.dataTransfer))
      }}
    >
      {dragOver && (
        <div className="absolute inset-3 z-30 rounded-2xl border-2 border-dashed border-brand bg-brand/10 grid place-items-center pointer-events-none">
          <div className="text-brand font-medium">松开鼠标，添加为参考图</div>
        </div>
      )}

      {editImage && <ImageEditModal dataUrl={editImage} onClose={() => setEditImage(null)} />}

      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 card p-1 shadow-2xl text-sm w-52"
            style={{ left: Math.min(menu.x, window.innerWidth - 220), top: menu.y }}
          >
            {menu.items.map((it, i) => (
              <button
                key={i}
                className="block w-full text-left px-3 py-1.5 rounded hover:bg-white/10"
                onClick={() => {
                  it.fn()
                  setMenu(null)
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-3xl mx-auto space-y-5">
          {messages.length === 0 && (
            <div className="text-center pt-12">
              <h2 className="text-lg font-medium mb-1">描述你想要的画面，回车生成</h2>
              <p className="text-sm text-gray-500 mb-6">
                正在使用 <span className="text-brand">Co-GPT</span> · {modelLabel(selectedModel, modelMeta)}
                <br />
                <span className="text-xs">可拖入或粘贴图片作为「参考图」，让 AI 参考其风格/构图生成</span>
              </p>
              <div className="grid grid-cols-2 gap-2 max-w-xl mx-auto">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="card p-3 text-left text-sm text-gray-300 hover:border-brand/60"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <Bubble
              key={i}
              msg={m}
              onEdit={setEditImage}
              onContextText={onContextText}
              onContextImage={onContextImage}
            />
          ))}

          {generating && <ProgressCard status={genStatus} onAbort={canAbort ? abortGenerate : undefined} />}
        </div>
      </div>

      {/* 输入区 */}
      <div className="border-t border-edge px-6 py-3">
        <div className="max-w-3xl mx-auto">
          {/* 参考图缩略图 */}
          {refs.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {refs.map((src, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-edge">
                  <img src={src} className="w-full h-full object-cover" />
                  <button
                    onClick={() => setRefs((p) => p.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5 hover:bg-black"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 设置弹层（即梦式：把标准/高质量档 + 高质量模型 + 比例 + 画质收进一个紧凑面板，点「设置」从下方弹起） */}
          {!chatMode && panel === 'set' && (
            <div className="card p-3 mb-2 space-y-3">
              {/* 档位：标准 / 高质量 */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-400 w-12 shrink-0">画质档</span>
                <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs">
                  <button
                    className={`px-3 py-1.5 ${isStd ? 'bg-brand text-white' : 'text-gray-400'}`}
                    onClick={() => setTier('standard')}
                  >
                    标准
                  </button>
                  <button
                    className={`px-3 py-1.5 ${!isStd ? 'bg-brand text-white' : 'text-gray-400'}`}
                    onClick={() => setTier('quality')}
                  >
                    高质量
                  </button>
                </div>
                <span className="text-[11px] text-gray-500">
                  本次{hasExtra ? '约扣' : '扣'} <b className="text-gray-300">{estPoints}</b> 点
                  {isStd ? '（通用 3 比例）' : '（可换模型 / 参考图 / 全比例）'}
                </span>
              </div>

              {/* 高质量档：展开 高质量GPT / Nano Banana 选择 */}
              {!isStd && qModels.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400 w-12 shrink-0">模型</span>
                  {qModels.map((m) => (
                    <button
                      key={m}
                      onClick={() => setSelectedModel(m)}
                      className={`px-2.5 py-1 rounded-md text-xs ${
                        m === selectedModel ? 'bg-brand text-white' : 'bg-white/5 hover:bg-white/10 text-gray-300'
                      }`}
                    >
                      {modelLabel(m, modelMeta)}
                    </button>
                  ))}
                </div>
              )}

              {/* 比例 */}
              <div>
                <div className="text-xs text-gray-400 mb-1.5">
                  比例
                  {!modelSupportsAnyRatio(selectedModel) && (
                    <span className="text-amber-300/80 font-normal"> （{modelLabel(selectedModel, modelMeta)} 仅 3 比例，9:16 等请切高质量）</span>
                  )}
                </div>
                {(['方形', '竖版', '横版'] as const).map((g) => (
                  <div key={g} className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`text-xs font-bold shrink-0 w-8 ${g === '方形' ? 'text-violet-300' : g === '竖版' ? 'text-cyan-300' : 'text-amber-300'}`}
                    >
                      {g}
                    </span>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {RATIOS.filter((r) => r.group === g).map((r) => {
                        const ok = ratioSupported(selectedModel, r.key)
                        return (
                          <button
                            key={r.key}
                            disabled={!ok}
                            title={ok ? '' : '当前模型不支持该比例'}
                            onClick={() => ok && setRatio(r.key)}
                            className={`px-2 py-1 rounded text-xs ${
                              !ok
                                ? 'opacity-30 line-through cursor-not-allowed bg-white/5'
                                : r.key === ratio
                                  ? 'bg-brand text-white'
                                  : 'bg-white/5 hover:bg-white/10'
                            }`}
                          >
                            {r.key}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* 画质（高清化：本地等比放大，越高越清越慢） */}
              <div>
                <div className="text-xs text-gray-400 mb-1.5">画质（生成后本地放大，越高越清越慢）</div>
                <div className="flex flex-wrap gap-1.5">
                  {QUALITIES.map((q) => (
                    <button
                      key={q.key}
                      onClick={() => setQuality(q.key)}
                      title={q.hint}
                      className={`px-2.5 py-1 rounded text-xs ${
                        q.key === quality ? 'bg-brand text-white' : 'bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 基于上一张继续改 */}
              {refAllowed && (
                <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={continueEdit}
                    disabled={!lastAssistantImage}
                    onChange={(e) => setContinueEdit(e.target.checked)}
                  />
                  <RefreshCw size={13} /> 基于上一张继续改
                </label>
              )}

              <p className="text-[10px] text-gray-600">
                多张参考图、超清（2K/4K）会额外计点；最终扣点以服务端为准。
              </p>
            </div>
          )}

          {/* 单行控件：对话/生图 + 参考图 + 设置（即梦式，详细项收进「设置」弹层；窗口窄时自动换行） */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div className="flex rounded-lg overflow-hidden border border-white/10 text-xs">
              <button
                className={`flex items-center gap-1 px-3 py-1.5 ${chatMode ? 'bg-brand text-white' : 'text-gray-400'}`}
                onClick={() => { setChatMode(true); setPanel(null) }}
              >
                <MessageSquareQuote size={13} /> 对话
              </button>
              <button
                className={`flex items-center gap-1 px-3 py-1.5 ${!chatMode ? 'bg-brand text-white' : 'text-gray-400'}`}
                onClick={() => setChatMode(false)}
              >
                <ImageIcon size={13} /> 生图
              </button>
            </div>
            {!chatMode && refAllowed && (
              <button className="btn-soft py-1.5 px-2.5 text-xs" onClick={pickRefs}>
                <ImagePlus size={14} /> 参考图{refs.length ? `(${refs.length})` : ''}
              </button>
            )}
            {!chatMode && (
              <button
                className={`btn-soft py-1.5 px-2.5 text-xs ${panel === 'set' ? '!bg-brand !text-white !border-brand' : ''}`}
                onClick={() => setPanel(panel === 'set' ? null : 'set')}
                title="档位 / 模型 / 比例 / 画质"
              >
                <SlidersHorizontal size={14} /> {setSummary}
              </button>
            )}
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 ml-auto"
              >
                <Trash2 size={13} /> 清空
              </button>
            )}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              className="field resize-none h-[52px] py-3"
              placeholder={chatMode ? '说说你想要的图，我帮你聊清楚（想好了回复「生成」即可出图）…' : '描述你想要的图片；也可拖入/粘贴图片作为参考图…'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={async (e) => {
                const imgs = await extractImages(e.clipboardData)
                if (imgs.length) {
                  e.preventDefault()
                  addRefs(imgs)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button
              className="btn-primary h-[52px] px-4"
              onClick={() => send()}
              disabled={generating || !text.trim()}
              title={!text.trim() ? '请输入文字描述' : '生成'}
            >
              {generating ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// 生图进度
function ProgressCard({ status, onAbort }: { status: string; onAbort?: () => void }): JSX.Element {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const mm = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return (
    <div className="card p-4 max-w-sm">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="animate-spin text-brand" size={16} />
        <span>{status || '正在生成…'}</span>
        <span className="ml-auto text-xs text-gray-500 tabular-nums">{mm}:{ss}</span>
        {onAbort && (
          <button onClick={onAbort} className="btn-soft py-1 px-2.5 text-xs">
            中止
          </button>
        )}
      </div>
      <div className="mt-2.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full w-1/3 bg-brand rounded-full animate-[indeterminate_1.4s_ease-in-out_infinite]" />
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        图像生成通常需要十几秒到一分钟，高清大图会再多花几秒，请耐心等待。
      </p>
    </div>
  )
}

function Bubble({
  msg,
  onEdit,
  onContextText,
  onContextImage
}: {
  msg: ChatMessage
  onEdit: (d: string) => void
  onContextText: (e: React.MouseEvent, text: string) => void
  onContextImage: (e: React.MouseEvent, dataUrl: string) => void
}): JSX.Element {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
        {msg.content && (
          <div
            onContextMenu={(e) => onContextText(e, msg.content)}
            className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap select-text cursor-text ${
              isUser ? 'bg-brand text-white' : 'bg-panel border border-edge'
            }`}
          >
            {msg.content}
          </div>
        )}
        {isUser && msg.images && msg.images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end">
            {msg.images.map((img, i) => (
              <img
                key={i}
                src={img}
                className="w-20 h-20 object-cover rounded-lg border border-edge"
                title="参考图"
              />
            ))}
          </div>
        )}
        {/* 兜底提示：所选模型繁忙、已用「极速」模型补出图时，在结果图上方用琥珀色醒目显示 */}
        {!isUser && msg.note && msg.images && msg.images.length > 0 && (
          <div className="rounded-lg bg-amber-400/10 border border-amber-400/30 px-3 py-1.5 text-xs text-amber-300">
            {msg.note}
          </div>
        )}
        {!isUser && msg.images?.map((img, i) => (
          <ImageCard key={i} dataUrl={img} onEdit={onEdit} onContextImage={onContextImage} />
        ))}
      </div>
    </div>
  )
}

function ImageCard({
  dataUrl,
  onEdit,
  onContextImage
}: {
  dataUrl: string
  onEdit: (d: string) => void
  onContextImage: (e: React.MouseEvent, dataUrl: string) => void
}): JSX.Element {
  const format = useApp((s) => s.settings.defaultFormat)
  const [saved, setSaved] = useState(false)

  async function save(): Promise<void> {
    const r = await window.api.image.save({ dataUrl, format })
    if (r.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  return (
    <button
      className="group relative rounded-xl overflow-hidden border border-edge bg-black/30 block text-left"
      onClick={() => onEdit(dataUrl)}
      onContextMenu={(e) => onContextImage(e, dataUrl)}
      title="点击查看大图（查看器内可局部重绘 / 绘制；右键可引用/保存）"
    >
      <img src={dataUrl} className="max-w-sm max-h-80 object-contain block" />
      <div className="absolute bottom-0 inset-x-0 flex gap-2 p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="btn-primary py-1.5 px-2.5 text-xs pointer-events-none">
          <Wand2 size={14} /> 查看 / 编辑
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation()
            save()
          }}
          className="btn-soft py-1.5 px-2.5 text-xs"
        >
          {saved ? '已保存 ✓' : (
            <>
              <Download size={14} /> 保存
            </>
          )}
        </span>
      </div>
    </button>
  )
}
