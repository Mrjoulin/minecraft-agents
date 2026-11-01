#!/usr/bin/env node
'use strict'
/*
 * Forensics on a (possibly frozen) Node process via the V8 inspector protocol:
 *   node scripts/forensics.cjs <port> heapstart            -> start sampling heap profiler
 *   node scripts/forensics.cjs <port> heapstop [out.json]  -> stop + save allocation profile
 *   node scripts/forensics.cjs <port> cpu [ms]             -> capture CPU profile of the hot loop
 *
 * All three work while the target's event loop is stuck in synchronous JS:
 * V8 services inspector interrupts at loop back-edges. The sampling heap
 * profiler reports allocation sites of memory that is STILL ALIVE at stop —
 * exactly what a leak hunt needs.
 */
const fs = require('fs')
const path = require('path')
const http = require('http')

const [, , portArg, cmd, arg1, arg2] = process.argv
const port = Number(portArg || 9229)
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

function connect (url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    const listeners = []
    let nextId = 1
    ws.onopen = () => resolve({
      call: (method, params) => new Promise((res, rej) => {
        const id = nextId++
        pending.set(id, { res, rej })
        ws.send(JSON.stringify({ id, method, params }))
      }),
      on: fn => listeners.push(fn),
      close: () => ws.close()
    })
    ws.onerror = e => reject(new Error('ws error: ' + (e.message || 'unknown')))
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(msg.method || '?') && new Error(JSON.stringify(msg.error)))
        else res(msg.result)
      } else if (msg.method) {
        for (const fn of listeners) fn(msg)
      }
    }
  })
}

async function withSession (fn) {
  const targets = await getTargets()
  const node = targets.find(t => t.type === 'node') || targets[0]
  if (!node) { console.error('no inspector target on port', port); process.exit(1) }
  const ws = await connect(node.webSocketDebuggerUrl)
  try { return await fn(ws) } finally { ws.close() }
}

async function cpu (ms) {
  await withSession(async ws => {
    await ws.call('Profiler.enable')
    await ws.call('Profiler.setSamplingInterval', { interval: 200 })
    await ws.call('Profiler.start')
    console.log(`profiling ${ms} ms...`)
    await new Promise(r => setTimeout(r, ms))
    const stop = await Promise.race([
      ws.call('Profiler.stop'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Profiler.stop timeout')), 30000))
    ])
    const out = path.join(root, 'logs', `frozen-cpu-${Date.now()}.json`)
    fs.writeFileSync(out, JSON.stringify(stop.profile))
    const agg = new Map()
    let total = 0
    for (const n of stop.profile.nodes) {
      if (!n.hitCount) continue
      total += n.hitCount
      const cf = n.callFrame
      const key = `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').replace(/^file:\/\/\/?/, '')}:${cf.lineNumber + 1}`
      agg.set(key, (agg.get(key) || 0) + n.hitCount)
    }
    console.log(`=== hottest frames (${total} samples) — ${out} ===`)
    for (const [k, h] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`${String(h).padStart(6)}  ${(100 * h / (total || 1)).toFixed(1)}%  ${k}`)
    }
  })
}

async function heapStart () {
  await withSession(async ws => {
    await ws.call('HeapProfiler.enable')
    await ws.call('HeapProfiler.startSampling', { samplingInterval: 524288 }) // 512 KB
    console.log('sampling heap profiler started (512KB interval)')
  })
}

function printAllocTree (head) {
  // self_size aggregated per call frame (sum over the subtree minus children handled by visitor)
  const rows = []
  const walk = (node, depth, parentShare) => {
    let self = node.self_size || 0
    for (const c of node.children || []) self += walk(c, depth + 1)
    const cf = node.callframe || node.callFrame || {}
    const label = `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').replace(/^file:\/\/\/?/, '')}:${(cf.lineNumber || 0) + 1}`
    rows.push({ label, total: self, depth })
    return self
  }
  walk(head, 0)
  // Aggregate per label across the whole tree (retained-ish attribution)
  const agg = new Map()
  for (const r of rows) agg.set(r.label, (agg.get(r.label) || 0) + r.total)
  console.log('=== top allocation sites (sampled, alive at stop) ===')
  for (const [k, v] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`${(v / 1048576).toFixed(1).padStart(9)} MB  ${k}`)
  }
}

async function heapStop (outArg) {
  await withSession(async ws => {
    await ws.call('HeapProfiler.enable')
    const stop = await Promise.race([
      ws.call('HeapProfiler.stopSampling'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('stopSampling timeout')), 60000))
    ])
    const out = outArg ? path.resolve(outArg) : path.join(root, 'logs', `frozen-heap-${Date.now()}.json`)
    fs.writeFileSync(out, JSON.stringify(stop.profile))
    console.log('allocation profile written:', out)
    printAllocTree(stop.profile.head)
  })
}

async function main () {
  if (cmd === 'cpu') await cpu(Number(arg1 || 6000))
  else if (cmd === 'heapstart') await heapStart()
  else if (cmd === 'heapstop') await heapStop(arg1)
  else {
    console.error('usage: forensics.cjs <port> cpu [ms] | heapstart | heapstop [out]')
    process.exit(2)
  }
}

main().catch(err => { console.error('forensics failed:', err.message); process.exit(1) })
