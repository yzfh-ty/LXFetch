import fs from 'node:fs'
import path from 'node:path'

export const ensureJsonFile = (filePath: string, fallback: any) => {
  if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true })
  if (!fs.existsSync(filePath)) writeJsonFileAtomic(filePath, fallback, { backup: false })
}

const parseJsonFile = <T>(filePath: string): T | undefined => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return undefined
  }
}

export const readJsonFile = <T>(filePath: string, fallback: T): T => {
  ensureJsonFile(filePath, fallback)
  const parsed = parseJsonFile<T>(filePath)
  if (parsed !== undefined) return parsed
  const backup = parseJsonFile<T>(`${filePath}.bak`)
  return backup !== undefined ? backup : fallback
}

export const writeTextFileAtomic = (
  filePath: string,
  content: string,
  options: { backup?: boolean } = {},
) => {
  if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmpPath, content)
  try {
    if (options.backup !== false && fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, `${filePath}.bak`) } catch {}
    }
    fs.renameSync(tmpPath, filePath)
  } catch (error) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch {}
    throw error
  }
}

export const writeJsonFileAtomic = (
  filePath: string,
  value: any,
  options: { backup?: boolean } = {},
) => {
  writeTextFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options)
}
