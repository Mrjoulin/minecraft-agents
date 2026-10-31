// "Body" layer: deterministic Mineflayer actions. The LLM decides *which* skill to run, never how.
import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import { plugin as collectBlockPlugin } from 'mineflayer-collectblock'
import { config } from './config.js'
import Vec3 from 'vec3'

const { pathfinder, Movements, goals } = pathfinderPkg

const NATURAL_LOG = /^(oak|birch|spruce|jungle|acacia|dark_oak|cherry|mangrove)_log$/
const PATH = config.params.path

/** Pure: retry ladder for a pathfinder goto — each attempt widens the goal radius. */
export function pathRetryPlan (range, retries = PATH.go_near_retries, settleMs = PATH.retry_settle_ms) {
  return Array.from({ length: retries }, (_, attempt) =>
    Object.freeze({ range: range + attempt * 2, settleMs: attempt > 0 ? settleMs : 0 }))
}

/** Pure: approach offsets around a chest so a failing path plan is not retried verbatim. */
export function approachSides (chestPos) {
  return Object.freeze([chestPos, chestPos.offset(2, 0, 0), chestPos.offset(-2, 0, 0), chestPos.offset(0, 0, 2)])
}
const PROTECTED_BLOCKS = /(_planks|_door|^crafting_table|^campfire|^chest)$/

export const DIRECTIONS = Object.freeze(['north', 'south', 'east', 'west', 'any'])
const DIRECTION_VECTORS = Object.freeze({ north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] })

/** Point ~18 blocks from `origin` in a compass direction (Minecraft: north = -z). */
export function directionAnchor (origin, direction) {
  const v = DIRECTION_VECTORS[direction]
  if (!v) return null
  return origin.offset(v[0] * PATH.anchor_distance, 0, v[1] * PATH.anchor_distance)
}

const lastPathErrors = new Map()
export const lastPathError = username => lastPathErrors.get(username) || 'unknown'

export function withTimeout (promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function createBody (username) {
  const bot = mineflayer.createBot({
    host: config.mc.host,
    port: config.mc.port,
    username,
    version: config.mc.version,
    hideErrors: false
  })
  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlockPlugin)
  const ready = new Promise((resolve, reject) => {
    bot.once('spawn', () => {
      const moves = new Movements(bot)
      moves.canDig = true // lets bots climb out of holes; logs are only chopped at or above feet level
      moves.allow1by1towers = false
      moves.allowParkour = true
      moves.scafoldingBlocks = []
      // Bots may dig to get unstuck, but never through anything the team built or placed.
      bot.registry.blocksArray
        .filter(b => PROTECTED_BLOCKS.test(b.name))
        .forEach(b => moves.blocksCantBreak.add(b.id))
      bot.pathfinder.setMovements(moves)
      bot.pathfinder.thinkTimeout = PATH.think_timeout_ms
      // Unlimited A* on an unreachable goal explores the whole loaded world and exhausts the heap.
      bot.pathfinder.searchRadius = PATH.search_radius
      resolve(bot)
    })
    bot.once('error', reject)
    bot.once('kicked', reason => reject(new Error(`${username} kicked: ${JSON.stringify(reason)}`)))
  })
  return { bot, ready }
}

export async function goNear (bot, pos, range = 2, ms = PATH.skill_timeout_ms) {
  // A* sometimes stalls its first think ("Took too long to decide path to goal!"), usually
  // right after heavy activity. Clearing the goal, letting physics settle and retrying with
  // a slightly wider radius recovers it instead of failing all PATH.deposit_attempts identically.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 600))
    const goal = new goals.GoalNear(pos.x, pos.y, pos.z, range + attempt * 2)
    try {
      await withTimeout(bot.pathfinder.goto(goal), ms, `${bot.username} goNear`)
      return true
    } catch (err) {
      lastPathErrors.set(bot.username, err.message)
      bot.pathfinder.setGoal(null)
    }
  }
  return false
}

export function findPlayerEntity (bot, name) {
  return bot.players[name]?.entity || null
}

export async function goToPlayer (bot, name, range = 3, ms = PATH.skill_timeout_ms) {
  const target = findPlayerEntity(bot, name)
  if (!target) return false
  const reached = await goNear(bot, target.position, range, ms)
  if (reached) await bot.lookAt(target.position.offset(0, 1.6, 0)).catch(() => {})
  return reached
}

/** Follow a (possibly moving) player until within `range` blocks or timeout. */
export async function approachPlayer (bot, name, range = 3, ms = 40000) {
  const target = findPlayerEntity(bot, name)
  if (!target) return false
  const deadline = Date.now() + ms
  bot.pathfinder.setGoal(new goals.GoalFollow(target, Math.max(1, range - 1)), true)
  try {
    while (Date.now() < deadline) {
      const t = findPlayerEntity(bot, name)
      if (t && t.position.distanceTo(bot.entity.position) <= range) {
        await bot.lookAt(t.position.offset(0, 1.6, 0)).catch(() => {})
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    return false
  } finally {
    bot.pathfinder.setGoal(null)
  }
}

export function countItems (bot, pattern) {
  return bot.inventory.items()
    .filter(i => pattern.test(i.name))
    .reduce((sum, i) => sum + i.count, 0)
}

function findReachableLog (bot, anchor) {
  const feetY = bot.entity.position.y
  const candidates = bot.findBlocks({
    matching: b => NATURAL_LOG.test(b.name),
    maxDistance: PATH.log_search_radius,
    count: 80
  }).filter(p => p.y <= feetY + PATH.max_log_height_above_feet && p.y >= Math.floor(feetY))
  // Prefer logs near the assigned area so workers spread out; fall back to the nearest one.
  const ranked = anchor
    ? [...candidates].sort((a, b) => a.distanceTo(anchor) - b.distanceTo(anchor))
    : candidates
  return ranked[0] ? bot.blockAt(ranked[0]) : null
}

/**
 * Collect up to `n` logs. `shouldStop()` is checked between logs so personality hooks can interrupt.
 * Returns the number of logs gathered.
 */
export async function collectLogs (bot, n, { shouldStop = () => false, onLog = () => {}, anchor = null } = {}) {
  const before = countItems(bot, /_log$/)
  let failures = 0
  while (countItems(bot, /_log$/) - before < n && failures < 4) {
    if (shouldStop()) break
    const block = findReachableLog(bot, anchor)
    if (!block) break
    try {
      await withTimeout(bot.collectBlock.collect(block, { ignoreNoPath: true }), PATH.skill_timeout_ms, 'collect')
      onLog(block.position)
    } catch (err) {
      failures += 1
      // A timed-out collect keeps running inside the plugin and would hijack later walks: cancel it.
      await bot.collectBlock.cancelTask().catch(() => {})
      bot.pathfinder.setGoal(null)
    }
  }
  return countItems(bot, /_log$/) - before
}

export async function depositToChest (bot, chestPos, pattern, count) {
  // Approach from different sides so a failing path plan is not retried verbatim.
  const sides = approachSides(new Vec3(0, 0, 0))
  let attempts = 0
  while (bot.entity.position.distanceTo(chestPos) > 3.5 && attempts < PATH.deposit_attempts) {
    await goNear(bot, chestPos.plus(sides[attempts % sides.length]), 2)
    attempts += 1
  }
  if (bot.entity.position.distanceTo(chestPos) > 4.5) return 0
  const chestBlock = bot.blockAt(chestPos)
  if (!chestBlock || chestBlock.name !== 'chest') return 0
  const chest = await bot.openContainer(chestBlock)
  let deposited = 0
  try {
    for (const item of bot.inventory.items().filter(i => pattern.test(i.name))) {
      if (deposited >= count) break
      const amount = Math.min(item.count, count - deposited)
      await chest.deposit(item.type, null, amount)
      deposited += amount
    }
  } finally {
    chest.close()
  }
  return deposited
}

export async function readChest (bot, chestPos, pattern) {
  const chestBlock = bot.blockAt(chestPos)
  if (!chestBlock || chestBlock.name !== 'chest') return 0
  const chest = await bot.openContainer(chestBlock)
  try {
    return chest.containerItems()
      .filter(i => pattern.test(i.name))
      .reduce((sum, i) => sum + i.count, 0)
  } finally {
    chest.close()
  }
}

/** Throw `count` items of a kind towards a player standing nearby. */
export async function giveToPlayer (bot, playerName, pattern, count) {
  const target = findPlayerEntity(bot, playerName)
  if (!target) return 0
  await bot.lookAt(target.position.offset(0, 1.2, 0)).catch(() => {})
  let given = 0
  for (const item of bot.inventory.items().filter(i => pattern.test(i.name))) {
    if (given >= count) break
    const amount = Math.min(item.count, count - given)
    await bot.toss(item.type, null, amount)
    given += amount
  }
  return given
}

export function nearestEntity (bot, names, maxDistance) {
  const wanted = new Set(names)
  return Object.values(bot.entities)
    .filter(e => wanted.has(e.name) && e.position.distanceTo(bot.entity.position) <= maxDistance)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0] || null
}

/** Walk after an entity for `ms` milliseconds (used by the animal-lover hook). */
export async function followEntity (bot, entity, ms) {
  bot.pathfinder.setGoal(new goals.GoalFollow(entity, 1.5), true)
  await new Promise(resolve => setTimeout(resolve, ms))
  bot.pathfinder.setGoal(null)
  await bot.lookAt(entity.position.offset(0, 0.5, 0)).catch(() => {})
}

export function isDark (bot) {
  const time = bot.time.timeOfDay
  return time >= 12600 && time <= 23300
}
