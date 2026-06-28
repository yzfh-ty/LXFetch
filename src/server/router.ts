import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appConfig, downloadsDir } from '../config'
import { QUALITY_FALLBACK_ORDER } from '../common/constants'
import { isAdminRequest, requireAdmin } from './auth'
import { deleteDownloadedFile, getDownloadIndexItem, readDownloadIndex, upsertDownloadIndex } from './downloadIndex'
import { downloadTaskManager } from './downloadTaskManager'
import { extractSongMetadata, collectMetadata, verifyFileMetadata, writeTags } from './metadataResolver'
import {
  getLeaderboardBoards,
  getLeaderboardList,
  getSongListDetail,
  getSongLists,
  getSongListTags,
  getSupportedPlatforms,
  getUserPlaylist,
  resolveMusicUrl,
  searchMusic,
  searchSongLists,
} from './musicResolver'
import { methodNotAllowed, notFound, readJson, sendError, sendJson } from './http'
import { resolveInside } from './pathSafety'
import { serveStatic } from './static'
import * as customSourceHandlers from './customSourceHandlers'
import { subscriptionManager } from './subscriptionManager'
import { isNeteaseCookieResolverEnabled } from './neteaseCookieResolver'

const sendDownloadedFile = (res: ServerResponse, filename: string) => {
  const filePath = resolveInside(downloadsDir, filename)
  if (!fs.existsSync(filePath)) throw new Error('File not found')
  const stat = fs.statSync(filePath)
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filename))}`,
  })
  fs.createReadStream(filePath).pipe(res)
}

const rebuildSongInfoFromIndex = (item: any) => {
  return item.songInfo || {
    id: item.songId,
    songmid: item.songId,
    name: item.name,
    singer: item.singer,
    albumName: item.album,
    albumId: item.albumId,
    source: item.source,
    quality: item.quality,
  }
}

export const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
    const pathname = decodeURIComponent(urlObj.pathname)

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,x-admin-password',
      })
      res.end()
      return
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, {
        success: true,
        adminRequired: !!appConfig.auth.adminPassword,
        download: {
          maxConcurrent: appConfig.download.maxConcurrent,
          throttleBytesPerSecond: appConfig.download.throttleBytesPerSecond,
          embedCover: appConfig.download.embedCover,
          embedLyric: appConfig.download.embedLyric,
          writeTags: appConfig.download.writeTags,
          verifyMetadata: appConfig.download.verifyMetadata,
        },
        subscription: {
          maxTasksPerRun: appConfig.subscription.maxTasksPerRun,
          taskCreateDelayMs: appConfig.subscription.taskCreateDelayMs,
        },
        netease: {
          cookieResolverEnabled: isNeteaseCookieResolverEnabled(),
        },
        qualityFallbackOrder: QUALITY_FALLBACK_ORDER,
        platforms: getSupportedPlatforms(),
      })
      return
    }

    if (pathname === '/api/admin/verify') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      const body = await readJson(req).catch(() => ({}))
      const password = req.headers['x-admin-password'] || body.password
      const ok = !appConfig.auth.adminPassword || password === appConfig.auth.adminPassword
      sendJson(res, ok ? 200 : 401, { success: ok })
      return
    }

    if (pathname === '/api/sources/validate') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      return customSourceHandlers.handleValidate(req, res)
    }
    if (pathname === '/api/sources/import') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      return customSourceHandlers.handleImport(req, res)
    }
    if (pathname === '/api/sources/upload') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      return customSourceHandlers.handleUpload(req, res)
    }
    if (pathname === '/api/sources') {
      if (req.method !== 'GET') return methodNotAllowed(res)
      return customSourceHandlers.handleList(req, res)
    }
    if (pathname === '/api/sources/toggle') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      return customSourceHandlers.handleToggle(req, res)
    }
    if (pathname === '/api/sources/delete') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      return customSourceHandlers.handleDelete(req, res)
    }
    if (pathname === '/api/sources/reorder') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      return customSourceHandlers.handleReorder(req, res)
    }

    if (pathname === '/api/music/platforms' && req.method === 'GET') {
      sendJson(res, 200, { success: true, platforms: getSupportedPlatforms() })
      return
    }

    if (pathname === '/api/music/search' && req.method === 'GET') {
      const source = urlObj.searchParams.get('source') || ''
      const keyword = urlObj.searchParams.get('keyword') || ''
      const page = Number(urlObj.searchParams.get('page') || 1)
      const limit = Number(urlObj.searchParams.get('limit') || 30)
      if (!source || !keyword) return sendError(res, 400, 'Missing source or keyword')
      const result = await searchMusic(source, keyword, page, limit)
      sendJson(res, 200, { success: true, ...result })
      return
    }

    if (pathname === '/api/music/songList/tags' && req.method === 'GET') {
      const source = urlObj.searchParams.get('source') || ''
      if (!source) return sendError(res, 400, 'Missing source')
      const result = await getSongListTags(source)
      sendJson(res, 200, { success: true, ...result })
      return
    }

    if (pathname === '/api/music/songList/list' && req.method === 'GET') {
      const source = urlObj.searchParams.get('source') || ''
      const sortId = urlObj.searchParams.get('sortId') || 'hot'
      const tagId = urlObj.searchParams.get('tagId') || ''
      const page = Number(urlObj.searchParams.get('page') || 1)
      if (!source) return sendError(res, 400, 'Missing source')
      const result = await getSongLists(source, sortId, tagId, page)
      sendJson(res, 200, { success: true, ...result })
      return
    }

    if (pathname === '/api/music/songList/detail' && req.method === 'GET') {
      const source = urlObj.searchParams.get('source') || ''
      const id = urlObj.searchParams.get('id') || ''
      const page = Number(urlObj.searchParams.get('page') || 1)
      if (!source || !id) return sendError(res, 400, 'Missing source or id')
      const result = await getSongListDetail(source, id, page)
      sendJson(res, 200, { success: true, ...result })
      return
    }

    if (pathname === '/api/music/songList/search' && req.method === 'GET') {
      const source = urlObj.searchParams.get('source') || ''
      const text = urlObj.searchParams.get('text') || ''
      const page = Number(urlObj.searchParams.get('page') || 1)
      if (!source || !text) return sendError(res, 400, 'Missing source or text')
      const result = await searchSongLists(source, text, page)
      sendJson(res, 200, { success: true, ...result })
      return
    }

    if (pathname === '/api/music/songList/userPlaylist' && req.method === 'GET') {
      const source = urlObj.searchParams.get('source') || ''
      const uid = urlObj.searchParams.get('uid') || ''
      const page = Number(urlObj.searchParams.get('page') || 1)
      if (!source || !uid) return sendError(res, 400, 'Missing source or uid')
      const result = await getUserPlaylist(source, uid, page)
      sendJson(res, 200, { success: true, ...result })
      return
    }

    if (pathname === '/api/music/leaderboard/boards' && req.method === 'GET') {
      const source = urlObj.searchParams.get('source') || ''
      if (!source) return sendError(res, 400, 'Missing source')
      const result = await getLeaderboardBoards(source)
      sendJson(res, 200, { success: true, ...result })
      return
    }

    if (pathname === '/api/music/leaderboard/list' && req.method === 'GET') {
      const source = urlObj.searchParams.get('source') || ''
      const bangid = urlObj.searchParams.get('bangid') || ''
      const page = Number(urlObj.searchParams.get('page') || 1)
      if (!source || !bangid) return sendError(res, 400, 'Missing source or bangid')
      const result = await getLeaderboardList(source, bangid, page)
      sendJson(res, 200, { success: true, ...result })
      return
    }

    if (pathname === '/api/music/resolve') {
      if (req.method !== 'POST') return methodNotAllowed(res)
      const body = await readJson(req)
      const result = await resolveMusicUrl({
        songInfo: body.songInfo,
        quality: 'best',
        allowQualityFallback: true,
        enableAutoSwitchApiSource: body.enableAutoSwitchApiSource,
      })
      sendJson(res, 200, { success: true, ...result })
      return
    }

    if (pathname === '/api/subscriptions') {
      if (req.method === 'GET') {
        sendJson(res, 200, { success: true, subscriptions: subscriptionManager.list() })
        return
      }
      if (req.method === 'POST') {
        if (!requireAdmin(req, res)) return
        const body = await readJson(req)
        const subscription = subscriptionManager.create({
          type: body.type,
          source: body.source,
          targetId: body.targetId,
          title: body.title,
          intervalMinutes: body.intervalMinutes,
          options: body.options,
        })
        sendJson(res, 200, { success: true, subscription })
        return
      }
      return methodNotAllowed(res)
    }

    const subscriptionRunMatch = pathname.match(/^\/api\/subscriptions\/([^/]+)\/run$/)
    if (subscriptionRunMatch) {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      const subscription = await subscriptionManager.run(subscriptionRunMatch[1])
      sendJson(res, 200, { success: true, subscription })
      return
    }

    const subscriptionToggleMatch = pathname.match(/^\/api\/subscriptions\/([^/]+)\/toggle$/)
    if (subscriptionToggleMatch) {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      const body = await readJson(req).catch(() => ({}))
      const subscription = subscriptionManager.toggle(subscriptionToggleMatch[1], body.enabled !== false)
      sendJson(res, 200, { success: true, subscription })
      return
    }

    const subscriptionMatch = pathname.match(/^\/api\/subscriptions\/([^/]+)$/)
    if (subscriptionMatch) {
      if (req.method !== 'DELETE') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      const deleted = subscriptionManager.delete(subscriptionMatch[1])
      if (!deleted) return notFound(res)
      sendJson(res, 200, { success: true })
      return
    }

    if (pathname === '/api/download/tasks') {
      if (req.method === 'GET') {
        sendJson(res, 200, { success: true, tasks: downloadTaskManager.listTasks() })
        return
      }
      if (req.method === 'POST') {
        if (!requireAdmin(req, res)) return
        const body = await readJson(req)
        const task = downloadTaskManager.createTask({
          songInfo: body.songInfo,
          source: body.source,
          url: body.url,
          options: body.options,
        })
        sendJson(res, 200, { success: true, task })
        return
      }
      return methodNotAllowed(res)
    }

    const taskStopMatch = pathname.match(/^\/api\/download\/tasks\/([^/]+)\/stop$/)
    if (taskStopMatch) {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      const task = downloadTaskManager.stopTask(taskStopMatch[1])
      sendJson(res, 200, { success: true, task })
      return
    }

    const taskRetryMatch = pathname.match(/^\/api\/download\/tasks\/([^/]+)\/retry$/)
    if (taskRetryMatch) {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      const task = downloadTaskManager.retryTask(taskRetryMatch[1])
      sendJson(res, 200, { success: true, task })
      return
    }

    const taskMatch = pathname.match(/^\/api\/download\/tasks\/([^/]+)$/)
    if (taskMatch) {
      if (req.method !== 'GET') return methodNotAllowed(res)
      const task = downloadTaskManager.getTask(taskMatch[1])
      if (!task) return notFound(res)
      sendJson(res, 200, { success: true, task })
      return
    }

    if (pathname === '/api/download/files') {
      if (req.method !== 'GET') return methodNotAllowed(res)
      sendJson(res, 200, { success: true, files: readDownloadIndex() })
      return
    }

    const fileVerifyMatch = pathname.match(/^\/api\/download\/files\/(.+)\/verify$/)
    if (fileVerifyMatch) {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      const filename = fileVerifyMatch[1]
      const item = getDownloadIndexItem(filename)
      if (!item) return notFound(res)
      const filePath = resolveInside(downloadsDir, filename)
      const songInfo = rebuildSongInfoFromIndex(item)
      const metadata = extractSongMetadata(songInfo, item.quality)
      const verify = await verifyFileMetadata(filePath, metadata, appConfig.download)
      const updated = upsertDownloadIndex(metadata, filename, verify, songInfo)
      sendJson(res, 200, { success: true, file: updated })
      return
    }

    const fileRewriteMatch = pathname.match(/^\/api\/download\/files\/(.+)\/rewrite-tags$/)
    if (fileRewriteMatch) {
      if (req.method !== 'POST') return methodNotAllowed(res)
      if (!requireAdmin(req, res)) return
      const filename = fileRewriteMatch[1]
      const item = getDownloadIndexItem(filename)
      if (!item) return notFound(res)
      const filePath = resolveInside(downloadsDir, filename)
      const songInfo = rebuildSongInfoFromIndex(item)
      const collected = await collectMetadata(songInfo, item.quality, appConfig.download)
      await writeTags(filePath, collected, appConfig.download)
      const verify = await verifyFileMetadata(filePath, collected, appConfig.download)
      const updated = upsertDownloadIndex(collected, filename, verify, songInfo)
      sendJson(res, 200, { success: true, file: updated })
      return
    }

    const fileMatch = pathname.match(/^\/api\/download\/files\/(.+)$/)
    if (fileMatch) {
      const filename = fileMatch[1]
      if (req.method === 'GET') {
        sendDownloadedFile(res, filename)
        return
      }
      if (req.method === 'DELETE') {
        if (!requireAdmin(req, res)) return
        deleteDownloadedFile(filename)
        sendJson(res, 200, { success: true })
        return
      }
      return methodNotAllowed(res)
    }

    if (pathname.startsWith('/api/')) {
      notFound(res)
      return
    }

    if (!serveStatic(req, res, pathname)) {
      if (pathname !== '/') {
        serveStatic(req, res, '/index.html')
      } else {
        notFound(res)
      }
    }
  } catch (error: any) {
    sendError(res, 500, error.message || String(error))
  }
}
