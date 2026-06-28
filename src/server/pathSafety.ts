import path from 'node:path'

export const sanitizeFilenamePart = (value: any): string => {
  const text = String(value || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  return text || 'Unknown'
}

export const limitFilename = (value: string, max = 180): string => {
  if (value.length <= max) return value
  return value.slice(0, max).trim()
}

export const resolveInside = (root: string, filename: string): string => {
  const clean = filename.replace(/\\/g, '/')
  if (!clean || clean.includes('../') || clean.startsWith('/') || clean.startsWith('..')) {
    throw new Error('Invalid filename')
  }
  const resolved = path.resolve(root, clean)
  const rootResolved = path.resolve(root)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error('Invalid filename')
  }
  return resolved
}
