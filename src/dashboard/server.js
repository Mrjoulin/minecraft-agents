// Spectator dashboard: serves the page and streams events over Server-Sent Events.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'
import { record, onEvent } from '../events.js'

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html')
const HISTORY_LIMIT = 2000

export function startDashboard ({ team, goal, port = config.dashboardPort }) {
  let history = []
  let clients = new Set()

  const unsubscribe = onEvent(event => {
    history = [...history, event].slice(-HISTORY_LIMIT)
    const line = `data: ${JSON.stringify(event)}\n\n`
    for (const res of clients) {
      if (!res.destroyed) res.write(line)
    }
  })

  const server = http.createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      // A spectator closing the tab mid-session must not crash the run with an
      // unhandled stream error; drop the client instead.
      res.on('error', () => {})
      res.write(`data: ${JSON.stringify({ kind: 'hello', team, goal, viewerPort: config.viewerPort })}\n\n`)
      history.forEach(e => res.write(`data: ${JSON.stringify(e)}\n\n`))
      clients = new Set(clients).add(res)
      req.on('close', () => { clients = new Set([...clients].filter(c => c !== res)) })
      return
    }
    if (req.url === '/' || req.url.startsWith('/?')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      fs.createReadStream(PAGE).pipe(res)
      return
    }
    res.writeHead(404).end()
  })
  // A busy port must degrade to "no dashboard", not kill the whole simulation.
  let listenError = null
  const listening = new Promise(resolve => {
    server.once('listening', resolve)
    server.once('error', err => {
      listenError = err
      record('error', { where: 'dashboard', message: err.message })
      console.error('[dashboard]', err.message)
      resolve()
    })
  })
  server.listen(port, '127.0.0.1')
  return Object.freeze({
    ready: () => listening,
    port: () => (server.listening ? server.address()?.port ?? null : null),
    error: () => listenError,
    close () {
      unsubscribe()
      server.close()
      // Existing SSE connections would keep the process (and server.close()) alive forever.
      for (const res of clients) res.destroy()
      server.closeAllConnections()
    }
  })
}
