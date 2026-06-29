import crypto from 'node:crypto'
import { appConfig } from '../config'

export interface NavidromeScanResult {
  requested: boolean
  ok: boolean
  error: string
}

const createAuthParams = () => {
  const salt = crypto.randomBytes(8).toString('hex')
  const token = crypto
    .createHash('md5')
    .update(`${appConfig.navidrome.password}${salt}`)
    .digest('hex')
  return {
    u: appConfig.navidrome.username,
    t: token,
    s: salt,
    v: appConfig.navidrome.apiVersion || '1.16.1',
    c: appConfig.navidrome.clientName || 'lxfetch',
    f: 'json',
  }
}

export const shouldScanAfterPlaylistExport = () => {
  return !!(
    appConfig.navidrome.enabled
    && appConfig.navidrome.scanAfterExport
    && appConfig.navidrome.baseUrl
    && appConfig.navidrome.username
    && appConfig.navidrome.password
  )
}

export const requestNavidromeScan = async (): Promise<NavidromeScanResult> => {
  if (!shouldScanAfterPlaylistExport()) {
    return { requested: false, ok: true, error: '' }
  }

  try {
    const baseUrl = appConfig.navidrome.baseUrl.replace(/\/+$/, '')
    const url = new URL(`${baseUrl}/rest/startScan.view`)
    for (const [key, value] of Object.entries(createAuthParams())) {
      url.searchParams.set(key, value)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 10000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      const text = await response.text()
      let payload: any = null
      try { payload = JSON.parse(text) } catch {}
      const subsonic = payload?.['subsonic-response']
      if (!response.ok || subsonic?.status === 'failed') {
        const message = subsonic?.error?.message || text || `HTTP ${response.status}`
        return { requested: true, ok: false, error: message }
      }
      return { requested: true, ok: true, error: '' }
    } finally {
      clearTimeout(timer)
    }
  } catch (error: any) {
    return { requested: true, ok: false, error: error.message || String(error) }
  }
}
