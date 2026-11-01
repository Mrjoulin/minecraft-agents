import { test } from 'node:test'
import assert from 'node:assert/strict'
import Vec3 from 'vec3'
import {
  serializePos, dayPhase, getSelf, getEnvironment, getInventory, getEntities,
  findBlocks, inspectBlock, scanArea, getObservation, describeObservation
} from '../src/perception.js'

const key = p => `${p.x},${p.y},${p.z}`

/** Offline bot double: Map-based world, object entity map, fixed inventory slots. */
function makeBot ({ pos = new Vec3(0, 71, 0), blocks = new Map(), entities = {}, slots = [], time = 1000, dimension = 'minecraft:overworld', raining = false, thunder = 0, health = 20, food = 18, goal = null } = {}) {
  const blockAt = v => {
    const name = blocks.get(key(v))
    return name
      ? { name, boundingBox: name === 'air' ? 'empty' : 'block', position: new Vec3(v.x, v.y, v.z) }
      : null
  }
  return {
    username: 'Test',
    entity: { position: pos, onGround: true, yaw: 90.4, pitch: 0.2 },
    health,
    food,
    isRaining: raining,
    thunderState: thunder,
    game: { dimension },
    time: { timeOfDay: time },
    entities,
    heldItem: null,
    inventory: { items: () => slots.filter(Boolean), slots },
    blockAt,
    findBlocks: ({ matching, maxDistance }) => [...blocks.entries()]
      .filter(([, name]) => matching({ name }))
      .map(([k]) => { const [x, y, z] = k.split(',').map(Number); return new Vec3(x, y, z) })
      .filter(p => p.distanceTo(pos) <= maxDistance),
    pathfinder: { goal }
  }
}

test('serializePos rounds to 1 decimal and rejects garbage', () => {
  assert.deepEqual(serializePos(new Vec3(1.234, 71.9, -3.21)), { x: 1.2, y: 71.9, z: -3.2 })
  assert.equal(serializePos(null), null)
  assert.equal(serializePos({ x: NaN, y: 1, z: 2 }), null)
  assert.equal(serializePos({ x: 1, z: 2 }), null)
})

test('dayPhase follows the vanilla night window; unknown time is unknown', () => {
  assert.equal(dayPhase(1000), 'day')
  assert.equal(dayPhase(11500), 'day')
  assert.equal(dayPhase(12000), 'sunset')
  assert.equal(dayPhase(12600), 'night')
  assert.equal(dayPhase(23300), 'night')
  assert.equal(dayPhase(23301), 'day')
  assert.equal(dayPhase(null), 'unknown')
})

test('getSelf reports position, vitals and stance; missing entity → null', () => {
  const { bot } = { bot: makeBot() }
  const self = getSelf(bot)
  assert.deepEqual(self.position, { x: 0, y: 71, z: 0 })
  assert.equal(self.health, 20)
  assert.equal(self.food, 18)
  assert.equal(self.onGround, true)
  assert.equal(self.yaw, 90)
  assert.equal(getSelf({}), null)
})

test('getEnvironment normalizes dimension and weather', () => {
  assert.deepEqual(getEnvironment(makeBot()), { dimension: 'overworld', timeOfDay: 1000, dayPhase: 'day', weather: 'clear' })
  assert.equal(getEnvironment(makeBot({ raining: true })).weather, 'rain')
  assert.equal(getEnvironment(makeBot({ raining: true, thunder: 1 })).weather, 'thunder')
  assert.equal(getEnvironment(makeBot({ time: 18000 })).dayPhase, 'night')
  assert.equal(getEnvironment({}).dimension, 'unknown')
})

test('getInventory counts free storage slots (9..44), held item and armor', () => {
  const slots = new Array(46).fill(null)
  slots[5] = { name: 'iron_helmet', count: 1 }
  slots[9] = { name: 'oak_log', count: 3 }
  slots[36] = { name: 'oak_planks', count: 2 }
  const bot = makeBot({ slots })
  bot.heldItem = { name: 'stone_axe', count: 1 }
  const inv = getInventory(bot)
  assert.deepEqual(inv.items, [{ name: 'iron_helmet', count: 1 }, { name: 'oak_log', count: 3 }, { name: 'oak_planks', count: 2 }])
  assert.equal(inv.freeSlots, 34, '36 storage slots minus 2 filled')
  assert.deepEqual(inv.held, { name: 'stone_axe', count: 1 })
  assert.deepEqual(inv.armor, ['iron_helmet'])
  assert.equal(getInventory({}).freeSlots, null)
})

test('getEntities sorts by distance, honors radius and types, skips self', () => {
  const bot = makeBot({
    entities: {
      1: { name: 'player', username: 'Commander', type: 'player', position: new Vec3(2, 71, 0) },
      2: { name: 'pig', type: 'mob', position: new Vec3(1, 71, 0) },
      3: { name: 'cow', type: 'mob', position: new Vec3(50, 71, 0) },
      4: { name: 'sheep', type: 'mob', position: new Vec3(0.5, 71, 0) },
      5: { name: 'pig', type: 'mob', position: new Vec3(100, 71, 0) }
    }
  })
  bot.entities[bot.username] = bot.entity // self must be excluded
  const all = getEntities(bot, { radius: 32 })
  assert.deepEqual(all.map(e => e.name), ['sheep', 'pig', 'player'], 'closest first')
  assert.equal(all[2].username, 'Commander')
  assert.equal(getEntities(bot, { radius: 32, types: ['pig'] }).length, 1)
  assert.deepEqual(getEntities(bot, { radius: 3 }).map(e => e.name), ['sheep', 'pig', 'player'], 'closest first, cow at 50m dropped')
})

test('findBlocks resolves names, ranks by distance from center, respects radius and limit', () => {
  const blocks = new Map([
    ['3,71,0', 'oak_log'],
    ['6,71,0', 'birch_log'],
    ['12,71,0', 'oak_log'],
    ['0,74,0', 'lava'],
    ['5,71,5', 'oak_planks']
  ])
  const bot = makeBot({ blocks, pos: new Vec3(0, 71, 20) })
  const found = findBlocks(bot, ['oak_log', /birch_.*/], { center: new Vec3(0, 71, 0), radius: 14 })
  assert.deepEqual(found.map(b => b.name), ['oak_log', 'birch_log', 'oak_log'], 'sorted by distance from center')
  assert.deepEqual(found[0].position, { x: 3, y: 71, z: 0 })
  assert.equal(found[0].distance, 3)
  assert.equal(findBlocks(bot, ['oak_log'], { center: new Vec3(0, 71, 0), radius: 5 }).length, 1, 'radius filters around center')
  assert.equal(findBlocks(bot, ['stone'], {}).length, 0, 'checked but empty')
  assert.equal(findBlocks({}, ['oak_log'], {}).length, 0, 'no findBlocks → empty, not a crash')
})

test('inspectBlock distinguishes unknown (unloaded) from checked-but-air, with above/below', () => {
  const blocks = new Map([
    ['0,71,0', 'oak_log'],
    ['0,72,0', 'air'],
    ['0,73,0', 'oak_leaves']
  ])
  const bot = makeBot({ blocks })
  const log = inspectBlock(bot, { x: 0, y: 71, z: 0 })
  assert.equal(log.known, true)
  assert.equal(log.name, 'oak_log')
  assert.equal(log.above, 'air')
  assert.equal(log.below, null, 'below y=71 is outside the map → unknown')
  const air = inspectBlock(bot, { x: 0, y: 72, z: 0 })
  assert.equal(air.known, true)
  assert.equal(air.name, 'air')
  assert.equal(inspectBlock(bot, { x: 500, y: 71, z: 500 }).known, false, 'unloaded chunk is "cannot say"')
  assert.equal(inspectBlock(bot, { x: 500, y: 71, z: 500 }).reason, 'chunk_not_loaded')
})

test('scanArea groups blocks by category and includes entities', () => {
  const blocks = new Map([
    ['2,71,0', 'oak_log'],
    ['-2,71,0', 'chest'],
    ['0,71,2', 'lava'],
    ['0,71,-2', 'crafting_table'],
    ['0,71,40', 'oak_log']
  ])
  const bot = makeBot({ blocks, entities: { 9: { name: 'pig', type: 'mob', position: new Vec3(1, 71, 1) } } })
  const scan = scanArea(bot, { radius: 16 })
  const cats = Object.fromEntries(scan.blocks.map(b => [`${b.category}@${b.name}`, true]))
  assert.ok(cats['logs@oak_log'])
  assert.ok(cats['containers@chest'])
  assert.ok(cats['hazards@lava'])
  assert.ok(cats['workstations@crafting_table'])
  assert.equal(scan.blocks.filter(b => b.name === 'oak_log').length, 1, 'the log at 40m is outside the radius')
  assert.equal(scan.entities.length, 1)
  assert.deepEqual(scan.center, { x: 0, y: 71, z: 0 })
  const limited = scanArea(bot, { radius: 16, categories: ['hazards'], limit: 1 })
  assert.deepEqual(limited.blocks.map(b => b.category), ['hazards'])
})

test('getObservation has the roadmap shape and serializes navigation goals', () => {
  const blocks = new Map([['2,71,0', 'oak_log']])
  const bot = makeBot({ blocks, goal: { x: 10, y: 71, z: -5, rangeSq: 4 } })
  const obs = getObservation(bot)
  assert.ok(obs.self.position)
  assert.equal(obs.environment.dimension, 'overworld')
  assert.equal(obs.nearby.blocks[0].name, 'oak_log')
  assert.deepEqual(obs.nearby.hazards, [])
  assert.ok(Array.isArray(obs.inventory.items))
  assert.deepEqual(obs.navigation.target, { x: 10, y: 71, z: -5 })
  assert.equal(obs.navigation.isMoving, true)
  bot.pathfinder.goal = { entity: { username: 'Commander' } }
  assert.deepEqual(getObservation(bot).navigation.target, { follow: 'Commander' })
  bot.pathfinder.goal = null
  assert.equal(getObservation(bot).navigation.target, null)
})

test('describeObservation renders compact lines; inventory is optional; missing self degrades', () => {
  const bot = makeBot({
    blocks: new Map([['2,71,0', 'oak_log'], ['0,71,5', 'lava']]),
    slots: (() => { const s = new Array(46).fill(null); s[9] = { name: 'oak_log', count: 3 }; return s })(),
    entities: { 1: { name: 'pig', type: 'mob', position: new Vec3(4, 71, 0) } }
  })
  const text = describeObservation(getObservation(bot))
  assert.match(text, /You are at \(0, 71, 0\) — day, overworld, weather clear; health 20, food 18\./)
  assert.match(text, /logs: 1 \(nearest 2m at \(2, 71, 0\)\)/)
  assert.match(text, /hazards: 1/)
  assert.match(text, /Creatures: pig 4m/)
  assert.match(text, /Inventory: 3 oak_log/)
  const noInv = describeObservation(getObservation(bot), { withInventory: false })
  assert.doesNotMatch(noInv, /Inventory:/)
  assert.match(describeObservation({ self: null }), /not available/)
})
