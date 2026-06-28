import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { appConfig, metadataCacheDir } from '../config'
import { readJsonFile, writeJsonFileAtomic, writeTextFileAtomic } from './jsonStore'
import { getLyricText } from './musicResolver'

const localRequire = createRequire(__filename)
const { MusicTagger, MetaPicture } = localRequire('music-tag-native')

export interface BasicMetadata {
  songId: string
  name: string
  singer: string
  album: string
  albumId: string
  img: string
  interval: string
  source: string
  quality: string
}

export interface CollectedMetadata extends BasicMetadata {
  lyric: string
  cover?: {
    data: Buffer
    mime: string
  }
  lyricFetched: boolean
  coverFetched: boolean
  errors: string[]
}

export interface VerifyResult {
  verified: boolean
  errors: string[]
  warnings: string[]
  size?: number
  ext?: string
  duration?: string
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  actualQuality?: string
  actualQualityLabel?: string
  title?: string
  artist?: string
  album?: string
  hasCover: boolean
  hasLyric: boolean
  hasEmbedLyric: boolean
}

const formatPlayTime = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

const ensureCacheDir = (type: string) => {
  const dir = path.join(metadataCacheDir, type)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

const cacheKey = (value: string) => crypto.createHash('sha1').update(value).digest('hex')

const readTextCache = (type: string, key: string) => {
  if (!appConfig.download.cacheMetadata) return undefined
  const filePath = path.join(ensureCacheDir(type), `${key}.txt`)
  if (!fs.existsSync(filePath)) return undefined
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
}

const writeTextCache = (type: string, key: string, value: string) => {
  if (!appConfig.download.cacheMetadata || !value) return
  writeTextFileAtomic(path.join(ensureCacheDir(type), `${key}.txt`), value, { backup: false })
}

const readCoverCache = (key: string): { data: Buffer, mime: string } | undefined => {
  if (!appConfig.download.cacheMetadata) return undefined
  const filePath = path.join(ensureCacheDir('covers'), `${key}.json`)
  if (!fs.existsSync(filePath)) return undefined
  const cached = readJsonFile<{ data: string, mime: string } | null>(filePath, null)
  if (!cached?.data) return undefined
  try {
    const data = Buffer.from(cached.data, 'base64')
    if (!data.length) return undefined
    return { data, mime: cached.mime || 'image/jpeg' }
  } catch {
    return undefined
  }
}

const writeCoverCache = (key: string, cover: { data: Buffer, mime: string }) => {
  if (!appConfig.download.cacheMetadata || !cover.data?.length) return
  writeJsonFileAtomic(path.join(ensureCacheDir('covers'), `${key}.json`), {
    mime: cover.mime || 'image/jpeg',
    data: cover.data.toString('base64'),
  }, { backup: false })
}

interface CacheFileInfo {
  path: string
  size: number
  mtimeMs: number
}

const listCacheFiles = () => {
  const files: CacheFileInfo[] = []
  if (!fs.existsSync(metadataCacheDir)) return files

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(filePath)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = fs.statSync(filePath)
        files.push({
          path: filePath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        })
      } catch {}
    }
  }

  walk(metadataCacheDir)
  return files
}

export const getMetadataCacheStats = () => {
  const files = listCacheFiles()
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  return {
    files: files.length,
    totalBytes,
    oldestAt: files.length ? Math.min(...files.map(file => file.mtimeMs)) : 0,
    newestAt: files.length ? Math.max(...files.map(file => file.mtimeMs)) : 0,
    maxAgeDays: appConfig.download.metadataCacheMaxAgeDays,
    maxBytes: appConfig.download.metadataCacheMaxBytes,
  }
}

export const cleanupMetadataCache = (options: {
  maxAgeDays?: number
  maxBytes?: number
  force?: boolean
} = {}) => {
  const maxAgeDays = Math.max(0, Number(options.maxAgeDays ?? appConfig.download.metadataCacheMaxAgeDays ?? 0))
  const maxBytes = Math.max(0, Number(options.maxBytes ?? appConfig.download.metadataCacheMaxBytes ?? 0))
  const force = !!options.force
  const now = Date.now()
  const maxAgeMs = maxAgeDays > 0 ? maxAgeDays * 24 * 60 * 60 * 1000 : 0
  const deleted = new Set<string>()
  let deletedBytes = 0

  const removeFile = (file: CacheFileInfo) => {
    if (deleted.has(file.path)) return
    try {
      fs.unlinkSync(file.path)
      deleted.add(file.path)
      deletedBytes += file.size
    } catch {}
  }

  let files = listCacheFiles()
  if (force) {
    for (const file of files) removeFile(file)
  } else {
    if (maxAgeMs > 0) {
      for (const file of files) {
        if (now - file.mtimeMs > maxAgeMs) removeFile(file)
      }
    }

    files = listCacheFiles().sort((a, b) => a.mtimeMs - b.mtimeMs)
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    if (maxBytes > 0 && totalBytes > maxBytes) {
      for (const file of files) {
        if (totalBytes <= maxBytes) break
        removeFile(file)
        totalBytes -= file.size
      }
    }
  }

  return {
    deletedFiles: deleted.size,
    deletedBytes,
    ...getMetadataCacheStats(),
  }
}

export const normalizeSongId = (songInfo: any): string => {
  let id = String(songInfo?.songmid || songInfo?.songId || songInfo?.id || songInfo?.meta?.songId || '')
  const source = songInfo?.source || songInfo?.meta?.source || 'unknown'
  if (id && !id.includes('_') && source !== 'unknown') id = `${source}_${id}`
  return id || `${source}_${Date.now()}`
}

export const extractSongMetadata = (songInfo: any, quality = 'unknown'): BasicMetadata => {
  const meta = songInfo?.meta || {}
  return {
    songId: normalizeSongId(songInfo),
    name: songInfo?.name || meta.songName || meta.name || 'Unknown',
    singer: songInfo?.singer || meta.singerName || meta.singer || 'Unknown',
    album: songInfo?.albumName || songInfo?.album || meta.albumName || meta.album || '',
    albumId: String(songInfo?.albumId || meta.albumId || ''),
    img: songInfo?.img || meta.picUrl || meta.img || '',
    interval: songInfo?.interval || meta.interval || '',
    source: songInfo?.source || meta.source || 'unknown',
    quality,
  }
}

const fetchWithTimeout = async (url: string, timeout = 8000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeout)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': new URL(url).origin,
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

const fetchCover = async (url: string): Promise<{ data: Buffer, mime: string } | undefined> => {
  if (!url || !url.startsWith('http')) return undefined
  const response = await fetchWithTimeout(url)
  if (!response.ok) throw new Error(`封面下载失败: ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (!data.length) throw new Error('封面为空')
  const mime = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
  return { data, mime }
}

const detectActualQuality = (input: {
  ext?: string
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
}) => {
  const ext = String(input.ext || '').toLowerCase()
  const bitrate = Number(input.bitrate || 0)
  const sampleRate = Number(input.sampleRate || 0)
  const bitDepth = Number(input.bitDepth || 0)
  const details = [
    bitDepth ? `${bitDepth}bit` : '',
    sampleRate ? `${Math.round(sampleRate / 1000)}kHz` : '',
    bitrate ? `${bitrate}kbps` : '',
  ].filter(Boolean).join(' / ')

  if (['flac', 'wav', 'ape', 'alac'].includes(ext)) {
    const actualQuality = bitDepth >= 24 || sampleRate > 48000 ? 'flac24bit' : ext
    return {
      actualQuality,
      actualQualityLabel: `${ext.toUpperCase()}${details ? ` ${details}` : ''}`,
    }
  }

  if (ext === 'mp3' || ext === 'mpga') {
    const actualQuality = bitrate >= 300 ? '320k' : bitrate >= 180 ? '192k' : '128k'
    return {
      actualQuality,
      actualQualityLabel: `MP3${details ? ` ${details}` : ''}`,
    }
  }

  if (['m4a', 'aac', 'ogg', 'opus'].includes(ext)) {
    return {
      actualQuality: ext,
      actualQualityLabel: `${ext.toUpperCase()}${details ? ` ${details}` : ''}`,
    }
  }

  return {
    actualQuality: ext || 'unknown',
    actualQualityLabel: details || ext || 'unknown',
  }
}

const isLosslessRequested = (quality: string) => {
  return ['master', 'flac24bit', 'flac', 'wav', 'ape'].includes(String(quality || '').toLowerCase())
}

const isLossyActual = (quality: string) => {
  return ['128k', '192k', '320k', 'mp3', 'm4a', 'aac', 'ogg', 'opus'].includes(String(quality || '').toLowerCase())
}

export const collectMetadata = async (
  songInfo: any,
  quality: string,
  options: { embedCover: boolean, embedLyric: boolean },
): Promise<CollectedMetadata> => {
  const base = extractSongMetadata(songInfo, quality)
  const errors: string[] = []
  let lyric = ''
  let cover: { data: Buffer, mime: string } | undefined

  if (options.embedLyric) {
    try {
      const key = cacheKey(`${base.source}:${base.songId}:lyric`)
      lyric = readTextCache('lyrics', key) || ''
      if (!lyric) {
        lyric = await getLyricText({ ...songInfo, ...base })
        writeTextCache('lyrics', key, lyric)
      }
    } catch (error: any) {
      errors.push(error.message || '歌词下载失败')
    }
  }

  if (options.embedCover && base.img) {
    try {
      const key = cacheKey(base.img)
      cover = readCoverCache(key)
      if (!cover) {
        cover = await fetchCover(base.img)
        if (cover) writeCoverCache(key, cover)
      }
    } catch (error: any) {
      errors.push(error.message || '封面下载失败')
    }
  }

  return {
    ...base,
    lyric,
    cover,
    lyricFetched: !!lyric,
    coverFetched: !!cover,
    errors,
  }
}

export const writeTags = async (
  filePath: string,
  metadata: CollectedMetadata,
  options: { writeTags: boolean, embedCover: boolean, embedLyric: boolean },
) => {
  if (!options.writeTags) return { tagsWritten: false, errors: [] as string[] }
  const errors: string[] = []
  let tagger: any

  try {
    tagger = new MusicTagger()
    tagger.loadPath(filePath)
    tagger.title = metadata.name
    tagger.artist = metadata.singer
    if (metadata.album) tagger.album = metadata.album

    if (options.embedCover && metadata.cover?.data?.length) {
      try {
        tagger.pictures = [new MetaPicture(metadata.cover.mime || 'image/jpeg', new Uint8Array(metadata.cover.data), 'Cover')]
      } catch (error: any) {
        errors.push(error.message || '封面写入失败')
      }
    }

    if (options.embedLyric && metadata.lyric) {
      try {
        tagger.lyrics = metadata.lyric
      } catch (error: any) {
        errors.push(error.message || '歌词写入失败')
      }
    }

    tagger.save()
    return { tagsWritten: errors.length === 0, errors }
  } catch (error: any) {
    return { tagsWritten: false, errors: [error.message || '标签写入失败', ...errors] }
  } finally {
    try { tagger?.dispose?.() } catch {}
  }
}

export const verifyFileMetadata = async (
  filePath: string,
  expected: BasicMetadata,
  options: { embedCover: boolean, embedLyric: boolean, verifyMetadata: boolean },
): Promise<VerifyResult> => {
  const result: VerifyResult = {
    verified: false,
    errors: [],
    warnings: [],
    ext: path.extname(filePath).replace('.', ''),
    hasCover: false,
    hasLyric: false,
    hasEmbedLyric: false,
  }

  if (!options.verifyMetadata) {
    result.verified = true
    return result
  }

  let tagger: any
  try {
    tagger = new MusicTagger()
    tagger.loadPath(filePath)
    result.size = fs.statSync(filePath).size
    result.duration = tagger.duration ? formatPlayTime(tagger.duration) : ''
    result.bitrate = tagger.bitRate
    result.sampleRate = tagger.sampleRate
    result.bitDepth = tagger.bitDepth
    const detected = detectActualQuality({
      ext: result.ext,
      bitrate: result.bitrate,
      sampleRate: result.sampleRate,
      bitDepth: result.bitDepth,
    })
    result.actualQuality = detected.actualQuality
    result.actualQualityLabel = detected.actualQualityLabel
    result.title = tagger.title || ''
    result.artist = tagger.artist || ''
    result.album = tagger.album || ''
    result.hasCover = !!(tagger.pictures && tagger.pictures.length > 0)
    result.hasLyric = !!(tagger.lyrics && String(tagger.lyrics).trim().length > 0)
    result.hasEmbedLyric = result.hasLyric

    if (!result.title) result.warnings.push('title 缺失')
    if (!result.artist) result.warnings.push('artist 缺失')
    if (expected.name && result.title && result.title !== expected.name) result.warnings.push('title 与歌曲名不一致')
    if (expected.singer && result.artist && result.artist !== expected.singer) result.warnings.push('artist 与歌手不一致')
    if (options.embedCover && !result.hasCover) result.warnings.push('封面未写入')
    if (options.embedLyric && !result.hasLyric) result.warnings.push('歌词未写入')
    if (!result.duration) result.warnings.push('duration 缺失')
    if (isLosslessRequested(expected.quality) && isLossyActual(result.actualQuality || '')) {
      result.warnings.push(`请求 ${expected.quality}，实际检测为 ${result.actualQualityLabel || result.actualQuality}`)
    }
    if (String(expected.quality).toLowerCase() === 'flac24bit' && result.actualQuality !== 'flac24bit') {
      result.warnings.push(`请求 flac24bit，实际检测为 ${result.actualQualityLabel || result.actualQuality}`)
    }

    result.verified = result.errors.length === 0
    return result
  } catch (error: any) {
    result.errors.push(error.message || '元数据读取失败')
    return result
  } finally {
    try { tagger?.dispose?.() } catch {}
  }
}
