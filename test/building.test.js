import { test } from 'node:test'
import assert from 'node:assert/strict'
import Vec3 from 'vec3'
import { toVec3, isBuilt, craftPlanks, withdrawFromChest, placeAt, buildCells } from '../src/building.js'

const key = p => `${p.x},${p.y},${p.z}`

/** Offline fake bot: block world in a Map, inventory in an array, instant pathfinder. */
function makeBot ({ inv = [], blocks = new Map(), pos = new Vec3(0, 71, 2), placeBlock } = {}) {
  const bot = {
    entity: { position: pos },
    entities: {},
    inventory: { items: () => inv },
    registry: {
      itemsByName: {
        oak_planks: { id: 5, name: 'oak_planks' },
        crafting_table: { id: 58, name: 'crafting_table' },
        oak_door: { id: 64, name: 'oak_door' }
      }
    },
    recipesFor: () => [{ recipe: true }],
    pathfinder: { setGoal () {}, goto: async () => {} },
    blockAt: v => {
      const name = blocks.get(key(v))
      return name
        ? { name, boundingBox: name === 'air' ? 'empty' : 'block', position: new Vec3(v.x, v.y, v.z), shapes: [] }
        : null
    },
    world: { getBlock: v => bot.blockAt(v), raycast: () => null },
    equip: async () => {},
    craft: async () => {},
    openContainer: async () => { throw new Error('no container in this test') }
  }
  bot.placeBlock = placeBlock || (async (ref, face) => { blocks.set(key(ref.position.plus(face)), 'oak_planks') })
  return bot
}

test('toVec3 copies plain positions into a Vec3', () => {
  const v = toVec3({ x: 1, y: 2, z: 3 })
  assert.ok(typeof v.plus === 'function')
  assert.deepEqual({ x: v.x, y: v.y, z: v.z }, { x: 1, y: 2, z: 3 })
})

test('isBuilt checks the block at a cell against the pattern', () => {
  const blocks = new Map([['0,71,0', 'oak_planks']])
  const bot = makeBot({ blocks })
  assert.equal(isBuilt(bot, { x: 0, y: 71, z: 0 }), true)
  assert.equal(isBuilt(bot, { x: 0, y: 71, z: 0 }, /^crafting_table$/), false)
  assert.equal(isBuilt(bot, { x: 9, y: 71, z: 9 }), false, 'missing block is not built')
})

test('craftPlanks crafts one recipe per log until enough planks are held', async () => {
  const inv = [{ name: 'oak_log', count: 3, type: 17 }]
  const bot = makeBot({ inv })
  bot.craft = async () => {
    const log = inv[0]
    log.count -= 1
    const planks = inv.find(i => i.name === 'oak_planks')
    if (planks) planks.count += 4
    else inv.push({ name: 'oak_planks', count: 4, type: 5 })
  }
  const held = await craftPlanks(bot, 10)
  assert.equal(held, 12, 'ceil(10/4)=3 crafts × 4 planks')
  assert.equal(inv.find(i => i.name === 'oak_log').count, 0)
})

test('craftPlanks stops when logs run out', async () => {
  const inv = [{ name: 'oak_log', count: 2, type: 17 }]
  const bot = makeBot({ inv })
  bot.craft = async () => {
    inv[0].count -= 1
    inv.push({ name: 'oak_planks', count: 4, type: 5 })
  }
  assert.equal(await craftPlanks(bot, 100), 8)
})

test('craftPlanks gives up quietly when no recipe exists', async () => {
  const bot = makeBot({ inv: [{ name: 'oak_log', count: 2, type: 17 }] })
  bot.recipesFor = () => []
  assert.equal(await craftPlanks(bot, 4), 0)
})

test('withdrawFromChest takes items across stacks up to the count', async () => {
  const blocks = new Map([['-441,71,-443', 'chest']])
  const bot = makeBot({ blocks, pos: new Vec3(-441, 71, -442) })
  const taken = []
  bot.openContainer = async () => ({
    containerItems: () => [{ name: 'oak_log', count: 5, type: 17 }, { name: 'birch_log', count: 2, type: 18 }],
    withdraw: async (type, meta, n) => { taken.push(n) },
    close () {}
  })
  assert.equal(await withdrawFromChest(bot, new Vec3(-441, 71, -443), /_log$/, 6), 6)
  assert.deepEqual(taken, [5, 1])
  assert.equal(await withdrawFromChest(bot, new Vec3(-441, 71, -443), /_log$/, 99), 7, 'caps at what the chest holds')
})

test('withdrawFromChest refuses nothing-to-take without opening the chest', async () => {
  const bot = makeBot({ pos: new Vec3(-441, 71, -442) })
  let opened = 0
  bot.openContainer = async () => { opened += 1; return { containerItems: () => [], close () {} } }
  assert.equal(await withdrawFromChest(bot, new Vec3(-441, 71, -443), /_log$/, 0), 0)
  assert.equal(opened, 0, 'count <= 0 short-circuits')
})

test('placeAt puts a plank on a solid reference block', async () => {
  const blocks = new Map([['0,70,0', 'grass_block']])
  const bot = makeBot({ blocks, inv: [{ name: 'oak_planks', count: 4, type: 5 }] })
  assert.equal(await placeAt(bot, { x: 0, y: 71, z: 0 }), true)
  assert.equal(blocks.get('0,71,0'), 'oak_planks')
})

test('placeAt fails when there is nothing solid to attach to', async () => {
  const bot = makeBot({ inv: [{ name: 'oak_planks', count: 4, type: 5 }] })
  assert.equal(await placeAt(bot, { x: 0, y: 71, z: 0 }), false)
})

test('placeAt reports failure when the block never lands', async () => {
  const blocks = new Map([['0,70,0', 'grass_block']])
  const bot = makeBot({ blocks, inv: [{ name: 'oak_planks', count: 4, type: 5 }], placeBlock: async () => { throw new Error('nope') } })
  assert.equal(await placeAt(bot, { x: 0, y: 71, z: 0 }), false)
})

test('buildCells places every cell and reports nothing remaining', async () => {
  const blocks = new Map([['0,70,0', 'grass_block'], ['1,70,0', 'grass_block']])
  const bot = makeBot({ blocks, inv: [{ name: 'oak_planks', count: 4, type: 5 }] })
  const touched = []
  const result = await buildCells(bot, [{ x: 0, y: 71, z: 0 }, { x: 1, y: 71, z: 0 }], { onPlaced: c => touched.push(c) })
  assert.deepEqual(result, { placed: 2, remaining: 0 })
  assert.equal(touched.length, 2)
  assert.equal(blocks.get('0,71,0'), 'oak_planks')
  assert.equal(blocks.get('1,71,0'), 'oak_planks')
})

test('buildCells skips already-built cells without spending planks', async () => {
  const blocks = new Map([['0,70,0', 'grass_block'], ['0,71,0', 'birch_planks']])
  const bot = makeBot({ blocks, inv: [{ name: 'oak_planks', count: 4, type: 5 }] })
  const result = await buildCells(bot, [{ x: 0, y: 71, z: 0 }])
  assert.deepEqual(result, { placed: 0, remaining: 0 })
})

test('buildCells stops early when planks run out', async () => {
  const blocks = new Map([['0,70,0', 'grass_block'], ['1,70,0', 'grass_block']])
  const bot = makeBot({ blocks }) // empty inventory
  const result = await buildCells(bot, [{ x: 0, y: 71, z: 0 }, { x: 1, y: 71, z: 0 }])
  assert.deepEqual(result, { placed: 0, remaining: 2 })
})

test('buildCells retries failed cells once and counts the remainder', async () => {
  const blocks = new Map([['0,70,0', 'grass_block']])
  let calls = 0
  const bot = makeBot({
    blocks,
    inv: [{ name: 'oak_planks', count: 4, type: 5 }],
    placeBlock: async () => { calls += 1; throw new Error('flaky') }
  })
  const result = await buildCells(bot, [{ x: 0, y: 71, z: 0 }])
  assert.deepEqual(result, { placed: 0, remaining: 1 })
  assert.equal(calls, 6, '3 place attempts × 2 passes')
})

test('buildCells respects shouldStop between cells', async () => {
  const blocks = new Map([['0,70,0', 'grass_block'], ['1,70,0', 'grass_block']])
  const bot = makeBot({ blocks, inv: [{ name: 'oak_planks', count: 4, type: 5 }] })
  const result = await buildCells(bot, [{ x: 0, y: 71, z: 0 }, { x: 1, y: 71, z: 0 }], { shouldStop: () => true })
  assert.deepEqual(result, { placed: 0, remaining: 2 })
})
