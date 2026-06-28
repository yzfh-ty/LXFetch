import http from 'node:http'
import { appConfig, ensureRuntimeDirs, installGlobalCompatibility } from './config'
import { handleRequest } from './server/router'
import { initUserApis } from './server/userApi'
import { initMusicSdk } from './server/musicResolver'

const start = async () => {
  ensureRuntimeDirs()
  installGlobalCompatibility()

  const loadedSources = await initUserApis()
  await initMusicSdk().catch(error => {
    console.warn('[lxfetch] musicSdk init failed:', error.message)
  })

  const server = http.createServer((req, res) => {
    void handleRequest(req, res)
  })

  server.listen(appConfig.server.port, appConfig.server.host, () => {
    console.log(`[lxfetch] listening on http://${appConfig.server.host}:${appConfig.server.port}`)
    console.log(`[lxfetch] loaded custom sources: ${loadedSources}`)
  })
}

void start().catch(error => {
  console.error('[lxfetch] failed to start:', error)
  process.exit(1)
})
