import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import yaml from 'yaml'
import { config } from '../src/config.js'
import { pathRetryPlan, approachSides } from '../src/skills.js'

test('params.yaml parses and covers all simulation sections', () => {
  const raw = yaml.parse(fs.readFileSync('params.yaml', 'utf8'))
  for (const section of ['speech', 'session', 'path', 'observer', 'world']) {
    assert.ok(raw[section], `missing section ${section}`)
  }
  assert.ok(raw.world.camp.chest.length === 3)
  assert.ok(raw.world.tree_spots.every(s => s.length === 2))
  assert.ok(raw.world.pastures.every(s => s.length === 3))
})

test('config mirrors params.yaml values (hearing, radii)', () => {
  const raw = yaml.parse(fs.readFileSync('params.yaml', 'utf8'))
  assert.deepEqual(config.hearing, raw.speech.hearing)
  assert.equal(config.orderRadius, raw.speech.order_radius)
  assert.equal(config.sightRadius, raw.speech.sight_radius)
})

test('pathRetryPlan widens the goal radius and settles between attempts', () => {
  const plan = pathRetryPlan(2, 3, 500)
  assert.equal(plan.length, 3)
  assert.deepEqual(plan.map(p => p.range), [2, 4, 6])
  assert.deepEqual(plan.map(p => p.settleMs), [0, 500, 500])
  // Default retry count comes from params.yaml.
  assert.equal(pathRetryPlan(2).length, config.params.path.go_near_retries)
})

test('approachSides returns the chest plus three distinct offsets', () => {
  const chest = { x: 10, y: 70, z: 20, offset: (dx, dy, dz) => ({ x: 10 + dx, y: 70 + dy, z: 20 + dz }) }
  const sides = approachSides(chest)
  assert.equal(sides.length, 4)
  assert.deepEqual(sides[0], chest)
  const keys = new Set(sides.map(s => `${s.x},${s.z}`))
  assert.equal(keys.size, 4, 'approach points must differ')
})
