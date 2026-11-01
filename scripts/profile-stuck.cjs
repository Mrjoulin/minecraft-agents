#!/usr/bin/env node
'use strict'
/*
 * Capture a CPU profile of a (possibly frozen) Node process through the V8
 * inspector protocol. V8 services inspector interrupts and runs the sampling
 * profiler on its own thread, so this works even when the target's event loop
 * is stuck in a synchronous JS loop — which is exactly when we need it.
 *
 * Usage: node scripts/profile-stuck.js [port=9229] [durationMs=8000]
 * Writes logs/stuck-profile-<ts>.json and prints the hottest frames.
 */
const fs = require('fs')
const path = require('path')
const http = require('http')

const port = Number(process.argv[2] || 9229)
const durationMs = Number(process.argv[3] || 8000)
const root = path.resolve(__dirname, '..')

function getTargets () {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/json/list' }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

const send = (ws, id, method, params) => new Promise((resolve, reject) => {
  const onMsg = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id === id) {
      ws.removeEventListener('message', onMsg)
      if (msg.error) reject(new Error(method + ': ' + JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  }
  ws.addEventListener('message', onMsg)
  ws.send(JSON.stringify({ id, method, params }))
})

async function main () {
  const targets = await getTargets()
  const node = targets.find(t => t.type === 'node') || targets[0]
  if (!node || !node.webSocketDebuggerUrl) {
    console.error('no inspector target on port', port, JSON.stringify(targets).slice(0, 400))
    process.exit(1)
  }
  console.log('connecting to', node.title, node.webSocketDebuggerUrl)
  const ws = new WebSocket(node.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

  let id = 0
  await send(ws, ++id, 'Profiler.enable')
  await send(ws, ++id, 'Profiler.setSamplingInterval', { interval: 200 }) // microseconds
  await send(ws, ++id, 'Profiler.start')
  console.log(`profiling for ${durationMs} ms...`)
  await new Promise(r => setTimeout(r, durationMs))
  const stop = await Promise.race([
    send(ws, ++id, 'Profiler.stop'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Profiler.stop timed out (main thread never serviced the interrupt?)')), 30000))
  ])
  ws.close()

  const profile = stop.profile
  const out = path.join(root, 'logs', `stuck-profile-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(profile))
  console.log('profile written:', out)

  const frames = new Map()
  for (const n of profile.nodes) frames.set(n.id, n.callFrame)
  const byId = new Map()
  for (const n of profile.nodes) byId.set(n.id, n)
  // Self time per call frame via hitCount; children attribution skipped (not needed for hotspots).
  const totalHits = profile.nodes.reduce((s, n) => s + (n.hitCount || 0), 0)
  const agg = new Map()
  for (const n of profile.nodes) {
    if (!n.hitCount) continue
    const cf = n.callFrame
    const key = `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').replace(/^file:\/\/\/?/, '')}:${cf.lineNumber + 1}`
    agg.set(key, (agg.get(key) || 0) + n.hitCount)
  }
  const rows = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
  console.log(`\n=== hottest frames (${totalHits} samples, ${(profile.timeDeltas || []).reduce((a, b) => a + b, 0) / 1000 | 0} ms) ===`)
  for (const [key, hits] of rows) {
    console.log(`${String(hits).padStart(6)}  ${(100 * hits / totalHits).toFixed(1)}%  ${key}`)
  }
  ws.close?.()
}

main().catch(err => { console.error('profile-stuck failed:', err.message); process.exit(1) })
