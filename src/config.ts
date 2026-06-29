import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

export interface AppConfig {
  server: {
    host: string
    port: number
  }
  auth: {
    adminPassword: string
  }
  source: {
    allowUnsafeVM: boolean
  }
  netease: {
    cookie: string
    cookies?: string
    cookieFile: string
  }
  download: {
    dir: string
    maxConcurrent: number
    throttleBytesPerSecond: number
    maxRetries: number
    retryDelayMs: number
    filenamePattern: string
    embedCover: boolean
    embedLyric: boolean
    writeTags: boolean
    verifyMetadata: boolean
    cacheMetadata: boolean
    metadataCacheMaxAgeDays: number
    metadataCacheMaxBytes: number
    skipExisting: boolean
    upgradeExisting: boolean
  }
  subscription: {
    maxTasksPerRun: number
    taskCreateDelayMs: number
  }
}

const defaults: AppConfig = {
  server: {
    host: '0.0.0.0',
    port: 9528,
  },
  auth: {
    adminPassword: '',
  },
  source: {
    allowUnsafeVM: false,
  },
  netease: {
    cookie: process.env.NETEASE_COOKIE || process.env.NETEASE_COOKIES || process.env.WY_COOKIE || '',
    cookieFile: process.env.NETEASE_COOKIE_FILE || process.env.WY_COOKIE_FILE || '../Netease_url/cookie.txt',
  },
  download: {
    dir: './data/downloads',
    maxConcurrent: 1,
    throttleBytesPerSecond: 0,
    maxRetries: 2,
    retryDelayMs: 2000,
    filenamePattern: '{name} - {singer}',
    embedCover: true,
    embedLyric: true,
    writeTags: true,
    verifyMetadata: true,
    cacheMetadata: true,
    metadataCacheMaxAgeDays: 90,
    metadataCacheMaxBytes: 200 * 1024 * 1024,
    skipExisting: true,
    upgradeExisting: true,
  },
  subscription: {
    maxTasksPerRun: 0,
    taskCreateDelayMs: 1500,
  },
}

const localRequire = createRequire(__filename)

const mergeConfig = (base: AppConfig, override: any): AppConfig => ({
  server: { ...base.server, ...(override.server || {}) },
  auth: { ...base.auth, ...(override.auth || {}) },
  source: { ...base.source, ...(override.source || {}) },
  netease: { ...base.netease, ...(override.netease || {}) },
  download: { ...base.download, ...(override.download || {}) },
  subscription: { ...base.subscription, ...(override.subscription || {}) },
})

const getEnv = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name]
    if (value != null && value !== '') return value
  }
  return undefined
}

const getEnvNumber = (...names: string[]) => {
  const value = getEnv(...names)
  if (value == null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const getEnvBoolean = (...names: string[]) => {
  const value = getEnv(...names)
  if (value == null) return undefined
  if (/^(1|true|yes|on)$/i.test(value)) return true
  if (/^(0|false|no|off)$/i.test(value)) return false
  return undefined
}

const compactObject = <T extends Record<string, any>>(value: T) => {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

const getEnvConfig = () => {
  return {
    server: compactObject({
      host: getEnv('LXFETCH_HOST', 'HOST'),
      port: getEnvNumber('LXFETCH_PORT', 'PORT'),
    }),
    auth: compactObject({
      adminPassword: getEnv('LXFETCH_ADMIN_PASSWORD', 'ADMIN_PASSWORD'),
    }),
    source: compactObject({
      allowUnsafeVM: getEnvBoolean('LXFETCH_ALLOW_UNSAFE_VM'),
    }),
    netease: compactObject({
      cookie: getEnv('NETEASE_COOKIE', 'NETEASE_COOKIES', 'WY_COOKIE'),
      cookieFile: getEnv('NETEASE_COOKIE_FILE', 'WY_COOKIE_FILE'),
    }),
    download: compactObject({
      dir: getEnv('LXFETCH_DOWNLOAD_DIR', 'DOWNLOAD_DIR'),
      maxConcurrent: getEnvNumber('LXFETCH_MAX_CONCURRENT'),
      throttleBytesPerSecond: getEnvNumber('LXFETCH_THROTTLE_BYTES_PER_SECOND'),
      maxRetries: getEnvNumber('LXFETCH_MAX_RETRIES'),
      retryDelayMs: getEnvNumber('LXFETCH_RETRY_DELAY_MS'),
      filenamePattern: getEnv('LXFETCH_FILENAME_PATTERN'),
      embedCover: getEnvBoolean('LXFETCH_EMBED_COVER'),
      embedLyric: getEnvBoolean('LXFETCH_EMBED_LYRIC'),
      writeTags: getEnvBoolean('LXFETCH_WRITE_TAGS'),
      verifyMetadata: getEnvBoolean('LXFETCH_VERIFY_METADATA'),
      cacheMetadata: getEnvBoolean('LXFETCH_CACHE_METADATA'),
      metadataCacheMaxAgeDays: getEnvNumber('LXFETCH_METADATA_CACHE_MAX_AGE_DAYS'),
      metadataCacheMaxBytes: getEnvNumber('LXFETCH_METADATA_CACHE_MAX_BYTES'),
      skipExisting: getEnvBoolean('LXFETCH_SKIP_EXISTING'),
      upgradeExisting: getEnvBoolean('LXFETCH_UPGRADE_EXISTING'),
    }),
    subscription: compactObject({
      maxTasksPerRun: getEnvNumber('LXFETCH_SUBSCRIPTION_MAX_TASKS_PER_RUN'),
      taskCreateDelayMs: getEnvNumber('LXFETCH_SUBSCRIPTION_TASK_CREATE_DELAY_MS'),
    }),
  }
}

export const loadConfig = (): AppConfig => {
  const configPath = path.join(process.cwd(), 'config.js')
  const fileConfig = fs.existsSync(configPath)
    ? (() => {
        delete localRequire.cache[localRequire.resolve(configPath)]
        return localRequire(configPath)
      })()
    : {}
  return mergeConfig(mergeConfig(defaults, fileConfig), getEnvConfig())
}

export const appConfig = loadConfig()

export const dataDir = path.resolve(process.cwd(), 'data')
export const sourcesDir = path.join(dataDir, 'sources')
export const scriptsDir = path.join(sourcesDir, 'scripts')
export const tasksFile = path.join(dataDir, 'tasks.json')
export const subscriptionsFile = path.join(dataDir, 'subscriptions.json')
export const downloadsDir = path.resolve(process.cwd(), appConfig.download.dir)
export const downloadIndexFile = path.join(downloadsDir, 'downloads_index.json')
export const metadataCacheDir = path.join(dataDir, 'cache', 'metadata')

export const ensureRuntimeDirs = () => {
  for (const dir of [dataDir, sourcesDir, scriptsDir, downloadsDir, metadataCacheDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

export const installGlobalCompatibility = () => {
  global.lx = {
    config: {
      'system.allowUnsafeVM': appConfig.source.allowUnsafeVM,
    },
    dataPath: dataDir,
  }
}
