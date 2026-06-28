import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { appConfig, downloadsDir, tasksFile } from '../config'
import { collectMetadata, extractSongMetadata, verifyFileMetadata, writeTags } from './metadataResolver'
import { resolveMusicUrl } from './musicResolver'
import { upsertDownloadIndex } from './downloadIndex'
import { limitFilename, sanitizeFilenamePart } from './pathSafety'

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
  quality: string
  allowQualityFallback?: boolean
  url?: string
  options?: Partial<DownloadTask['options']>
}

const activeControllers = new Map<string, AbortController>()

const ensureTasksFile = () => {
  if (!fs.existsSync(path.dirname(tasksFile))) fs.mkdirSync(path.dirname(tasksFile), { recursive: true })
  if (!fs.existsSync(tasksFile)) fs.writeFileSync(tasksFile, '[]')
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

class DownloadTaskManager {
  private tasks: DownloadTask[] = []
  private running = 0

  constructor() {
    this.tasks = this.loadTasks()
  }

  private loadTasks() {
    ensureTasksFile()
    try {
      const parsed = JSON.parse(fs.readFileSync(tasksFile, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed.map((task: DownloadTask) => {
        if (!['finished', 'failed', 'stopped'].includes(task.status)) {
          task.status = 'stopped'
          task.error = '服务已重启，任务已停止'
        }
        return task
      })
    } catch {
      return []
    }
  }

  private saveTasks() {
    ensureTasksFile()
    fs.writeFileSync(tasksFile, JSON.stringify(this.tasks.slice(0, 200), null, 2))
  }

  private touch(task: DownloadTask) {
    task.updatedAt = Date.now()
    this.saveTasks()
  }

  listTasks() {
    return this.tasks
  }

  getTask(id: string) {
    return this.tasks.find(task => task.id === id)
  }

  createTask(input: CreateTaskInput) {
    if (!input.songInfo?.source) throw new Error('Invalid songInfo')
    const now = Date.now()
    const task: DownloadTask = {
      id: createId(),
      status: 'waiting',
      songInfo: input.songInfo,
      source: input.songInfo.source,
      quality: input.quality || '128k',
      allowQualityFallback: input.allowQualityFallback ?? true,
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
      quality: oldTask.quality,
      allowQualityFallback: oldTask.allowQualityFallback ?? true,
      options: oldTask.options,
    })
  }

  stopTask(id: string) {
    const task = this.getTask(id)
    if (!task) throw new Error('Task not found')
    const controller = activeControllers.get(id)
    if (controller) controller.abort()
    task.status = 'stopped'
    task.error = '任务已停止'
    task.speed = 0
    if (task.tempFilename) {
      try {
        const tempPath = path.join(downloadsDir, task.tempFilename)
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
      } catch {}
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

  private async runTask(task: DownloadTask) {
    const controller = new AbortController()
    activeControllers.set(task.id, controller)

    try {
      if (!task.url) {
        task.status = 'resolving'
        task.error = ''
        this.touch(task)
        const resolved = await resolveMusicUrl({
          songInfo: task.songInfo,
          quality: task.quality,
          allowQualityFallback: task.allowQualityFallback ?? true,
        })
        task.url = resolved.url
        if (resolved.type && resolved.type !== task.quality) {
          task.requestedQuality = task.quality
          task.quality = resolved.type
        }
        task.sourceName = resolved.sourceName || ''
        task.attempts = resolved.attempts || []
      }

      task.status = 'downloading'
      task.progress = 0
      task.received = 0
      task.total = 0
      task.speed = 0
      this.touch(task)

      const baseName = formatFilename(task)
      const tempFilename = `${baseName}.${task.id}.tmp`
      task.tempFilename = tempFilename
      this.touch(task)

      const tempPath = path.join(downloadsDir, tempFilename)
      const downloadResult = await this.downloadToTemp(task, tempPath, controller)
      if (controller.signal.aborted || String(task.status) === 'stopped') return

      const ext = await detectFileExt(tempPath, downloadResult.headerExt)
      const finalFilename = uniqueFilename(baseName, ext)
      const finalPath = path.join(downloadsDir, finalFilename)
      fs.renameSync(tempPath, finalPath)
      task.filename = finalFilename
      task.tempFilename = ''

      task.status = 'metadata_fetching'
      this.touch(task)
      const collected = await collectMetadata(task.songInfo, task.quality, task.options)
      task.metadata.lyricFetched = collected.lyricFetched
      task.metadata.coverFetched = collected.coverFetched
      task.metadata.metadataErrors = collected.errors

      task.status = 'tagging'
      this.touch(task)
      const tagResult = await writeTags(finalPath, collected, task.options)
      task.metadata.tagsWritten = tagResult.tagsWritten
      if (tagResult.errors.length) task.metadata.metadataErrors.push(...tagResult.errors)

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
      this.touch(task)
    } catch (error: any) {
      if (controller.signal.aborted || task.status === 'stopped') return
      task.status = 'failed'
      task.speed = 0
      task.error = error.message || String(error)
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
      let settled = false
      let request: http.ClientRequest | null = null
      let fileStream: fs.WriteStream | null = null
      let lastTime = Date.now()
      let lastBytes = 0

      const cleanup = () => {
        controller.signal.removeEventListener('abort', abort)
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
        settle(() => reject(new Error('Aborted')))
      }

      const requestUrl = (targetUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          settle(() => reject(new Error('Too many redirects')))
          return
        }

        let parsed: URL
        try {
          parsed = new URL(targetUrl)
        } catch {
          settle(() => reject(new Error('Invalid download URL')))
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
            requestUrl(nextUrl, redirectCount + 1)
            return
          }

          if (response.statusCode !== 200 && response.statusCode !== 206) {
            settle(() => reject(new Error(`Download failed: status ${response.statusCode}`)))
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
              this.touch(task)
            }
          })

          response.pipe(fileStream)
          fileStream.on('finish', () => {
            fileStream?.close(() => {
              task.progress = 100
              task.speed = 0
              task.received = task.received || total
              this.touch(task)
              settle(() => resolve({ headerExt }))
            })
          })
          fileStream.on('error', error => {
            settle(() => reject(error))
          })
        })

        request.on('error', error => {
          settle(() => reject(error))
        })
        request.end()
      }

      controller.signal.addEventListener('abort', abort)
      requestUrl(task.url)
    })
  }
}

export const downloadTaskManager = new DownloadTaskManager()
