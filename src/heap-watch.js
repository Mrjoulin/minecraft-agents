// Diagnostic sampler for memory leaks: per-bot loaded-chunk-column counts plus
// process memory, optionally an automatic V8 heap snapshot once the heap crosses
// a threshold (the empty 0-byte snapshot from --heapsnapshot-near-heap-limit showed
// the flag fires too late to flush). Inert unless started (index.js, HEAP_WATCH=1);
// all dependencies are injected so the sampler is unit-testable.
import v8 from 'node:v8'

const MB = 1048576

/**
 * Take one memory sample. Returns { heapMb, rssMb, externalMb, columns, snapshot? }
 * where `columns` maps bot username -> number of loaded chunk columns.
 */
export function sampleMemory (getBots, {
  memory = () => process.memoryUsage(),
  writeSnapshot = name => v8.writeHeapSnapshot(name),
  snapshotAtMb = 0
} = {}) {
  const mem = memory()
  const columns = {}
  for (const bot of getBots()) {
    try { columns[bot.username] = bot.world.getColumns().length } catch { /* bot not spawned yet */ }
  }
  const sample = {
    heapMb: Math.round(mem.heapUsed / MB),
    rssMb: Math.round(mem.rss / MB),
    externalMb: Math.round((mem.external + mem.arrayBuffers) / MB),
    columns
  }
  if (snapshotAtMb > 0 && mem.heapUsed > snapshotAtMb * MB) {
    // Synchronous: blocks the event loop for a while, but reliably flushes the file.
    sample.snapshot = writeSnapshot()
  }
  return sample
}

/**
 * Sample every intervalMs and pass each sample to onSample (e.g. record('heap', m)).
 * A snapshot is written at most once per watcher: either when the heap crosses
 * snapshotAtMb, or unconditionally at snapshotAtMs into the watch. The time trigger
 * exists because a CPU-bound main thread (e.g. pathfinder A*) starves the sampling
 * interval, so the size threshold alone can miss the window entirely — it fired
 * 0 times before the first OOM. Returns a stop function.
 */
export function startHeapWatch (getBots, onSample, opts = {}) {
  const deps = {
    memory: opts.memory || (() => process.memoryUsage()),
    writeSnapshot: opts.writeSnapshot || (name => v8.writeHeapSnapshot(name)),
    snapshotAtMb: Number(opts.snapshotAtMb || process.env.HEAP_SNAPSHOT_AT_MB || 0)
  }
  let snapshotted = false
  const takeSnapshot = note => {
    if (snapshotted) return
    snapshotted = true
    try {
      onSample({ snapshot: deps.writeSnapshot(), note, heapMb: -1, rssMb: -1, externalMb: -1, columns: {} })
    } catch (err) {
      console.error('[heap-watch] snapshot failed:', err.message)
    }
  }
  const timer = setInterval(() => {
    try {
      const sample = sampleMemory(getBots, deps)
      if (!snapshotted && deps.snapshotAtMb > 0 && sample.heapMb > deps.snapshotAtMb) {
        takeSnapshot(`heap ${sample.heapMb}MB > ${deps.snapshotAtMb}MB`)
        return
      }
      onSample(sample)
    } catch (err) {
      console.error('[heap-watch]', err.message)
    }
  }, Number(opts.intervalMs || 5000))
  timer.unref?.()
  const snapshotAtMs = Number(opts.snapshotAtMs || process.env.HEAP_SNAPSHOT_AT_MS || 0)
  const timeTrigger = snapshotAtMs > 0 ? setTimeout(() => takeSnapshot(`at ${snapshotAtMs}ms`), snapshotAtMs) : null
  timeTrigger?.unref?.()
  return () => {
    clearInterval(timer)
    if (timeTrigger) clearTimeout(timeTrigger)
  }
}
