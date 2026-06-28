import fs from 'node:fs'
import path from 'node:path'
// @ts-ignore copied music SDK helper is JavaScript.
import { httpFetch } from '../modules/utils/request.js'
// @ts-ignore copied music SDK helper is JavaScript.
import { weapi } from '../modules/utils/musicSdk/wy/utils/crypto.js'
import { appConfig } from '../config'

const NETEASE_COOKIE_SOURCE_NAME = '网易云 Cookie'

const QUALITY_LEVEL_MAP: Record<string, { level: string, encodeType: string }> = {
  flac24bit: { level: 'hires', encodeType: 'flac' },
  flac: { level: 'lossless', encodeType: 'flac' },
  wav: { level: 'lossless', encodeType: 'flac' },
  ape: { level: 'lossless', encodeType: 'flac' },
  '320k': { level: 'exhigh', encodeType: 'mp3' },
  '192k': { level: 'higher', encodeType: 'mp3' },
  '128k': { level: 'standard', encodeType: 'mp3' },
}

const normalizeCookie = (cookie: string) => String(cookie || '')
  .replace(/^cookie:\s*/i, '')
  .replace(/[\r\n]+/g, '; ')
  .trim()

const parseCookieFileText = (text: string) => {
  const netscapePairs: string[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split('\t')
    if (parts.length >= 7) {
      const name = parts[5]?.trim()
      const value = parts.slice(6).join('\t').trim()
      if (name && value) netscapePairs.push(`${name}=${value}`)
    }
  }
  if (netscapePairs.length) return netscapePairs.join('; ')
  return text
}

const readCookieFile = () => {
  const cookieFile = appConfig.netease?.cookieFile
  if (!cookieFile) return ''
  const filePath = path.resolve(process.cwd(), cookieFile)
  try {
    if (!fs.existsSync(filePath)) return ''
    return parseCookieFileText(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return ''
  }
}

export const getNeteaseCookie = () => {
  const configuredCookie = normalizeCookie(appConfig.netease?.cookie || appConfig.netease?.cookies || '')
  return configuredCookie || normalizeCookie(readCookieFile())
}

export const isNeteaseCookieResolverEnabled = () => !!getNeteaseCookie()

const getCsrfToken = (cookie: string) => {
  const match = cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

const getNeteaseSongId = (songInfo: any) => {
  const value = songInfo?.songmid || songInfo?.songId || songInfo?.id || songInfo?.meta?.songId
  const id = String(value || '').replace(/^wy_/, '').trim()
  if (!/^\d+$/.test(id)) throw new Error('网易云 Cookie 解析缺少有效 songId')
  return id
}

const getQualityLevel = (quality: string) => {
  const level = QUALITY_LEVEL_MAP[quality]
  if (!level) throw new Error(`网易云 Cookie 解析不支持音质 ${quality}`)
  return level
}

const getResponseError = (body: any, item: any) => {
  if (body?.message) return String(body.message)
  if (item?.message) return String(item.message)
  if (item?.freeTrialInfo) return '仅返回试听片段'
  if (item?.fee === 1) return '需要有效会员 Cookie'
  return '未返回下载链接'
}

export const resolveNeteaseCookieMusicUrl = async (songInfo: any, quality: string) => {
  const cookie = getNeteaseCookie()
  if (!cookie) throw new Error('未配置网易云 Cookie')

  const songId = getNeteaseSongId(songInfo)
  const csrfToken = getCsrfToken(cookie)
  const { level, encodeType } = getQualityLevel(quality)
  const requestObj = httpFetch(`https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=${encodeURIComponent(csrfToken)}`, {
    method: 'post',
    headers: {
      Cookie: cookie,
      Referer: `https://music.163.com/song?id=${songId}`,
      origin: 'https://music.163.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    form: weapi({
      ids: `[${songId}]`,
      level,
      encodeType,
      csrf_token: csrfToken,
    }),
    timeout: 30000,
  })

  const { body, statusCode } = await requestObj.promise
  if (statusCode !== 200 || body?.code !== 200) {
    throw new Error(`接口返回 ${statusCode || body?.code || 'unknown'}：${getResponseError(body, null)}`)
  }

  const item = Array.isArray(body?.data) ? body.data[0] : null
  if (!item?.url) {
    throw new Error(getResponseError(body, item))
  }

  return {
    url: item.url,
    type: quality,
    sourceName: NETEASE_COOKIE_SOURCE_NAME,
    raw: item,
  }
}

export const getNeteaseCookieSourceName = () => NETEASE_COOKIE_SOURCE_NAME
