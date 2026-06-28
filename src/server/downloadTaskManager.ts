import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { appConfig, downloadsDir, tasksFile } from '../config'
import { isHigherQuality } from '../common/constants'
import { collectMetadata, extractSongMetadata, verifyFileMetadata, writeTags } from './metadataResolver'
import { getBestReportedQuality, resolveMusicUrl } from './musicResolver'
import { getDownloadedItemBySongInfo, upsertDownloadIndex, type DownloadIndexItem } from './downloadIndex'
import { limitFilename, sanitizeFilenamePart } from './pathSafety'
import { ensureJsonFile, readJsonFile, writeJsonFileAtomic } from './jsonStore'
import { getSongKey } from './songIdentity'

type DownloadErrorCategory = '' | 'resolve' | 'quality' | 'network' | 'remote' | 'filesystem' | 'metadata' | 'tagging' | 'verification' | 'duplicate' | 'unknown'

export interface DownloadTask {
  id: string
  status: 'waiting' | 'resolving' | 'downloading' | 'metadata_fetching' | 'tagging' | 'verifying' | 'finished' | 'failed' | 'stopped'
  songInfo: any
  source: string
  quality: string
  requestedQuality?: string
  allowQualityFallback: boolean
  url: string
  sourceName: string
  attempts: any[]
  progress: number
  received: number
  total: number
  speed: number
  filename: string
  tempFilename: string
  error: string
  errorCategory: DownloadErrorCategory
  retryCount: number
  maxRetries: number
  existingFilename?: string
  existingQuality?: string
  upgradeTargetQuality?: string
  metadata: {
    lyricFetched: boolean
    coverFetched: boolean
    tagsWritten: boolean
    verified: boolean
    verifyErrors: string[]
    verifyWarnings: string[]
    metadataErrors: string[]
  }
  options: {
    embedCover: boolean
    embedLyric: boolean
    writeTags: boolean
    verifyMetadata: boolean
  }
  createdAt: number
  updatedAt: number
}

interface CreateTaskInput {
  songInfo: any
  source?: string
  url?: string
  options?: Partial<DownloadTask['options']>
}

const DEFAULT_DOWNLOAD_QUALITY = 'best'
const MAX_TERMINAL_TASK_HISTORY = 200
const DOWNLOAD_IDLE_TIMEOUT_MS = 30000
const PROGRESS_SAVE_INTERVAL_MS = 5000
const activeControllers = new Map<string, AbortController>()
const TERMINAL_STATUSES = new Set(['finished', 'failed', 'stopped'])
const ABORTABLE_STATUSES = new Set(['waiting', 'resolving', 'downloading'])

const ensureTasksFile = () => {
  ensureJsonFile(tasksFile, [])
}

const createId = () => `task_${Date.now()}_${Math.random().toString(16).slice(2)}`

const extFromContentType = (contentType: string) => {
  const value = contentType.toLowerCase()
  if (value.includes('flac')) return '.flac'
  if (value.includes('ogg')) return '.ogg'
  if (value.includes('wav')) return '.wav'
  if (value.includes('mp4') || value.includes('m4a')) return '.m4a'
  if (value.includes('aac')) return '.aac'
  if (value.includes('mpeg') || value.includes('mp3')) return '.mp3'
  return '.mp3'
}

const formatFilename = (task: DownloadTask) => {
  const metadata = extractSongMetadata(task.songInfo, task.quality)
  const pattern = appConfig.download.filenamePattern || '{singer} - {name} - {quality}'
  const filename = pattern
    .replace(/\{name\}/g, sanitizeFilenamePart(metadata.name))
    .replace(/\{singer\}/g, sanitizeFilenamePart(metadata.singer))
    .replace(/\{album\}/g, sanitizeFilenamePart(metadata.album))
    .replace(/\{source\}/g, sanitizeFilenamePart(metadata.source))
    .replace(/\{quality\}/g, sanitizeFilenamePart(metadata.quality))
    .replace(/\{id\}/g, sanitizeFilenamePart(metadata.songId))
  return limitFilename(filename)
}

const uniqueFilename = (baseName: string, ext: string) => {
  let filename = `${baseName}${ext}`
  let index = 1
  while (fs.existsSync(path.join(downloadsDir, filename))) {
    filename = `${baseName} (${index})${ext}`
    index++
  }
  return filename
}

const safeRenameSync = (src: string, dst: string) => {
  try {
    fs.renameSync(src, dst)
  } catch (error) {
    try {
      fs.copyFileSync(src, dst)
      fs.unlinkSync(src)
    } catch {
      throw error
    }
  }
}

const detectFileExt = async (filePath: string, headerExt: string) => {
  try {
    const { fileTypeFromFile } = await import('file-type')
    const type = await fileTypeFromFile(filePath)
    if (type?.ext) {
      if (type.ext === 'mpga') return '.mp3'
      return `.${type.ext}`
    }
  } catch {}
  return headerExt
}

const sleep = async (ms: number) => {
  if (ms <= 0) return
  await new Promise(resolve => setTimeout(resolve, ms))
}

const isStopRequested = (task: DownloadTask, controller: AbortController) => {
  return controller.signal.aborted || task.status === 'stopped'
}

const createDownloadError = (
  message: string,
  category: DownloadErrorCategory,
  retryable = false,
) => {
  const error: any = new Error(message)
  error.category = category
  error.retryable = retryable
  return error
}

const classifyError = (error: any, fallback: DownloadErrorCategory): DownloadErrorCategory => {
  if (error?.category) return error.category
  if (error?.qualityMismatch) return 'quality'
  const message = String(error?.message || error || '').toLowerCase()
  if (message.includes('quality') || message.includes('音质')) return 'quality'
  if (
    message.includes('timeout')
    || message.includes('aborted')
    || message.includes('socket')
    || message.includes('network')
    || message.includes('econn')
    || message.includes('enet')
    || message.includes('eai_again')
    || message.includes('fetch failed')
  ) return 'network'
  if (message.includes('status') || message.includes('redirect')) return 'remote'
  if (
    message.includes('enoent')
    || message.includes('eacces')
    || message.includes('enospc')
    || message.includes('file')
    || message.includes('rename')
  ) return 'filesystem'
  return fallback || 'unknown'
}

const isRetryableDownloadError = (error: any) => {
  if (error?.retryable === false) return false
  if (error?.retryable === true) return true
  return ['network', 'remote'].includes(classifyError(error, 'unknown'))
}

class DownloadTaskManager {
  private tasks: DownloadTask[] = []
  private running = 0
  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    this.tasks = this.loadTasks()
  }

  private loadTasks() {
    ensureTasksFile()
    const parsed = readJsonFile<DownloadTask[]>(tasksFile, [])
    if (!Array.isArray(parsed)) return []
    return parsed.map((task: DownloadTask) => {
      if (!['finished', 'failed', 'stopped'].includes(task.status)) {
        task.status = 'stopped'
        task.error = '服务已重启，任务已停止'
      }
      task.errorCategory = task.errorCategory || ''
      task.retryCount = Number(task.retryCount || 0)
      task.maxRetries = Number(task.maxRetries ?? appConfig.download.maxRetries ?? 0)
      return task
    })
  }

  private getPersistedTasks() {
    const activeTasks = this.tasks.filter(task => !TERMINAL_STATUSES.has(task.status))
    const terminalTasks = this.tasks.filter(task => TERMINAL_STATUSES.has(task.status)).slice(0, MAX_TERMINAL_TASK_HISTORY)
    const activeIds = new Set(activeTasks.map(task => task.id))
    const terminalIds = new Set(terminalTasks.map(task => task.id))
    return this.tasks.filter(task => activeIds.has(task.id) || terminalIds.has(task.id))
  }

  private saveTasksNow() {
    ensureTasksFile()
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    writeJsonFileAtomic(tasksFile, this.getPersistedTasks())
  }

  private scheduleSaveTasks() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveTasksNow()
    }, PROGRESS_SAVE_INTERVAL_MS)
    this.saveTimer.unref?.()
  }

  private saveTasks(deferred = false) {
    if (deferred) {
      this.scheduleSaveTasks()
      return
    }
    this.saveTasksNow()
  }

  private touch(task: DownloadTask, deferred = false) {
    task.updatedAt = Date.now()
    this.saveTasks(deferred)
  }

  private findActiveDuplicate(songInfo: any) {
    const key = getSongKey(songInfo)
    if (!key) return undefined
    return this.tasks.find(task => !TERMINAL_STATUSES.has(task.status) && getSongKey(task.songInfo) === key)
  }

  private createExistingDownloadTask(
    songInfo: any,
    existing: DownloadIndexItem,
    input: CreateTaskInput,
  ) {
    const now = Date.now()
    const task: DownloadTask = {
      id: createId(),
      status: 'finished',
      songInfo,
      source: songInfo.source,
      quality: existing.quality || DEFAULT_DOWNLOAD_QUALITY,
      requestedQuality: DEFAULT_DOWNLOAD_QUALITY,
      allowQualityFallback: true,
      url: input.url || '',
      sourceName: '本地文件',
      attempts: [{
        name: '系统',
        status: 'success',
        message: `已存在 ${existing.filename}，跳过重复下载`,
      }],
      progress: 100,
      received: existing.size || 0,
      total: existing.size || 0,
      speed: 0,
      filename: existing.filename,
      tempFilename: '',
      error: `已存在 ${existing.filename}，跳过重复下载`,
      errorCategory: 'duplicate',
      retryCount: 0,
      maxRetries: Math.max(0, Number(appConfig.download.maxRetries || 0)),
      existingFilename: existing.filename,
      existingQuality: existing.actualQuality || existing.quality,
      upgradeTargetQuality: '',
      metadata: {
        lyricFetched: !!existing.hasLyric,
        coverFetched: !!existing.hasCover,
        tagsWritten: existing.tagStatus !== 'error',
        verified: existing.tagStatus !== 'error',
        verifyErrors: existing.verifyErrors || [],
        verifyWarnings: existing.verifyWarnings || [],
        metadataErrors: [],
      },
      options: {
        embedCover: input.options?.embedCover ?? appConfig.download.embedCover,
        embedLyric: input.options?.embedLyric ?? appConfig.download.embedLyric,
        writeTags: input.options?.writeTags ?? appConfig.download.writeTags,
        verifyMetadata: input.options?.verifyMetadata ?? appConfig.download.verifyMetadata,
      },
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.unshift(task)
    this.saveTasks()
    return task
  }

  private finishWithExistingDownload(
    task: DownloadTask,
    existing: DownloadIndexItem,
    message: string,
  ) {
    task.status = 'finished'
    task.quality = existing.quality || task.quality
    task.sourceName = '本地文件'
    task.progress = 100
    task.received = existing.size || 0
    task.total = existing.size || 0
    task.speed = 0
    task.filename = existing.filename
    task.tempFilename = ''
    task.error = message
    task.errorCategory = 'duplicate'
    task.metadata.lyricFetched = !!existing.hasLyric
    task.metadata.coverFetched = !!existing.hasCover
    task.metadata.tagsWritten = existing.tagStatus !== 'error'
    task.metadata.verified = existing.tagStatus !== 'error'
    task.metadata.verifyErrors = existing.verifyErrors || []
    task.metadata.verifyWarnings = existing.verifyWarnings || []
    task.metadata.metadataErrors = []
    task.attempts.push({
      name: '系统',
      status: 'success',
      message,
    })
    this.touch(task)
  }

  private getUpgradeTargetQuality(songInfo: any) {
    return getBestReportedQuality(songInfo)
  }

  private shouldSkipExisting(songInfo: any, existing: DownloadIndexItem) {
    const existingQuality = existing.actualQuality || existing.quality
    if (!appConfig.download.upgradeExisting) {
      return { skip: true, targetQuality: '', existingQuality }
    }
    const targetQuality = this.getUpgradeTargetQuality(songInfo)
    return {
      skip: !targetQuality || !isHigherQuality(targetQuality, existingQuality),
      targetQuality,
      existingQuality,
    }
  }

  getActiveSongKeys() {
    const keys = new Set<string>()
    for (const task of this.tasks) {
      if (TERMINAL_STATUSES.has(task.status)) continue
      const key = getSongKey(task.songInfo)
      if (key) keys.add(key)
    }
    return keys
  }

  listTasks() {
    return this.tasks
  }

  getStats() {
    const byStatus: Record<string, number> = {}
    let active = 0
    let speed = 0
    for (const task of this.tasks) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1
      if (!TERMINAL_STATUSES.has(task.status)) {
        active += 1
        speed += Number(task.speed || 0)
      }
    }
    return {
      total: this.tasks.length,
      active,
      speed,
      byStatus,
    }
  }

  getTask(id: string) {
    return this.tasks.find(task => task.id === id)
  }

  private normalizeTaskSongInfo(songInfo: any, source?: string) {
    const taskSource = String(source || songInfo?.source || songInfo?.meta?.source || '').trim()
    if (!taskSource) throw new Error('Invalid songInfo')
    const normalized = {
      ...(songInfo || {}),
      source: taskSource,
    }
    if (songInfo?.meta && typeof songInfo.meta === 'object') {
      normalized.meta = {
        ...songInfo.meta,
        source: taskSource,
      }
    }
    return normalized
  }

  createTask(input: CreateTaskInput) {
    const songInfo = this.normalizeTaskSongInfo(input.songInfo, input.source)
    const duplicate = this.findActiveDuplicate(songInfo)
    if (duplicate) return duplicate
    const existing = appConfig.download.skipExisting ? getDownloadedItemBySongInfo(songInfo) : undefined
    const existingDecision = existing ? this.shouldSkipExisting(songInfo, existing) : undefined
    if (existing && existingDecision?.skip) return this.createExistingDownloadTask(songInfo, existing, input)
    const now = Date.now()
    const task: DownloadTask = {
      id: createId(),
      status: 'waiting',
      songInfo,
      source: songInfo.source,
      quality: DEFAULT_DOWNLOAD_QUALITY,
      allowQualityFallback: true,
      url: input.url || '',
      sourceName: '',
      attempts: [],
      progress: 0,
      received: 0,
      total: 0,
      speed: 0,
      filename: '',
      tempFilename: '',
      error: '',
      errorCategory: '',
      retryCount: 0,
      maxRetries: Math.max(0, Number(appConfig.download.maxRetries || 0)),
      existingFilename: existing?.filename || '',
      existingQuality: existingDecision?.existingQuality || '',
      upgradeTargetQuality: existingDecision?.targetQuality || '',
      metadata: {
        lyricFetched: false,
        coverFetched: false,
        tagsWritten: false,
        verified: false,
        verifyErrors: [],
        verifyWarnings: [],
        metadataErrors: [],
      },
      options: {
        embedCover: input.options?.embedCover ?? appConfig.download.embedCover,
        embedLyric: input.options?.embedLyric ?? appConfig.download.embedLyric,
        writeTags: input.options?.writeTags ?? appConfig.download.writeTags,
        verifyMetadata: input.options?.verifyMetadata ?? appConfig.download.verifyMetadata,
      },
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.unshift(task)
    this.saveTasks()
    this.processQueue()
    return task
  }

  retryTask(id: string) {
    const oldTask = this.getTask(id)
    if (!oldTask) throw new Error('Task not found')
    return this.createTask({
      songInfo: oldTask.songInfo,
      source: oldTask.source,
      options: oldTask.options,
    })
  }

  retryFailedTasks() {
    const failedTasks = this.tasks.filter(task => task.status === 'failed')
    const beforeIds = new Set(this.tasks.map(task => task.id))
    const retried = failedTasks.map(task => this.createTask({
      songInfo: task.songInfo,
      source: task.source,
      options: task.options,
    }))
    const created = retried.filter(task => !beforeIds.has(task.id)).length
    return {
      requested: failedTasks.length,
      count: created,
      created,
      reused: retried.length - created,
      tasks: retried,
    }
  }

  clearTasks(statuses: Array<DownloadTask['status']>) {
    const allowedStatuses = new Set(statuses.filter(status => TERMINAL_STATUSES.has(status)))
    if (!allowedStatuses.size) return { removed: 0, tasks: this.tasks }
    const before = this.tasks.length
    this.tasks = this.tasks.filter(task => !allowedStatuses.has(task.status))
    const removed = before - this.tasks.length
    if (removed) this.saveTasks()
    return { removed, tasks: this.tasks }
  }

  stopActiveTasks() {
    const ids = this.tasks
      .filter(task => ABORTABLE_STATUSES.has(task.status))
      .map(task => task.id)
    for (const id of ids) this.stopTask(id)
    return { count: ids.length, tasks: this.tasks }
  }

  stopTask(id: string) {
    const task = this.getTask(id)
    if (!task) throw new Error('Task not found')
    if (TERMINAL_STATUSES.has(task.status)) return task
    if (!ABORTABLE_STATUSES.has(task.status)) {
      throw new Error('任务已进入元数据处理阶段，不能安全停止')
    }
    const controller = activeControllers.get(id)
    if (controller) controller.abort()
    task.status = 'stopped'
    task.error = '任务已停止'
    task.errorCategory = ''
    task.speed = 0
    if (task.tempFilename) {
      try {
        const tempPath = path.join(downloadsDir, task.tempFilename)
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
      } catch {}
      task.tempFilename = ''
    }
    this.touch(task)
    return task
  }

  private processQueue() {
    const maxConcurrent = Math.max(1, appConfig.download.maxConcurrent || 1)
    while (this.running < maxConcurrent) {
      const task = this.tasks.find(item => item.status === 'waiting')
      if (!task) return
      this.running++
      void this.runTask(task).finally(() => {
        this.running--
        this.processQueue()
      })
    }
  }

  private async downloadWithRetries(
    task: DownloadTask,
    tempPath: string,
    controller: AbortController,
  ): Promise<{ headerExt: string }> {
    const maxRetries = Math.max(0, Number(appConfig.download.maxRetries || 0))
    const retryDelayMs = Math.max(0, Number(appConfig.download.retryDelayMs || 0))
    task.maxRetries = maxRetries
    task.retryCount = 0

    let lastError: any
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (isStopRequested(task, controller)) throw createDownloadError('Aborted', 'network', false)
      if (attempt > 0) {
        task.retryCount = attempt
        task.errorCategory = classifyError(lastError, 'network')
        task.error = `下载重试 ${attempt}/${maxRetries}: ${lastError?.message || lastError}`
        this.touch(task)
        await sleep(retryDelayMs)
        if (isStopRequested(task, controller)) throw createDownloadError('Aborted', 'network', false)
      }

      try {
        return await this.downloadToTemp(task, tempPath, controller)
      } catch (error: any) {
        if (isStopRequested(task, controller)) throw error
        lastError = error
        const category = classifyError(error, 'network')
        task.errorCategory = category
        if (!isRetryableDownloadError(error) || attempt >= maxRetries) throw error

        task.attempts.push({
          name: '下载',
          status: 'fail',
          retryable: true,
          category,
          message: `第 ${attempt + 1}/${maxRetries + 1} 次下载失败，将重试：${error.message || String(error)}`,
        })
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch {}
      }
    }

    throw lastError
  }

  private async runTask(task: DownloadTask) {
    const controller = new AbortController()
    activeControllers.set(task.id, controller)
    let failureCategory: DownloadErrorCategory = 'unknown'

    try {
      if (!task.url) {
        failureCategory = 'resolve'
        task.status = 'resolving'
        task.error = ''
        task.errorCategory = ''
        task.retryCount = 0
        task.maxRetries = Math.max(0, Number(appConfig.download.maxRetries || 0))
        this.touch(task)
        const resolved = await resolveMusicUrl({
          songInfo: task.songInfo,
          quality: DEFAULT_DOWNLOAD_QUALITY,
          allowQualityFallback: true,
        })
        if (isStopRequested(task, controller)) return
        task.url = resolved.url
        if (resolved.type && resolved.type !== task.quality) {
          task.requestedQuality = task.quality
          task.quality = resolved.type
        }
        task.sourceName = resolved.sourceName || ''
        task.attempts = resolved.attempts || []

        if (task.existingFilename && task.existingQuality) {
          const existing = getDownloadedItemBySongInfo(task.songInfo)
          if (existing && !isHigherQuality(task.quality, task.existingQuality)) {
            this.finishWithExistingDownload(
              task,
              existing,
              `已存在 ${existing.filename}，解析到的 ${task.quality} 不高于本地 ${task.existingQuality}，跳过重复下载`,
            )
            return
          }
          task.attempts.push({
            name: '系统',
            status: 'success',
            message: `发现本地 ${task.existingQuality}，本次解析到 ${task.quality}，继续下载升级版本`,
          })
        }
      }

      failureCategory = 'network'
      task.status = 'downloading'
      task.progress = 0
      task.received = 0
      task.total = 0
      task.speed = 0
      task.error = ''
      task.errorCategory = ''
      this.touch(task)

      const baseName = formatFilename(task)
      const tempFilename = `${baseName}.${task.id}.tmp`
      task.tempFilename = tempFilename
      this.touch(task)

      const tempPath = path.join(downloadsDir, tempFilename)
      const downloadResult = await this.downloadWithRetries(task, tempPath, controller)
      if (isStopRequested(task, controller)) return

      failureCategory = 'filesystem'
      const ext = await detectFileExt(tempPath, downloadResult.headerExt)
      const finalFilename = uniqueFilename(baseName, ext)
      const finalPath = path.join(downloadsDir, finalFilename)
      safeRenameSync(tempPath, finalPath)
      task.filename = finalFilename
      task.tempFilename = ''

      failureCategory = 'metadata'
      task.status = 'metadata_fetching'
      this.touch(task)
      const collected = await collectMetadata(task.songInfo, task.quality, task.options)
      task.metadata.lyricFetched = collected.lyricFetched
      task.metadata.coverFetched = collected.coverFetched
      task.metadata.metadataErrors = collected.errors

      failureCategory = 'tagging'
      task.status = 'tagging'
      this.touch(task)
      const tagResult = await writeTags(finalPath, collected, task.options)
      task.metadata.tagsWritten = tagResult.tagsWritten
      if (tagResult.errors.length) task.metadata.metadataErrors.push(...tagResult.errors)

      failureCategory = 'verification'
      task.status = 'verifying'
      this.touch(task)
      const verify = await verifyFileMetadata(finalPath, collected, task.options)
      task.metadata.verified = verify.verified
      task.metadata.verifyErrors = verify.errors
      task.metadata.verifyWarnings = verify.warnings

      upsertDownloadIndex(collected, finalFilename, verify, task.songInfo)

      task.status = 'finished'
      task.progress = 100
      task.speed = 0
      task.error = ''
      task.errorCategory = ''
      this.touch(task)
    } catch (error: any) {
      if (isStopRequested(task, controller)) return
      task.status = 'failed'
      task.speed = 0
      task.error = error.message || String(error)
      task.errorCategory = classifyError(error, failureCategory)
      if (error.attempts) task.attempts = error.attempts
      if (task.tempFilename) {
        try {
          const tempPath = path.join(downloadsDir, task.tempFilename)
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
        } catch {}
        task.tempFilename = ''
      }
      this.touch(task)
    } finally {
      activeControllers.delete(task.id)
    }
  }

  private async downloadToTemp(task: DownloadTask, tempPath: string, controller: AbortController): Promise<{ headerExt: string }> {
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true })
    return await new Promise((resolve, reject) => {
      if (isStopRequested(task, controller)) {
        reject(createDownloadError('Aborted', 'network', false))
        return
      }
      let settled = false
      let request: http.ClientRequest | null = null
      let fileStream: fs.WriteStream | null = null
      let lastTime = Date.now()
      let lastBytes = 0
      const speedLimit = Math.max(0, Number(appConfig.download.throttleBytesPerSecond || 0))
      const startTime = Date.now()
      let throttleTimer: NodeJS.Timeout | null = null

      const cleanup = () => {
        controller.signal.removeEventListener('abort', abort)
        if (throttleTimer) clearTimeout(throttleTimer)
      }

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }

      const abort = () => {
        request?.destroy()
        fileStream?.destroy()
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath) } catch {}
        settle(() => reject(createDownloadError('Aborted', 'network', false)))
      }

      const requestUrl = (targetUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          settle(() => reject(createDownloadError('Too many redirects', 'remote', false)))
          return
        }

        let parsed: URL
        try {
          parsed = new URL(targetUrl)
        } catch {
          settle(() => reject(createDownloadError('Invalid download URL', 'remote', false)))
          return
        }

        const lib = parsed.protocol === 'https:' ? https : http
        request = lib.request(targetUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': parsed.origin,
          },
        }, response => {
          if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
            const nextUrl = response.headers.location.startsWith('http')
              ? response.headers.location
              : new URL(response.headers.location, targetUrl).href
            response.resume()
            requestUrl(nextUrl, redirectCount + 1)
            return
          }

          if (response.statusCode !== 200 && response.statusCode !== 206) {
            const statusCode = response.statusCode || 0
            const retryable = statusCode === 408 || statusCode === 429 || statusCode >= 500
            settle(() => reject(createDownloadError(`Download failed: status ${statusCode}`, 'remote', retryable)))
            return
          }

          const total = parseInt(String(response.headers['content-length'] || '0'), 10)
          const headerExt = extFromContentType(String(response.headers['content-type'] || ''))
          task.total = total
          task.received = 0
          task.progress = total > 0 ? 0 : -1
          this.touch(task)

          fileStream = fs.createWriteStream(tempPath)

          response.on('data', (chunk: Buffer) => {
            task.received += chunk.length
            if (total > 0) task.progress = Math.min(99, Math.round((task.received / total) * 100))
            const now = Date.now()
            if (now - lastTime >= 1000) {
              task.speed = Math.max(0, Math.round(((task.received - lastBytes) / (now - lastTime)) * 1000))
              lastTime = now
              lastBytes = task.received
              this.touch(task, true)
            }
            if (speedLimit > 0 && !throttleTimer) {
              const expectedElapsed = (task.received / speedLimit) * 1000
              const actualElapsed = now - startTime
              const delay = Math.min(1000, Math.max(0, expectedElapsed - actualElapsed))
              if (delay > 10) {
                response.pause()
                throttleTimer = setTimeout(() => {
                  throttleTimer = null
                  response.resume()
                }, delay)
              }
            }
          })

          response.pipe(fileStream)
          response.on('aborted', () => {
            settle(() => reject(createDownloadError('Download aborted by remote server', 'network', true)))
          })
          response.on('error', error => {
            settle(() => reject(createDownloadError(error.message || String(error), 'network', true)))
          })
          fileStream.on('finish', () => {
            fileStream?.close(() => {
              const fileSize = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0
              if (total > 0 && (task.received !== total || fileSize !== total)) {
                settle(() => reject(createDownloadError(
                  `Download incomplete: expected ${total} bytes, received ${task.received}, file size ${fileSize}`,
                  'network',
                  true,
                )))
                return
              }
              if (!fileSize) {
                settle(() => reject(createDownloadError('Download produced an empty file', 'network', true)))
                return
              }
              task.progress = 100
              task.speed = 0
              task.received = task.received || total || fileSize
              this.touch(task)
              settle(() => resolve({ headerExt }))
            })
          })
          fileStream.on('error', error => {
            settle(() => reject(createDownloadError(error.message || String(error), 'filesystem', false)))
          })
        })

        request.on('error', error => {
          settle(() => reject(createDownloadError(error.message || String(error), 'network', true)))
        })
        request.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
          request?.destroy(createDownloadError(`Download timeout (${Math.round(DOWNLOAD_IDLE_TIMEOUT_MS / 1000)}s idle)`, 'network', true))
        })
        request.end()
      }

      controller.signal.addEventListener('abort', abort)
      requestUrl(task.url)
    })
  }
}

export const downloadTaskManager = new DownloadTaskManager()
