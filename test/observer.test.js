import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import Vec3 from 'vec3'
import { describeActivity, createObserver } from '../src/agents/observer.js'
import { createHutBlueprint } from '../src/blueprint.js'

const CAMP = {
  fire: new Vec3(-444, 71, -440),
  chest: new Vec3(-441, 71, -443)
}
const BP = createHutBlueprint({ x: -435, y: 71, z: -450 })
const key = p => `${p.x},${p.y},${p.z}`

/** Commander stand-in: players/entities in plain objects, blocks in a Map. */
function makeBot ({ pos = new Vec3(-438, 71, -446), timeOfDay = 1000, blocks = new Map() } = {}) {
  const bot = new EventEmitter()
  bot.username = 'Commander'
  bot.time = { timeOfDay }
  bot.entity = { position: pos }
  bot.players = {}
  bot.entities = {}
  bot.blockAt = v => {
    const name = blocks.get(key(v))
    return name ? { name, position: new Vec3(v.x, v.y, v.z) } : null
  }
  bot.openContainer = async () => { throw new Error('no container in this test') }
  return bot
}

const makeObserver = (bot, workerNames = ['Bram', 'Lina', 'Odo']) =>
  createObserver({ bot, workerNames, camp: CAMP, blueprint: BP, startedAt: Date.now() - 9000 })

const line = (obs, fragment) => obs.evidence().find(l => l.includes(fragment))

test('describeActivity ranks animal over chest over fire over motion', () => {
  const base = { nearAnimal: null, nearChest: false, nearFire: false, moving: false }
  assert.equal(describeActivity({ ...base, nearAnimal: 'pig' }), 'standing next to a pig')
  assert.equal(describeActivity({ ...base, nearChest: true }), 'at the camp chest')
  assert.equal(describeActivity({ ...base, nearFire: true }), 'standing by the campfire')
  assert.equal(describeActivity({ ...base, moving: true }), 'moving around')
  assert.equal(describeActivity(base), 'standing still')
})

test('a worker by the campfire is seen and noted once, not on every sample', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const bot = makeBot()
  bot.players.Bram = { entity: { position: CAMP.fire.clone() } }
  const obs = makeObserver(bot)
  obs.start()
  t.mock.timers.tick(2000)
  await new Promise(setImmediate)
  obs.stop()
  assert.ok(line(obs, 'I see Bram standing by the campfire'), JSON.stringify(obs.evidence()))
  const notes = obs.evidence().filter(l => l.includes('I see Bram')).length
  t.mock.timers.tick(3000)
  assert.equal(notes, 1, 'unchanged activity is not repeated')
})

test('nightfall is noted exactly once', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const bot = makeBot({ timeOfDay: 13000 })
  const obs = makeObserver(bot)
  obs.start()
  t.mock.timers.tick(2500)
  await new Promise(setImmediate)
  obs.stop()
  assert.equal(obs.evidence().filter(l => l.includes('Night has fallen')).length, 1)
})

test('a worker near a chest with logs gets the delivery attributed to them', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const bot = makeBot({ pos: new Vec3(-441, 71, -442) })
  bot.players.Bram = { entity: { position: new Vec3(-441, 71, -442) } }
  bot.blockAt = v => (key(v) === key(CAMP.chest) ? { name: 'chest', position: CAMP.chest.clone() } : null)
  bot.openContainer = async () => ({
    containerItems: () => [{ name: 'oak_log', count: 12 }, { name: 'oak_planks', count: 5 }],
    close () {}
  })
  const obs = makeObserver(bot)
  obs.start()
  t.mock.timers.tick(1000)
  await new Promise(setImmediate)
  await new Promise(setImmediate)
  obs.stop()
  assert.equal(obs.chestCount(), 12, 'only logs are audited')
  assert.ok(line(obs, 'Chest audit: 12 logs'), JSON.stringify(obs.evidence()))
  assert.ok(line(obs, 'delivered by Bram'), 'single visitor is credited')
  assert.ok(obs.summary().includes('chest deliveries surely by Bram: 12'))
})

test('block updates are attributed to the nearest visible worker', () => {
  const bot = makeBot()
  bot.players.Bram = { entity: { position: new Vec3(-450, 71, -460) } }
  bot.players.Lina = { entity: { position: new Vec3(100, 71, 100) } }
  const obs = makeObserver(bot)
  obs.start()
  const stump = new Vec3(-451, 72, -460)
  bot.emit('blockUpdate', { name: 'oak_log', position: stump }, { name: 'air', position: stump })
  const plank = new Vec3(-449, 71, -460)
  bot.emit('blockUpdate', { name: 'air', position: plank }, { name: 'oak_planks', position: plank })
  obs.stop()
  assert.ok(line(obs, 'I saw Bram chopping logs (seen so far: 1)'))
  assert.ok(line(obs, 'I saw Bram placing planks on the hut (seen so far: 1)'))
  assert.ok(obs.summary().includes('Bram: seen chopping 1 logs; seen placing 1 hut blocks'))
})

test('finished hut sections are noted and hutDone only fires when everything stands', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const blocks = new Map()
  for (const cell of BP.sections.north_wall) blocks.set(key(cell), 'oak_planks')
  const bot = makeBot({ pos: new Vec3(-435, 71, -449) })
  bot.blockAt = v => blocks.get(key(v)) ? { name: blocks.get(key(v)), position: new Vec3(v.x, v.y, v.z) } : null
  const obs = makeObserver(bot)
  obs.start()
  t.mock.timers.tick(1000)
  await new Promise(setImmediate)
  obs.stop()
  assert.equal(obs.hutDone(), false)
  assert.ok(line(obs, "The hut's north wall is finished"), JSON.stringify(obs.evidence()))
  assert.ok(obs.summary().includes('north wall 15/15'))

  // Now finish everything.
  const obs2 = makeObserver(bot)
  for (const s of Object.keys(BP.sections)) for (const cell of BP.sections[s]) blocks.set(key(cell), 'oak_planks')
  obs2.start()
  t.mock.timers.tick(1000)
  await new Promise(setImmediate)
  obs2.stop()
  assert.equal(obs2.hutDone(), true)
})

test('stop() really stops sampling', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const bot = makeBot({ timeOfDay: 13000 })
  const obs = makeObserver(bot)
  obs.start()
  t.mock.timers.tick(1000)
  await new Promise(setImmediate)
  const count = obs.evidence().length
  obs.stop()
  t.mock.timers.tick(5000)
  assert.equal(obs.evidence().length, count)
})

test('notes are stamped with session seconds and evidence is capped', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const bot = makeBot({ timeOfDay: 13000 })
  const obs = makeObserver(bot)
  obs.start()
  t.mock.timers.tick(1000)
  obs.stop()
  assert.match(obs.evidence()[0], /^\[9s\]/, 'startedAt was 9s ago')

  const obs2 = makeObserver(bot)
  for (let i = 0; i < 70; i++) obs2.note(`line ${i}`)
  assert.equal(obs2.evidence().length, 60)
  assert.ok(obs2.evidence()[0].includes('line 10'), 'oldest lines fall off')
})
