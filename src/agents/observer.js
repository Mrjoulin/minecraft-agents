// Commander's eyes: turns what is *visible* (within sight radius) into textual evidence.
// It never reads other agents' personas or internal state.
import { config } from '../config.js'
import { record } from '../events.js'
import { isDark, readChest } from '../skills.js'
import { isBuilt } from '../building.js'
import { hutProgress, describeProgress, SECTIONS } from '../blueprint.js'

const NATURAL_LOG = /_log$/
const ANIMALS = new Set(['pig', 'cow', 'sheep', 'chicken'])
const SAMPLE_MS = 1000
const AUDIT_EVERY_MS = 8000
const MAX_EVIDENCE = 60
const CHOP_NOTE_EVERY = 3
const PLACE_NOTE_EVERY = 5

export function describeActivity ({ nearFire, nearAnimal, nearChest, moving }) {
  if (nearAnimal) return `standing next to a ${nearAnimal}`
  if (nearChest) return 'at the camp chest'
  if (nearFire) return 'standing by the campfire'
  return moving ? 'moving around' : 'standing still'
}

export function createObserver ({ bot, workerNames, camp, blueprint, startedAt = Date.now() }) {
  let evidence = []
  let lastActivity = new Map()
  let seenMined = new Map(workerNames.map(n => [n, 0]))
  let attributed = new Map(workerNames.map(n => [n, 0]))
  let seenPlaced = new Map(workerNames.map(n => [n, 0]))
  let progress = hutProgress(blueprint, () => false)
  let nearChestSinceAudit = new Set()
  let lastAudit = { at: 0, count: 0 }
  let lastPos = new Map()
  let darkNoted = false
  let timer = null

  const stamp = () => `[${Math.round((Date.now() - startedAt) / 1000)}s]`

  function note (text) {
    const line = `${stamp()} ${text}`
    evidence = [...evidence, line].slice(-MAX_EVIDENCE)
    record('observation', { agent: bot.username, text })
  }

  function visibleWorker (name) {
    const e = bot.players[name]?.entity
    if (!e || !bot.entity) return null
    return e.position.distanceTo(bot.entity.position) <= config.sightRadius ? e : null
  }

  function nearestAnimalName (pos) {
    const animal = Object.values(bot.entities)
      .find(e => ANIMALS.has(e.name) && e.position.distanceTo(pos) < 3.5)
    return animal?.name || null
  }

  function sample () {
    if (!darkNoted && isDark(bot)) { darkNoted = true; note('Night has fallen; it is dark outside the camp.') }
    for (const name of workerNames) {
      const e = visibleWorker(name)
      if (!e) continue
      const prev = lastPos.get(name)
      lastPos = new Map(lastPos).set(name, e.position.clone())
      const activity = describeActivity({
        nearFire: e.position.distanceTo(camp.fire) < 5,
        nearChest: e.position.distanceTo(camp.chest) < 3,
        nearAnimal: nearestAnimalName(e.position),
        moving: prev ? prev.distanceTo(e.position) > 0.5 : false
      })
      if (e.position.distanceTo(camp.chest) < 3) nearChestSinceAudit = new Set(nearChestSinceAudit).add(name)
      if (lastActivity.get(name) !== activity) {
        lastActivity = new Map(lastActivity).set(name, activity)
        if (activity !== 'moving around' && activity !== 'standing still') note(`I see ${name} ${activity}${isDark(bot) ? ' (at night)' : ''}.`)
      }
    }
    updateHut()
    maybeAudit().catch(err => record('error', { agent: bot.username, where: 'audit', message: err.message }))
  }

  function updateHut () {
    if (!bot.entity || bot.entity.position.distanceTo(blueprint.origin) > config.sightRadius) return
    const next = hutProgress(blueprint, p => isBuilt(bot, p))
    const finished = SECTIONS.filter(s => next[s].built === next[s].total && progress[s].built < progress[s].total)
    const changed = SECTIONS.some(s => next[s].built !== progress[s].built)
    progress = next
    if (changed) record('hut', { progress })
    finished.forEach(s => note(`The hut's ${s.replace('_', ' ')} is finished.`))
  }

  async function maybeAudit () {
    if (!bot.entity || bot.entity.position.distanceTo(camp.chest) > 4) return
    if (Date.now() - lastAudit.at < AUDIT_EVERY_MS) return
    const count = await readChest(bot, camp.chest, NATURAL_LOG)
    const delta = count - lastAudit.count
    const visitors = [...nearChestSinceAudit]
    lastAudit = { at: Date.now(), count }
    nearChestSinceAudit = new Set()
    if (delta === 0) return
    const single = visitors.length === 1 ? visitors[0] : null
    if (single && delta > 0) attributed = new Map(attributed).set(single, attributed.get(single) + delta)
    note(`Chest audit: ${count} logs in the camp chest (${delta > 0 ? '+' : ''}${delta} since last audit). ` +
      `Seen at the chest since then: ${visitors.join(', ') || 'nobody I saw'}` +
      `${single ? ` → those ${delta} logs were delivered by ${single}` : ''}.`)
  }

  function nearestVisibleWorker (pos) {
    const center = pos.offset(0.5, 0.5, 0.5)
    return workerNames
      .map(n => ({ n, e: visibleWorker(n) }))
      .filter(x => x.e && x.e.position.distanceTo(center) < 5.5)
      .sort((a, b) => a.e.position.distanceTo(center) - b.e.position.distanceTo(center))
      .map(x => x.n)[0]
  }

  function onBlockUpdate (oldBlock, newBlock) {
    if (oldBlock?.name === 'air' && /_planks$/.test(newBlock?.name || '')) {
      const builder = nearestVisibleWorker(newBlock.position)
      if (!builder) return
      const total = seenPlaced.get(builder) + 1
      seenPlaced = new Map(seenPlaced).set(builder, total)
      if (total === 1 || total % PLACE_NOTE_EVERY === 0) note(`I saw ${builder} placing planks on the hut (seen so far: ${total}).`)
      return
    }
    if (!oldBlock || !NATURAL_LOG.test(oldBlock.name) || newBlock?.name !== 'air') return
    const center = oldBlock.position.offset(0.5, 0.5, 0.5)
    const [chopper] = workerNames
      .map(n => ({ n, e: visibleWorker(n) }))
      .filter(x => x.e && x.e.position.distanceTo(center) < 5.5)
      .sort((a, b) => a.e.position.distanceTo(center) - b.e.position.distanceTo(center))
      .map(x => x.n)
    if (!chopper) return
    const total = seenMined.get(chopper) + 1
    seenMined = new Map(seenMined).set(chopper, total)
    if (total === 1 || total % CHOP_NOTE_EVERY === 0) note(`I saw ${chopper} chopping logs (seen so far: ${total}).`)
  }

  /** Compact per-worker tally that goes into every review prompt. */
  function summary () {
    return [...workerNames.map(n => `${n}: seen chopping ${seenMined.get(n)} logs; seen placing ${seenPlaced.get(n)} hut blocks; chest deliveries surely by ${n}: ${attributed.get(n)}; last seen ${lastActivity.get(n) || 'never'}`), `Hut (last time I looked): ${describeProgress(progress)}`].join('\n')
  }

  return Object.freeze({
    start () {
      bot.on('blockUpdate', onBlockUpdate)
      timer = setInterval(sample, SAMPLE_MS)
    },
    stop () {
      clearInterval(timer)
      bot.off('blockUpdate', onBlockUpdate)
    },
    note,
    summary,
    hutDone: () => SECTIONS.every(s => progress[s].built === progress[s].total),
    evidence: () => evidence,
    chestCount: () => lastAudit.count
  })
}
