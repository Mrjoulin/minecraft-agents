#!/usr/bin/env node
'use strict'
/*
 * Stage-3 metrics aggregator (ROADMAP.md): goal completion, completion time,
 * orders issued, LLM cost per goal, worker stats, ToM accuracy — from run-*.jsonl.
 *
 * Usage:
 *   node scripts/stage-metrics.cjs                    # every logs/run-*.jsonl, table + batch summary
 *   node scripts/stage-metrics.cjs logs/run-A.jsonl   # specific runs
 *   node scripts/stage-metrics.cjs --jsonl out.jsonl  # also append per-run JSON lines
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
let jsonlOut = null
const files = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--jsonl') jsonlOut = path.resolve(ROOT, args[++i])
  else files.push(args[i].includes('/') ? args[i] : path.join(ROOT, 'logs', args[i]))
}
if (files.length === 0) {
  files.push(...fs.readdirSync(path.join(ROOT, 'logs'))
    .filter(f => /^run-.*\.jsonl$/.test(f))
    .map(f => path.join(ROOT, 'logs', f)))
}

function readEvents (file) {
  const text = fs.readFileSync(file, 'utf8').trim()
  if (!text) return []
  return text.split('\n').map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

function parseHut (text) {
  // "north wall 15/15, south wall 13/13, east wall 6/9, west wall 9/9, roof 25/25"
  const re = /([a-z_]+(?: wall|roof)?)\s+(\d+)\/(\d+)/gi
  let built = 0
  let total = 0
  let m
  while ((m = re.exec(text))) { built += Number(m[2]); total += Number(m[3]) }
  return { built, total, pct: total ? built / total : 0 }
}

function analyze (file) {
  const events = readEvents(file)
  const kinds = new Map()
  for (const e of events) kinds.set(e.kind, (kinds.get(e.kind) || 0) + 1)
  const last = events[events.length - 1] || { t: 0 }
  const hutText = [...events].reverse().find(e => e.kind === 'gm' && /^Hut:/.test(e.text || ''))
  const hut = hutText ? parseHut(hutText.text) : { built: 0, total: 0, pct: 0 }
  const door = events.find(e => e.kind === 'gm' && /hung the door|crafted a crafting table/.test(e.text || ''))
  const completed = Boolean(door) || (hut.total > 0 && hut.pct >= 1)
  const reveal = events.find(e => e.kind === 'reveal')
  const revealRows = reveal?.rows || []
  const traitOk = revealRows.filter(r => r.score?.trait).length
  const motiveOk = revealRows.filter(r => r.score?.motive).length
  const llmTokens = events.filter(e => e.kind === 'llm').reduce((s, e) => s + (e.tokens || 0), 0)
  const llmCalls = kinds.get('llm') || 0
  const rewards = events.filter(e => e.kind === 'incentive' && e.incentive === 'reward').length
  const punishments = events.filter(e => e.kind === 'incentive' && e.incentive === 'punish').length
  const heapEvents = events.filter(e => e.kind === 'heap' && typeof e.heapMb === 'number' && e.heapMb > 0)
  const maxHeapMb = heapEvents.length ? Math.max(...heapEvents.map(e => e.heapMb)) : null
  const workers = {}
  for (const e of events) {
    if (e.kind === 'status' && e.final && e.collected !== undefined) {
      workers[e.agent] = { collected: e.collected, delivered: e.delivered, placed: e.placed ?? 0 }
    }
  }
  const blocksPlaced = Object.values(workers).reduce((s, w) => s + w.placed, 0)
  return {
    run: path.basename(file, '.jsonl').replace(/^run-/, ''),
    sessionSec: Math.round((last.t || 0) / 1000),
    completed,
    completionTimeSec: completed && door ? Math.round(door.t / 1000) : null,
    hutBuilt: hut.built,
    hutTotal: hut.total,
    hutPct: Math.round(100 * hut.pct),
    blocksPlaced,
    orders: kinds.get('order') || 0,
    ordersLegacy: 0,
    rewards,
    punishments,
    llmCalls,
    llmTokens,
    tokensPerGoal: llmCalls ? Math.round(llmTokens / 1) : 0,
    llmFinalFailures: (kinds.get('error') || 0) > 0
      ? events.filter(e => e.kind === 'error' && /after 5 attempts/.test(e.message || '')).length
      : 0,
    errors: kinds.get('error') || 0,
    traitOk, traitTotal: revealRows.length,
    motiveOk,
    maxHeapMb,
    workers
  }
}

const rows = files.map(analyze).sort((a, b) => a.run.localeCompare(b.run))

if (jsonlOut) {
  fs.appendFileSync(jsonlOut, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
}

const pad = (v, n) => String(v ?? '-').padStart(n)
console.log('run'.padEnd(22) + pad('sec', 6) + pad('done', 6) + pad('hut%', 6) + pad('blocks', 7) +
  pad('orders', 7) + pad('rew', 4) + pad('pun', 4) + pad('llm', 5) + pad('tokens', 8) + pad('err', 5) + pad('maxHeap', 8) + ' ToM(t/m)')
for (const r of rows) {
  console.log(r.run.padEnd(22) + pad(r.sessionSec, 6) + pad(r.completed ? 'YES' : 'no', 6) +
    pad(`${r.hutBuilt}/${r.hutTotal}`, 6) + pad(r.blocksPlaced, 7) + pad(r.orders, 7) +
    pad(r.rewards, 4) + pad(r.punishments, 4) + pad(r.llmCalls, 5) + pad(r.llmTokens, 8) +
    pad(r.errors, 5) + pad(r.maxHeapMb === null ? '-' : r.maxHeapMb + 'M', 8) +
    ` ${r.traitOk}/${r.traitTotal}:${r.motiveOk}/${r.traitTotal}`)
}

const done = rows.filter(r => r.completed)
const times = done.map(r => r.completionTimeSec).filter(Boolean)
const batch = {
  runs: rows.length,
  completed: done.length,
  completionRate: rows.length ? +(done.length / rows.length).toFixed(2) : 0,
  medianCompletionTimeSec: times.length ? times.sort((a, b) => a - b)[Math.floor(times.length / 2)] : null,
  totalOrders: rows.reduce((s, r) => s + r.orders, 0),
  totalLlmTokens: rows.reduce((s, r) => s + r.llmTokens, 0),
  tokensPerGoalMedian: rows.length ? [...rows].sort((a, b) => a.llmTokens - b.llmTokens)[Math.floor(rows.length / 2)].llmTokens : 0
}
console.log('\n=== batch (stage-3 metric box) ===')
console.log(JSON.stringify(batch, null, 2))
