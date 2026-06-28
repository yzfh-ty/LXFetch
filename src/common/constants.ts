// Mirrors lxserver and lx-music-desktop's QUALITYS order.
export const LXSERVER_QUALITYS: string[] = ['flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k']

export const QUALITY_FALLBACK_ORDER: string[] = [...LXSERVER_QUALITYS]

const QUALITY_ALIASES: Record<string, string> = {
  mp3: '128k',
  mpga: '128k',
}

export const normalizeQuality = (quality: string) => {
  const value = String(quality || '').trim().toLowerCase()
  return QUALITY_ALIASES[value] || value
}

export const getQualityRank = (quality: string) => {
  const normalized = normalizeQuality(quality)
  const rank = QUALITY_FALLBACK_ORDER.indexOf(normalized)
  return rank === -1 ? Number.POSITIVE_INFINITY : rank
}

export const isHigherQuality = (candidate: string, current: string) => {
  return getQualityRank(candidate) < getQualityRank(current)
}
