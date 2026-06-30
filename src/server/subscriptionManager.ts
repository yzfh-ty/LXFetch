import { appConfig, subscriptionsFile } from '../config'
import { isHigherQuality } from '../common/constants'
import { downloadTaskManager } from './downloadTaskManager'
import { getDownloadedItemBySongInfo } from './downloadIndex'
import { getBestReportedQuality, getLeaderboardList, getSongListDetail } from './musicResolver'
import { ensureJsonFile, readJsonFile, writeJsonFileAtomic } from './jsonStore'
import { getSongKey } from './songIdentity'
import {
  exportSubscriptionPlaylist,
  exportSubscriptionPlaylists,
  removeSubscriptionPlaylist,
  type PlaylistExportResult,
} from './navidromePlaylistExporter'
import { localLibraryMatcher } from './localLibraryMatcher'

type SubscriptionType = 'songList' | 'leaderboard'

interface SubscriptionOptions {
  embedCover: boolean
  embedLyric: boolean
  writeTags: boolean
  verifyMetadata: boolean
}

export interface Subscription {
  id: string
  type: SubscriptionType
  source: string
  targetId: string
  title: string
  enabled: boolean
  intervalMinutes: number
  quality: string
  allowQualityFallback: boolean
  options: SubscriptionOptions
  downloadedKeys: string[]
  lastCheckedAt: number
  lastUpdatedAt: number
  lastRunStatus: 'idle' | 'running' | 'success' | 'failed' | 'cancelled'
  lastError: string
  lastFoundCount: number
  lastCreatedCount: number
  lastSkippedCount: number
  lastInvalidCount: number
  lastPlaylistSyncedAt: number
  lastPlaylistFile: string
  lastPlaylistDisplayName: string
  lastPlaylistDownloadedCount: number
  lastPlaylistMissingCount: number
  lastPlaylistError: string
  createdAt: number
  updatedAt: number
}

interface CreateSubscriptionInput {
  type: SubscriptionType
  source: string
  targetId: string
  title?: string
  intervalMinutes?: number
  options?: Partial<SubscriptionOptions>
}

const CHECK_INTERVAL_MS = 60 * 1000
const MAX_FETCH_PAGES = 20
const MAX_FETCH_SONGS = 500
const MAX_STORED_KEYS = 5000
const PLAYLIST_SYNC_DEBOUNCE_MS = 30 * 1000

const sleep = async (ms: number, shouldStop?: () => boolean) => {
  if (ms <= 0) return
  const stepMs = 250
  let remaining = ms
  while (remaining > 0) {
    if (shouldStop?.()) return
    const waitMs = Math.min(stepMs, remaining)
    await new Promise(resolve => setTimeout(resolve, waitMs))
    remaining -= waitMs
  }
}

const yieldToEventLoop = async () => {
  await new Promise(resolve => setImmediate(resolve))
}

const ensureSubscriptionsFile = () => {
  ensureJsonFile(subscriptionsFile, [])
}

const createId = () => `sub_${Date.now()}_${Math.random().toString(16).slice(2)}`

const clampInterval = (minutes: any) => {
  const value = Number(minutes || 360)
  if (!Number.isFinite(value)) return 360
  return Math.max(15, Math.min(60 * 24 * 30, Math.round(value)))
}

const pinSongSource = (songInfo: any, source: string) => {
  const normalized = {
    ...(songInfo || {}),
    source,
  }
  if (songInfo?.meta && typeof songInfo.meta === 'object') {
    normalized.meta = {
      ...songInfo.meta,
      source,
    }
  }
  return normalized
}

class SubscriptionManager {
  private subscriptions: Subscription[] = []
  private runningIds = new Set<string>()
  private cancelRequestedIds = new Set<string>()
  private runPhases = new Map<string, 'scanning' | 'creating'>()
  private timer: NodeJS.Timeout | null = null
  private playlistTimer: NodeJS.Timeout | null = null
  private playlistSyncTimer: NodeJS.Timeout | null = null

  constructor() {
    this.subscriptions = this.load()
  }

  private load() {
    ensureSubscriptionsFile()
    const parsed = readJsonFile<any[]>(subscriptionsFile, [])
    if (!Array.isArray(parsed)) return []
    return parsed.map((item: any) => ({
      ...item,
      enabled: item.enabled !== false,
      intervalMinutes: clampInterval(item.intervalMinutes),
      quality: 'best',
      allowQualityFallback: true,
      options: {
        embedCover: item.options?.embedCover ?? appConfig.download.embedCover,
        embedLyric: item.options?.embedLyric ?? appConfig.download.embedLyric,
        writeTags: item.options?.writeTags ?? appConfig.download.writeTags,
        verifyMetadata: item.options?.verifyMetadata ?? appConfig.download.verifyMetadata,
      },
      downloadedKeys: Array.isArray(item.downloadedKeys) ? item.downloadedKeys : [],
      lastRunStatus: item.lastRunStatus === 'running' ? 'idle' : (item.lastRunStatus || 'idle'),
      lastError: item.lastError || '',
      lastFoundCount: Number(item.lastFoundCount || 0),
      lastCreatedCount: Number(item.lastCreatedCount || 0),
      lastSkippedCount: Number(item.lastSkippedCount || 0),
      lastInvalidCount: Number(item.lastInvalidCount || 0),
      lastPlaylistSyncedAt: Number(item.lastPlaylistSyncedAt || 0),
      lastPlaylistFile: item.lastPlaylistFile || '',
      lastPlaylistDisplayName: item.lastPlaylistDisplayName || '',
      lastPlaylistDownloadedCount: Number(item.lastPlaylistDownloadedCount || 0),
      lastPlaylistMissingCount: Number(item.lastPlaylistMissingCount || 0),
      lastPlaylistError: item.lastPlaylistError || '',
    }))
  }

  private save() {
    ensureSubscriptionsFile()
    writeJsonFileAtomic(subscriptionsFile, this.subscriptions)
  }

  private touch(subscription: Subscription) {
    subscription.updatedAt = Date.now()
    this.save()
  }

  list() {
    return this.subscriptions.map(subscription => ({
      ...subscription,
      running: this.runningIds.has(subscription.id),
      cancelRequested: this.cancelRequestedIds.has(subscription.id),
      runPhase: this.runPhases.get(subscription.id) || '',
    }))
  }

  get(id: string) {
    return this.subscriptions.find(item => item.id === id)
  }

  create(input: CreateSubscriptionInput) {
    if (!['songList', 'leaderboard'].includes(input.type)) throw new Error('Invalid subscription type')
    if (!input.source || !input.targetId) throw new Error('Missing source or targetId')
    const now = Date.now()
    const existing = this.subscriptions.find(item => (
      item.type === input.type
      && item.source === input.source
      && item.targetId === input.targetId
    ))
    if (existing) {
      existing.title = input.title || existing.title
      existing.enabled = true
      existing.intervalMinutes = clampInterval(input.intervalMinutes || existing.intervalMinutes)
      existing.quality = 'best'
      existing.allowQualityFallback = true
      existing.options = {
        embedCover: input.options?.embedCover ?? existing.options.embedCover,
        embedLyric: input.options?.embedLyric ?? existing.options.embedLyric,
        writeTags: input.options?.writeTags ?? existing.options.writeTags,
        verifyMetadata: input.options?.verifyMetadata ?? existing.options.verifyMetadata,
      }
      this.touch(existing)
      void this.run(existing.id).catch(() => {})
      return existing
    }

    const subscription: Subscription = {
      id: createId(),
      type: input.type,
      source: input.source,
      targetId: input.targetId,
      title: input.title || input.targetId,
      enabled: true,
      intervalMinutes: clampInterval(input.intervalMinutes),
      quality: 'best',
      allowQualityFallback: true,
      options: {
        embedCover: input.options?.embedCover ?? appConfig.download.embedCover,
        embedLyric: input.options?.embedLyric ?? appConfig.download.embedLyric,
        writeTags: input.options?.writeTags ?? appConfig.download.writeTags,
        verifyMetadata: input.options?.verifyMetadata ?? appConfig.download.verifyMetadata,
      },
      downloadedKeys: [],
      lastCheckedAt: 0,
      lastUpdatedAt: 0,
      lastRunStatus: 'idle',
      lastError: '',
      lastFoundCount: 0,
      lastCreatedCount: 0,
      lastSkippedCount: 0,
      lastInvalidCount: 0,
      lastPlaylistSyncedAt: 0,
      lastPlaylistFile: '',
      lastPlaylistDisplayName: '',
      lastPlaylistDownloadedCount: 0,
      lastPlaylistMissingCount: 0,
      lastPlaylistError: '',
      createdAt: now,
      updatedAt: now,
    }
    this.subscriptions.unshift(subscription)
    this.save()
    void this.run(subscription.id).catch(() => {})
    return subscription
  }

  toggle(id: string, enabled: boolean) {
    const subscription = this.get(id)
    if (!subscription) throw new Error('Subscription not found')
    subscription.enabled = enabled
    this.touch(subscription)
    return subscription
  }

  delete(id: string) {
    const before = this.subscriptions.length
    this.subscriptions = this.subscriptions.filter(item => item.id !== id)
    removeSubscriptionPlaylist(id)
    this.save()
    return this.subscriptions.length !== before
  }

  resetRecord(id: string) {
    const subscription = this.get(id)
    if (!subscription) throw new Error('Subscription not found')
    subscription.downloadedKeys = []
    subscription.lastRunStatus = 'idle'
    subscription.lastError = ''
    subscription.lastFoundCount = 0
    subscription.lastCreatedCount = 0
    subscription.lastSkippedCount = 0
    subscription.lastInvalidCount = 0
    this.touch(subscription)
    return subscription
  }

  startRun(id: string) {
    const subscription = this.get(id)
    if (!subscription) throw new Error('Subscription not found')
    if (!this.runningIds.has(id)) {
      void this.run(id).catch(error => {
        console.warn('[lxfetch] subscription run failed:', error.message)
      })
    }
    return this.list().find(item => item.id === id) || subscription
  }

  cancelTaskCreation(id: string) {
    const subscription = this.get(id)
    if (!subscription) throw new Error('Subscription not found')
    if (this.runningIds.has(id)) {
      this.cancelRequestedIds.add(id)
      this.runPhases.set(id, this.runPhases.get(id) || 'scanning')
    }
    return subscription
  }

  cancelAllTaskCreation() {
    const ids = Array.from(this.runningIds)
    for (const id of ids) {
      this.cancelRequestedIds.add(id)
      this.runPhases.set(id, this.runPhases.get(id) || 'scanning')
    }
    return {
      requested: ids.length,
      subscriptions: this.list().filter(subscription => ids.includes(subscription.id)),
    }
  }

  startScheduler() {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.runDueSubscriptions().catch(error => {
        console.warn('[lxfetch] subscription scheduler failed:', error.message)
      })
    }, CHECK_INTERVAL_MS)
    this.timer.unref?.()
    setTimeout(() => {
      void this.runDueSubscriptions().catch(() => {})
    }, 2000).unref?.()
    this.startPlaylistScheduler()
    localLibraryMatcher.startWatcher()
  }

  stopScheduler() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    if (this.playlistTimer) {
      clearInterval(this.playlistTimer)
      this.playlistTimer = null
    }
    if (this.playlistSyncTimer) {
      clearTimeout(this.playlistSyncTimer)
      this.playlistSyncTimer = null
    }
    void localLibraryMatcher.stopWatcher().catch(() => {})
  }

  private startPlaylistScheduler() {
    if (this.playlistTimer || !appConfig.navidrome.enabled || !appConfig.navidrome.playlistSyncEnabled) return
    const intervalMs = Math.max(1, appConfig.navidrome.playlistExportIntervalMinutes || 5) * 60 * 1000
    this.playlistTimer = setInterval(() => {
      void this.syncAllNavidromePlaylists().catch(error => {
        console.warn('[lxfetch] navidrome playlist sync failed:', error.message)
      })
    }, intervalMs)
    this.playlistTimer.unref?.()
    setTimeout(() => {
      void this.syncAllNavidromePlaylists().catch(() => {})
    }, 10000).unref?.()
  }

  async runDueSubscriptions() {
    const now = Date.now()
    for (const subscription of this.subscriptions) {
      if (!subscription.enabled || this.runningIds.has(subscription.id)) continue
      const intervalMs = clampInterval(subscription.intervalMinutes) * 60 * 1000
      if (!subscription.lastCheckedAt || now - subscription.lastCheckedAt >= intervalMs) {
        await this.run(subscription.id)
      }
    }
  }

  private shouldSkipSong(song: any, subscription: Subscription, activeKeys: Set<string>) {
    const key = getSongKey(song)
    if (!key || activeKeys.has(key)) return true

    const existing = getDownloadedItemBySongInfo(song)
    const hasKnownKey = subscription.downloadedKeys.includes(key)
    if (!hasKnownKey && !existing) return false
    if (!appConfig.download.upgradeExisting) return true
    if (!existing) return true

    const targetQuality = getBestReportedQuality(song)
    const existingQuality = existing.actualQuality || existing.quality
    return !targetQuality || !isHigherQuality(targetQuality, existingQuality)
  }

  private async fetchSongs(subscription: Subscription) {
    const songs: any[] = []
    const seenKeys = new Set<string>()
    for (let page = 1; page <= MAX_FETCH_PAGES && songs.length < MAX_FETCH_SONGS; page++) {
      const result = subscription.type === 'songList'
        ? await getSongListDetail(subscription.source, subscription.targetId, page)
        : await getLeaderboardList(subscription.source, subscription.targetId, page)
      const list = Array.isArray(result?.list) ? result.list : []
      let addedFromPage = 0
      for (const song of list) {
        if (songs.length >= MAX_FETCH_SONGS) break
        const pinnedSong = pinSongSource(song, subscription.source)
        const key = getSongKey(pinnedSong)
        if (key) {
          if (seenKeys.has(key)) continue
          seenKeys.add(key)
        }
        songs.push(pinnedSong)
        addedFromPage += 1
      }
      const total = Number(result?.total || 0)
      const limit = Number(result?.limit || list.length || 0)
      if (!list.length) break
      if (!addedFromPage) break
      if (total > 0 && limit > 0 && page * limit >= total) break
      if (list.length < Math.max(1, limit || list.length)) break
    }
    return songs
  }

  async getCurrentSongs(id: string) {
    const subscription = this.get(id)
    if (!subscription) throw new Error('Subscription not found')
    return this.fetchSongs(subscription)
  }

  private applyPlaylistResult(subscription: Subscription, result: PlaylistExportResult) {
    if (!result.enabled) return
    subscription.lastPlaylistSyncedAt = Date.now()
    subscription.lastPlaylistFile = result.playlistFile || subscription.lastPlaylistFile || ''
    subscription.lastPlaylistDisplayName = result.displayName || subscription.lastPlaylistDisplayName || ''
    subscription.lastPlaylistDownloadedCount = Number(result.downloaded || 0)
    subscription.lastPlaylistMissingCount = Number(result.missing || 0)
    subscription.lastPlaylistError = result.error || result.scan?.error || ''
    this.touch(subscription)
  }

  private applyPlaylistError(subscription: Subscription, error: any) {
    subscription.lastPlaylistSyncedAt = Date.now()
    subscription.lastPlaylistError = error.message || String(error)
    this.touch(subscription)
  }

  async syncNavidromePlaylist(id: string, songs?: any[]) {
    const subscription = this.get(id)
    if (!subscription) throw new Error('Subscription not found')
    try {
      const currentSongs = songs || await this.fetchSongs(subscription)
      const result = await exportSubscriptionPlaylist(subscription, currentSongs, this.subscriptions)
      this.applyPlaylistResult(subscription, result)
      return result
    } catch (error: any) {
      this.applyPlaylistError(subscription, error)
      throw error
    }
  }

  async syncAllNavidromePlaylists() {
    if (appConfig.localMatch.enabled) return this.syncLocalLibraryPlaylists()
    const results = await exportSubscriptionPlaylists(this.subscriptions, subscription => this.fetchSongs(subscription))
    for (const result of results) {
      const subscription = this.get(result.subscriptionId)
      if (!subscription) continue
      this.applyPlaylistResult(subscription, result)
    }
    return results
  }

  async syncLocalLibraryPlaylists() {
    const result = await localLibraryMatcher.sync(this.subscriptions, subscription => this.fetchSongs(subscription))
    for (const item of result.results) {
      const subscription = this.get(item.subscriptionId)
      if (!subscription) continue
      this.applyPlaylistResult(subscription, item)
    }
    return result
  }

  getLocalLibraryMatchState() {
    return localLibraryMatcher.getState()
  }

  getLocalLibraryIndex() {
    return localLibraryMatcher.getIndex()
  }

  setLocalLibraryMatchPriority(priority: string[]) {
    return localLibraryMatcher.setPriority(priority, this.subscriptions)
  }

  scheduleNavidromePlaylistSync() {
    if (!appConfig.navidrome.enabled || !appConfig.navidrome.playlistSyncEnabled) return
    if (this.playlistSyncTimer) return
    this.playlistSyncTimer = setTimeout(() => {
      this.playlistSyncTimer = null
      void this.syncAllNavidromePlaylists().catch(error => {
        console.warn('[lxfetch] navidrome playlist sync failed:', error.message)
      })
    }, PLAYLIST_SYNC_DEBOUNCE_MS)
    this.playlistSyncTimer.unref?.()
  }

  async run(id: string) {
    const subscription = this.get(id)
    if (!subscription) throw new Error('Subscription not found')
    if (this.runningIds.has(id)) return subscription

    this.runningIds.add(id)
    this.cancelRequestedIds.delete(id)
    this.runPhases.set(id, 'scanning')
    subscription.lastRunStatus = 'running'
    subscription.lastError = ''
    subscription.lastCheckedAt = Date.now()
    this.touch(subscription)

    try {
      const activeKeys = downloadTaskManager.getActiveSongKeys()
      const songs = await this.fetchSongs(subscription)
      this.runPhases.set(id, 'creating')
      const configuredMaxTasks = Number(appConfig.subscription.maxTasksPerRun || 0)
      const maxTasksPerRun = configuredMaxTasks > 0 ? configuredMaxTasks : Number.POSITIVE_INFINITY
      const taskCreateDelayMs = Math.max(0, Number(appConfig.subscription.taskCreateDelayMs || 0))
      let created = 0
      let skipped = 0
      let invalid = 0
      let cancelled = false

      for (let index = 0; index < songs.length; index++) {
        const song = songs[index]
        if (this.cancelRequestedIds.has(id)) {
          cancelled = true
          skipped += songs.length - index
          break
        }
        if (created >= maxTasksPerRun) break
        const key = getSongKey(song)
        if (!key) {
          invalid += 1
          continue
        }
        if (this.shouldSkipSong(song, subscription, activeKeys)) {
          skipped += 1
          continue
        }
        downloadTaskManager.createTask({
          songInfo: song,
          source: subscription.source,
          options: subscription.options,
        })
        activeKeys.add(key)
        subscription.downloadedKeys.push(key)
        created += 1
        if (taskCreateDelayMs > 0) await sleep(taskCreateDelayMs, () => this.cancelRequestedIds.has(id))
        else await yieldToEventLoop()
      }

      subscription.downloadedKeys = Array.from(new Set(subscription.downloadedKeys)).slice(-MAX_STORED_KEYS)
      if (cancelled || this.cancelRequestedIds.has(id)) {
        subscription.lastRunStatus = 'cancelled'
        subscription.lastError = '已取消剩余下载任务创建'
      } else {
        subscription.lastRunStatus = 'success'
        subscription.lastError = ''
      }
      subscription.lastFoundCount = songs.length
      subscription.lastCreatedCount = created
      subscription.lastSkippedCount = skipped
      subscription.lastInvalidCount = invalid
      subscription.lastUpdatedAt = Date.now()
      this.touch(subscription)
      void this.syncNavidromePlaylist(subscription.id, songs).catch(error => {
        console.warn('[lxfetch] navidrome playlist sync failed:', error.message)
      })
      return subscription
    } catch (error: any) {
      subscription.lastRunStatus = 'failed'
      subscription.lastError = error.message || String(error)
      this.touch(subscription)
      throw error
    } finally {
      this.runningIds.delete(id)
      this.cancelRequestedIds.delete(id)
      this.runPhases.delete(id)
    }
  }
}

export const subscriptionManager = new SubscriptionManager()
