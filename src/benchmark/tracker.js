// Benchmark metrics tracker (roadmap Шаг 0): samples the bot's position on an interval
// and derives path length, stuck time and path-error counts for a scenario run.
// pathLength / stuckMs are pure and unit-tested; createTracker only wires a timer.

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/** Pure: total length of the walked polyline, in blocks. */
export function pathLength (samples) {
  let total = 0
  for (let i = 1; i < samples.length; i++) total += dist(samples[i].pos, samples[i - 1].pos)
  return Math.round(total * 10) / 10
}

/**
 * Pure: the longest span (ms) during which the bot moved less than `moveDistance`
 * blocks. Returns 0 when no such span reached `thresholdMs` — sampling jitter and
 * slow-but-steady walks must not count as stuck. Any displacement ≥ `moveDistance`
 * (including a teleport) resets the span; the time before it was already counted.
 */
export function stuckMs (samples, { thresholdMs = 3000, moveDistance = 1 } = {}) {
  let worst = 0
  let anchor = 0
  for (let i = 1; i < samples.length; i++) {
    if (dist(samples[i].pos, samples[anchor].pos) >= moveDistance) anchor = i
    else worst = Math.max(worst, samples[i].t - samples[anchor].t)
  }
  return worst >= thresholdMs ? worst : 0
}

/**
 * Poll `bot.entity.position` every `intervalMs`. `onSample` (if given) receives each
 * sample — the runner uses it to count lastPathError changes. snapshot() summarizes.
 */
export function createTracker (bot, { intervalMs = 500, onSample = null } = {}) {
  let timer = null
  let t0 = 0
  let samples = []

  const tick = () => {
    const pos = bot.entity?.position
    if (!pos) return
    const sample = Object.freeze({ t: Date.now() - t0, pos: { x: pos.x, y: pos.y, z: pos.z } })
    samples = [...samples, sample]
    onSample?.(sample)
  }

  return Object.freeze({
    start () {
      t0 = Date.now()
      samples = []
      tick()
      timer = setInterval(tick, intervalMs)
      timer.unref?.()
    },
    stop () {
      if (timer) clearInterval(timer)
      timer = null
      tick()
    },
    snapshot () {
      return Object.freeze({
        distance: pathLength(samples),
        stuckMs: stuckMs(samples),
        samples: samples.length
      })
    }
  })
}
