import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { VM } from 'vm2'
import { appConfig, scriptsDir, sourcesDir } from '../config'

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

const createLxRequest = () => {
  return (url: string, options: any = {}, callback: Function) => {
    const safeOptions = decontextify(options || {})
    const method = String(safeOptions.method || 'get').toUpperCase()
    const headers = { ...(safeOptions.headers || {}) }
    const controller = new AbortController()
    const timeoutMs = typeof safeOptions.timeout === 'number' && safeOptions.timeout > 0
      ? Math.min(safeOptions.timeout, 60000)
      : 60000

    let body: any = safeOptions.body
    if (safeOptions.form) {
      body = new URLSearchParams(safeOptions.form).toString()
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
      }
    } else if (safeOptions.formData) {
      body = safeOptions.formData
    }

    const timer = setTimeout(() => { controller.abort() }, timeoutMs)

    fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal: controller.signal,
    }).then(async response => {
      clearTimeout(timer)
      const buffer = Buffer.from(await response.arrayBuffer())
      const text = buffer.toString('utf8')
      let parsedBody: any = text
      try { parsedBody = JSON.parse(text) } catch {}

      const safeResp = {
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: decontextify(parsedBody),
        raw: buffer,
      }
      callback.call(null, null, safeResp, safeResp.body)
    }).catch(error => {
      clearTimeout(timer)
      callback.call(null, decontextify(error), null, null)
    })

    return () => { controller.abort() }
  }
}

const normalizeResultUrl = (result: any): string => {
  const value = decontextify(result)
  if (typeof value === 'string') return value
  if (value?.url && typeof value.url === 'string') return value.url
  if (value?.data && typeof value.data === 'string') return value.data
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
        aesEncrypt: (buffer: any, mode: string, key: any, iv: any) => {
          const dKey = decontextify(key)
          const dIv = decontextify(iv)
          const dBuffer = decontextify(buffer)
          const algorithm = `aes-${dKey.length * 8}-${mode}`
          const cipher = crypto.createCipheriv(algorithm as any, dKey, dIv)
          return Buffer.concat([cipher.update(dBuffer), cipher.final()])
        },
        rsaEncrypt: (buffer: any, key: any) => crypto.publicEncrypt(decontextify(key) as any, decontextify(buffer) as any),
        randomBytes: (size: number) => crypto.randomBytes(size),
      },
      zlib: {
        inflate: (buffer: any) => inflate(decontextify(buffer)),
        deflate: (buffer: any) => deflate(decontextify(buffer)),
      },
    },
    request: createLxRequest(),
    send: (eventName: string, data: any) => {
      const payload = decontextify(data)
      if (eventName === 'inited') {
        if (payload?.sources) registeredSources = payload.sources
        if (initResolve) initResolve()
      } else if (eventName === 'updateAlert') {
        if (initReject) initReject(new Error(`发现新版本,需要更新: ${JSON.stringify(payload)}`))
      }
    },
    on: (eventName: string, handler: Function) => {
      if (eventName === 'request') eventHandlers.set(eventName, handler)
    },
  }

  const sandbox: any = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
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
    crypto,
  }
  sandbox.global = sandbox
  sandbox.window = sandbox
  sandbox.globalThis = sandbox

  try {
    if (apiInfo.allowUnsafeVM && appConfig.source.allowUnsafeVM) {
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
      new Promise((_, reject) => setTimeout(() => { reject(new Error('初始化超时，请确保脚本调用了 lx.send("inited", ...)')) }, 3000)),
    ])

    const apiInstance: LoadedApi = {
      info: { ...fullApiInfo, sources: registeredSources },
      handlers: eventHandlers,
      callRequest: async (action: string, source: string, info: any) => {
        const handler = eventHandlers.get('request')
        if (!handler) throw new Error(`源 ${fullApiInfo.name} 未注册 request 处理器`)
        const inputData = apiInfo.allowUnsafeVM && appConfig.source.allowUnsafeVM
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
    const requireUnsafe = !apiInfo.allowUnsafeVM && (
      message === 'REQUIRE_UNSAFE_VM' ||
      message.includes('初始化超时') ||
      message.toLowerCase().includes('timeout')
    )
    return { success: false, apiInstance: null, error: message, requireUnsafe }
  }
}

const readSourceMeta = (): any[] => {
  const metaPath = path.join(sourcesDir, 'sources.json')
  if (!fs.existsSync(metaPath)) return []
  return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
}

export const getApiStatus = (id: string) => apiStatus.get(id)

export const initUserApis = async () => {
  loadedApis.clear()
  apiStatus.clear()

  const sources = readSourceMeta()
  const orderPath = path.join(sourcesDir, 'order.json')
  let order: string[] = []
  if (fs.existsSync(orderPath)) {
    try { order = JSON.parse(fs.readFileSync(orderPath, 'utf8')) } catch {}
  }
  if (order.length) {
    const positions = new Map(order.map((id, index) => [id, index]))
    sources.sort((a, b) => (positions.get(a.id) ?? 999999) - (positions.get(b.id) ?? 999999))
  }

  for (const source of sources) {
    if (!source.enabled) continue
    const scriptPath = path.join(scriptsDir, source.id)
    if (!fs.existsSync(scriptPath)) {
      apiStatus.set(source.id, { status: 'failed', error: '脚本文件不存在' })
      continue
    }
    const script = fs.readFileSync(scriptPath, 'utf8')
    const result = await loadUserApi({
      id: source.id,
      name: source.name,
      description: source.description || '',
      version: source.version || '1.0.0',
      author: source.author || '',
      homepage: source.homepage || '',
      script,
      enabled: !!source.enabled,
      sources: {},
      allowUnsafeVM: !!source.allowUnsafeVM,
      requireUnsafe: !!source.requireUnsafe,
    })
    if (result.success) {
      apiStatus.set(source.id, { status: 'success' })
    } else {
      apiStatus.set(source.id, { status: 'failed', error: result.error })
    }
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

  if (!candidates.length) {
    const message = `未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源`
    const attempt = { name: '系统', status: 'fail', message }
    attempts.push(attempt)
    if (onProgress) await onProgress(attempt)
    const err: any = new Error(message)
    err.attempts = attempts
    throw err
  }

  const runCandidate = async (api: LoadedApi, retryLabel?: string, shouldProbe = false) => {
    try {
      const result = await api.callRequest('musicUrl', source, {
        musicInfo: normalizedSongInfo,
        quality,
        type: quality,
      })
      let url = normalizeResultUrl(result)
      let probe: QualityProbe | undefined
      let message = retryLabel || '解析成功'
      if (shouldProbe) {
        probe = await probeUrlQuality(url, normalizedSongInfo, quality)
        url = probe.finalUrl || url
        message = `解析成功，探测结果：${probe.label}`
      }
      const attempt = { name: api.info.name, status: 'success', message, probe }
      attempts.push(attempt)
      if (onProgress) await onProgress(attempt)
      return { url, type: quality, sourceName: api.info.name, attempts, probe }
    } catch (error: any) {
      lastError = error
      const attempt = { name: api.info.name, status: 'fail', message: retryLabel ? `${retryLabel}, 音源日志：${error.message}` : `音源日志：${error.message}` }
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
