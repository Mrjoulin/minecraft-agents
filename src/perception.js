// Perception layer (roadmap Шаг 1): bounded, structured observations over the Mineflayer bot.
// Pure functions of the bot object so tests can drive them with doubles. Every spatial
// record carries world coordinates. "Unknown" (chunk not loaded) is distinguishable from
// "checked but empty" (an empty list / known:'air'). The LLM decides what to do with the
// data; this module only reads it.
import Vec3 from 'vec3'
import { config } from './config.js'

const P = config.params.perception || {}

export const OBSERVATION_RADIUS = P.observation_radius ?? 24
export const ENTITY_LIMIT = P.entity_limit ?? 12
export const SCAN_LIMIT = P.scan_limit ?? 24

const round1 = n => Math.round(n * 10) / 10

/** Plain rounded {x,y,z} (JSON-safe) from anything position-like; null when absent. */
export function serializePos (p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null
  return Object.freeze({ x: round1(p.x), y: round1(p.y), z: round1(p.z) })
}

const scanCategories = Object.freeze({
  logs: /_log$/,
  planks: /_planks$/,
  hazards: /^(lava|fire|cactus|magma|sweet_berry_bush|powder_snow)$/,
  containers: /^(chest|trapped_chest|barrel)$/,
  workstations: /^(crafting_table|furnace)$/
})

/** Same night window as skills.isDark, kept local so perception stays dependency-light. */
export function dayPhase (timeOfDay) {
  if (!Number.isFinite(timeOfDay)) return 'unknown'
  if (timeOfDay >= 12600 && timeOfDay <= 23300) return 'night'
  if (timeOfDay > 11500 && timeOfDay < 12600) return 'sunset'
  return 'day'
}

export function getSelf (bot) {
  const e = bot.entity
  if (!e?.position) return null
  return Object.freeze({
    position: serializePos(e.position),
    yaw: Number.isFinite(e.yaw) ? Math.round(e.yaw) : null,
    pitch: Number.isFinite(e.pitch) ? round1(e.pitch) : null,
    health: Number.isFinite(bot.health) ? bot.health : null,
    food: Number.isFinite(bot.food) ? bot.food : null,
    onGround: Boolean(e.onGround)
  })
}

export function getEnvironment (bot) {
  const dimension = String(bot.game?.dimension || 'unknown').replace(/^minecraft:/, '')
  const timeOfDay = Number.isFinite(bot.time?.timeOfDay) ? bot.time.timeOfDay : null
  const weather = bot.thunderState > 0 ? 'thunder' : bot.isRaining ? 'rain' : 'clear'
  return Object.freeze({ dimension, timeOfDay, dayPhase: dayPhase(timeOfDay), weather })
}

/** Items, free storage slots (9..44), held item and worn armor. */
export function getInventory (bot) {
  const inv = bot.inventory
  if (!inv) return Object.freeze({ items: [], freeSlots: null, held: null, armor: [] })
  const items = (inv.items() || []).map(i => Object.freeze({ name: i.name, count: i.count }))
  let freeSlots = null
  if (Array.isArray(inv.slots)) {
    freeSlots = 0
    for (let i = 9; i <= 44; i++) if (!inv.slots[i]) freeSlots++
  }
  const held = bot.heldItem ? Object.freeze({ name: bot.heldItem.name, count: bot.heldItem.count }) : null
  const armor = [5, 6, 7, 8].map(i => inv.slots?.[i]).filter(Boolean).map(i => i.name)
  return Object.freeze({ items, freeSlots, held, armor })
}

/** Nearest entities of the wanted kinds (null types = any), closest first. */
export function getEntities (bot, { radius = OBSERVATION_RADIUS, types = null, limit = ENTITY_LIMIT } = {}) {
  const me = bot.entity?.position
  if (!me) return []
  const wanted = types ? new Set(types) : null
  return Object.values(bot.entities || {})
    .filter(e => e !== bot.entity && e.position && e.name && (!wanted || wanted.has(e.name)))
    .map(e => Object.freeze({
      name: e.name,
      username: e.username || null,
      type: e.type || 'unknown',
      position: serializePos(e.position),
      distance: round1(e.position.distanceTo(me))
    }))
    .filter(e => e.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
}

const matcherFor = blockTypes => {
  const patterns = blockTypes.map(t => (t instanceof RegExp ? t : new RegExp(`^${t}$`)))
  return b => patterns.some(p => p.test(b.name))
}

/** Candidates of the given block kinds around `center` (default: the bot), closest first. */
export function findBlocks (bot, blockTypes, { center = null, radius = OBSERVATION_RADIUS, limit = SCAN_LIMIT } = {}) {
  const origin = center || bot.entity?.position
  if (!origin || !bot.findBlocks) return []
  const from = bot.entity?.position
  const extra = from ? Math.ceil(from.distanceTo(origin)) + 1 : 0
  return (bot.findBlocks({ matching: matcherFor(blockTypes), maxDistance: radius + extra, count: limit * 4 }) || [])
    .map(p => ({ position: p, name: bot.blockAt(p)?.name || null, distance: round1(p.distanceTo(origin)) }))
    .filter(e => e.name && e.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(e => Object.freeze({ name: e.name, position: serializePos(e.position), distance: e.distance }))
}

/**
 * One block in detail. known:false + reason means "cannot say" (unloaded chunk),
 * known:true with name 'air' means "checked, empty".
 */
export function inspectBlock (bot, position) {
  const p = position instanceof Vec3 ? position.floored() : new Vec3(position.x, position.y, position.z)
  const block = bot.blockAt?.(p)
  if (!block) return Object.freeze({ known: false, reason: 'chunk_not_loaded', position: serializePos(p), name: null })
  return Object.freeze({
    known: true,
    reason: null,
    name: block.name,
    position: serializePos(p),
    boundingBox: block.boundingBox || null,
    distance: bot.entity?.position ? round1(p.distanceTo(bot.entity.position)) : null,
    above: bot.blockAt?.(p.offset(0, 1, 0))?.name ?? null,
    below: bot.blockAt?.(p.offset(0, -1, 0))?.name ?? null
  })
}

/** Bounded look-around: interest blocks by category + entities around a center. */
export function scanArea (bot, { center = null, radius = OBSERVATION_RADIUS, categories = Object.keys(scanCategories), limit = SCAN_LIMIT } = {}) {
  const origin = center || bot.entity?.position
  if (!origin) {
    return Object.freeze({ center: null, radius, blocks: [], entities: [] })
  }
  const wanted = categories.map(c => [c, scanCategories[c]]).filter(([, re]) => re)
  const from = bot.entity?.position
  const extra = from ? Math.ceil(from.distanceTo(origin)) + 1 : 0
  const blocks = (bot.findBlocks?.({
    matching: b => wanted.some(([, re]) => re.test(b.name)),
    maxDistance: radius + extra,
    count: limit * 8
  }) || [])
    .map(p => {
      const name = bot.blockAt?.(p)?.name
      if (!name) return null
      const category = wanted.find(([, re]) => re.test(name))?.[0]
      if (!category) return null
      const distance = round1(p.distanceTo(origin))
      return distance <= radius ? { category, name, position: serializePos(p), distance } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
  return Object.freeze({ center: serializePos(origin), radius, blocks: Object.freeze(blocks), entities: getEntities(bot, { radius, limit: ENTITY_LIMIT }) })
}

function serializeGoal (goal) {
  if (!goal) return null
  if (Number.isFinite(goal.x) && Number.isFinite(goal.z)) return Object.freeze({ x: goal.x, y: goal.y ?? null, z: goal.z })
  if (goal.entity) return Object.freeze({ follow: goal.entity.username || goal.entity.name || 'entity' })
  return Object.freeze({ dynamic: true })
}

/** The full structured observation (roadmap Шаг 1 shape: self/environment/nearby/inventory/navigation). */
export function getObservation (bot, { radius = OBSERVATION_RADIUS } = {}) {
  const scan = scanArea(bot, { radius, categories: ['logs', 'hazards', 'containers', 'workstations'] })
  return Object.freeze({
    self: getSelf(bot),
    environment: getEnvironment(bot),
    nearby: Object.freeze({
      blocks: scan.blocks,
      entities: scan.entities,
      hazards: Object.freeze(scan.blocks.filter(b => b.category === 'hazards'))
    }),
    inventory: getInventory(bot),
    navigation: Object.freeze({
      isMoving: Boolean(bot.pathfinder?.goal),
      target: serializeGoal(bot.pathfinder?.goal),
      stuck: null // real stuck tracking arrives with navigation operations (roadmap Шаг 2)
    })
  })
}

const fmtPos = p => p ? `(${p.x}, ${p.y}, ${p.z})` : '?'

/**
 * Compact multi-line rendering of an observation for an LLM prompt.
 * withInventory=false drops the item line (the worker prompt states carried amounts its own way).
 */
export function describeObservation (obs, { withInventory = true } = {}) {
  if (!obs?.self) return 'Observation: not available yet (world not loaded).'
  const { self, environment: env, nearby, inventory } = obs
  const lines = []
  lines.push(`You are at ${fmtPos(self.position)} — ${env.dayPhase}, ${env.dimension}, weather ${env.weather}; health ${self.health ?? '?'}, food ${self.food ?? '?'}.`)
  const byCategory = new Map()
  for (const b of nearby.blocks) {
    if (!byCategory.has(b.category)) byCategory.set(b.category, [])
    byCategory.get(b.category).push(b)
  }
  const blockText = [...byCategory.entries()]
    .map(([cat, list]) => `${cat}: ${list.length} (nearest ${list[0].distance}m at ${fmtPos(list[0].position)})`)
    .join('; ')
  lines.push(`Around you: ${blockText || 'nothing of interest'}.`)
  lines.push(nearby.entities.length
    ? `Creatures: ${nearby.entities.slice(0, 5).map(e => `${e.username || e.name} ${e.distance}m`).join(', ')}.`
    : 'Creatures: none.')
  if (withInventory && inventory) {
    const items = inventory.items.map(i => `${i.count} ${i.name}`).join(', ')
    lines.push(`Inventory: ${items || 'empty'}; free slots: ${inventory.freeSlots ?? '?'}.`)
  }
  return lines.join('\n')
}
