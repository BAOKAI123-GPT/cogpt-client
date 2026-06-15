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
  Crop,
  Sparkles,
  ChevronDown
} from 'lucide-react'
import { useApp } from '../store/app'
import type { ChatMessage } from '@shared/types'
import { extractImages } from '../lib/files'
import { ImageEditModal } from '../components/ImageEditModal'
import {
  RATIOS,
  QUALITIES,
  DEFAULT_RATIO,
  DEFAULT_QUALITY,
  ratioSupported,
  modelSupportsAnyRatio
} from '../lib/genOptions'

const SUGGESTIONS = [
  '一只戴着圆框眼镜的柴犬，扁平插画风格，米色背景',
  '夏季促销海报背景，清新薄荷绿，留白给标题，电商风',
  '极简 logo：一只展翅的纸飞机，单色线条',
  '赛博朋克城市夜景，霓虹反射在湿润街道上，电影感'
]

// 模型友好名（让用户能凭直觉选「快速 / 高质量」，gpt-image 系列出图本身约 35–60 秒）
const MODEL_LABELS: Record<string, string> = {
  'gpt-image-1-mini': '快速（约 35s）',
  'gpt-image-2': '高质量（约 50–60s）',
  'gpt-image-2-all': '高质量（约 50–60s）',
  'gpt-image-1': '标准',
  'gpt-image-1.5': '高清'
}
function modelLabel(m: string): string {
  return MODEL_LABELS[m] ?? m
}

export function ChatView(): JSX.Element {
  const messages = useApp((s) => s.messages)
  const generating = useApp((s) => s.generating)
  const genStatus = useApp((s) => s.genStatus)
  const generate = useApp((s) => s.generate)
  const clearChat = useApp((s) => s.clearChat)
  const setView = useApp((s) => s.setView)
  const models = useApp((s) => s.models)
  const selectedModel = useApp((s) => s.selectedModel)
  const setSelectedModel = useApp((s) => s.setSelectedModel)

  const [text, setText] = useState('')
  const [continueEdit, setContinueEdit] = useState(false)
  const [refs, setRefs] = useState<string[]>([])
  const [ratio, setRatio] = useState(DEFAULT_RATIO)
  const [quality, setQuality] = useState(DEFAULT_QUALITY)
  const [dragOver, setDragOver] = useState(false)
  const [editImage, setEditImage] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: { label: string; fn: () => void }[] } | null>(null)
  const format = useApp((s) => s.settings.defaultFormat)
  const scrollRef = useRef<HTMLDivElement>(null)

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
        { label: '保存图片', fn: () => window.api.image.save({ dataUrl, format }) }
      ]
    })
  }

  const lastAssistantImage = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.images?.length)?.images?.[0]

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, generating])

  // 切换模型后，若当前比例该模型不支持，自动回退到方形，避免选了出不了的比例
  useEffect(() => {
    if (selectedModel && !ratioSupported(selectedModel, ratio)) setRatio(DEFAULT_RATIO)
  }, [selectedModel, ratio])

  function addRefs(urls: string[]): void {
    if (urls.length) setRefs((prev) => [...prev, ...urls].slice(0, 6))
  }

  async function pickRefs(): Promise<void> {
    const r = await window.api.image.openMany()
    if (r.ok) addRefs(r.images.map((i) => i.dataUrl))
  }

  async function send(prompt?: string): Promise<void> {
    const p = (prompt ?? text).trim()
    if ((!p && refs.length === 0) || generating) return
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
                正在使用 <span className="text-brand">Co-GPT</span> · {modelLabel(selectedModel)}
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

          {generating && <ProgressCard status={genStatus} />}
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

          {/* 工具行：参考图 / 比例 / 画质 / 继续修改 */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <button className="btn-soft py-1.5 px-2.5 text-xs" onClick={pickRefs}>
              <ImagePlus size={14} /> 参考图
            </button>
            <RatioPicker value={ratio} model={selectedModel} onChange={setRatio} />
            <QualityPicker value={quality} onChange={setQuality} />
            {models.length > 1 && (
              <select
                className="field py-1.5 px-2 text-xs w-auto"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                title="生图模型"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {modelLabel(m)}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer ml-auto">
              <input
                type="checkbox"
                checked={continueEdit}
                disabled={!lastAssistantImage}
                onChange={(e) => setContinueEdit(e.target.checked)}
              />
              <RefreshCw size={13} /> 基于上一张继续改
            </label>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
              >
                <Trash2 size={13} /> 清空
              </button>
            )}
          </div>

          <div className="flex items-end gap-2">
            <textarea
              className="field resize-none h-[52px] py-3"
              placeholder="描述你想要的图片；也可拖入/粘贴图片作为参考图…"
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
              disabled={generating}
            >
              {generating ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// 比例选择（不支持的比例按当前模型禁用）
function RatioPicker({
  value,
  model,
  onChange
}: {
  value: string
  model: string
  onChange: (v: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const cur = RATIOS.find((r) => r.key === value) ?? RATIOS[0]
  const anyRatio = modelSupportsAnyRatio(model)
  return (
    <div className="relative">
      <button
        className="btn-soft py-1.5 px-2.5 text-xs"
        onClick={() => setOpen((v) => !v)}
        title="选择出图比例"
      >
        <Crop size={14} /> 比例 {cur.key} <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-1.5 z-20 card p-2 w-56 shadow-2xl">
            {!anyRatio && (
              <div className="text-[10px] text-amber-300/80 px-1 mb-1.5 leading-snug">
                当前模型仅支持 3 种比例。需要 9:16 等更多比例，请把模型切到「高质量」。
              </div>
            )}
            {(['方形', '竖版', '横版'] as const).map((g) => (
              <div key={g} className="mb-1.5 last:mb-0">
                <div className="text-[10px] text-gray-500 px-1 mb-1">{g}</div>
                <div className="flex flex-wrap gap-1">
                  {RATIOS.filter((r) => r.group === g).map((r) => {
                    const ok = ratioSupported(model, r.key)
                    return (
                      <button
                        key={r.key}
                        disabled={!ok}
                        title={ok ? '' : '当前模型不支持该比例'}
                        onClick={() => {
                          if (!ok) return
                          onChange(r.key)
                          setOpen(false)
                        }}
                        className={`px-2 py-1 rounded text-xs ${
                          !ok
                            ? 'opacity-30 line-through cursor-not-allowed bg-white/5'
                            : r.key === value
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
        </>
      )}
    </div>
  )
}

// 画质选择
function QualityPicker({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const cur = QUALITIES.find((q) => q.key === value) ?? QUALITIES[1]
  return (
    <div className="relative">
      <button
        className="btn-soft py-1.5 px-2.5 text-xs"
        onClick={() => setOpen((v) => !v)}
        title="选择出图画质"
      >
        <Sparkles size={14} /> 画质 {cur.label} <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-1.5 z-20 card p-1 w-48 shadow-2xl">
            {QUALITIES.map((q) => (
              <button
                key={q.key}
                onClick={() => {
                  onChange(q.key)
                  setOpen(false)
                }}
                className={`w-full text-left px-2.5 py-2 rounded-md ${
                  q.key === value ? 'bg-brand/20 text-brand' : 'hover:bg-white/5'
                }`}
              >
                <div className="text-sm">{q.label}</div>
                <div className="text-[10px] text-gray-500">{q.hint}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// 生图进度
function ProgressCard({ status }: { status: string }): JSX.Element {
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
      title="点开编辑（右键可引用/保存）"
    >
      <img src={dataUrl} className="max-w-sm max-h-80 object-contain block" />
      <div className="absolute bottom-0 inset-x-0 flex gap-2 p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="btn-primary py-1.5 px-2.5 text-xs pointer-events-none">
          <Wand2 size={14} /> 点开编辑
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
