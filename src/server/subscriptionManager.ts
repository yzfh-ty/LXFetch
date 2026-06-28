import fs from 'node:fs'
import path from 'node:path'
import { appConfig, subscriptionsFile } from '../config'
import { downloadTaskManager } from './downloadTaskManager'
import { readDownloadIndex } from './downloadIndex'
import { getLeaderboardList, getSongListDetail } from './musicResolver'

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
  lastRunStatus: 'idle' | 'running' | 'success' | 'failed'
  lastError: string
  lastFoundCount: number
  lastCreatedCount: number
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

const sleep = async (ms: number) => {
  if (ms <= 0) return
  await new Promise(resolve => setTimeout(resolve, ms))
}

const ensureSubscriptionsFile = () => {
  if (!fs.existsSync(path.dirname(subscriptionsFile))) fs.mkdirSync(path.dirname(subscriptionsFile), { recursive: true })
  if (!fs.existsSync(subscriptionsFile)) fs.writeFileSync(subscriptionsFile, '[]')
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

export const getSongKey = (songInfo: any) => {
  const meta = songInfo?.meta || {}
  const source = songInfo?.source || meta.source || ''
  const rawId = songInfo?.songmid
    || songInfo?.songId
    || songInfo?.id
    || songInfo?.hash
    || songInfo?.strMediaMid
    || songInfo?.copyrightId
    || meta.songId
    || meta.hash
    || meta.strMediaMid
    || meta.copyrightId
  if (rawId) return `${source}:${String(rawId)}`
  const name = songInfo?.name || songInfo?.songName || songInfo?.title || meta.name || ''
  const singer = songInfo?.singer || songInfo?.artist || songInfo?.author || meta.singer || ''
  return `${source}:name:${name}:${singer}`.toLowerCase()
}

class SubscriptionManager {
  private subscriptions: Subscription[] = []
  private runningIds = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor() {
    this.subscriptions = this.load()
  }

  private load() {
    ensureSubscriptionsFile()
    try {
      const parsed = JSON.parse(fs.readFileSync(subscriptionsFile, 'utf8'))
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
      }))
    } catch {
      return []
    }
  }

  private save() {
    ensureSubscriptionsFile()
    fs.writeFileSync(subscriptionsFile, JSON.stringify(this.subscriptions, null, 2))
  }

  private touch(subscription: Subscription) {
    subscription.updatedAt = Date.now()
    this.save()
  }

  list() {
    return this.subscriptions
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
    this.save()
    return this.subscriptions.length !== before
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
  }

  stopScheduler() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
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

  private getExistingDownloadedKeys() {
    const keys = new Set<string>()
    for (const item of readDownloadIndex()) {
      if (item.songInfo) keys.add(getSongKey(item.songInfo))
      keys.add(`${item.source}:${item.songId}`)
    }
    return keys
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
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
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

  async run(id: string) {
    const subscription = this.get(id)
    if (!subscription) throw new Error('Subscription not found')
    if (this.runningIds.has(id)) return subscription

    this.runningIds.add(id)
    subscription.lastRunStatus = 'running'
    subscription.lastError = ''
    subscription.lastCheckedAt = Date.now()
    this.touch(subscription)

    try {
      const existingKeys = this.getExistingDownloadedKeys()
      const knownKeys = new Set([...subscription.downloadedKeys, ...existingKeys])
      const songs = await this.fetchSongs(subscription)
      const configuredMaxTasks = Number(appConfig.subscription.maxTasksPerRun || 0)
      const maxTasksPerRun = configuredMaxTasks > 0 ? configuredMaxTasks : Number.POSITIVE_INFINITY
      const taskCreateDelayMs = Math.max(0, Number(appConfig.subscription.taskCreateDelayMs || 0))
      let created = 0

      for (const song of songs) {
        if (created >= maxTasksPerRun) break
        const key = getSongKey(song)
        if (!key || knownKeys.has(key)) continue
        downloadTaskManager.createTask({
          songInfo: song,
          source: subscription.source,
          options: subscription.options,
        })
        knownKeys.add(key)
        subscription.downloadedKeys.push(key)
        created += 1
        if (taskCreateDelayMs > 0) await sleep(taskCreateDelayMs)
      }

      subscription.downloadedKeys = Array.from(new Set(subscription.downloadedKeys)).slice(-MAX_STORED_KEYS)
      subscription.lastRunStatus = 'success'
      subscription.lastFoundCount = songs.length
      subscription.lastCreatedCount = created
      subscription.lastUpdatedAt = Date.now()
      subscription.lastError = ''
      this.touch(subscription)
      return subscription
    } catch (error: any) {
      subscription.lastRunStatus = 'failed'
      subscription.lastError = error.message || String(error)
      this.touch(subscription)
      throw error
    } finally {
      this.runningIds.delete(id)
    }
  }
}

export const subscriptionManager = new SubscriptionManager()
