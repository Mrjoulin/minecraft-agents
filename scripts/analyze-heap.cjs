#!/usr/bin/env node
'use strict'
/*
 * Streaming analyzer for V8 .heapsnapshot files (one pass over "nodes" and
 * "strings", "edges" skipped — those are what makes DevTools choke on multi-GB
 * snapshots). Prints the top constructors by self_size and by node count, plus
 * every node type whose name looks chunk/leak-related, so we can tell a
 * chunk-column leak (Column / Chunk / Uint8Array / Buffer dominance) from a
 * listener or string leak.
 *
 * Usage: node scripts/analyze-heap.js <file.heapsnapshot> [topN=30]
 */
const fs = require('fs')

const file = process.argv[2]
const TOP_N = Math.max(1, Number(process.argv[3] || 30))
if (!file) {
  console.error('usage: node scripts/analyze-heap.js <file.heapsnapshot> [topN]')
  process.exit(2)
}

const CHUNK = 4 << 20
const NAME_BITS = 1 << 25 // key = typeIdx * NAME_BITS + stringIdx

let fd
try { fd = fs.openSync(file, 'r') } catch (e) { console.error('cannot open:', e.message); process.exit(1) }
const fsize = fs.fstatSync(fd).size
const startedAt = Date.now()

let NF = 6, iType = 0, iName = 1, iSelf = 3
let typeNames = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'native', 'synthetic', 'concatenated string', 'sliced string', 'symbol', 'bigint']
let nodeCount = -1
let metaSeen = false
let nodesClosed = false

const byKey = new Map()      // typeIdx*NAME_BITS+nameIdx -> [count, selfSize]
const byTypeSize = new Map() // typeIdx -> total self_size
let nodePos = 0, curType = 0, curName = 0
let totalSelf = 0

let phase = 'head'           // head -> nodes -> seekStrings -> strings -> done
let carry = ''
let bytesRead = 0
let lastProgress = 0

// strings pass state
let wanted = new Set()       // string indices to resolve (top nodes)
const resolved = new Map()   // idx -> string
const interestRe = /column|chunk|section|light|palett|buffer|typed|array|uint|int8|block|long|vec3|entity|path|goal|movement|mesh|mat4|registry|queue|listener|closure|string/i
const interestIdx = new Set()
let sIdx = 0, inStr = false, mode = 0, uCount = 0, uVal = 0, curStr = ''

const topKeys = { size: [], count: [] }

function grabArray (text, key) {
  const i = text.indexOf(`"${key}":`)
  if (i < 0) return null
  const start = text.indexOf('[', i)
  if (start < 0) return null
  let depth = 0
  for (let j = start; j < text.length; j++) {
    const c = text[j]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) { try { return JSON.parse(text.slice(start, j + 1)) } catch { return null } }
    }
  }
  return null
}

function tryMeta (text) {
  if (metaSeen || !text.includes('"node_types"')) return
  const fields = grabArray(text, 'node_fields')
  const types = grabArray(text, 'node_types')
  if (fields && types) {
    NF = fields.length
    iType = Math.max(0, fields.indexOf('type'))
    iName = Math.max(0, fields.indexOf('name'))
    iSelf = Math.max(0, fields.indexOf('self_size'))
    if (Array.isArray(types[0])) typeNames = types[0]
    const mc = text.match(/"node_count":\s*(\d+)/)
    nodeCount = mc ? Number(mc[1]) : -1
    metaSeen = true
    console.error(`[meta] node_count=${nodeCount} fields=${fields.join(',')}`)
  }
}

function feedNodes (part) {
  const re = /-?\d+/g
  let m
  while ((m = re.exec(part)) !== null) {
    const f = nodePos % NF
    const v = +m[0]
    if (f === iType) curType = v
    else if (f === iName) curName = v
    else if (f === iSelf) {
      totalSelf += v
      byTypeSize.set(curType, (byTypeSize.get(curType) || 0) + v)
      const key = curType * NAME_BITS + curName
      const agg = byKey.get(key)
      if (agg) { agg[0]++; agg[1] += v } else byKey.set(key, [1, v])
    }
    nodePos++
  }
}

function runNodes () {
  const text = carry
  const close = text.indexOf(']')
  if (close >= 0) {
    feedNodes(text.slice(0, close))
    nodesClosed = true
    phase = 'seekStrings'
    carry = text.slice(close + 1)
    afterNodes()
    return
  }
  const c = text.lastIndexOf(',')
  if (c < 0) return // keep everything as carry
  feedNodes(text.slice(0, c))
  carry = text.slice(c) // keep the trailing comma
}

function afterNodes () {
  const arr = [...byKey.entries()]
  topKeys.size = arr.slice().sort((a, b) => b[1][1] - a[1][1]).slice(0, TOP_N)
  topKeys.count = arr.slice().sort((a, b) => b[1][0] - a[1][0]).slice(0, TOP_N)
  wanted = new Set()
  for (const [k] of topKeys.size) wanted.add(k % NAME_BITS)
  for (const [k] of topKeys.count) wanted.add(k % NAME_BITS)
}

function feedStrings (text) {
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (mode === 2) { // collecting \uXXXX
      uVal = uVal * 16 + Number.parseInt(c, 16)
      if (--uCount === 0) { curStr += String.fromCharCode(uVal); mode = 0 }
      continue
    }
    if (mode === 1) { // after a backslash
      if (c === 'u') { mode = 2; uCount = 4; uVal = 0 } else {
        curStr += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' })[c] || c
        mode = 0
      }
      continue
    }
    if (!inStr) {
      if (c === '"') { inStr = true; curStr = '' }
      else if (c === ']') { phase = 'done'; report(); return }
      continue
    }
    if (c === '\\') { mode = 1; continue }
    if (c === '"') {
      const idx = sIdx++
      if (wanted.has(idx) || (interestIdx.size < 500 && interestRe.test(curStr))) {
        resolved.set(idx, curStr)
        if (interestRe.test(curStr) && interestIdx.size < 500) interestIdx.add(idx)
      }
      inStr = false
      continue
    }
    curStr += c
  }
}

const fmt = b => b >= (1 << 30) ? (b / (1 << 30)).toFixed(2) + ' GB' : (b / (1 << 20)).toFixed(1) + ' MB'
const label = k => {
  const t = Math.floor(k / NAME_BITS)
  const n = resolved.get(k % NAME_BITS)
  return `${typeNames[t] || 'type' + t} "${n === undefined ? 'str#' + (k % NAME_BITS) : n}"`
}

function report () {
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`\n=== ${file} (${fmt(fsize)} scanned in ${secs}s) ===`)
  console.log(`nodes parsed: ${nodePos}${nodeCount > 0 ? ` / ${nodeCount * NF} expected` : ''}  |  total self_size: ${fmt(totalSelf)}`)
  if (!nodesClosed) console.log('WARNING: nodes array not closed — file truncated?')

  const line = ([k, [count, size]]) => `${label(k).padEnd(52)} count=${String(count).padStart(9)}  self=${fmt(size).padStart(9)}`
  console.log(`\n--- top ${TOP_N} by self_size ---`)
  for (const e of topKeys.size) console.log(line(e))
  console.log(`\n--- top ${TOP_N} by node count ---`)
  for (const e of topKeys.count) console.log(line(e))

  const interesting = [...byKey.entries()]
    .filter(([k]) => interestIdx.has(k % NAME_BITS))
    .sort((a, b) => b[1][1] - a[1][1])
    .slice(0, 40)
  console.log('\n--- chunk/leak-related names (by self_size) ---')
  for (const e of interesting) console.log(line(e))

  console.log('\n--- by node type ---')
  for (const [t, size] of [...byTypeSize.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${(typeNames[t] || 'type' + t).padEnd(22)} self=${fmt(size).padStart(9)}`)
  }
}

function fail () {
  if (!global.__reported) {
    global.__reported = true
    console.error('\n[analyze] stream ended early — partial report follows')
    report()
    process.exit(1)
  }
}

const stream = fs.createReadStream(file, { fd, autoClose: true, highWaterMark: CHUNK })
stream.on('data', buf => {
  bytesRead += buf.length
  if (bytesRead - lastProgress >= (512 << 20)) {
    lastProgress = bytesRead
    console.error(`[progress] ${(bytesRead / (1 << 20)).toFixed(0)} MB / ${(fsize / (1 << 20)).toFixed(0)} MB, phase=${phase}, nodes=${nodePos / NF | 0}`)
  }
  const text = carry + buf.toString('latin1')
  if (phase === 'head') {
    tryMeta(text)
    const i = text.indexOf('"nodes":[')
    if (i >= 0) { phase = 'nodes'; carry = text.slice(i + 9); runNodes() } else carry = text.length > 65536 ? text.slice(-65536) : text
  } else if (phase === 'nodes') {
    carry = text; runNodes()
  } else if (phase === 'seekStrings') {
    const i = text.indexOf('"strings":[')
    if (i >= 0) { phase = 'strings'; carry = text.slice(i + 11); feedStrings(carry) } else carry = text.length > 4096 ? text.slice(-64) : text
  } else if (phase === 'strings') {
    feedStrings(text) // char-by-char state (inStr/mode/curStr) survives chunk boundaries
    carry = ''
  }
})
stream.on('end', () => {
  if (phase !== 'done') { fail(); return }
  if (!global.__reported) { global.__reported = true; report() }
})
stream.on('error', err => { console.error('read error:', err.message); fail() })
