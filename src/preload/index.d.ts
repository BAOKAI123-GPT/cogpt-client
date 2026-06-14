import type { PixRelayApi } from './index'

declare global {
  interface Window {
    api: PixRelayApi
  }
}

export {}
