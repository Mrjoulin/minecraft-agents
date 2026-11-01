// Crafting and construction skills (Mineflayer). Deterministic: the LLM only decides *what* to build.
import pathfinderPkg from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { countItems, goNear, withTimeout } from './skills.js'
import { PLANKS_PER_LOG } from './blueprint.js'

const { goals } = pathfinderPkg

export const PLANKS = /_planks$/
const LOGS = /_log$/
const PLACE_ATTEMPTS = 3
const PLACE_RANGE = 4
const GOTO_TIMEOUT_MS = 20000
const OCCUPIED_WAIT_MS = 800
// Reference faces to try, most stable first: the block below, then the sides, then above.
const NEIGHBOURS = Object.freeze([
  new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)
])
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const CRAFT_ATTEMPTS = 3
const CRAFT_RETRY_MS = 700

/** bot.craft sometimes times out waiting for the inventory update; stand still and retry. */
async function craftWithRetry (bot, recipe, table) {
  for (let attempt = 1; attempt <= CRAFT_ATTEMPTS; attempt++) {
    bot.pathfinder.setGoal(null)
    try {
      await bot.craft(recipe, 1, table)
      return true
    } catch (err) {
      if (attempt === CRAFT_ATTEMPTS) throw err
      await sleep(CRAFT_RETRY_MS)
    }
  }
  return false
}

export function toVec3 (p) {
  return new Vec3(p.x, p.y, p.z)
}

export function isBuilt (bot, p, pattern = PLANKS) {
  return pattern.test(bot.blockAt(toVec3(p))?.name || '')
}

export async function withdrawFromChest (bot, chestPos, pattern, count) {
  if (count <= 0) return 0
  await goNear(bot, chestPos, 2)
  const chestBlock = bot.blockAt(chestPos)
  if (!chestBlock || chestBlock.name !== 'chest' || bot.entity.position.distanceTo(chestPos) > 4.5) return 0
  const chest = await bot.openContainer(chestBlock)
  let taken = 0
  try {
    for (const item of chest.containerItems().filter(i => pattern.test(i.name))) {
      if (taken >= count) break
      const amount = Math.min(item.count, count - taken)
      await chest.withdraw(item.type, null, amount)
      taken += amount
    }
  } finally {
    chest.close()
  }
  return taken
}

/** Craft planks from carried logs (2x2 inventory recipe, no table needed) until `wanted` planks are held. */
export async function craftPlanks (bot, wanted) {
  for (const log of bot.inventory.items().filter(i => LOGS.test(i.name))) {
    const missing = wanted - countItems(bot, PLANKS)
    if (missing <= 0) break
    const plank = bot.registry.itemsByName[log.name.replace(/_log$/, '_planks')]
    // One craft per log: batch crafts fail with "missing ingredient" when stacks shift mid-craft.
    // Snapshot the count: crafting shrinks the live stack, and a re-read bound would stop early.
    const crafts = Math.min(log.count, Math.ceil(missing / PLANKS_PER_LOG))
    for (let i = 0; i < crafts; i++) {
      const recipe = plank && bot.recipesFor(plank.id, null, 1, null)[0]
      if (!recipe) break
      try {
        await craftWithRetry(bot, recipe, null)
      } catch {
        break
      }
    }
  }
  return countItems(bot, PLANKS)
}

/** Craft an item that needs a crafting table standing at `tablePos`. */
export async function craftAtTable (bot, itemName, tablePos) {
  const item = bot.registry.itemsByName[itemName]
  const table = bot.blockAt(tablePos)
  if (!item || table?.name !== 'crafting_table') return false
  await goNear(bot, tablePos, 2)
  const recipe = bot.recipesFor(item.id, null, 1, table)[0]
  if (!recipe) return false
  return craftWithRetry(bot, recipe, table)
}

function findReference (bot, target) {
  for (const offset of NEIGHBOURS) {
    const ref = bot.blockAt(target.plus(offset))
    if (ref && ref.boundingBox === 'block' && ref.name !== 'air') return { ref, face: offset.scaled(-1) }
  }
  return null
}

// Another player standing in the cell. The bot itself is excluded: GoalPlaceBlock already moves it out.
function occupiedByEntity (bot, target) {
  return Object.values(bot.entities).some(e =>
    e.type === 'player' && e !== bot.entity && Math.floor(e.position.x) === target.x && Math.floor(e.position.z) === target.z &&
    e.position.y > target.y - 1.8 && e.position.y < target.y + 1)
}

/** Place one block of `pattern` at `p`. Returns true when the block is there afterwards. */
export async function placeAt (bot, p, pattern = PLANKS) {
  const target = toVec3(p)
  for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
    if (isBuilt(bot, target, pattern)) return true
    const support = findReference(bot, target)
    if (!support) return false
    if (occupiedByEntity(bot, target)) { await sleep(OCCUPIED_WAIT_MS); continue }
    const item = bot.inventory.items().find(i => pattern.test(i.name))
    if (!item) return false
    try {
      const goal = new goals.GoalPlaceBlock(target, bot.world, { range: PLACE_RANGE, LOS: true })
      await withTimeout(bot.pathfinder.goto(goal), GOTO_TIMEOUT_MS, 'reach build spot')
      // Use the face the goal can actually see from here; fall back to the first solid neighbour.
      const visible = goal.getFaceAndRef(bot.entity.position.offset(0, 1.6, 0))
      const ref = visible ? bot.blockAt(visible.ref) : support.ref
      const face = visible ? visible.face.scaled(-1) : support.face
      await bot.equip(item, 'hand')
      await bot.placeBlock(ref, face)
    } catch {
      // placeBlock sometimes times out waiting for the update even though the block landed; checked below.
      bot.pathfinder.setGoal(null)
    }
    if (isBuilt(bot, target, pattern)) return true
  }
  return isBuilt(bot, target, pattern)
}

/**
 * Build the given cells in order. Cells that fail are retried once at the end (their support may exist by then).
 * Returns { placed, remaining }.
 */
export async function buildCells (bot, cells, { shouldStop = () => false, onPlaced = () => {} } = {}) {
  let placed = 0
  let failed = []
  for (const pass of [cells, null]) {
    const queue = pass || failed
    failed = []
    for (const cell of queue) {
      if (shouldStop()) return { placed, remaining: queue.filter(c => !isBuilt(bot, c)).length }
      if (isBuilt(bot, cell)) continue
      if (countItems(bot, PLANKS) === 0) break
      if (await placeAt(bot, cell)) { placed += 1; onPlaced(cell) } else failed = [...failed, cell]
    }
  }
  return { placed, remaining: cells.filter(c => !isBuilt(bot, c)).length }
}

const DOOR = /_door$/
const TABLE = /^crafting_table$/
const DOOR_LOGS = 5

// Where the crafting table may go if its preferred spot is blocked (offsets from the preferred spot).
const TABLE_FALLBACKS = Object.freeze([[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1]])

async function placeTable (bot, preferred) {
  const existing = TABLE_FALLBACKS.map(([dx, dz]) => preferred.offset(dx, 0, dz)).find(p => isBuilt(bot, p, TABLE))
  if (existing) return existing
  const recipe = bot.recipesFor(bot.registry.itemsByName.crafting_table.id, null, 1, null)[0]
  if (!recipe) return null
  await craftWithRetry(bot, recipe, null)
  for (const [dx, dz] of TABLE_FALLBACKS) {
    const spot = preferred.offset(dx, 0, dz)
    if (bot.blockAt(spot)?.name !== 'air') continue
    if (await placeAt(bot, spot, TABLE)) return spot
  }
  return null
}

/**
 * Commander's finishing touch: crafting table at camp, then a door in the hut's door gap.
 * Returns { ok, step } so a failure says which step broke.
 */
export async function craftAndPlaceDoor (bot, { chest, table, door }) {
  if (isBuilt(bot, door.bottom, DOOR)) return { ok: true, step: 'already there' }
  await withdrawFromChest(bot, chest, LOGS, Math.max(0, DOOR_LOGS - countItems(bot, LOGS)))
  await craftPlanks(bot, DOOR_LOGS * 4)
  const tableAt = await placeTable(bot, table)
  if (!tableAt) return { ok: false, step: 'crafting table' }
  // A door needs 6 planks of a single wood type.
  const plank = bot.inventory.items().filter(i => PLANKS.test(i.name)).sort((a, b) => b.count - a.count)[0]
  if (!plank || plank.count < 6) return { ok: false, step: 'not enough planks of one wood type' }
  if (!await craftAtTable(bot, plank.name.replace(/_planks$/, '_door'), tableAt)) return { ok: false, step: 'crafting the door' }
  return { ok: await placeAt(bot, door.bottom, DOOR), step: 'hanging the door' }
}
