import Store from 'electron-store'
import type { AppSettings } from '../shared/types'

interface Schema {
  settings: AppSettings
}

// 注意：store name 沿用 'pixrelay-config' 不可改——现有用户的 settings/customFonts 都存在该文件里，改名会丢数据。
const store = new Store<Schema>({
  name: 'pixrelay-config',
  defaults: {
    settings: {
      defaultFormat: 'png',
      customFonts: []
    }
  }
})

export const configStore = {
  getSettings(): AppSettings {
    return store.get('settings')
  },

  setSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...store.get('settings'), ...patch }
    store.set('settings', next)
    return next
  }
}
