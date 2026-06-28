import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024

export const readBody = async (req: IncomingMessage): Promise<string> => {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    let settled = false

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    req.on('data', chunk => {
      if (settled) return
      const buffer = Buffer.from(chunk)
      received += buffer.length
      if (received > MAX_REQUEST_BODY_BYTES) {
        fail(new Error('Request body too large'))
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', fail)
  })
}

export const readJson = async <T = any>(req: IncomingMessage): Promise<T> => {
  const body = await readBody(req)
  if (!body.trim()) return {} as T
  return JSON.parse(body)
}

export const sendJson = (res: ServerResponse, status: number, payload: any) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

export const sendError = (res: ServerResponse, status: number, message: string, extra: Record<string, any> = {}) => {
  sendJson(res, status, { success: false, error: message, ...extra })
}

export const notFound = (res: ServerResponse) => {
  sendError(res, 404, 'Not found')
}

export const methodNotAllowed = (res: ServerResponse) => {
  sendError(res, 405, 'Method not allowed')
}
