import fs from 'node:fs'
import path from 'node:path'
import { appConfig, dataDir, downloadsDir, navidromePlaylistDir } from '../config'
import { getDownloadedItemBySongInfo } from './downloadIndex'
import { ensureJsonFile, readJsonFile, writeJsonFileAtomic } from './jsonStore'
import { getSupportedPlatforms } from './musicResolver'
import { limitFilename, resolveInside, sanitizeFilenamePart } from './pathSafety'
import { getSongKey } from './songIdentity'
import { requestNavidromeScan, shouldScanAfterPlaylistExport, type NavidromeScanResult } from './navidromeClient'
import type { Subscription } from './subscriptionManager'

interface PlaylistManifestEntry {
  subscriptionId: string
  filename: string
  displayName: string
  updatedAt: number
}

interface PlaylistManifest {
  version: number
  entries: PlaylistManifestEntry[]
}

export interface PlaylistExportResult {
  enabled: boolean
  subscriptionId: string
  playlistFile: string
  displayName: string
  found: number
  downloaded: number
  missing: number
  skipped: number
  updated: boolean
  scan: NavidromeScanResult
  error: string
}

const MANIFEST_FILENAME = 'navidrome_playlists.json'

const isSyncEnabled = () => !!(appConfig.navidrome.enabled && appConfig.navidrome.playlistSyncEnabled)

const ensurePlaylistDir = () => {
  if (!fs.existsSync(navidromePlaylistDir)) fs.mkdirSync(navidromePlaylistDir, { recursive: true })
}

const getManifestPath = () => path.join(dataDir, MANIFEST_FILENAME)

const readManifest = (): PlaylistManifest => {
  ensurePlaylistDir()
  const manifestPath = getManifestPath()
  ensureJsonFile(manifestPath, { version: 1, entries: [] })
  const parsed = readJsonFile<PlaylistManifest>(manifestPath, { version: 1, entries: [] })
  return {
    version: 1,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
  }
}

const writeManifest = (manifest: PlaylistManifest) => {
  ensurePlaylistDir()
  writeJsonFileAtomic(getManifestPath(), {
    version: 1,
    entries: manifest.entries,
  })
}

const writeFileAtomic = (filename: string, content: string) => {
  const tempFilename = `${filename}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tempFilename, content, 'utf8')
  fs.renameSync(tempFilename, filename)
}

const normalizeTitle = (value: any) => {
  const title = String(value || '').replace(/\s+/g, ' ').trim()
  return title || '未命名歌单'
}

const normalizeComparableTitle = (value: string) => normalizeTitle(value).toLowerCase()

const getSourceLabelMap = () => {
  const map = new Map<string, string>()
  for (const platform of getSupportedPlatforms()) {
    map.set(platform.id, platform.name || platform.id)
  }
  return map
}

const getSourceLabel = (source: string, sourceLabels: Map<string, string>) => {
  return sourceLabels.get(source) || source || 'unknown'
}

const shortId = (value: string) => String(value || '').replace(/[^a-zA-Z0-9]+/g, '').slice(-6) || 'unknown'

const displayNamesForSubscriptions = (subscriptions: Subscription[]) => {
  const sourceLabels = getSourceLabelMap()
  const byTitle = new Map<string, Subscription[]>()
  for (const subscription of subscriptions) {
    const key = normalizeComparableTitle(subscription.title || subscription.targetId)
    byTitle.set(key, [...(byTitle.get(key) || []), subscription])
  }

  const result = new Map<string, string>()
  for (const group of byTitle.values()) {
    if (group.length === 1) {
      const subscription = group[0]
      result.set(subscription.id, normalizeTitle(subscription.title || subscription.targetId))
      continue
    }

    const sourceCounts = new Map<string, number>()
    for (const subscription of group) {
      sourceCounts.set(subscription.source, (sourceCounts.get(subscription.source) || 0) + 1)
    }

    for (const subscription of group) {
      const title = normalizeTitle(subscription.title || subscription.targetId)
      const sourceLabel = getSourceLabel(subscription.source, sourceLabels)
      const suffix = sourceCounts.get(subscription.source) === 1
        ? sourceLabel
        : `${sourceLabel} ${subscription.type} ${shortId(subscription.targetId || subscription.id)}`
      result.set(subscription.id, `${title} (${suffix})`)
    }
  }
  return result
}

const getPlaylistFilename = (subscription: Subscription, displayName: string, manifest: PlaylistManifest) => {
  const existing = manifest.entries.find(entry => entry.subscriptionId === subscription.id)
  const baseName = limitFilename(sanitizeFilenamePart(displayName), 150)
  let candidate = `${baseName}.nsp`
  let index = 2
  const used = new Set(
    manifest.entries
      .filter(entry => entry.subscriptionId !== subscription.id)
      .map(entry => entry.filename),
  )

  const isTaken = (filename: string) => {
    if (used.has(filename)) return true
    if (existing?.filename === filename) return false
    return fs.existsSync(path.join(navidromePlaylistDir, filename))
  }

  while (isTaken(candidate)) {
    const indexedBaseName = limitFilename(`${baseName} (${index})`, 150)
    candidate = `${indexedBaseName}.nsp`
    index += 1
  }

  if (!existing) return candidate
  if (existing.filename && !existing.filename.endsWith('.nsp')) return candidate
  if (existing.displayName === displayName && existing.filename) return existing.filename
  return candidate
}

const makeNavidromeFilepath = (filename: string) => {
  const filePath = resolveInside(downloadsDir, filename)
  if (appConfig.navidrome.playlistPathMode === 'absolute') return filePath
  return path.relative(downloadsDir, filePath).replace(/\\/g, '/')
}

const buildSmartPlaylist = (
  displayName: string,
  rows: Array<{ filename: string }>,
) => {
  const rules = rows.map(row => ({
    is: {
      filepath: makeNavidromeFilepath(row.filename),
    },
  }))
  const playlist = {
    name: displayName,
    comment: 'Generated by LXFetch',
    public: true,
    any: rules.length ? rules : [{ is: { filepath: '__lxfetch_empty_playlist__' } }],
  }
  return `${JSON.stringify(playlist, null, 2)}\n`
}

const safeRemoveOldPlaylist = (filename: string) => {
  if (!filename) return
  if (filename.includes('../') || filename.startsWith('/') || filename.startsWith('..')) return
  const root = path.resolve(navidromePlaylistDir)
  const filePath = path.resolve(root, filename)
  if (!filePath.startsWith(root + path.sep)) return
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

export const removeSubscriptionPlaylist = (subscriptionId: string) => {
  if (!fs.existsSync(getManifestPath())) return false
  const manifest = readManifest()
  const entry = manifest.entries.find(item => item.subscriptionId === subscriptionId)
  if (!entry) return false
  safeRemoveOldPlaylist(entry.filename)
  manifest.entries = manifest.entries.filter(item => item.subscriptionId !== subscriptionId)
  writeManifest(manifest)
  return true
}

const updateManifestEntry = (
  manifest: PlaylistManifest,
  subscription: Subscription,
  filename: string,
  displayName: string,
) => {
  const now = Date.now()
  const existing = manifest.entries.find(entry => entry.subscriptionId === subscription.id)
  if (existing) {
    existing.filename = filename
    existing.displayName = displayName
    existing.updatedAt = now
  } else {
    manifest.entries.push({
      subscriptionId: subscription.id,
      filename,
      displayName,
      updatedAt: now,
    })
  }
}

const disabledResult = (subscription: Subscription): PlaylistExportResult => ({
  enabled: false,
  subscriptionId: subscription.id,
  playlistFile: '',
  displayName: '',
  found: 0,
  downloaded: 0,
  missing: 0,
  skipped: 0,
  updated: false,
  scan: { requested: false, ok: true, error: '' },
  error: '',
})

export const exportSubscriptionPlaylist = async (
  subscription: Subscription,
  songs: any[] = [],
  allSubscriptions: Subscription[] = [subscription],
  scanAfterExport = true,
): Promise<PlaylistExportResult> => {
  if (!isSyncEnabled()) return disabledResult(subscription)

  ensurePlaylistDir()
  const manifest = readManifest()
  const displayNames = displayNamesForSubscriptions(allSubscriptions.length ? allSubscriptions : [subscription])
  const displayName = displayNames.get(subscription.id) || normalizeTitle(subscription.title || subscription.targetId)
  const filename = getPlaylistFilename(subscription, displayName, manifest)
  const playlistFilePath = path.join(navidromePlaylistDir, filename)
  const existingEntry = manifest.entries.find(entry => entry.subscriptionId === subscription.id)

  const rows: Array<{ filename: string }> = []
  const seenKeys = new Set<string>()
  let skipped = 0
  let missing = 0

  for (const song of songs) {
    const key = getSongKey(song)
    if (!key || seenKeys.has(key)) {
      skipped += 1
      continue
    }
    seenKeys.add(key)
    const downloaded = getDownloadedItemBySongInfo(song)
    if (!downloaded) {
      missing += 1
      continue
    }
    rows.push({ filename: downloaded.filename })
  }

  const content = buildSmartPlaylist(displayName, rows)
  const oldContent = fs.existsSync(playlistFilePath) ? fs.readFileSync(playlistFilePath, 'utf8') : ''
  const updated = oldContent !== content || existingEntry?.displayName !== displayName || existingEntry?.filename !== filename

  writeFileAtomic(playlistFilePath, content)
  if (existingEntry?.filename && existingEntry.filename !== filename) {
    safeRemoveOldPlaylist(existingEntry.filename)
  }
  updateManifestEntry(manifest, subscription, filename, displayName)
  writeManifest(manifest)

  const scan = updated && scanAfterExport ? await requestNavidromeScan() : { requested: false, ok: true, error: '' }
  return {
    enabled: true,
    subscriptionId: subscription.id,
    playlistFile: path.relative(downloadsDir, playlistFilePath).replace(/\\/g, '/'),
    displayName,
    found: songs.length,
    downloaded: rows.length,
    missing,
    skipped,
    updated,
    scan,
    error: '',
  }
}

export const exportSubscriptionPlaylists = async (
  subscriptions: Subscription[],
  getSongs: (subscription: Subscription) => Promise<any[]>,
): Promise<PlaylistExportResult[]> => {
  if (!isSyncEnabled()) return []
  const results: PlaylistExportResult[] = []
  let hasUpdatedPlaylist = false

  for (const subscription of subscriptions.filter(subscription => subscription.enabled !== false)) {
    try {
      const songs = await getSongs(subscription)
      const result = await exportSubscriptionPlaylist(
        subscription,
        songs,
        subscriptions,
        false,
      )
      if (result.updated) hasUpdatedPlaylist = true
      results.push(result)
    } catch (error: any) {
      results.push({
        enabled: true,
        subscriptionId: subscription.id,
        playlistFile: '',
        displayName: normalizeTitle(subscription.title || subscription.targetId),
        found: 0,
        downloaded: 0,
        missing: 0,
        skipped: 0,
        updated: false,
        scan: { requested: false, ok: true, error: '' },
        error: error.message || String(error),
      })
    }
  }

  if (hasUpdatedPlaylist && shouldScanAfterPlaylistExport()) {
    const scan = await requestNavidromeScan()
    const lastUpdated = [...results].reverse().find(result => result.updated)
    if (lastUpdated) lastUpdated.scan = scan
  }

  return results
}
