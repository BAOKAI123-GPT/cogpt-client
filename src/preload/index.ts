import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CustomFont,
  ImageInfo,
  ProcessImageRequest,
  ProcessImageResult
} from '../shared/types'

// 暴露给渲染进程的安全 API（window.api）
const api = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion')
  },
  config: {
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('config:getSettings'),
    setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('config:setSettings', patch)
  },
  logs: {
    get: (): Promise<{ t: number; level: 'info' | 'error'; msg: string }[]> =>
      ipcRenderer.invoke('log:get'),
    clear: (): Promise<void> => ipcRenderer.invoke('log:clear'),
    export: (): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('log:export')
  },
  image: {
    info: (dataUrl: string): Promise<ImageInfo> => ipcRenderer.invoke('image:info', dataUrl),
    process: (req: ProcessImageRequest): Promise<ProcessImageResult> =>
      ipcRenderer.invoke('image:process', req),
    vectorize: (dataUrl: string): Promise<{ ok: boolean; svg?: string; error?: string }> =>
      ipcRenderer.invoke('image:vectorize', dataUrl),
    rasterizeSvg: (args: {
      svg: string
      width: number
    }): Promise<{ ok: boolean; dataUrl?: string; error?: string }> =>
      ipcRenderer.invoke('image:rasterizeSvg', args),
    saveSvg: (args: {
      svg: string
      defaultName?: string
    }): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('image:saveSvg', args),
    save: (args: {
      dataUrl: string
      defaultName?: string
      format?: 'png' | 'jpeg' | 'webp'
      quality?: number
    }): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('image:save', args),
    // 云作品库：把远程 COS 图片下载到本地（主进程拉取，绕开渲染层 CORS）
    downloadUrl: (args: { url: string; defaultName?: string }): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('image:downloadUrl', args),
    openMany: (): Promise<{ ok: boolean; images: { name: string; dataUrl: string }[] }> =>
      ipcRenderer.invoke('image:openMany'),
    saveBatch: (args: {
      items: { name: string; dataUrl: string }[]
      format: 'png' | 'jpeg' | 'webp'
    }): Promise<{ ok: boolean; dir?: string; count?: number; canceled?: boolean }> =>
      ipcRenderer.invoke('image:saveBatch', args)
  },
  fonts: {
    import: (): Promise<{ ok: boolean; fonts: CustomFont[] }> =>
      ipcRenderer.invoke('fonts:import'),
    read: (path: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> =>
      ipcRenderer.invoke('fonts:read', path),
    list: (): Promise<CustomFont[]> => ipcRenderer.invoke('fonts:list')
  }
}

export type PixRelayApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore fallback
  window.api = api
}
