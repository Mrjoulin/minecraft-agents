import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateDecision } from '../src/agents/worker.js'
import { resolvePattern, depositShare, ITEMS } from '../src/items.js'

const act = action => validateDecision({ thought: 't', say: '', action })

test('deposit accepts any known item kind', () => {
  for (const item of ['logs', 'planks', 'emerald']) {
    const d = act({ type: 'deposit', item, n: 3 })
    assert.equal(d.action.type, 'deposit')
    assert.equal(d.action.item, item)
  }
})

test('deposit/give without a known item kind is rejected', () => {
  assert.throws(() => act({ type: 'deposit', item: 'diamond_sword' }), /needs a known item/)
  assert.throws(() => act({ type: 'deposit' }), /needs a known item/)
  assert.throws(() => act({ type: 'give', item: undefined }), /needs a known item/)
})

test('collect only works for logs', () => {
  assert.equal(act({ type: 'collect', item: 'logs', n: 4 }).action.n, 4)
  assert.throws(() => act({ type: 'collect', item: 'planks' }), /collect only works for logs/)
})

test('build_section still requires a section; unknown actions rejected', () => {
  assert.throws(() => act({ type: 'build_section' }), /needs a section/)
  assert.throws(() => act({ type: 'chop_wood' }), /bad action/)
  assert.equal(act({ type: 'wait_at_camp' }).action.item, null)
})

test('n is clamped to 0..16', () => {
  assert.equal(act({ type: 'deposit', item: 'logs', n: 99 }).action.n, 16)
  assert.equal(act({ type: 'deposit', item: 'logs', n: -5 }).action.n, 0)
})

test('item registry maps kinds to inventory patterns', () => {
  assert.ok(ITEMS.logs.test('oak_log'))
  assert.ok(ITEMS.planks.test('oak_planks'))
  assert.ok(ITEMS.emerald.test('emerald'))
  assert.throws(() => resolvePattern('diamond'), /Unknown item kind/)
})

test('depositShare: hoarders skim half (rounded up), others hand in everything', () => {
  assert.equal(depositShare(12, 'hoarder'), 6)
  assert.equal(depositShare(7, 'hoarder'), 4)
  assert.equal(depositShare(7, 'diligent'), 7)
  assert.equal(depositShare(0, 'hoarder'), 0)
})

test('a decision without an action is valid and produces action: null', () => {
  const d = validateDecision({ thought: 'nothing to do', say: 'hm' })
  assert.equal(d.action, null)
  assert.equal(d.thought, 'nothing to do')
  assert.equal(d.say, 'hm')
})

test('non-object decisions are rejected', () => {
  assert.throws(() => validateDecision(null), /not an object/)
  assert.throws(() => validateDecision('build the wall'), /not an object/)
  assert.throws(() => validateDecision(42), /not an object/)
})

test('thought and say are coerced to strings', () => {
  const d = validateDecision({ thought: 42, say: null, action: { type: 'wait_at_camp' } })
  assert.equal(d.thought, '42')
  assert.equal(d.say, '')
})

test('unknown directions are normalized; unknown sections are rejected for builds', () => {
  const d = act({ type: 'collect', item: 'logs', n: 3, direction: 'up' })
  assert.equal(d.action.direction, 'any')
  assert.throws(() => act({ type: 'build_section', section: 'garage' }), /needs a section/)
  assert.equal(act({ type: 'wait_at_camp', section: 'garage' }).action.section, null, 'garbage section is dropped where it does not matter')
})

test('the normalized decision is frozen and give/follow work', () => {
  const d = act({ type: 'give', item: 'emerald', n: 2 })
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.action))
  assert.equal(d.action.item, 'emerald')
  assert.equal(act({ type: 'follow_commander' }).action.type, 'follow_commander')
})
