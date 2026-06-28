import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { configStore } from './store'
import { getImageInfo, processImage, toBuffer, vectorizeImage, rasterizeSvg } from './image'
import { getLogs, clearLogs, formatLogs } from './logger'
import type { ProcessImageRequest, AppSettings, CustomFont } from '../shared/types'

const MIME_BY_EXT: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

export function registerIpc(): void {
  // ---- 应用 ----
  ipcMain.handle('app:getVersion', () => app.getVersion())

  // ---- 配置 ----
  ipcMain.handle('config:getSettings', () => configStore.getSettings())
  ipcMain.handle('config:setSettings', (_e, patch: Partial<AppSettings>) =>
    configStore.setSettings(patch)
  )

  // ---- 系统日志 ----
  ipcMain.handle('log:get', () => getLogs())
  ipcMain.handle('log:clear', () => clearLogs())
  ipcMain.handle('log:export', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: '导出系统日志',
      defaultPath: 'huiyi-log.txt',
      filters: [{ name: '文本', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    await writeFile(filePath, formatLogs(), 'utf8')
    return { ok: true, path: filePath }
  })

  // ---- 本地图像处理 ----
  ipcMain.handle('image:info', (_e, dataUrl: string) => getImageInfo(dataUrl))
  ipcMain.handle('image:process', (_e, req: ProcessImageRequest) => processImage(req))

  // ---- 矢量化（VTracer）----
  ipcMain.handle('image:vectorize', async (_e, dataUrl: string) => {
    try {
      const svg = await vectorizeImage(dataUrl)
      return { ok: true, svg }
    } catch (e: any) {
      return { ok: false, error: `矢量化失败：${e?.message ?? e}` }
    }
  })
  ipcMain.handle('image:rasterizeSvg', async (_e, args: { svg: string; width: number }) => {
    try {
      const dataUrl = await rasterizeSvg(args.svg, args.width)
      return { ok: true, dataUrl }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })
  ipcMain.handle(
    'image:saveSvg',
    async (e, args: { svg: string; defaultName?: string }) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '导出矢量图 (SVG)',
        defaultPath: args.defaultName || 'pixrelay-vector.svg',
        filters: [{ name: 'SVG', extensions: ['svg'] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      await writeFile(filePath, args.svg, 'utf8')
      return { ok: true, path: filePath }
    }
  )

  // ---- 保存 / 打开图片 ----
  ipcMain.handle(
    'image:save',
    async (
      e,
      args: {
        dataUrl: string
        defaultName?: string
        format?: 'png' | 'jpeg' | 'webp'
        quality?: number
      }
    ) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const format = args.format ?? 'png'
      const ext = format === 'jpeg' ? 'jpg' : format
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '导出图片',
        defaultPath: args.defaultName || `pixrelay-export.${ext}`,
        filters: [{ name: format.toUpperCase(), extensions: [ext] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      const buf = await toBuffer(args.dataUrl, format, args.quality)
      await writeFile(filePath, buf)
      return { ok: true, path: filePath }
    }
  )

  // ---- 云作品库：把远程 COS 图片下载到本地（主进程拉取，绕开渲染层 CORS）----
  ipcMain.handle('image:downloadUrl', async (e, args: { url: string; defaultName?: string }) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const resp = await fetch(args.url)
      if (!resp.ok) return { ok: false, error: `下载失败：HTTP ${resp.status}` }
      const buf = Buffer.from(await resp.arrayBuffer())
      const ct = resp.headers.get('content-type') || ''
      const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: '保存图片',
        defaultPath: args.defaultName || `cogpt-${ext}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })
      if (canceled || !filePath) return { ok: false, canceled: true }
      await writeFile(filePath, buf)
      return { ok: true, path: filePath }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  })

  ipcMain.handle('image:openMany', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    })
    if (canceled) return { ok: false, images: [] }
    const images: { name: string; dataUrl: string }[] = []
    for (const p of filePaths) {
      const buf = await readFile(p)
      const ext = extname(p).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      images.push({ name: basename(p), dataUrl: `data:${mime};base64,${buf.toString('base64')}` })
    }
    return { ok: true, images }
  })

  // ---- 批量导出到文件夹 ----
  ipcMain.handle(
    'image:saveBatch',
    async (
      e,
      args: { items: { name: string; dataUrl: string }[]; format: 'png' | 'jpeg' | 'webp' }
    ) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
      const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
        title: '选择导出文件夹',
        properties: ['openDirectory', 'createDirectory']
      })
      if (canceled || !filePaths[0]) return { ok: false, canceled: true }
      const dir = filePaths[0]
      const ext = args.format === 'jpeg' ? 'jpg' : args.format
      let count = 0
      for (const it of args.items) {
        const buf = await toBuffer(it.dataUrl, args.format)
        const base = it.name.replace(/\.[^.]+$/, '') || `image-${count}`
        await writeFile(join(dir, `${base}.${ext}`), buf)
        count++
      }
      return { ok: true, dir, count }
    }
  )

  // ---- 字体 ----
  ipcMain.handle('fonts:import', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: '导入字体',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '字体', extensions: ['ttf', 'otf', 'woff', 'woff2'] }]
    })
    if (canceled) return { ok: false, fonts: [] }
    const fontsDir = join(app.getPath('userData'), 'fonts')
    await mkdir(fontsDir, { recursive: true })
    const settings = configStore.getSettings()
    const added: CustomFont[] = []
    for (const p of filePaths) {
      const dest = join(fontsDir, basename(p))
      await copyFile(p, dest)
      const family = basename(p, extname(p))
      added.push({ family, path: dest })
    }
    const merged = [...settings.customFonts]
    for (const f of added) {
      if (!merged.some((m) => m.path === f.path)) merged.push(f)
    }
    configStore.setSettings({ customFonts: merged })
    return { ok: true, fonts: added }
  })

  // 读取字体文件为 dataURL，供渲染进程用 FontFace 注册
  ipcMain.handle('fonts:read', async (_e, path: string) => {
    try {
      const buf = await readFile(path)
      const mime = MIME_BY_EXT[extname(path).toLowerCase()] ?? 'font/ttf'
      return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })

  ipcMain.handle('fonts:list', () => configStore.getSettings().customFonts)
}
