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
  download: {
    dir: string
    maxConcurrent: number
    filenamePattern: string
    embedCover: boolean
    embedLyric: boolean
    writeTags: boolean
    verifyMetadata: boolean
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
  download: {
    dir: './data/downloads',
    maxConcurrent: 3,
    filenamePattern: '{name} - {singer}',
    embedCover: true,
    embedLyric: true,
    writeTags: true,
    verifyMetadata: true,
  },
}

const localRequire = createRequire(__filename)

const mergeConfig = (base: AppConfig, override: any): AppConfig => ({
  server: { ...base.server, ...(override.server || {}) },
  auth: { ...base.auth, ...(override.auth || {}) },
  source: { ...base.source, ...(override.source || {}) },
  download: { ...base.download, ...(override.download || {}) },
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
export const downloadsDir = path.resolve(process.cwd(), appConfig.download.dir)
export const downloadIndexFile = path.join(downloadsDir, 'downloads_index.json')

export const ensureRuntimeDirs = () => {
  for (const dir of [dataDir, sourcesDir, scriptsDir, downloadsDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

export const installGlobalCompatibility = () => {
  global.lx = {
    config: {
      'system.allowUnsafeVM': appConfig.source.allowUnsafeVM,
      'proxy.all.enabled': false,
      'proxy.all.address': '',
    },
    dataPath: dataDir,
  }
}
