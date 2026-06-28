import fs from 'node:fs'
import path from 'node:path'
import { downloadIndexFile, downloadsDir } from '../config'
import type { BasicMetadata, VerifyResult } from './metadataResolver'
import { resolveInside } from './pathSafety'

export interface DownloadIndexItem {
  id: string
  songId: string
  name: string
  singer: string
  album: string
  albumId: string
  source: string
  quality: string
  filename: string
  size: number
  ext: string
  duration?: string
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  hasCover: boolean
  hasLyric: boolean
  hasEmbedLyric: boolean
  tagStatus: 'ok' | 'warning' | 'error'
  verifyErrors: string[]
  verifyWarnings: string[]
  songInfo?: any
  createdAt: number
  updatedAt: number
}

const ensureIndexFile = () => {
  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true })
  if (!fs.existsSync(downloadIndexFile)) fs.writeFileSync(downloadIndexFile, '[]')
}

export const readDownloadIndex = (): DownloadIndexItem[] => {
  ensureIndexFile()
  try {
    const parsed = JSON.parse(fs.readFileSync(downloadIndexFile, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const writeDownloadIndex = (items: DownloadIndexItem[]) => {
  ensureIndexFile()
  fs.writeFileSync(downloadIndexFile, JSON.stringify(items, null, 2))
}

export const upsertDownloadIndex = (
  metadata: BasicMetadata,
  filename: string,
  verify: VerifyResult,
  songInfo: any,
) => {
  const filePath = resolveInside(downloadsDir, filename)
  const stats = fs.statSync(filePath)
  const now = Date.now()
  const id = `${metadata.songId}_${metadata.quality}`
  const items = readDownloadIndex()
  const old = items.find(item => item.id === id || item.filename === filename)

  const next: DownloadIndexItem = {
    id,
    songId: metadata.songId,
    name: metadata.name,
    singer: metadata.singer,
    album: metadata.album,
    albumId: metadata.albumId,
    source: metadata.source,
    quality: metadata.quality,
    filename,
    size: stats.size,
    ext: path.extname(filename).replace('.', ''),
    duration: verify.duration,
    bitrate: verify.bitrate,
    sampleRate: verify.sampleRate,
    bitDepth: verify.bitDepth,
    hasCover: verify.hasCover,
    hasLyric: verify.hasLyric,
    hasEmbedLyric: verify.hasEmbedLyric,
    tagStatus: verify.errors.length ? 'error' : (verify.warnings.length ? 'warning' : 'ok'),
    verifyErrors: verify.errors,
    verifyWarnings: verify.warnings,
    songInfo,
    createdAt: old?.createdAt || now,
    updatedAt: now,
  }

  if (old) {
    Object.assign(old, next)
  } else {
    items.unshift(next)
  }

  writeDownloadIndex(items)
  return next
}

export const removeDownloadIndexItem = (filename: string) => {
  const items = readDownloadIndex()
  const next = items.filter(item => item.filename !== filename)
  writeDownloadIndex(next)
  return next.length !== items.length
}

export const getDownloadIndexItem = (filename: string) => {
  return readDownloadIndex().find(item => item.filename === filename)
}

export const deleteDownloadedFile = (filename: string) => {
  const filePath = resolveInside(downloadsDir, filename)
  if (!fs.existsSync(filePath)) throw new Error('File not found')
  fs.unlinkSync(filePath)
  removeDownloadIndexItem(filename)
}
