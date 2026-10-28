import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHutBlueprint, hutProgress, SECTIONS } from '../src/blueprint.js'

const origin = { x: 0, y: 64, z: 0 }
const bp = createHutBlueprint(origin)
const key = p => `${p.x},${p.y},${p.z}`

test('section sizes: corners belong to north/south walls, door gap is open', () => {
  const sizes = Object.fromEntries(SECTIONS.map(s => [s, bp.sections[s].length]))
  assert.deepEqual(sizes, { north_wall: 15, south_wall: 13, east_wall: 9, west_wall: 9, roof: 25 })
  assert.equal(new Set(bp.all.map(key)).size, bp.all.length, 'no duplicate positions')
  assert.ok(!bp.all.some(p => key(p) === key(bp.door.bottom)), 'door bottom stays open')
  assert.ok(!bp.all.some(p => key(p) === key({ ...bp.door.bottom, y: 65 })), 'door top stays open')
})

test('walls go bottom-up and the roof starts at the edges', () => {
  for (const s of ['north_wall', 'south_wall', 'east_wall', 'west_wall']) {
    const ys = bp.sections[s].map(p => p.y)
    assert.deepEqual(ys, [...ys].sort((a, b) => a - b))
  }
  const [first] = bp.sections.roof
  assert.equal(Math.max(Math.abs(first.x), Math.abs(first.z)), 2)
  assert.deepEqual(bp.sections.roof.at(-1), { x: 0, y: 67, z: 0 })
})

test('hutProgress counts built cells per section', () => {
  const built = new Set(bp.sections.north_wall.slice(0, 5).map(key))
  const progress = hutProgress(bp, p => built.has(key(p)))
  assert.deepEqual({ ...progress.north_wall }, { built: 5, total: 15 })
  assert.deepEqual({ ...progress.roof }, { built: 0, total: 25 })
})
