import { createRequire } from 'node:module'
import path from 'node:path'
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
      lyric = await getLyricText({ ...songInfo, ...base })
    } catch (error: any) {
      errors.push(error.message || '歌词下载失败')
    }
  }

  if (options.embedCover && base.img) {
    try {
      cover = await fetchCover(base.img)
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
    result.duration = tagger.duration ? formatPlayTime(tagger.duration) : ''
    result.bitrate = tagger.bitRate
    result.sampleRate = tagger.sampleRate
    result.bitDepth = tagger.bitDepth
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

    result.verified = result.errors.length === 0
    return result
  } catch (error: any) {
    result.errors.push(error.message || '元数据读取失败')
    return result
  } finally {
    try { tagger?.dispose?.() } catch {}
  }
}
