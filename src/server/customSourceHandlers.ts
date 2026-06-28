import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appConfig, scriptsDir, sourcesDir } from '../config'
import { readJson, sendError, sendJson } from './http'
import { extractMetadata, getApiStatus, initUserApis, loadUserApi } from './userApi'
import { ensureJsonFile, readJsonFile, writeJsonFileAtomic, writeTextFileAtomic } from './jsonStore'
// @ts-ignore copied music SDK helper is JavaScript.
import { httpFetch } from '../modules/utils/request.js'

const sourcesMetaPath = path.join(sourcesDir, 'sources.json')
const orderPath = path.join(sourcesDir, 'order.json')
const MAX_SOURCE_SCRIPT_BYTES = 12 * 1024 * 1024
const SOURCE_IMPORT_TIMEOUT_MS = 30000

const ensureFiles = () => {
  if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true })
  if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true })
  ensureJsonFile(sourcesMetaPath, [])
}

const readSources = (): any[] => {
  ensureFiles()
  const sources = readJsonFile<any[]>(sourcesMetaPath, [])
  return Array.isArray(sources) ? sources : []
}

const writeSources = (sources: any[]) => {
  ensureFiles()
  writeJsonFileAtomic(sourcesMetaPath, sources)
}

const readOrder = (): string[] => {
  ensureFiles()
  if (!fs.existsSync(orderPath)) return []
  const order = readJsonFile<string[]>(orderPath, [])
  return Array.isArray(order) ? order.filter(id => typeof id === 'string') : []
}

const writeOrder = (ids: string[]) => {
  ensureFiles()
  writeJsonFileAtomic(orderPath, ids)
}

const sortSources = (sources: any[]) => {
  const order = readOrder()
  if (!order.length) return sources
  const positions = new Map(order.map((id, index) => [id, index]))
  return [...sources].sort((a, b) => (positions.get(a.id) ?? 999999) - (positions.get(b.id) ?? 999999))
}

const generateId = (name?: string, fallbackFilename?: string): string => {
  let input = name || fallbackFilename || 'source'
  try { input = decodeURIComponent(input) } catch {}
  let base = path.basename(input)
  if (base.toLowerCase().endsWith('.js')) base = base.slice(0, -3)
  const clean = base.replace(/[\\/:*?"<>|]/g, '_').trim()
  return `${clean || 'source'}.js`
}

const enrichSources = (sources: any[]) => {
  return sortSources(sources).map(source => ({
    ...source,
    status: getApiStatus(source.id)?.status || (source.enabled ? 'unknown' : 'disabled'),
    error: getApiStatus(source.id)?.error || '',
  }))
}

const fetchScript = async (url: string): Promise<string> => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported')
  }
  const requestObj = httpFetch(url, {
    method: 'get',
    timeout: SOURCE_IMPORT_TIMEOUT_MS,
    format: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })
  const response = await requestObj.promise
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Failed to download: status code ${response.statusCode}`)
  }
  const contentLength = Number(response.headers?.['content-length'] || 0)
  if (contentLength > MAX_SOURCE_SCRIPT_BYTES) throw new Error('Source script is too large')
  const script = String(response.body || '')
  if (Buffer.byteLength(script, 'utf8') > MAX_SOURCE_SCRIPT_BYTES) throw new Error('Source script is too large')
  return script
}

const analyzeScript = async (script: string, allowUnsafeVM = false) => {
  const metadata = extractMetadata(script)
  const result = await loadUserApi({
    id: `temp_${Date.now()}.js`,
    name: metadata.name || 'temp',
    description: metadata.description || '',
    version: metadata.version || '1.0.0',
    author: metadata.author || '',
    homepage: metadata.homepage || '',
    script,
    enabled: false,
    sources: {},
    allowUnsafeVM,
  } as any)

  if (!result.success) {
    return {
      metadata,
      valid: false,
      error: result.error,
      requireUnsafe: !!result.requireUnsafe,
      supportedSources: [],
    }
  }

  const supportedSources = Object.keys(result.apiInstance?.info?.sources || {})
  if (!supportedSources.length) {
    return {
      metadata,
      valid: false,
      error: '脚本没有注册任何音源，请确认 lx.send("inited", { sources }) 已执行',
      requireUnsafe: false,
      supportedSources,
    }
  }

  return {
    metadata,
    valid: true,
    error: '',
    requireUnsafe: false,
    supportedSources,
  }
}

const saveScript = async (filename: string, script: string, allowUnsafeVM = false, sourceUrl?: string) => {
  const analysis = await analyzeScript(script, allowUnsafeVM)
  if (!analysis.valid) {
    if (analysis.requireUnsafe && !appConfig.source.allowUnsafeVM) {
      return {
        success: false,
        disabledVM: true,
        error: 'VM_DISABLED',
        message: '配置已禁用 unsafe VM，无法导入需要原生 VM 的音源',
        metadata: analysis.metadata,
      }
    }
    if (analysis.requireUnsafe && !allowUnsafeVM) {
      return {
        success: false,
        requireUnsafe: true,
        disabledVM: false,
        error: analysis.error,
        metadata: analysis.metadata,
      }
    }
    throw new Error(analysis.error || 'Invalid source script')
  }

  if (allowUnsafeVM && !appConfig.source.allowUnsafeVM) {
    return {
      success: false,
      disabledVM: true,
      error: 'VM_DISABLED',
      message: '配置已禁用 unsafe VM，无法导入需要原生 VM 的音源',
    }
  }

  const sources = readSources()
  const id = generateId(analysis.metadata.name, filename)
  if (sources.some(source => source.id === id)) {
    throw new Error(`源 "${analysis.metadata.name || filename}" 已存在`)
  }

  writeTextFileAtomic(path.join(scriptsDir, id), script, { backup: false })

  const item = {
    id,
    name: analysis.metadata.name || filename,
    version: analysis.metadata.version || '1.0.0',
    author: analysis.metadata.author || 'unknown',
    description: analysis.metadata.description || '',
    homepage: analysis.metadata.homepage || '',
    size: Buffer.byteLength(script, 'utf8'),
    supportedSources: analysis.supportedSources,
    enabled: false,
    uploadTime: new Date().toISOString(),
    sourceUrl: sourceUrl || '',
    allowUnsafeVM: !!allowUnsafeVM,
    requireUnsafe: !!analysis.requireUnsafe,
  }

  sources.push(item)
  writeSources(sources)
  await initUserApis()
  return { success: true, source: item }
}

export const handleValidate = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const { script, allowUnsafeVM } = await readJson(req)
    if (!script || typeof script !== 'string') throw new Error('Invalid script content')
    const result = await analyzeScript(script, !!allowUnsafeVM)
    sendJson(res, 200, {
      valid: result.valid,
      metadata: result.metadata,
      sources: result.supportedSources,
      sourcesCount: result.supportedSources.length,
      requireUnsafe: result.requireUnsafe,
      disabledVM: result.requireUnsafe && !appConfig.source.allowUnsafeVM,
      error: result.error,
    })
  } catch (error: any) {
    sendError(res, 400, error.message)
  }
}

export const handleImport = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const { url, filename, allowUnsafeVM } = await readJson(req)
    if (!url) throw new Error('Missing URL')
    const content = await fetchScript(url)
    const result = await saveScript(filename || path.basename(new URL(url).pathname) || 'source.js', content, !!allowUnsafeVM, url)
    sendJson(res, result.success ? 200 : 400, result)
  } catch (error: any) {
    sendError(res, 500, error.message)
  }
}

export const handleUpload = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const { filename, content, allowUnsafeVM } = await readJson(req)
    if (!content || typeof content !== 'string') throw new Error('Missing content')
    const result = await saveScript(filename || 'source.js', content, !!allowUnsafeVM)
    sendJson(res, result.success ? 200 : 400, result)
  } catch (error: any) {
    sendError(res, 500, error.message)
  }
}

export const handleList = async (_req: IncomingMessage, res: ServerResponse) => {
  sendJson(res, 200, enrichSources(readSources()))
}

export const handleToggle = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const { id, enabled, allowUnsafeVM } = await readJson(req)
    if (!id) throw new Error('Missing id')
    const sources = readSources()
    const source = sources.find(item => item.id === id)
    if (!source) throw new Error('源不存在')
    if ((source.requireUnsafe || allowUnsafeVM) && !appConfig.source.allowUnsafeVM) {
      sendJson(res, 400, { success: false, disabledVM: true, error: 'VM_DISABLED' })
      return
    }
    if (allowUnsafeVM === true) source.allowUnsafeVM = true
    source.enabled = enabled !== undefined ? !!enabled : !source.enabled
    writeSources(sources)
    await initUserApis()
    sendJson(res, 200, { success: true, enabled: source.enabled })
  } catch (error: any) {
    sendError(res, 500, error.message)
  }
}

export const handleDelete = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const { id } = await readJson(req)
    if (!id) throw new Error('Missing id')
    const sources = readSources()
    const nextSources = sources.filter(source => source.id !== id)
    if (nextSources.length === sources.length) throw new Error('源不存在')
    const scriptPath = path.join(scriptsDir, id)
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath)
    writeSources(nextSources)
    writeOrder(readOrder().filter(sourceId => sourceId !== id))
    await initUserApis()
    sendJson(res, 200, { success: true })
  } catch (error: any) {
    sendError(res, 500, error.message)
  }
}

export const handleReorder = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const { ids } = await readJson(req)
    if (!Array.isArray(ids)) throw new Error('ids must be an array')
    const sources = readSources()
    const knownIds = new Set(sources.map(source => source.id))
    const seen = new Set<string>()
    const orderedIds: string[] = []
    for (const id of ids) {
      if (typeof id !== 'string' || !knownIds.has(id) || seen.has(id)) continue
      seen.add(id)
      orderedIds.push(id)
    }
    for (const source of sources) {
      if (!seen.has(source.id)) orderedIds.push(source.id)
    }
    writeOrder(orderedIds)
    await initUserApis()
    sendJson(res, 200, { success: true, order: orderedIds })
  } catch (error: any) {
    sendError(res, 500, error.message)
  }
}
