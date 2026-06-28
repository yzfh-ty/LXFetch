export const getSongKey = (songInfo: any) => {
  const meta = songInfo?.meta || {}
  const text = (value: any) => String(value || '').trim()
  const source = text(songInfo?.source || meta.source)
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
  const rawIdText = text(rawId)
  if (rawIdText) {
    let id = rawIdText
    const prefix = `${source}_`
    if (source && id.startsWith(prefix)) id = id.slice(prefix.length)
    return `${source || 'unknown'}:${id}`
  }
  const name = text(songInfo?.name || songInfo?.songName || songInfo?.title || meta.name)
  const singer = text(songInfo?.singer || songInfo?.artist || songInfo?.author || meta.singer)
  if (!name && !singer) return ''
  return `${source || 'unknown'}:name:${name}:${singer}`.toLowerCase()
}
