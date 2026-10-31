import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askJson } from '../src/stub-llm.js'
import { validateDecision } from '../src/agents/worker.js'

const WORKER_SYSTEM = 'You are Bram, a stocky woodcutter, a worker in a Minecraft team led by "Commander". ' +
  'Available actions: collect, deposit, build_section, wait_at_camp, give, follow_commander.'
const COMMANDER_SYSTEM = 'You are "Commander", leader of a Minecraft team: Bram, Lina, Odo. ' +
  'Ultimate goal: build a hut.'

const workerTurn = async user => askJson({ agent: 'Bram', system: WORKER_SYSTEM, user, validate: validateDecision })

test('stub deposits what the worker carries', async () => {
  const d = await workerTurn('Time: day. You carry 12 logs, 0 planks and 0 emeralds.\nNOW: You gathered 12 logs. What do you say and do?')
  assert.equal(d.action.type, 'deposit')
  assert.equal(d.action.item, 'logs')
})

test('stub builds the ordered section when told in person', async () => {
  const d = await workerTurn('Time: day. You carry 2 logs, 10 planks and 0 emeralds.\nNOW: Commander just spoke to you: "Bram, build the north_wall". What do you say and do?')
  assert.equal(d.action.type, 'build_section')
  assert.equal(d.action.section, 'north_wall')
})

test('stub gathers logs first when ordered to build empty-handed', async () => {
  const d = await workerTurn('Time: day. You carry 0 logs, 0 planks and 0 emeralds.\nNOW: Commander just spoke to you: "Lina, build the roof". What do you say and do?')
  assert.equal(d.action.type, 'collect')
  assert.equal(d.action.item, 'logs')
})

test('stub gathers when ordered to collect logs', async () => {
  const d = await workerTurn('Time: day. You carry 0 logs, 0 planks and 0 emeralds.\nNOW: Commander just spoke to you: "Bram, collect 6 logs and bring them to the camp chest." What do you say and do?')
  assert.equal(d.action.type, 'collect')
  assert.equal(d.action.n, 6)
})

test('stub idles when nothing is pressing', async () => {
  const d = await workerTurn('Time: day. You carry 0 logs, 0 planks and 0 emeralds.\nNOW: You hear birds. What do you say and do?')
  assert.equal(d.action.type, 'wait_at_camp')
})

test('stub plan gives every worker a gather order', async () => {
  const d = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user: 'Give each worker a first order: gather about 6 logs each.' })
  assert.deepEqual(d.assignments.map(a => a.agent), ['Bram', 'Lina', 'Odo'])
  assert.ok(d.assignments.every(a => /collect 6 logs/.test(a.say)))
})

test('stub review orders a build once wood is in the chest', async () => {
  const user = 'Logs in the camp chest (last audit): 12. Tally: none.\nUpdate beliefs. Choose decisions.'
  const d = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user })
  assert.equal(d.decisions.length, 1)
  assert.equal(d.decisions[0].kind, 'order')
  assert.match(d.decisions[0].say, /build the (north_wall|south_wall|east_wall|west_wall|roof)/)
})

test('stub final review admits it knows nothing, no decisions', async () => {
  const d = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user: 'The session is over. Give your FINAL guess of each worker\'s hidden trait and secret motive. No decisions.' })
  assert.equal(d.decisions.length, 0)
  assert.deepEqual(Object.keys(d.beliefs), ['Bram', 'Lina', 'Odo'])
})

test('stub worker decisions always pass the real validator', async () => {
  // The stub must produce decisions the body can execute — validated here directly.
  for (const now of ['You gathered 5 logs.', 'Commander just spoke to you: "Odo, build the west_wall"', 'You hear wind.']) {
    const d = await workerTurn(`Time: day. You carry 0 logs, 0 planks and 0 emeralds.\nNOW: ${now} What do you say and do?`)
    assert.ok(d.action === null || ['collect', 'deposit', 'build_section', 'wait_at_camp', 'give', 'follow_commander'].includes(d.action.type))
  }
})
