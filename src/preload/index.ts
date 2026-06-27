import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  Billing,
  CustomFont,
  GenerateImageRequest,
  GenerateImageResult,
  ImageInfo,
  ProcessImageRequest,
  ProcessImageResult,
  RelayProfile,
  RelayProfileInput,
  ScanModelsResult
} from '../shared/types'

// 暴露给渲染进程的安全 API（window.api）
const api = {
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion')
  },
  config: {
    getProfiles: (): Promise<RelayProfile[]> => ipcRenderer.invoke('config:getProfiles'),
    saveProfile: (input: RelayProfileInput): Promise<RelayProfile> =>
      ipcRenderer.invoke('config:saveProfile', input),
    deleteProfile: (id: string): Promise<void> =>
      ipcRenderer.invoke('config:deleteProfile', id),
    getActiveProfileId: (): Promise<string | undefined> =>
      ipcRenderer.invoke('config:getActiveProfileId'),
    setActiveProfileId: (id: string): Promise<void> =>
      ipcRenderer.invoke('config:setActiveProfileId', id),
    getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('config:getSettings'),
    setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('config:setSettings', patch),
    encryptionAvailable: (): Promise<boolean> =>
      ipcRenderer.invoke('config:encryptionAvailable')
  },
  logs: {
    get: (): Promise<{ t: number; level: 'info' | 'error'; msg: string }[]> =>
      ipcRenderer.invoke('log:get'),
    clear: (): Promise<void> => ipcRenderer.invoke('log:clear'),
    export: (): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
      ipcRenderer.invoke('log:export')
  },
  billing: {
    get: (): Promise<Billing> => ipcRenderer.invoke('billing:get'),
    consume: (): Promise<{ ok: boolean; credits: number }> =>
      ipcRenderer.invoke('billing:consume'),
    recharge: (amount: number): Promise<Billing> => ipcRenderer.invoke('billing:recharge', amount)
  },
  relay: {
    scanModels: (args: { baseUrl: string; apiKey: string }): Promise<ScanModelsResult> =>
      ipcRenderer.invoke('relay:scanModels', args),
    scanByProfile: (id: string): Promise<ScanModelsResult> =>
      ipcRenderer.invoke('relay:scanByProfile', id),
    generateImage: (req: GenerateImageRequest): Promise<GenerateImageResult> =>
      ipcRenderer.invoke('relay:generateImage', req)
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
