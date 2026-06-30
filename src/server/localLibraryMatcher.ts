import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { appConfig, dataDir, downloadsDir, navidromePlaylistDir } from '../config'
import { readDownloadIndex, type DownloadIndexItem } from './downloadIndex'
import { ensureJsonFile, readJsonFile, writeJsonFileAtomic } from './jsonStore'
import { getSongKey } from './songIdentity'
import { verifyFileMetadata } from './metadataResolver'
import { exportFilePlaylists, type PlaylistExportResult } from './navidromePlaylistExporter'
import type { Subscription } from './subscriptionManager'

const LOCAL_MATCH_STATE_FILENAME = 'local_match_state.json'
const LOCAL_LIBRARY_INDEX_FILENAME = 'local_library_index.json'
const LOCAL_LIBRARY_INDEX_VERSION = 2
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.ape'])
const LXFETCH_UNMATCHED_KEY = '__lxfetch_local_unmatched__'

export interface LocalLibraryTrack {
  version?: number
  filename: string
  size: number
  mtimeMs: number
  ext: string
  title: string
  artist: string
  album: string
  duration: string
  durationSeconds: number
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  songKey: string
  normalizedTitle: string
  normalizedArtist: string
  normalizedAlbum: string
  fingerprint: string
}

interface LocalMatchState {
  version: number
  priority: string[]
  lastMatchedAt: number
  lastScannedAt: number
  lastStatus: 'idle' | 'running' | 'success' | 'failed'
  lastError: string
  lastTrackCount: number
  lastMatchedCount: number
  lastUnmatchedCount: number
  lastResults: Array<{
    subscriptionId: string
    displayName: string
    found: number
    matched: number
    missing: number
    playlistFile: string
    error: string
  }>
}

export interface LocalMatchSyncResult {
  enabled: boolean
  scanned: number
  matched: number
  unmatched: number
  results: PlaylistExportResult[]
  error: string
}

const getStatePath = () => path.join(dataDir, LOCAL_MATCH_STATE_FILENAME)
const getIndexPath = () => path.join(dataDir, LOCAL_LIBRARY_INDEX_FILENAME)

const defaultState = (): LocalMatchState => ({
  version: 1,
  priority: [],
  lastMatchedAt: 0,
  lastScannedAt: 0,
  lastStatus: 'idle',
  lastError: '',
  lastTrackCount: 0,
  lastMatchedCount: 0,
  lastUnmatchedCount: 0,
  lastResults: [],
})

const isEnabled = () => !!(
  appConfig.navidrome.enabled
  && appConfig.navidrome.playlistSyncEnabled
  && appConfig.localMatch.enabled
)

const readState = (): LocalMatchState => {
  ensureJsonFile(getStatePath(), defaultState())
  const parsed = readJsonFile<LocalMatchState>(getStatePath(), defaultState())
  return {
    ...defaultState(),
    ...parsed,
    priority: Array.isArray(parsed.priority) ? parsed.priority : [],
    lastResults: Array.isArray(parsed.lastResults) ? parsed.lastResults : [],
  }
}

const writeState = (state: LocalMatchState) => {
  writeJsonFileAtomic(getStatePath(), state)
}

const readIndex = (): LocalLibraryTrack[] => {
  ensureJsonFile(getIndexPath(), [])
  const parsed = readJsonFile<LocalLibraryTrack[]>(getIndexPath(), [])
  return Array.isArray(parsed) ? parsed : []
}

const writeIndex = (tracks: LocalLibraryTrack[]) => {
  writeJsonFileAtomic(getIndexPath(), tracks, { backup: false })
}

const normalizeText = (value: any) => String(value || '')
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu, '')

const normalizeArtistParts = (value: any) => {
  const text = String(value || '')
    .normalize('NFKC')
    .replace(/\b(feat|featuring|ft)\.?\b/gi, '、')
    .replace(/[,&/／+|｜;；，、]/g, '、')
  const parts = text
    .split('、')
    .map(part => normalizeText(part))
    .filter(Boolean)
  const full = normalizeText(value)
  if (full) parts.unshift(full)
  return Array.from(new Set(parts))
}

const artistsMatch = (songArtist: string, track: LocalLibraryTrack) => {
  const normalizedSongArtist = normalizeText(songArtist)
  if (!normalizedSongArtist || !track.normalizedArtist) return false
  if (track.normalizedArtist === normalizedSongArtist) return true

  const songParts = normalizeArtistParts(songArtist)
  const trackParts = normalizeArtistParts(track.artist)
  for (const songPart of songParts) {
    for (const trackPart of trackParts) {
      if (songPart === trackPart) return true
      if (songPart.length >= 2 && trackPart.length >= 2 && (songPart.includes(trackPart) || trackPart.includes(songPart))) {
        return true
      }
    }
  }
  return false
}

const parseDurationSeconds = (value: any) => {
  const text = String(value || '').trim()
  if (!text) return 0
  const parts = text.split(':').map(part => Number(part))
  if (parts.some(part => !Number.isFinite(part))) return 0
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

const getSongText = (song: any, keys: string[]) => {
  const meta = song?.meta || {}
  for (const key of keys) {
    const value = song?.[key] ?? meta?.[key]
    if (value != null && value !== '') return String(value)
  }
  return ''
}

const getSongTitle = (song: any) => getSongText(song, ['name', 'songName', 'title'])
const getSongArtist = (song: any) => getSongText(song, ['singer', 'singerName', 'artist', 'artistName', 'author', 'authorName'])
const getSongAlbum = (song: any) => getSongText(song, ['albumName', 'album'])
const getSongDurationSeconds = (song: any) => {
  const interval = getSongText(song, ['interval', 'duration'])
  const parsed = parseDurationSeconds(interval)
  if (parsed) return parsed
  const numeric = Number(song?.duration || song?.meta?.duration || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return numeric > 1000 ? Math.round(numeric / 1000) : Math.round(numeric)
}

const makeFingerprint = (title: string, artist: string, album = '') => [
  normalizeText(title),
  normalizeText(artist),
  normalizeText(album),
].join('|')

const parseTitleArtistFromFilename = (filename: string) => {
  const basename = path.basename(filename, path.extname(filename)).replace(/\s+/g, ' ').trim()
  const parts = basename.split(/\s+-\s+/)
  if (parts.length < 2) return { title: basename, artist: '' }
  return {
    title: parts[0].trim(),
    artist: parts.slice(1).join(' - ').trim(),
  }
}

const listAudioFiles = () => {
  const files: string[] = []
  const playlistRoot = path.resolve(navidromePlaylistDir)
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name)
      const resolved = path.resolve(filePath)
      if (entry.isDirectory()) {
        if (resolved === playlistRoot || resolved.startsWith(playlistRoot + path.sep)) continue
        walk(filePath)
        continue
      }
      if (!entry.isFile()) continue
      if (!AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      files.push(path.relative(downloadsDir, filePath).replace(/\\/g, '/'))
    }
  }
  walk(downloadsDir)
  return files.sort((a, b) => a.localeCompare(b))
}

const buildDownloadIndexMap = () => {
  const map = new Map<string, DownloadIndexItem>()
  for (const item of readDownloadIndex()) {
    if (item.filename) map.set(item.filename, item)
  }
  return map
}

const scanTrack = async (
  filename: string,
  existing: LocalLibraryTrack | undefined,
  downloaded: DownloadIndexItem | undefined,
) => {
  const filePath = path.join(downloadsDir, filename)
  const stat = fs.statSync(filePath)
  if (existing && existing.version === LOCAL_LIBRARY_INDEX_VERSION && existing.size === stat.size && existing.mtimeMs === stat.mtimeMs) {
    return existing
  }

  const filenameInfo = parseTitleArtistFromFilename(filename)
  const fallbackTitle = filenameInfo.title
  let title = downloaded?.name || ''
  let artist = downloaded?.singer || ''
  let album = downloaded?.album || ''
  let duration = downloaded?.duration || ''
  let bitrate = downloaded?.bitrate
  let sampleRate = downloaded?.sampleRate
  let bitDepth = downloaded?.bitDepth
  let songKey = downloaded?.songInfo ? getSongKey(downloaded.songInfo) : ''
  if (!songKey && downloaded) songKey = getSongKey({ source: downloaded.source, songmid: downloaded.songId })

  if (!title || !artist || !duration) {
    const verify = await verifyFileMetadata(filePath, {
      songId: downloaded?.songId || '',
      name: title || '',
      singer: artist || '',
      album: album || '',
      albumId: downloaded?.albumId || '',
      img: '',
      interval: '',
      source: downloaded?.source || 'local',
      quality: downloaded?.quality || 'unknown',
    }, { embedCover: false, embedLyric: false, verifyMetadata: true })
    title = title || verify.title || fallbackTitle
    artist = artist || verify.artist || filenameInfo.artist
    album = album || verify.album || ''
    duration = duration || verify.duration || ''
    bitrate = bitrate || verify.bitrate
    sampleRate = sampleRate || verify.sampleRate
    bitDepth = bitDepth || verify.bitDepth
  }

  title = title || fallbackTitle
  const normalizedTitle = normalizeText(title)
  const normalizedArtist = normalizeText(artist)
  const normalizedAlbum = normalizeText(album)
  return {
    version: LOCAL_LIBRARY_INDEX_VERSION,
    filename,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ext: path.extname(filename).replace('.', '').toLowerCase(),
    title,
    artist,
    album,
    duration,
    durationSeconds: parseDurationSeconds(duration),
    bitrate,
    sampleRate,
    bitDepth,
    songKey,
    normalizedTitle,
    normalizedArtist,
    normalizedAlbum,
    fingerprint: [normalizedTitle, normalizedArtist, normalizedAlbum].join('|'),
  }
}

const scanLibrary = async () => {
  const previous = new Map(readIndex().map(track => [track.filename, track]))
  const downloadIndex = buildDownloadIndexMap()
  const tracks: LocalLibraryTrack[] = []
  for (const filename of listAudioFiles()) {
    try {
      tracks.push(await scanTrack(filename, previous.get(filename), downloadIndex.get(filename)))
    } catch (error: any) {
      console.warn('[lxfetch] local library scan skipped:', filename, error.message)
    }
  }
  writeIndex(tracks)
  const state = readState()
  state.lastScannedAt = Date.now()
  state.lastTrackCount = tracks.length
  writeState(state)
  return tracks
}

const orderedSubscriptions = (subscriptions: Subscription[], priority: string[]) => {
  const enabled = subscriptions.filter(subscription => subscription.enabled !== false)
  const byId = new Map(enabled.map(subscription => [subscription.id, subscription]))
  const ordered: Subscription[] = []
  for (const id of priority) {
    const subscription = byId.get(id)
    if (!subscription) continue
    ordered.push(subscription)
    byId.delete(id)
  }
  ordered.push(...enabled.filter(subscription => byId.has(subscription.id)))
  return ordered
}

const matchSongToTrack = (
  song: any,
  availableTracks: Map<string, LocalLibraryTrack>,
  mode: string,
) => {
  const key = getSongKey(song)
  if (key) {
    for (const track of availableTracks.values()) {
      if (track.songKey && track.songKey === key) return track
    }
    if (mode === 'strict') return undefined
  }

  const title = normalizeText(getSongTitle(song))
  const rawArtist = getSongArtist(song)
  const artist = normalizeText(rawArtist)
  const album = normalizeText(getSongAlbum(song))
  if (!title || !artist) return undefined

  for (const track of availableTracks.values()) {
    if (track.normalizedTitle === title && artistsMatch(rawArtist, track) && (!album || !track.normalizedAlbum || track.normalizedAlbum === album)) {
      return track
    }
  }
  if (mode === 'metadata') return undefined

  const duration = getSongDurationSeconds(song)
  const tolerance = appConfig.localMatch.durationToleranceSeconds
  for (const track of availableTracks.values()) {
    if (track.normalizedTitle !== title || !artistsMatch(rawArtist, track)) continue
    if (!duration || !track.durationSeconds || Math.abs(track.durationSeconds - duration) <= tolerance) return track
  }
  return undefined
}

class LocalLibraryMatcher {
  private watcher: FSWatcher | null = null
  private syncTimer: NodeJS.Timeout | null = null
  private running = false

  getState() {
    return {
      enabled: isEnabled(),
      watchEnabled: !!(isEnabled() && appConfig.localMatch.watchEnabled),
      ...readState(),
    }
  }

  getIndex() {
    return readIndex()
  }

  setPriority(priority: string[], subscriptions: Subscription[]) {
    const allowed = new Set(subscriptions.map(subscription => subscription.id))
    const next = Array.from(new Set(priority.filter(id => allowed.has(id))))
    for (const subscription of subscriptions) {
      if (!next.includes(subscription.id)) next.push(subscription.id)
    }
    const state = readState()
    state.priority = next
    writeState(state)
    this.scheduleSync()
    return this.getState()
  }

  async sync(subscriptions: Subscription[], getSongs: (subscription: Subscription) => Promise<any[]>) {
    if (!isEnabled()) {
      return { enabled: false, scanned: 0, matched: 0, unmatched: 0, results: [], error: '' }
    }
    if (this.running) throw new Error('Local library match is already running')

    this.running = true
    const state = readState()
    state.lastStatus = 'running'
    state.lastError = ''
    writeState(state)

    try {
      const tracks = await scanLibrary()
      const availableTracks = new Map(tracks.map(track => [track.filename, track]))
      const playlists: Array<{
        key: string
        displayName: string
        rows: Array<{ filename: string }>
        found: number
        missing: number
      }> = []

      let matched = 0
      const assignedFilenames = new Set<string>()
      for (const subscription of orderedSubscriptions(subscriptions, state.priority)) {
        const songs = await getSongs(subscription)
        const rows: Array<{ filename: string }> = []
        const seenSongs = new Set<string>()
        for (const song of songs) {
          const songKey = getSongKey(song) || makeFingerprint(getSongTitle(song), getSongArtist(song), getSongAlbum(song))
          if (songKey && seenSongs.has(songKey)) continue
          if (songKey) seenSongs.add(songKey)
          const track = matchSongToTrack(song, availableTracks, appConfig.localMatch.matchMode)
          if (!track) continue
          rows.push({ filename: track.filename })
          assignedFilenames.add(track.filename)
          availableTracks.delete(track.filename)
        }
        matched += rows.length
        playlists.push({
          key: subscription.id,
          displayName: subscription.title || subscription.targetId,
          rows,
          found: songs.length,
          missing: Math.max(0, songs.length - rows.length),
        })
      }

      if (appConfig.localMatch.includeUnmatchedPlaylist) {
        playlists.push({
          key: LXFETCH_UNMATCHED_KEY,
          displayName: appConfig.localMatch.unmatchedPlaylistName || '未匹配',
          rows: tracks
            .filter(track => !assignedFilenames.has(track.filename))
            .map(track => ({ filename: track.filename })),
          found: tracks.length,
          missing: 0,
        })
      }

      const results = await exportFilePlaylists(playlists)
      const nextState = readState()
      nextState.priority = orderedSubscriptions(subscriptions, state.priority).map(subscription => subscription.id)
      nextState.lastMatchedAt = Date.now()
      nextState.lastStatus = 'success'
      nextState.lastError = ''
      nextState.lastTrackCount = tracks.length
      nextState.lastMatchedCount = matched
      nextState.lastUnmatchedCount = availableTracks.size
      nextState.lastResults = results.map(result => ({
        subscriptionId: result.subscriptionId,
        displayName: result.displayName,
        found: result.found,
        matched: result.downloaded,
        missing: result.missing,
        playlistFile: result.playlistFile,
        error: result.error || result.scan?.error || '',
      }))
      writeState(nextState)
      return {
        enabled: true,
        scanned: tracks.length,
        matched,
        unmatched: availableTracks.size,
        results,
        error: '',
      }
    } catch (error: any) {
      const nextState = readState()
      nextState.lastStatus = 'failed'
      nextState.lastError = error.message || String(error)
      writeState(nextState)
      throw error
    } finally {
      this.running = false
    }
  }

  scheduleSync() {
    if (!isEnabled()) return
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      void import('./subscriptionManager.js').then(({ subscriptionManager }) => {
        return subscriptionManager.syncLocalLibraryPlaylists()
      }).catch(error => {
        console.warn('[lxfetch] local library match failed:', error.message)
      })
    }, appConfig.localMatch.watchDebounceMs)
    this.syncTimer.unref?.()
  }

  startWatcher() {
    if (this.watcher || !isEnabled() || !appConfig.localMatch.watchEnabled) return
    this.watcher = chokidar.watch(downloadsDir, {
      ignoreInitial: true,
      persistent: true,
      ignored: filePath => {
        const resolved = path.resolve(filePath)
        const playlistRoot = path.resolve(navidromePlaylistDir)
        return resolved === playlistRoot || resolved.startsWith(playlistRoot + path.sep)
      },
    })
    this.watcher
      .on('add', filePath => {
        if (AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) this.scheduleSync()
      })
      .on('change', filePath => {
        if (AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) this.scheduleSync()
      })
      .on('unlink', filePath => {
        if (AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) this.scheduleSync()
      })
  }

  async stopWatcher() {
    if (!this.watcher) return
    const watcher = this.watcher
    this.watcher = null
    await watcher.close()
  }
}

export const localLibraryMatcher = new LocalLibraryMatcher()
