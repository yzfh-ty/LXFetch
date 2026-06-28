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

export const loadConfig = (): AppConfig => {
  const configPath = path.join(process.cwd(), 'config.js')
  if (!fs.existsSync(configPath)) return defaults
  delete localRequire.cache[localRequire.resolve(configPath)]
  return mergeConfig(defaults, localRequire(configPath))
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
