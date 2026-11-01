import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pruneColumns } from '../src/skills.js'
import { sampleMemory, startHeapWatch } from '../src/heap-watch.js'

const MB = 1048576

/** Fake bot whose world records unloadColumn calls. chunkX/chunkZ kept raw (strings, as real getColumns returns). */
const makeBot = (x, z, cols = [], username = 'Tester') => {
  const unloaded = []
  const bot = {
    username,
    entity: { position: { x, y: 71, z } },
    world: {
      getColumns: () => cols.map(([chunkX, chunkZ]) => ({ chunkX, chunkZ, column: {} })),
      unloadColumn: (cx, cz) => unloaded.push([cx, cz])
    }
  }
  return { bot, unloaded }
}

test('pruneColumns unloads only columns beyond the Chebyshev radius, keeps the bot chunk', () => {
  // Bot at block (5, 5) → chunk (0, 0); radius 12 keeps Chebyshev distance ≤ 12.
  const { bot, unloaded } = makeBot(5, 5, [
    [0, 0], [12, 12], [-3, 7],          // keep: d=0, d=12, d=7
    ['13', '0'], [0, -13], [20, 20]     // drop: d=13 (string keys must parse), d=13, d=20
  ])
  assert.equal(pruneColumns(bot, 12), 3)
  assert.deepEqual(unloaded.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])), [[0, -13], [13, 0], [20, 20]])
})

test('pruneColumns derives the bot chunk from its block position, not (0,0)', () => {
  // Block (250, -8) → chunk (15, -1): (2, 0) is at distance 13 → dropped; (15, -1) itself kept.
  const { bot, unloaded } = makeBot(250, -8, [[2, 0], [15, -1]])
  assert.equal(pruneColumns(bot, 12), 1)
  assert.deepEqual(unloaded, [[2, 0]])
})

test('pruneColumns tolerates bots without a world and malformed keys', () => {
  assert.equal(pruneColumns({}, 12), 0)
  assert.equal(pruneColumns(null, 12), 0)
  const { bot, unloaded } = makeBot(0, 0, [[undefined, 3], [Number.NaN, 1]])
  assert.equal(pruneColumns(bot, 12), 0)
  assert.equal(unloaded.length, 0)
})

test('sampleMemory counts columns per bot and omits snapshot below threshold', () => {
  const a = makeBot(0, 0, [[0, 0], [1, 0]], 'Ann').bot
  const b = makeBot(100, 100, [[6, 6]], 'Bob').bot
  const sample = sampleMemory(
    () => [a, b],
    {
      memory: () => ({ heapUsed: 100 * MB, rss: 200 * MB, external: 10 * MB, arrayBuffers: 5 * MB }),
      snapshotAtMb: 500
    }
  )
  assert.deepEqual(sample.columns, { Ann: 2, Bob: 1 })
  assert.equal(sample.heapMb, 100)
  assert.equal(sample.rssMb, 200)
  assert.equal(sample.externalMb, 15)
  assert.equal(sample.snapshot, undefined)
})

test('sampleMemory writes a snapshot once the heap crosses the threshold', () => {
  const { bot } = makeBot(0, 0, [[0, 0]])
  const names = []
  const sample = sampleMemory(
    () => [bot],
    {
      memory: () => ({ heapUsed: 4 * MB, rss: 5 * MB, external: 0, arrayBuffers: 0 }),
      writeSnapshot: name => { names.push(name); return 'snap.heapsnapshot' },
      snapshotAtMb: 3
    }
  )
  assert.equal(sample.snapshot, 'snap.heapsnapshot')
  assert.equal(names.length, 1)
})

test('startHeapWatch samples on the interval and stops cleanly', async () => {
  const { bot } = makeBot(0, 0, [[0, 0]])
  const seen = []
  const stop = startHeapWatch(() => [bot], sample => seen.push(sample), {
    intervalMs: 10,
    memory: () => ({ heapUsed: 1 * MB, rss: 2 * MB, external: 0, arrayBuffers: 0 }),
    snapshotAtMb: 0
  })
  await new Promise(resolve => setTimeout(resolve, 60))
  stop()
  const count = seen.length
  assert.ok(count >= 2, `expected ≥2 samples, got ${count}`)
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(seen.length, count, 'no samples after stop()')
})

test('startHeapWatch fires the time-based snapshot once, below the size threshold', async () => {
  const { bot } = makeBot(0, 0, [[0, 0]])
  const seen = []
  const stop = startHeapWatch(() => [bot], sample => seen.push(sample), {
    intervalMs: 10,
    memory: () => ({ heapUsed: 1 * MB, rss: 2 * MB, external: 0, arrayBuffers: 0 }),
    writeSnapshot: () => 'timed.heapsnapshot',
    snapshotAtMb: 500,
    snapshotAtMs: 25
  })
  await new Promise(resolve => setTimeout(resolve, 80))
  stop()
  const snaps = seen.filter(s => s.snapshot)
  assert.equal(snaps.length, 1, `exactly one snapshot expected, got ${snaps.length}`)
  assert.equal(snaps[0].snapshot, 'timed.heapsnapshot')
  assert.match(snaps[0].note, /at 25ms/)
})
