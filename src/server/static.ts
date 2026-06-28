import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
}

export const serveStatic = (req: IncomingMessage, res: ServerResponse, pathname: string): boolean => {
  const publicDir = path.resolve(process.cwd(), 'public')
  const cleanPath = pathname === '/' ? '/index.html' : pathname
  const target = path.resolve(publicDir, '.' + decodeURIComponent(cleanPath))

  if (target !== publicDir && !target.startsWith(publicDir + path.sep)) {
    res.writeHead(403)
    res.end('Forbidden')
    return true
  }

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return false

  const ext = path.extname(target).toLowerCase()
  res.writeHead(200, {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
  })
  fs.createReadStream(target).pipe(res)
  return true
}
