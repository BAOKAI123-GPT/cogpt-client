import { create } from 'zustand'

function loadDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = dataUrl
  })
}

interface EditorStore {
  /** 内容基线（全分辨率）：缩放始终基于它，避免“先缩后放”变糊 */
  original?: string
  origW: number
  origH: number
  /** 当前显示图（可能是缩放后的结果） */
  base?: string
  baseW: number
  baseH: number
  busy: string | null

  /** 载入新图片（导入/从对话发来）：作为新的内容基线 */
  setBase: (dataUrl: string) => Promise<void>
  /** 内容被工具改动后（抠图/矢量化/重绘等）：成为新的内容基线 */
  setContent: (dataUrl: string) => Promise<void>
  clearBase: () => void
  setBusy: (msg: string | null) => void

  /** 缩放到指定宽（高按比例）——从 original 重采样 */
  scaleToWidth: (width: number) => Promise<void>
  /** 按当前显示尺寸的倍数缩放——目标尺寸 = 当前×factor，但从 original 重采样 */
  scaleByFactor: (factor: number) => Promise<void>
}

export const useEditor = create<EditorStore>((set, get) => ({
  original: undefined,
  origW: 0,
  origH: 0,
  base: undefined,
  baseW: 0,
  baseH: 0,
  busy: null,

  async setBase(dataUrl) {
    const { w, h } = await loadDims(dataUrl)
    set({ original: dataUrl, origW: w, origH: h, base: dataUrl, baseW: w, baseH: h })
  },

  async setContent(dataUrl) {
    const { w, h } = await loadDims(dataUrl)
    set({ original: dataUrl, origW: w, origH: h, base: dataUrl, baseW: w, baseH: h })
  },

  clearBase: () =>
    set({ original: undefined, base: undefined, origW: 0, origH: 0, baseW: 0, baseH: 0 }),

  setBusy: (busy) => set({ busy }),

  async scaleToWidth(width) {
    const { original } = get()
    if (!original || width <= 0) return
    set({ busy: '正在缩放…' })
    const res = await window.api.image.process({ dataUrl: original, width, fit: 'inside' })
    set({ busy: null })
    if (res.ok && res.dataUrl) {
      set({ base: res.dataUrl, baseW: res.width ?? width, baseH: res.height ?? 0 })
    }
  },

  async scaleByFactor(factor) {
    const { baseW } = get()
    if (!baseW) return
    await get().scaleToWidth(Math.max(1, Math.round(baseW * factor)))
  }
}))
