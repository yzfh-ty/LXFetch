import type { IncomingMessage, ServerResponse } from 'node:http'
import { appConfig } from '../config'
import { sendError } from './http'

export const isAdminRequest = (req: IncomingMessage): boolean => {
  if (!appConfig.auth.adminPassword) return true
  const password = req.headers['x-admin-password']
  return password === appConfig.auth.adminPassword
}

export const requireAdmin = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (isAdminRequest(req)) return true
  sendError(res, 401, 'Unauthorized')
  return false
}
