import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { VM } from 'vm2'
import needle from 'needle'
import { appConfig, scriptsDir, sourcesDir } from '../config'
import {
  getNeteaseCookieSourceName,
  isNeteaseCookieResolverEnabled,
  resolveNeteaseCookieMusicUrl,
} from './neteaseCookieResolver'

const inflate = promisify(zlib.inflate)
const deflate = promisify(zlib.deflate)

interface UserApiInfo {
  id: string
  name: string
  description: string
  version: string | number
  author: string
  homepage: string
  script: string
  enabled: boolean
  sources: Record<string, any>
  allowUnsafeVM?: boolean
  requireUnsafe?: boolean
}

interface LoadedApi {
  info: UserApiInfo
  handlers: Map<string, Function>
  callRequest: (action: string, source: string, info: any) => Promise<any>
}

const loadedApis = new Map<string, LoadedApi>()
const apiStatus = new Map<string, { status: 'success' | 'failed', error?: string }>()
let sourceUnhandledRejectionHandlerInstalled = false

const DESKTOP_SOURCE_QUALITIES: Record<string, string[]> = {
  kw: ['128k', '320k', 'flac', 'flac24bit'],
  kg: ['128k', '320k', 'flac', 'flac24bit'],
  tx: ['128k', '320k', 'flac', 'flac24bit'],
  wy: ['128k', '320k', 'flac', 'flac24bit'],
  mg: ['128k', '320k', 'flac', 'flac24bit'],
  local: [],
}

const DESKTOP_SOURCE_ACTIONS: Record<string, string[]> = {
  kw: ['musicUrl'],
  kg: ['musicUrl'],
  tx: ['musicUrl'],
  wy: ['musicUrl'],
  mg: ['musicUrl'],
  local: ['musicUrl', 'lyric', 'pic'],
}

const toRuntimeErrorMessage = (error: any) => {
  if (!error) return 'unknown'
  if (typeof error === 'string') return error
  if (error.message) return String(error.message)
  try { return JSON.stringify(decontextify(error)) } catch { return String(error) }
}

const ensureSourceUnhandledRejectionHandler = () => {
  if (sourceUnhandledRejectionHandlerInstalled) return
  sourceUnhandledRejectionHandlerInstalled = true
  process.on('unhandledRejection', reason => {
    console.warn('[UserApi] ignored unhandled source rejection:', toRuntimeErrorMessage(reason))
  })
}

const decontextify = (obj: any): any => {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj

  try {
    if (Buffer.isBuffer(obj) || obj instanceof Uint8Array || obj?.constructor?.name === 'Buffer') {
      return Buffer.from(Uint8Array.from(obj as any))
    }
  } catch {}

  if (Array.isArray(obj)) {
    try { return obj.map(item => decontextify(item)) } catch { return [] }
  }

  if (obj instanceof Error || obj?.constructor?.name === 'Error') {
    const err = new Error(obj.message)
    err.stack = obj.stack
    return err
  }

  try {
    const result: any = {}
    for (const key of Object.keys(obj)) {
      try { result[key] = decontextify(obj[key]) } catch {}
    }
    return result
  } catch {
    try {
      const text = JSON.stringify(obj)
      return text ? JSON.parse(text) : String(obj)
    } catch {
      return String(obj)
    }
  }
}

export const extractMetadata = (script: string): Partial<UserApiInfo> => {
  const meta: any = {}
  const commentMatch = script.match(/\/\*[*!]([\s\S]*?)\*\//)
  if (!commentMatch) return meta

  const comment = commentMatch[1]
  const fields: Array<[keyof UserApiInfo, RegExp]> = [
    ['name', /@name\s+(.+)/],
    ['description', /@description\s+(.+)/],
    ['version', /@version\s+(.+)/],
    ['author', /@author\s+(.+)/],
    ['homepage', /@(?:repository|homepage)\s+(.+)/],
  ]
  for (const [key, rxp] of fields) {
    const match = comment.match(rxp)
    if (match) meta[key] = match[1].trim()
  }
  return meta
}

const toBuffer = (value: any, encoding?: BufferEncoding): Buffer => {
  const data = decontextify(value)
  if (Buffer.isBuffer(data)) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(data, encoding)
}

const getAesAlgorithm = (mode: string, key: Buffer) => {
  const value = String(decontextify(mode) || '').toLowerCase()
  if (/^aes-\d+-.+/.test(value)) return value
  return `aes-${key.length * 8}-${value}`
}

const getAesIv = (algorithm: string, iv: any) => {
  if (algorithm.includes('-ecb')) return null
  if (iv == null) return null
  const data = decontextify(iv)
  if (data == null) return null
  if (Buffer.isBuffer(data)) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (data === '') return null
  return Buffer.from(data)
}

const desktopAesEncrypt = (buffer: any, mode: string, key: any, iv: any) => {
  const dKey = toBuffer(key)
  const dBuffer = toBuffer(buffer)
  const algorithm = getAesAlgorithm(mode, dKey)
  const cipher = crypto.createCipheriv(algorithm as any, dKey, getAesIv(algorithm, iv) as any)
  return Buffer.concat([cipher.update(dBuffer), cipher.final()])
}

const desktopAesDecrypt = (buffer: any, mode: string, key: any, iv: any) => {
  const dKey = toBuffer(key)
  const dBuffer = toBuffer(buffer)
  const algorithm = getAesAlgorithm(mode, dKey)
  const decipher = crypto.createDecipheriv(algorithm as any, dKey, getAesIv(algorithm, iv) as any)
  return Buffer.concat([decipher.update(dBuffer), decipher.final()])
}

const desktopRsaEncrypt = (buffer: any, key: any) => {
  let dBuffer = toBuffer(buffer)
  if (dBuffer.length < 128) dBuffer = Buffer.concat([Buffer.alloc(128 - dBuffer.length), dBuffer])
  return crypto.publicEncrypt({
    key: decontextify(key),
    padding: crypto.constants.RSA_NO_PADDING,
  }, dBuffer)
}

const normalizeStringList = (list: any) => {
  if (!Array.isArray(list)) return []
  return list.filter((item: any): item is string => typeof item === 'string')
}

const filterRegisteredSources = (sources: any): Record<string, any> => {
  const result: Record<string, any> = {}
  if (!sources || typeof sources !== 'object') return result

  for (const source of Object.keys(DESKTOP_SOURCE_QUALITIES)) {
    const sourceInfo = sources[source]
    if (!sourceInfo || sourceInfo.type !== 'music') continue
    const userActions = normalizeStringList(sourceInfo.actions)
    const userQualitys = normalizeStringList(sourceInfo.qualitys)
    const actions = (DESKTOP_SOURCE_ACTIONS[source] || []).filter(action => userActions.includes(action))
    const qualitys = DESKTOP_SOURCE_QUALITIES[source].filter(quality => userQualitys.includes(quality))
    if (!actions.length) continue
    result[source] = {
      ...decontextify(sourceInfo),
      type: 'music',
      actions,
      qualitys,
    }
  }

  return result
}

const createLxRequest = (isUnsafe = false) => {
  return (url: string, options: any = {}, callback: Function) => {
    const safeOptions = decontextify(options || {})
    const { method = 'get', timeout, headers, body, form, formData } = safeOptions
    const requestOptions: any = {
      headers,
      response_timeout: typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 60000) : 60000,
    }

    let data = body
    if (safeOptions.form) {
      data = form
      requestOptions.json = false
    } else if (formData) {
      data = formData
      requestOptions.json = false
    }

    const callSourceCallback = (...args: any[]) => {
      if (typeof callback !== 'function') return
      try {
        const result = callback.call(null, ...args)
        if (result && typeof result.catch === 'function') {
          result.catch((error: any) => {
            console.warn('[UserApi] ignored async source request callback error:', toRuntimeErrorMessage(error))
          })
        }
      } catch (error: any) {
        console.warn('[UserApi] ignored source request callback error:', toRuntimeErrorMessage(error))
      }
    }

    const request = needle.request(method, url, data, requestOptions, (err: any, resp: any, responseBody: any) => {
      try {
        if (err) {
          callSourceCallback(decontextify(err), null, null)
          return
        }

        let parsedBody: any = resp?.raw ? resp.raw.toString() : responseBody
        if (parsedBody === undefined && resp?.body !== undefined) parsedBody = resp.body
        if (typeof parsedBody === 'string') {
          try { parsedBody = JSON.parse(parsedBody) } catch {}
        }

        let safeResp: any = {
          statusCode: resp.statusCode,
          statusMessage: resp.statusMessage,
          headers: resp.headers,
          bytes: resp.bytes,
          body: decontextify(parsedBody),
          raw: resp.raw ? Buffer.from(resp.raw) : undefined,
        }

        if (isUnsafe) {
          const jsonBody = (parsedBody && typeof parsedBody === 'object' && !Buffer.isBuffer(parsedBody))
            ? JSON.parse(JSON.stringify(parsedBody))
            : parsedBody
          safeResp = JSON.parse(JSON.stringify({
            statusCode: resp.statusCode,
            statusMessage: resp.statusMessage,
            headers: resp.headers,
            bytes: resp.bytes,
          }))
          safeResp.body = jsonBody
          safeResp.raw = resp.raw ? Buffer.from(resp.raw) : undefined
        }

        callSourceCallback(null, safeResp, safeResp.body)
      } catch (error: any) {
        callSourceCallback(decontextify(error), null, null)
      }
    })

    return () => {
      const reqObj = (request as any).request || request
      if (reqObj && !reqObj.aborted) reqObj.abort?.()
    }
  }
}

const normalizeResultUrl = (result: any): string => {
  const value = decontextify(result)
  if (typeof value === 'string') return value
  if (value?.url && typeof value.url === 'string') return value.url
  if (value?.data && typeof value.data === 'string') return value.data
  if (value?.data?.url && typeof value.data.url === 'string') return value.data.url
  throw new Error('音源没有返回有效下载链接')
}

const formatBytes = (bytes: number) => {
  if (!bytes) return 'unknown size'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`
}

const parseSizeToBytes = (value: any): number => {
  if (!value) return 0
  if (typeof value === 'number') return value
  const text = String(value).trim()
  const match = text.match(/([\d.]+)\s*(B|KB|K|MB|M|GB|G|TB|T)?/i)
  if (!match) return 0
  const number = Number(match[1])
  if (!Number.isFinite(number)) return 0
  const unit = (match[2] || 'B').toUpperCase()
  const power = unit.startsWith('T') ? 4 : unit.startsWith('G') ? 3 : unit.startsWith('M') ? 2 : unit.startsWith('K') ? 1 : 0
  return Math.round(number * Math.pow(1024, power))
}

const getExpectedQualitySize = (songInfo: any, quality: string): number => {
  const direct = songInfo?._types?.[quality]?.size || songInfo?.types?.find?.((item: any) => item.type === quality)?.size
  const meta = songInfo?.meta?._qualitys?.[quality]?.size || songInfo?.meta?.qualitys?.find?.((item: any) => item.type === quality)?.size
  return parseSizeToBytes(direct || meta)
}

const extFromContentType = (contentType: string) => {
  const value = contentType.toLowerCase()
  if (value.includes('flac')) return 'flac'
  if (value.includes('wav') || value.includes('wave')) return 'wav'
  if (value.includes('ape')) return 'ape'
  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3'
  if (value.includes('mp4') || value.includes('m4a') || value.includes('aac')) return 'm4a'
  if (value.includes('ogg')) return 'ogg'
  if (value.includes('opus')) return 'opus'
  return ''
}

const extFromUrl = (url: string) => {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const match = pathname.match(/\.([a-z0-9]{2,5})$/)
    return match?.[1] || ''
  } catch {
    return ''
  }
}

const extFromDisposition = (value: string) => {
  const match = value.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)
  if (!match) return ''
  const ext = path.extname(decodeURIComponent(match[1])).replace('.', '').toLowerCase()
  return ext
}

const containerRank = (ext: string) => {
  const value = ext.toLowerCase()
  if (['flac', 'wav', 'ape', 'dsf', 'dff'].includes(value)) return 6000
  if (['m4a', 'alac'].includes(value)) return 4500
  if (['aac', 'ogg', 'opus'].includes(value)) return 3000
  if (['mp3', 'mpga'].includes(value)) return 2000
  return 1000
}

const LOSSLESS_QUALITIES = new Set(['master', 'flac24bit', 'flac', 'wav', 'ape'])
const LOSSY_EXTS = new Set(['mp3', 'mpga', 'aac', 'ogg', 'opus'])

const contentRangeTotal = (value: string | null) => {
  if (!value) return 0
  const match = value.match(/\/(\d+)$/)
  return match ? Number(match[1]) : 0
}

const fetchWithTimeout = async (url: string, options: RequestInit, timeout = 10000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeout)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

interface QualityProbe {
  finalUrl: string
  statusCode: number
  contentType: string
  contentLength: number
  ext: string
  score: number
  label: string
  ok: boolean
}

const probeUrlQuality = async (url: string, songInfo: any, quality: string): Promise<QualityProbe> => {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': (() => {
      try { return new URL(url).origin } catch { return '' }
    })(),
  }
  const result: QualityProbe = {
    finalUrl: url,
    statusCode: 0,
    contentType: '',
    contentLength: 0,
    ext: extFromUrl(url),
    score: 0,
    label: 'unknown',
    ok: false,
  }

  const applyResponse = async (response: Response) => {
    result.finalUrl = response.url || result.finalUrl
    result.statusCode = response.status
    result.contentType = response.headers.get('content-type') || result.contentType
    const contentLength = Number(response.headers.get('content-length') || 0)
    result.contentLength = contentRangeTotal(response.headers.get('content-range')) || contentLength || result.contentLength
    result.ext = extFromContentType(result.contentType) ||
      extFromDisposition(response.headers.get('content-disposition') || '') ||
      extFromUrl(result.finalUrl) ||
      result.ext
    result.ok = response.ok || response.status === 206
    try { await response.body?.cancel() } catch {}
  }

  try {
    const response = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'follow', headers }, 10000)
    await applyResponse(response)
  } catch {}

  if (!result.ok || !result.contentLength || !result.ext) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { ...headers, Range: 'bytes=0-4095' },
      }, 12000)
      await applyResponse(response)
    } catch {}
  }

  const expectedSize = getExpectedQualitySize(songInfo, quality)
  let score = containerRank(result.ext) * 1_000_000_000 + (result.contentLength || 0)
  if (expectedSize && result.contentLength) {
    if (result.contentLength >= expectedSize * 0.85) score += 500_000_000
    if (result.contentLength < expectedSize * 0.55) score -= 500_000_000
  }
  if (!result.ok) score -= 1_000_000_000
  result.score = score
  result.label = `${result.ext || 'unknown'} / ${formatBytes(result.contentLength)}`
  return result
}

const getProbeQualityMismatch = (probe: QualityProbe, songInfo: any, quality: string) => {
  const expectedSize = getExpectedQualitySize(songInfo, quality)
  const ext = (probe.ext || '').toLowerCase()

  if (LOSSLESS_QUALITIES.has(quality) && LOSSY_EXTS.has(ext)) {
    return `请求 ${quality}，但返回的是 ${ext}`
  }

  if (expectedSize && probe.contentLength) {
    const ratio = probe.contentLength / expectedSize
    if (LOSSLESS_QUALITIES.has(quality) && ratio < 0.7) {
      return `请求 ${quality} 预期约 ${formatBytes(expectedSize)}，实际链接约 ${formatBytes(probe.contentLength)}`
    }
    if (!LOSSLESS_QUALITIES.has(quality) && ratio < 0.45) {
      return `请求 ${quality} 预期约 ${formatBytes(expectedSize)}，实际链接约 ${formatBytes(probe.contentLength)}`
    }
  }

  return ''
}

const createSandboxConsole = () => ({
  log: () => {},
  info: () => {},
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: () => {},
  group: () => {},
  groupEnd: () => {},
  clear: () => {},
})

const createBrowserCompatibility = () => {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  const location = {
    href: 'https://lxmusic.toside.cn/',
    origin: 'https://lxmusic.toside.cn',
    protocol: 'https:',
    host: 'lxmusic.toside.cn',
    hostname: 'lxmusic.toside.cn',
    port: '',
    pathname: '/',
    search: '',
    hash: '',
    toString() { return this.href },
  }
  const document = {
    location,
    referrer: '',
    cookie: '',
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: (tagName: string) => ({
      tagName: String(tagName || '').toUpperCase(),
      style: {},
      children: [],
      setAttribute() {},
      getAttribute() { return null },
      appendChild() {},
      remove() {},
      click() {},
    }),
    body: {
      appendChild() {},
      removeChild() {},
    },
  }

  return {
    navigator: {
      userAgent,
      appVersion: userAgent,
      platform: 'Win32',
      language: 'zh-CN',
      languages: ['zh-CN', 'zh'],
    },
    location,
    document,
    performance: {
      now: () => Date.now(),
    },
    crypto: crypto.webcrypto || crypto,
  }
}

export const loadUserApi = async (apiInfo: UserApiInfo): Promise<any> => {
  const metadata = extractMetadata(apiInfo.script)
  const fullApiInfo: UserApiInfo = {
    ...apiInfo,
    ...metadata,
    name: String(metadata.name || apiInfo.name || apiInfo.id),
    description: String(metadata.description || apiInfo.description || ''),
    version: metadata.version || apiInfo.version || '1.0.0',
    author: String(metadata.author || apiInfo.author || ''),
    homepage: String(metadata.homepage || apiInfo.homepage || ''),
  }

  const eventHandlers = new Map<string, Function>()
  let registeredSources: Record<string, any> = {}
  let initResolve: (() => void) | null = null
  let initReject: ((err: Error) => void) | null = null
  const initPromise = new Promise<void>((resolve, reject) => {
    initResolve = resolve
    initReject = reject
  })
  let unhandledLoadError: Error | null = null

  const lxObject = {
    version: '2.0.0',
    env: 'desktop',
    platform: 'web',
    currentScriptInfo: {
      name: fullApiInfo.name,
      description: fullApiInfo.description,
      version: fullApiInfo.version,
      author: fullApiInfo.author,
      homepage: fullApiInfo.homepage,
      rawScript: fullApiInfo.script,
    },
    EVENT_NAMES: {
      request: 'request',
      inited: 'inited',
      updateAlert: 'updateAlert',
    },
    utils: {
      buffer: {
        from: (d: any, e: any) => Buffer.from(decontextify(d), decontextify(e)),
        bufToString: (b: any, f: any) => Buffer.isBuffer(b) ? b.toString(f) : Buffer.from(b, 'binary').toString(f),
      },
      crypto: {
        md5: (str: string) => crypto.createHash('md5').update((decontextify(str) || '') as any).digest('hex'),
        aesEncrypt: desktopAesEncrypt,
        aesDecrypt: desktopAesDecrypt,
        rsaEncrypt: desktopRsaEncrypt,
        randomBytes: (size: number) => crypto.randomBytes(size),
      },
      zlib: {
        inflate: (buffer: any) => inflate(decontextify(buffer)),
        deflate: (buffer: any) => deflate(decontextify(buffer)),
      },
    },
    request: createLxRequest(!!apiInfo.allowUnsafeVM && appConfig.source.allowUnsafeVM),
    send: (eventName: string, data: any) => {
      return new Promise<void>((resolve, reject) => {
        const payload = decontextify(data)
        if (eventName === 'inited') {
          registeredSources = filterRegisteredSources(payload?.sources)
          if (initResolve) initResolve()
          resolve()
        } else if (eventName === 'updateAlert') {
          resolve()
        } else {
          reject(new Error(`The event is not supported: ${eventName}`))
        }
      })
    },
    on: (eventName: string, handler: Function) => {
      if (eventName === 'request') {
        eventHandlers.set(eventName, handler)
        return Promise.resolve()
      }
      return Promise.reject(new Error(`The event is not supported: ${eventName}`))
    },
  }

  const browserCompatibility = createBrowserCompatibility()
  const sandbox: any = {
    console: createSandboxConsole(),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    ...browserCompatibility,
    process: {
      nextTick: (fn: Function, ...args: any[]) => setTimeout(() => fn(...args), 0),
      env: { NODE_ENV: process.env.NODE_ENV || 'production' },
    },
    lx: lxObject,
    global: null,
    window: null,
    globalThis: null,
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
  }
  sandbox.global = sandbox
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.globalThis = sandbox

  const toLoadError = (error: any) => {
    if (error instanceof Error) return error
    const message = typeof error === 'string'
      ? error
      : JSON.stringify(decontextify(error))
    return new Error(message || '未知脚本错误')
  }
  const unhandledRejectionHandler = (reason: any) => {
    unhandledLoadError = toLoadError(reason)
  }
  process.on('unhandledRejection', unhandledRejectionHandler)

  try {
    const unsafeEnabled = !!apiInfo.allowUnsafeVM && appConfig.source.allowUnsafeVM
    if (unsafeEnabled) {
      const context = vm.createContext(sandbox)
      vm.runInContext(apiInfo.script, context, {
        filename: `custom_source_${fullApiInfo.id}.js`,
        timeout: 10000,
      })
    } else {
      try {
        const vmInstance = new VM({
          timeout: 10000,
          sandbox,
          eval: true,
          wasm: false,
        })
        await vmInstance.run(apiInfo.script)
      } catch (error: any) {
        const message = String(error?.message || '')
        if (message.includes('contextified object') || message.includes('Operation not allowed')) {
          throw new Error('REQUIRE_UNSAFE_VM')
        }
        throw error
      }
    }

    await Promise.race([
      initPromise,
      new Promise((_, reject) => setTimeout(() => {
        reject(unhandledLoadError || new Error('初始化超时，请确保脚本调用了 lx.send("inited", ...)'))
      }, 10000)),
    ])

    const apiInstance: LoadedApi = {
      info: { ...fullApiInfo, sources: registeredSources },
      handlers: eventHandlers,
      callRequest: async (action: string, source: string, info: any) => {
        const handler = eventHandlers.get('request')
        if (!handler) throw new Error(`源 ${fullApiInfo.name} 未注册 request 处理器`)
        const inputData = unsafeEnabled
          ? JSON.parse(JSON.stringify({ action, source, info }))
          : { action, source, info }
        return decontextify(await handler(inputData))
      },
    }

    if (!String(fullApiInfo.id).startsWith('temp_')) {
      loadedApis.set(fullApiInfo.id, apiInstance)
    }
    return { success: true, apiInstance, error: null }
  } catch (error: any) {
    const message = String(error?.message || error)
    const requireUnsafe = !(apiInfo.allowUnsafeVM && appConfig.source.allowUnsafeVM) && (
      message === 'REQUIRE_UNSAFE_VM' ||
      message.includes('初始化超时') ||
      message.toLowerCase().includes('timeout')
    )
    return { success: false, apiInstance: null, error: message, requireUnsafe }
  } finally {
    process.removeListener('unhandledRejection', unhandledRejectionHandler)
  }
}

const readSourceMeta = (): any[] => {
  const metaPath = path.join(sourcesDir, 'sources.json')
  if (!fs.existsSync(metaPath)) return []
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
}

export const getApiStatus = (id: string) => apiStatus.get(id)

export const initUserApis = async () => {
  ensureSourceUnhandledRejectionHandler()
  loadedApis.clear()
  apiStatus.clear()

  const storedSources = readSourceMeta()
  const sources = [...storedSources]
  const orderPath = path.join(sourcesDir, 'order.json')
  let order: string[] = []
  if (fs.existsSync(orderPath)) {
    try { order = JSON.parse(fs.readFileSync(orderPath, 'utf8')) } catch {}
  }
  if (order.length) {
    const positions = new Map(order.map((id, index) => [id, index]))
    sources.sort((a, b) => (positions.get(a.id) ?? 999999) - (positions.get(b.id) ?? 999999))
  }

  let needsSave = false
  for (const source of sources) {
    if (!source.enabled) continue
    const scriptPath = path.join(scriptsDir, source.id)
    if (!fs.existsSync(scriptPath)) {
      apiStatus.set(source.id, { status: 'failed', error: '脚本文件不存在' })
      continue
    }
    const script = fs.readFileSync(scriptPath, 'utf8')
    const metadata = extractMetadata(script)
    const result = await loadUserApi({
      id: source.id,
      name: metadata.name || source.name,
      description: metadata.description || source.description || '',
      version: metadata.version || source.version || '1.0.0',
      author: metadata.author || source.author || '',
      homepage: metadata.homepage || source.homepage || '',
      script,
      enabled: !!source.enabled,
      sources: {},
      allowUnsafeVM: !!source.allowUnsafeVM,
      requireUnsafe: !!source.requireUnsafe,
    })
    if (result.success) {
      apiStatus.set(source.id, { status: 'success' })
      const runtimeSources = Object.keys(result.apiInstance.info.sources || {}).sort()
      const storedSupportedSources = Array.isArray(source.supportedSources)
        ? [...source.supportedSources].sort()
        : []
      if (JSON.stringify(runtimeSources) !== JSON.stringify(storedSupportedSources)) {
        source.supportedSources = runtimeSources
        needsSave = true
      }
      for (const key of ['name', 'version', 'author', 'description', 'homepage']) {
        const value = (metadata as any)[key]
        if (value && source[key] !== value) {
          source[key] = value
          needsSave = true
        }
      }
    } else {
      apiStatus.set(source.id, { status: 'failed', error: result.error })
    }
  }

  if (needsSave) {
    const updated = new Map(sources.map(source => [source.id, source]))
    const merged = storedSources.map(source => updated.get(source.id) || source)
    fs.writeFileSync(path.join(sourcesDir, 'sources.json'), JSON.stringify(merged, null, 2))
  }

  return Array.from(loadedApis.values()).length
}

export const getLoadedApis = () => {
  return Array.from(loadedApis.values()).map(api => api.info)
}

export const isSourceSupported = (source: string): boolean => {
  for (const api of loadedApis.values()) {
    if (api.info.enabled && api.info.sources?.[source]) return true
  }
  return false
}

const normalizeSongInfo = (songInfo: any) => {
  const normalized = { ...(songInfo || {}) }
  if (songInfo?.meta) {
    Object.assign(normalized, songInfo.meta)
    if (songInfo.meta.songId && !normalized.songmid) normalized.songmid = songInfo.meta.songId
    if (songInfo.meta.picUrl && !normalized.img) normalized.img = songInfo.meta.picUrl
    if (songInfo.meta.qualitys && !normalized.types) normalized.types = songInfo.meta.qualitys
    if (songInfo.meta._qualitys && !normalized._types) normalized._types = songInfo.meta._qualitys
    if (songInfo.meta.hash && !normalized.hash) normalized.hash = songInfo.meta.hash
    if (songInfo.meta.albumId && !normalized.albumId) normalized.albumId = songInfo.meta.albumId
    if (songInfo.meta.copyrightId && !normalized.copyrightId) normalized.copyrightId = songInfo.meta.copyrightId
    if (songInfo.meta.strMediaMid && !normalized.strMediaMid) normalized.strMediaMid = songInfo.meta.strMediaMid
    if (songInfo.meta.albumMid && !normalized.albumMid) normalized.albumMid = songInfo.meta.albumMid
    if (songInfo.meta.lrcUrl && !normalized.lrcUrl) normalized.lrcUrl = songInfo.meta.lrcUrl
    if (songInfo.meta.mrcUrl && !normalized.mrcUrl) normalized.mrcUrl = songInfo.meta.mrcUrl
    if (songInfo.meta.trcUrl && !normalized.trcUrl) normalized.trcUrl = songInfo.meta.trcUrl
  }
  for (const key of ['hash', 'copyrightId', 'strMediaMid', 'albumMid', 'albumId', 'lrcUrl', 'mrcUrl', 'trcUrl']) {
    if (!normalized[key] && songInfo?.[key]) normalized[key] = songInfo[key]
  }
  return normalized
}

const getOrderedCandidates = (source: string) => {
  const candidates = Array.from(loadedApis.values()).filter(api => api.info.enabled && api.info.sources?.[source])
  const orderPath = path.join(sourcesDir, 'order.json')
  if (candidates.length > 1 && fs.existsSync(orderPath)) {
    try {
      const order: string[] = JSON.parse(fs.readFileSync(orderPath, 'utf8'))
      const positions = new Map(order.map((id, index) => [id, index]))
      candidates.sort((a, b) => (positions.get(a.info.id) ?? 999999) - (positions.get(b.info.id) ?? 999999))
    } catch {}
  }
  return candidates
}

const getApiSourceQualities = (api: LoadedApi, source: string) => {
  const sourceInfo = api.info.sources?.[source]
  const values = new Set<string>()
  const add = (quality: any) => {
    if (typeof quality === 'string' && quality.trim()) values.add(quality.trim())
  }
  const addList = (list: any) => {
    if (Array.isArray(list)) {
      for (const item of list) add(item?.type || item)
    } else if (list && typeof list === 'object') {
      for (const key of Object.keys(list)) add(key)
    }
  }

  addList(sourceInfo?.qualitys)
  addList(sourceInfo?.qualities)
  addList(sourceInfo?.types)
  addList(sourceInfo?._types)
  return Array.from(values)
}

export const getSupportedQualitiesForSource = (source: string): string[] => {
  const qualities = new Set<string>()
  let hasDeclaredQualities = false
  for (const api of getOrderedCandidates(source)) {
    const apiQualities = getApiSourceQualities(api, source)
    if (!apiQualities.length) continue
    hasDeclaredQualities = true
    for (const quality of apiQualities) qualities.add(quality)
  }
  return hasDeclaredQualities ? Array.from(qualities) : []
}

const SOURCE_RESOLVE_TIMEOUT_MS = 90000

const withSourceTimeout = async <T>(promise: Promise<T>, sourceName: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${sourceName} 解析超时 (${Math.round(SOURCE_RESOLVE_TIMEOUT_MS / 1000)}s)`))
        }, SOURCE_RESOLVE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const callUserApiGetMusicUrl = async (
  source: string,
  songInfo: any,
  quality: string,
  _clientUsername?: string,
  onProgress?: (attempt: any) => Promise<void> | void,
  enableAutoSwitchApiSource = true,
): Promise<{ url: string, type: string, sourceName?: string, attempts?: any[] }> => {
  const normalizedSongInfo = normalizeSongInfo(songInfo)
  let candidates = getOrderedCandidates(source)
  if (enableAutoSwitchApiSource === false && candidates.length > 1) candidates = [candidates[0]]

  const attempts: any[] = []
  let lastError: Error | null = null

  const runNeteaseCookieResolver = async () => {
    if (source !== 'wy' || !isNeteaseCookieResolverEnabled()) return null
    const sourceName = getNeteaseCookieSourceName()
    try {
      const result = await withSourceTimeout(resolveNeteaseCookieMusicUrl(normalizedSongInfo, quality), sourceName)
      let url = normalizeResultUrl(result)
      const probe = await probeUrlQuality(url, normalizedSongInfo, quality)
      url = probe.finalUrl || url
      const mismatch = getProbeQualityMismatch(probe, normalizedSongInfo, quality)
      if (mismatch) {
        const err: any = new Error(`返回链接不符合请求音质：${mismatch}，探测结果 ${probe.label}`)
        err.qualityMismatch = true
        throw err
      }
      const attempt = {
        name: sourceName,
        status: 'success',
        message: `Cookie 解析成功，探测结果：${probe.label}`,
        probe,
      }
      attempts.push(attempt)
      if (onProgress) await onProgress(attempt)
      return { url, type: quality, sourceName, attempts, probe }
    } catch (error: any) {
      lastError = error
      const attempt = {
        name: sourceName,
        status: 'fail',
        retryable: !error.qualityMismatch,
        message: `Cookie 解析失败：${error.message || String(error)}`,
      }
      attempts.push(attempt)
      if (onProgress) await onProgress(attempt)
      return null
    }
  }

  const cookieResult = await runNeteaseCookieResolver()
  if (cookieResult) return cookieResult

  if (!candidates.length) {
    const message = `未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源`
    const attempt = { name: '系统', status: 'fail', message }
    attempts.push(attempt)
    if (onProgress) await onProgress(attempt)
    const err: any = new Error(message)
    err.attempts = attempts
    throw err
  }

  const runCandidate = async (api: LoadedApi, retryLabel?: string, _shouldProbe = false) => {
    try {
      const result = await withSourceTimeout(api.callRequest('musicUrl', source, {
        musicInfo: normalizedSongInfo,
        quality,
        type: quality,
      }), api.info.name)
      let url = normalizeResultUrl(result)
      const probe = await probeUrlQuality(url, normalizedSongInfo, quality)
      url = probe.finalUrl || url
      const mismatch = getProbeQualityMismatch(probe, normalizedSongInfo, quality)
      if (mismatch) {
        const err: any = new Error(`返回链接不符合请求音质：${mismatch}，探测结果 ${probe.label}`)
        err.qualityMismatch = true
        throw err
      }
      const message = retryLabel
        ? `${retryLabel}，探测结果：${probe.label}`
        : `解析成功，探测结果：${probe.label}`
      const attempt = { name: api.info.name, status: 'success', message, probe }
      attempts.push(attempt)
      if (onProgress) await onProgress(attempt)
      return { url, type: quality, sourceName: api.info.name, attempts, probe }
    } catch (error: any) {
      lastError = error
      const attempt = {
        name: api.info.name,
        status: 'fail',
        retryable: !error.qualityMismatch,
        message: retryLabel ? `${retryLabel}, 音源日志：${error.message}` : `音源日志：${error.message}`,
      }
      attempts.push(attempt)
      if (onProgress) await onProgress(attempt)
      return null
    }
  }

  if (candidates.length === 1) {
    const api = candidates[0]
    for (let i = 0; i < 3; i++) {
      const result = await runCandidate(api, `第 ${i + 1}/3 次尝试`)
      if (result) return result
      if ((lastError as any)?.qualityMismatch) break
      if (i < 2) await new Promise(resolve => setTimeout(resolve, 1000))
    }
  } else {
    const successResults: Array<{
      url: string
      type: string
      sourceName: string
      attempts: any[]
      probe?: QualityProbe
    }> = []

    for (const api of candidates) {
      const result = await runCandidate(api, undefined, true)
      if (result) successResults.push(result)
    }

    if (successResults.length) {
      successResults.sort((a, b) => (b.probe?.score ?? 0) - (a.probe?.score ?? 0))
      const best = successResults[0]
      const summary = successResults
        .map(item => `${item.sourceName}: ${item.probe?.label || 'unknown'}`)
        .join('；')
      const selectedAttempt = {
        name: '系统',
        status: 'success',
        message: `已对比 ${successResults.length} 个音源，选择 ${best.sourceName} (${best.probe?.label || 'unknown'})。候选：${summary}`,
        candidates: successResults.map(item => ({
          name: item.sourceName,
          url: item.url,
          probe: item.probe,
        })),
      }
      attempts.push(selectedAttempt)
      if (onProgress) await onProgress(selectedAttempt)
      return {
        url: best.url,
        type: quality,
        sourceName: best.sourceName,
        attempts,
      }
    }
  }

  const message = candidates.length === 1
    ? `自定义源 [${candidates[0].info.name}] 解析失败`
    : `已尝试了 ${candidates.length} 个支持 ${source} 平台的源，但全部解析失败`
  const err: any = new Error(`${message} (音源日志: ${lastError?.message || 'unknown'})`)
  err.attempts = attempts
  throw err
}
