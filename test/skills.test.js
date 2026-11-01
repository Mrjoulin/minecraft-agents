import { test } from 'node:test'
import assert from 'node:assert/strict'
import Vec3 from 'vec3'
import {
  withTimeout, directionAnchor, goNear, goToPlayer, approachPlayer,
  countItems, nearestEntity, isDark, lastPathError, DIRECTIONS, collectLogs
} from '../src/skills.js'

const fakeBot = ({ goto, pos = new Vec3(0, 64, 0) } = {}) => {
  const calls = { setGoal: [], goto: [], lookAt: [] }
  const bot = {
    username: 'Test',
    entity: { position: pos },
    players: {},
    inventory: { items: () => [] },
    time: { timeOfDay: 1000 },
    lookAt: async p => { calls.lookAt.push(p) },
    pathfinder: {
      setGoal: g => { calls.setGoal.push(g) },
      goto: async g => {
        calls.goto.push(g)
        if (goto) await goto(g, calls.goto.length)
      }
    }
  }
  return { bot, calls }
}

test('withTimeout passes values through and rejects on deadline', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 500, 'x'), 7)
  await assert.rejects(withTimeout(new Promise(() => {}), 30, 'slow walk'), /slow walk timed out after 30 ms/)
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 5000, 'x'), /boom/)
})

test('directionAnchor points ~18 blocks along a compass direction; unknown → null', () => {
  const fire = new Vec3(10, 70, 20)
  assert.deepEqual({ x: directionAnchor(fire, 'north').x, z: directionAnchor(fire, 'north').z }, { x: 10, z: 2 })
  assert.deepEqual({ x: directionAnchor(fire, 'east').x, z: directionAnchor(fire, 'east').z }, { x: 28, z: 20 })
  assert.equal(directionAnchor(fire, 'any'), null)
  assert.equal(directionAnchor(fire, 'up'), null)
  assert.ok(DIRECTIONS.includes('any'))
})

test('goNear succeeds on the first attempt when the path works', async () => {
  const { bot, calls } = fakeBot()
  assert.equal(await goNear(bot, new Vec3(5, 64, 5), 2), true)
  assert.equal(calls.goto.length, 1)
  assert.equal(Math.sqrt(calls.goto[0].rangeSq), 2)
})

test('goNear retries with a wider radius after a failure, then succeeds', async () => {
  const { bot, calls } = fakeBot({ goto: (g, attempt) => { if (attempt === 1) throw new Error('Took too long to decide path') } })
  assert.equal(await goNear(bot, new Vec3(5, 64, 5), 2), true)
  assert.equal(calls.goto.length, 2)
  assert.deepEqual(calls.goto.map(g => Math.sqrt(g.rangeSq)), [2, 4], 'radius widens on retry')
  assert.deepEqual(calls.setGoal, [null], 'stuck goal is cleared before the retry')
})

test('goNear gives up after the retry ladder and records the last path error', async () => {
  const { bot, calls } = fakeBot({ goto: async () => { throw new Error('unreachable') } })
  assert.equal(await goNear(bot, new Vec3(5, 64, 5), 2), false)
  assert.equal(calls.goto.length, 2, 'ladder length comes from params.yaml')
  assert.equal(calls.setGoal.filter(g => g === null).length, 2)
  assert.equal(lastPathError('Test'), 'unreachable')
  assert.equal(lastPathError('Nobody'), 'unknown')
})

test('countItems sums stacks matching the pattern', () => {
  const { bot } = fakeBot()
  bot.inventory.items = () => [
    { name: 'oak_log', count: 3 },
    { name: 'birch_log', count: 2 },
    { name: 'oak_planks', count: 9 }
  ]
  assert.equal(countItems(bot, /_log$/), 5)
  assert.equal(countItems(bot, /_planks$/), 9)
  assert.equal(countItems(bot, /^emerald$/), 0)
})

test('nearestEntity picks the closest matching entity within radius', () => {
  const { bot } = fakeBot({ pos: new Vec3(0, 64, 0) })
  bot.entities = {
    1: { name: 'pig', position: new Vec3(3, 64, 0) },
    2: { name: 'cow', position: new Vec3(50, 64, 0) },
    3: { name: 'pig', position: new Vec3(1, 64, 0) },
    4: { name: 'piglet', position: new Vec3(0.5, 64, 0) }
  }
  assert.equal(nearestEntity(bot, ['pig', 'cow'], 16).name, 'pig')
  assert.equal(nearestEntity(bot, ['sheep'], 16), null)
  assert.equal(nearestEntity(bot, ['cow'], 10), null, 'radius is respected')
})

test('isDark follows the vanilla night window', () => {
  const { bot } = fakeBot()
  for (const [t, dark] of [[1000, false], [12599, false], [12600, true], [18000, true], [23300, true], [23301, false]]) {
    bot.time.timeOfDay = t
    assert.equal(isDark(bot), dark, `timeOfDay ${t}`)
  }
})

test('goToPlayer walks to the player and looks at them; missing player fails fast', async () => {
  const { bot, calls } = fakeBot({ pos: new Vec3(0, 64, 0) })
  assert.equal(await goToPlayer(bot, 'Ghost'), false, 'no such player')
  bot.players.Cmd = { entity: { position: new Vec3(2, 64, 0) } }
  assert.equal(await goToPlayer(bot, 'Cmd', 3), true)
  assert.equal(calls.goto.length, 1)
  assert.equal(calls.lookAt.length, 1)
})

test('approachPlayer resolves when already in range and clears the follow goal', async () => {
  const { bot, calls } = fakeBot({ pos: new Vec3(1, 64, 0) })
  bot.players.Cmd = { entity: { position: new Vec3(2, 64, 0) } }
  assert.equal(await approachPlayer(bot, 'Cmd', 3, 500), true)
  assert.equal(calls.lookAt.length, 1)
  assert.equal(calls.setGoal.at(-1), null, 'follow goal released')
})

test('approachPlayer yields to timers even on an instant in-range success (anti-starvation)', async () => {
  // Regression: an instant-true return let the caller's action loop re-enter with
  // only microtask awaits — the event loop starved, sockets froze and inbound
  // packets piled up into an OOM (every live GLM run died this way at 55-110s).
  const { bot } = fakeBot({ pos: new Vec3(1, 64, 0) })
  bot.players.Cmd = { entity: { position: new Vec3(2, 64, 0) } }
  const t0 = Date.now()
  assert.equal(await approachPlayer(bot, 'Cmd', 3, 500), true)
  assert.ok(Date.now() - t0 >= 90, `in-range approach must sleep (~100ms), took ${Date.now() - t0}ms`)
})

test('approachPlayer yields to timers when the target entity is missing (anti-starvation)', async () => {
  // The null path is the nastiest variant: once the target despawns/kicks, an
  // instant-false loop pins the event loop forever (the server then kicks the
  // spinning bot too, keeping players maps empty).
  const { bot } = fakeBot()
  const t0 = Date.now()
  assert.equal(await approachPlayer(bot, 'Ghost', 3, 500), false)
  assert.ok(Date.now() - t0 >= 90, `null-target approach must sleep (~100ms), took ${Date.now() - t0}ms`)
})

test('collectLogs survives a search cap consumed by out-of-reach canopy logs', async () => {
  // Regression (the intermittent "0 logs next to a planted grove"): findBlocks caps at
  // count BEFORE any post-filter — floating canopy logs at y=75..80 ate all 80 slots,
  // the height filter then dropped every candidate and collect reported "no logs".
  // The height window now lives inside the matching predicate, before the cap.
  const trunk = { name: 'oak_log', position: new Vec3(2, 71, 0) }
  const canopy = Array.from({ length: 80 }, (_, i) => ({ name: 'oak_log', position: new Vec3(10 + i, 78, 0) }))
  // Mineflayer's palette gate feeds the matcher name-only stubs (position null) before
  // any real block exists — the predicate must survive them without crashing.
  const paletteStub = { name: 'oak_log', position: null }
  const carried = []
  const bot = {
    username: 'Cap',
    entity: { position: new Vec3(0, 71, 0) },
    inventory: { items: () => carried },
    // Emulate mineflayer: palette gate first, then full blocks, count cap, positions out.
    findBlocks: ({ matching, count }) => {
      if (![paletteStub, ...canopy, trunk].some(matching)) return []
      return [...canopy, trunk].filter(matching).slice(0, count).map(b => b.position)
    },
    blockAt: p => ({ name: 'oak_log', position: p.clone() }),
    collectBlock: {
      collect: async block => {
        if (block.position.y !== 71) throw new Error('noPath')
        carried.push({ name: 'oak_log', count: 1 })
      },
      cancelTask: async () => {}
    },
    pathfinder: { setGoal: () => {} }
  }
  const got = await collectLogs(bot, 1, {})
  assert.equal(got, 1, 'the trunk log is found despite 80 canopy matches above')
})

test('collectLogs blacklists an unreachable anchor-favourite and falls through to the next log', async () => {
  // Regression: with a direction anchor, findReachableLog always re-served the same
  // far tree, the collect failed 4x on it and the worker reported "no logs anywhere"
  // while standing next to perfectly good ones.
  const anchor = new Vec3(40, 64, 0)
  const far = new Vec3(38, 64, 0)   // anchor-nearest: the doomed favourite
  const near = new Vec3(1, 64, 0)   // bot-nearest: the one that actually works
  const carried = []
  const attempted = []
  const bot = {
    username: 'Lumber',
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => carried },
    findBlocks: () => [far.clone(), near.clone()],
    blockAt: p => ({ name: 'oak_log', position: p.clone() }),
    collectBlock: {
      collect: async block => {
        attempted.push(block.position.clone())
        if (block.position.equals(far)) throw new Error('noPath')
        carried.push({ name: 'oak_log', count: 1 })
      },
      cancelTask: async () => {}
    },
    pathfinder: { setGoal: () => {} }
  }
  const got = await collectLogs(bot, 1, { anchor })
  assert.equal(got, 1, 'one log gathered via the fallback candidate')
  assert.equal(attempted.length, 2)
  assert.deepEqual([attempted[0].x, attempted[1].x], [far.x, near.x], 'anchor favourite tried first, then the fallback')
})

test('approachPlayer times out when the player never comes near', async () => {
  const { bot, calls } = fakeBot({ pos: new Vec3(0, 64, 0) })
  bot.players.Cmd = { entity: { position: new Vec3(30, 64, 0) } }
  assert.equal(await approachPlayer(bot, 'Cmd', 3, 120), false)
  assert.equal(calls.setGoal.at(-1), null)
})
