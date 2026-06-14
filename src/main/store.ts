import Store from 'electron-store'
import { safeStorage } from 'electron'
import type {
  AppSettings,
  Billing,
  RelayProfile,
  RelayProfileInput
} from '../shared/types'
import { normalizeBaseUrl } from '../shared/url'

interface StoredProfile {
  id: string
  name: string
  baseUrl: string
  /** 加密后的 base64；若加密不可用则为明文（带 plain: 前缀） */
  apiKeyEnc?: string
  imageModel?: string
  chatModel?: string
  flow: RelayProfile['flow']
  defaultSize: string
  createdAt: number
}

interface Schema {
  profiles: StoredProfile[]
  activeProfileId?: string
  settings: AppSettings
  billing?: Billing
}

const DEFAULT_QUOTA = 200
function curPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const store = new Store<Schema>({
  name: 'pixrelay-config',
  defaults: {
    profiles: [],
    activeProfileId: undefined,
    settings: {
      defaultFormat: 'png',
      customFonts: []
    }
  }
})

function encrypt(plain: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(plain).toString('base64')
    }
  } catch {
    // 落到明文兜底
  }
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
}

function decrypt(stored?: string): string {
  if (!stored) return ''
  try {
    if (stored.startsWith('enc:')) {
      const buf = Buffer.from(stored.slice(4), 'base64')
      return safeStorage.decryptString(buf)
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
  } catch {
    return ''
  }
  return ''
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return key[0] + '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

function toPublic(p: StoredProfile): RelayProfile {
  const key = decrypt(p.apiKeyEnc)
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKeyMasked: maskKey(key),
    hasKey: !!key,
    imageModel: p.imageModel,
    chatModel: p.chatModel,
    flow: p.flow,
    defaultSize: p.defaultSize,
    createdAt: p.createdAt
  }
}

let idCounter = 0
function genId(): string {
  // 不能用 Math.random/Date.now（环境限制），用计数器 + 进程信息
  idCounter += 1
  return `relay_${process.pid}_${idCounter}`
}

export const configStore = {
  getProfiles(): RelayProfile[] {
    return store.get('profiles').map(toPublic)
  },

  getActiveProfileId(): string | undefined {
    const id = store.get('activeProfileId')
    const profiles = store.get('profiles')
    if (id && profiles.some((p) => p.id === id)) return id
    return profiles[0]?.id
  },

  setActiveProfileId(id: string): void {
    store.set('activeProfileId', id)
  },

  /** 主进程内部使用：取出原始（解密后）的 key 与模型设置 */
  getRawProfile(id: string): (StoredProfile & { apiKey: string }) | undefined {
    const p = store.get('profiles').find((x) => x.id === id)
    if (!p) return undefined
    return { ...p, apiKey: decrypt(p.apiKeyEnc) }
  },

  saveProfile(input: RelayProfileInput): RelayProfile {
    const profiles = store.get('profiles')
    const existing = input.id ? profiles.find((p) => p.id === input.id) : undefined

    const next: StoredProfile = {
      id: existing?.id ?? genId(),
      name: input.name.trim() || '未命名中转站',
      baseUrl: normalizeBaseUrl(input.baseUrl),
      apiKeyEnc:
        input.apiKey && input.apiKey.length > 0
          ? encrypt(input.apiKey)
          : existing?.apiKeyEnc,
      imageModel: input.imageModel,
      chatModel: input.chatModel,
      flow: input.flow,
      defaultSize: input.defaultSize,
      createdAt: existing?.createdAt ?? Date.now()
    }

    const updated = existing
      ? profiles.map((p) => (p.id === next.id ? next : p))
      : [...profiles, next]
    store.set('profiles', updated)
    if (!store.get('activeProfileId')) store.set('activeProfileId', next.id)
    return toPublic(next)
  },

  deleteProfile(id: string): void {
    const profiles = store.get('profiles').filter((p) => p.id !== id)
    store.set('profiles', profiles)
    if (store.get('activeProfileId') === id) {
      store.set('activeProfileId', profiles[0]?.id)
    }
  },

  getSettings(): AppSettings {
    return store.get('settings')
  },

  setSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...store.get('settings'), ...patch }
    store.set('settings', next)
    return next
  },

  encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },

  // ---- 会员 / 计费（本地实现，预留后台对接）----
  getBilling(): Billing {
    const period = curPeriod()
    let b = store.get('billing')
    if (!b) {
      b = { plan: '基础月套餐', monthlyQuota: DEFAULT_QUOTA, credits: DEFAULT_QUOTA, period }
    } else if (b.period !== period) {
      // 跨月：额度重置为套餐月额度
      b = { ...b, credits: b.monthlyQuota, period }
    }
    store.set('billing', b)
    return b
  },

  // 生图成功后扣 1 次（失败不调用，即“失败不扣次数”）
  consumeCredit(): { ok: boolean; credits: number } {
    const b = this.getBilling()
    if (b.credits <= 0) return { ok: false, credits: 0 }
    b.credits -= 1
    store.set('billing', b)
    return { ok: true, credits: b.credits }
  },

  // 充值（当前为本地演示；正式版在此对接支付/后台）
  recharge(amount: number): Billing {
    const b = this.getBilling()
    b.credits += amount
    store.set('billing', b)
    return b
  }
}
