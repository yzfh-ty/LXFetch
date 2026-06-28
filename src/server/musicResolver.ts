// @ts-ignore copied lxserver SDK is JavaScript.
import musicSdkRaw from '../modules/utils/musicSdk/index.js'
import { callUserApiGetMusicUrl, isSourceSupported } from './userApi'

const musicSdk = musicSdkRaw as any
const QUALITY_FALLBACK_ORDER = ['master', 'flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k']
const AUTO_QUALITY_VALUES = new Set(['best', 'highest', 'auto'])

export const initMusicSdk = async () => {
  if (musicSdk?.init) await musicSdk.init()
}

export const getSupportedPlatforms = () => {
  return (musicSdk.sources || []).map((source: any) => ({
    id: source.id,
    name: source.name,
    resolverEnabled: isSourceSupported(source.id),
    songListSupported: !!musicSdk[source.id]?.songList,
    leaderboardSupported: !!musicSdk[source.id]?.leaderboard,
    userPlaylistSupported: !!musicSdk[source.id]?.userPlaylist,
  }))
}

export const searchMusic = async (source: string, keyword: string, page = 1, limit = 30) => {
  if (!source || !musicSdk[source]?.musicSearch?.search) throw new Error(`Unsupported source: ${source}`)
  const result = await musicSdk[source].musicSearch.search(keyword, page, limit)
  if (Array.isArray(result)) return { source, list: result, total: result.length, page, limit }
  return { source, ...result }
}

const getSourceFeature = (source: string, feature: string) => {
  if (!source || !musicSdk[source]?.[feature]) throw new Error(`Source ${source} does not support ${feature}`)
  return musicSdk[source][feature]
}

export const normalizeSongInfo = (songInfo: any) => {
  if (!songInfo) return songInfo
  const meta = songInfo.meta || {}

  if (!songInfo.types && meta) songInfo.types = meta.qualitys || meta.types
  if (!songInfo._types && meta) songInfo._types = meta._qualitys || meta._types
  if (!songInfo.albumName && meta.albumName) songInfo.albumName = meta.albumName
  if (!songInfo.albumId && meta.albumId) songInfo.albumId = meta.albumId
  if (!songInfo.img && meta.picUrl) songInfo.img = meta.picUrl
  if (!songInfo.name && meta.name) songInfo.name = meta.name
  if (!songInfo.singer && meta.singer) songInfo.singer = meta.singer
  if (!songInfo.source && meta.source) songInfo.source = meta.source
  if (!songInfo.interval && meta.interval) songInfo.interval = meta.interval

  if (!songInfo.songmid) {
    if (meta.songId) {
      songInfo.songmid = meta.songId
    } else if (songInfo.id) {
      const sourcePrefix = `${songInfo.source}_`
      songInfo.songmid = typeof songInfo.id === 'string' && songInfo.id.startsWith(sourcePrefix)
        ? songInfo.id.slice(sourcePrefix.length)
        : songInfo.id
    }
  }

  switch (songInfo.source) {
    case 'wy':
      if (!songInfo.id && meta.songId) songInfo.id = Number(meta.songId)
      if (!songInfo.songmid && songInfo.id) songInfo.songmid = String(songInfo.id)
      break
    case 'kg':
      if (!songInfo.hash && meta.hash) songInfo.hash = meta.hash
      break
    case 'tx': {
      if (!songInfo.strMediaMid && meta.strMediaMid) songInfo.strMediaMid = meta.strMediaMid
      if (!songInfo.albumMid && meta.albumMid) songInfo.albumMid = meta.albumMid
      const metaSongId = String(meta.songId || '')
      if (/^\d+$/.test(metaSongId)) songInfo.songId = metaSongId
      break
    }
    case 'mg':
      if (!songInfo.copyrightId && meta.copyrightId) songInfo.copyrightId = meta.copyrightId
      if (!songInfo.lrcUrl && meta.lrcUrl) songInfo.lrcUrl = meta.lrcUrl
      if (!songInfo.songId) songInfo.songId = songInfo.songmid
      break
  }

  return songInfo
}

const normalizeListResult = (result: any) => {
  if (result?.list && Array.isArray(result.list)) {
    result.list = result.list.map(normalizeSongInfo)
  }
  return result
}

export const getSongListTags = async (source: string) => {
  const songList = getSourceFeature(source, 'songList')
  if (!songList.getTags) throw new Error(`Source ${source} does not support songList tags`)
  const result = await songList.getTags()
  return {
    source,
    ...result,
    sortList: songList.sortList || result?.sortList || [],
  }
}

export const getSongLists = async (source: string, sortId = 'hot', tagId = '', page = 1) => {
  const songList = getSourceFeature(source, 'songList')
  if (!songList.getList) throw new Error(`Source ${source} does not support songList list`)
  return { source, ...(await songList.getList(sortId, tagId, page)) }
}

export const getSongListDetail = async (source: string, id: string, page = 1) => {
  const songList = getSourceFeature(source, 'songList')
  if (!songList.getListDetail) throw new Error(`Source ${source} does not support songList detail`)
  return normalizeListResult({ source, ...(await songList.getListDetail(id, page)) })
}

export const searchSongLists = async (source: string, text: string, page = 1) => {
  const songList = getSourceFeature(source, 'songList')
  if (!songList.search) throw new Error(`Source ${source} does not support songList search`)
  return { source, ...(await songList.search(text, page)) }
}

export const getUserPlaylist = async (source: string, uid: string, page = 1) => {
  const userPlaylist = getSourceFeature(source, 'userPlaylist')
  if (!userPlaylist.getList) throw new Error(`Source ${source} does not support userPlaylist`)
  return { source, ...(await userPlaylist.getList(uid, page)) }
}

export const getLeaderboardBoards = async (source: string) => {
  const leaderboard = getSourceFeature(source, 'leaderboard')
  if (!leaderboard.getBoards) throw new Error(`Source ${source} does not support leaderboard boards`)
  return { source, ...(await leaderboard.getBoards()) }
}

export const getLeaderboardList = async (source: string, bangid: string, page = 1) => {
  const leaderboard = getSourceFeature(source, 'leaderboard')
  if (!leaderboard.getList) throw new Error(`Source ${source} does not support leaderboard list`)
  return normalizeListResult({ source, ...(await leaderboard.getList(bangid, page)) })
}

const resolveRedirects = async (url: string): Promise<string> => {
  if (!url.startsWith('http')) return url
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    return response.url || url
  } catch {
    return url
  }
}

const collectAvailableQualities = (songInfo: any) => {
  const values = new Set<string>()
  const add = (quality: any) => {
    if (typeof quality === 'string' && quality.trim()) values.add(quality.trim())
  }
  const addFromTypes = (types: any) => {
    if (Array.isArray(types)) {
      for (const item of types) add(item?.type || item)
    } else if (types && typeof types === 'object') {
      for (const key of Object.keys(types)) add(key)
    }
  }

  addFromTypes(songInfo?.types)
  addFromTypes(songInfo?._types)
  addFromTypes(songInfo?.meta?.types)
  addFromTypes(songInfo?.meta?._types)
  addFromTypes(songInfo?.meta?.qualitys)
  addFromTypes(songInfo?.meta?._qualitys)
  return values
}

export const getQualityFallbackCandidates = (
  songInfo: any,
  requestedQuality = '128k',
  allowQualityFallback = true,
) => {
  const requested = String(requestedQuality || '128k').trim()
  const isAuto = AUTO_QUALITY_VALUES.has(requested.toLowerCase())
  const available = collectAvailableQualities(songInfo)
  const orderedAvailable = QUALITY_FALLBACK_ORDER.filter(quality => available.has(quality))

  if (isAuto) {
    const startQuality = orderedAvailable[0] || QUALITY_FALLBACK_ORDER[0]
    const startIndex = Math.max(0, QUALITY_FALLBACK_ORDER.indexOf(startQuality))
    const candidates = QUALITY_FALLBACK_ORDER.slice(startIndex)
    return allowQualityFallback ? candidates : [candidates[0] || '128k']
  }

  if (!allowQualityFallback) return [requested]

  const startIndex = QUALITY_FALLBACK_ORDER.indexOf(requested)
  if (startIndex === -1) {
    return [
      requested,
      ...QUALITY_FALLBACK_ORDER.filter(quality => quality !== requested),
    ]
  }

  const lowerOrEqual = QUALITY_FALLBACK_ORDER.slice(startIndex)
  return lowerOrEqual
}

const annotateAttempts = (attempts: any[], quality: string, fallback: any[] = []) => {
  const items = attempts.length
    ? attempts
    : [{ name: '系统', status: 'fail', message: '解析失败' }]
  return items.map(attempt => ({
    ...attempt,
    quality,
    fallback,
    message: attempt.message ? `[${quality}] ${attempt.message}` : `请求音质 ${quality}`,
  }))
}

export const resolveMusicUrl = async (input: {
  songInfo: any
  quality: string
  allowQualityFallback?: boolean
  enableAutoSwitchApiSource?: boolean
}) => {
  if (!input.songInfo?.source) throw new Error('Invalid songInfo')
  const requestedQuality = String(input.quality || '128k').trim()
  const candidates = getQualityFallbackCandidates(
    input.songInfo,
    requestedQuality,
    input.allowQualityFallback !== false,
  )
  const attempts: any[] = []
  let lastError: any = null

  for (const quality of candidates) {
    try {
      const result = await callUserApiGetMusicUrl(
        input.songInfo.source,
        input.songInfo,
        quality,
        undefined,
        undefined,
        input.enableAutoSwitchApiSource !== false,
      )
      if (result.url) result.url = await resolveRedirects(result.url)

      const resultAttempts = annotateAttempts(
        result.attempts || [{ name: '系统', status: 'success', message: '解析成功' }],
        quality,
        candidates,
      )
      if (quality !== requestedQuality) {
        resultAttempts.push({
          name: '系统',
          status: 'success',
          quality,
          fallback: candidates,
          message: AUTO_QUALITY_VALUES.has(requestedQuality.toLowerCase())
            ? `已选择最高可解析音质 ${quality}`
            : `已从 ${requestedQuality} 自动降级为 ${quality}`,
        })
      }

      return {
        ...result,
        type: result.type || quality,
        attempts: [...attempts, ...resultAttempts],
        requestedQuality,
      }
    } catch (error: any) {
      lastError = error
      attempts.push(...annotateAttempts(
        error.attempts || [{ name: '系统', status: 'fail', message: error.message || String(error) }],
        quality,
        candidates,
      ))
    }
  }

  const error: any = new Error(lastError?.message || `无法解析音质 ${requestedQuality}`)
  error.attempts = attempts
  throw error
}

export const getLyricText = async (songInfo: any): Promise<string> => {
  const source = songInfo?.source
  if (!source || !musicSdk[source]?.getLyric) return ''
  try {
    const request = musicSdk[source].getLyric(songInfo)
    const result = await (request?.promise || request)
    return result?.lyric || result?.lrc || result?.raw || ''
  } catch {
    return ''
  }
}

export const getMusicSdk = () => musicSdk
