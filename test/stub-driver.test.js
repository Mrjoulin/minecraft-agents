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

test('stub review orders builds once wood is in the chest', async () => {
  const user = 'Logs in the camp chest (last audit): 12. Tally: none.\nUpdate beliefs. Choose decisions.'
  const d = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user })
  assert.equal(d.decisions.length, 2, 'two builders per review')
  assert.ok(d.decisions.every(x => x.kind === 'order'))
  assert.ok(d.decisions.every(x => /build the (north_wall|south_wall|east_wall|west_wall|roof)/.test(x.say)))
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

// --- Regression tests: the worker stub must not resurrect finished build orders ---

test('a finished section does not loop the worker back into building it', async () => {
  // Memory still holds the old order; NOW is the completion report.
  const user = 'Time: day. You carry 0 logs, 0 planks and 0 emeralds.\n' +
    'Recent memory:\n- Commander said to Bram: "Bram, build the north_wall."\n' +
    'NOW: The north wall is already finished. What do you say and do?'
  const d = await workerTurn(user)
  assert.equal(d.action.type, 'wait_at_camp', 'must not rebuild')
})

test('a placement report does not count as a build order either', async () => {
  const user = 'Time: day. You carry 0 logs, 2 planks and 0 emeralds.\n' +
    'Recent memory:\n- Commander said to Bram: "Bram, build the south_wall."\n' +
    'NOW: You placed 13 blocks on the south wall; 0 still missing. What do you say and do?'
  const d = await workerTurn(user)
  assert.equal(d.action.type, 'wait_at_camp')
})

test('build orders work in both spellings: north_wall and "north wall"', async () => {
  const d = await workerTurn('Time: day. You carry 2 logs, 0 planks and 0 emeralds.\nNOW: Commander just spoke to you: "Odo, build the west wall". What do you say and do?')
  assert.equal(d.action.type, 'build_section')
  assert.equal(d.action.section, 'west_wall')
})

test('a gather order loses to depositing when the worker already carries logs', async () => {
  const d = await workerTurn('Time: day. You carry 5 logs, 0 planks and 0 emeralds.\nNOW: Commander just spoke to you: "Bram, collect 6 logs and bring them to the camp chest." What do you say and do?')
  assert.equal(d.action.type, 'deposit')
  assert.equal(d.action.n, 5)
})

test('collect orders honour a custom amount', async () => {
  const d = await workerTurn('Time: day. You carry 0 logs, 0 planks and 0 emeralds.\nNOW: Commander just spoke to you: "Lina, collect 4 logs and bring them to the camp chest." What do you say and do?')
  assert.equal(d.action.n, 4)
})

test('after a bare direction the worker rotates to the next compass point', async () => {
  const cases = { north: 'east', east: 'south', south: 'west', west: 'north' }
  for (const [failed, expected] of Object.entries(cases)) {
    const d = await workerTurn(`Time: day. You carry 0 logs, 0 planks and 0 emeralds.\nNOW: You could not find any reachable logs to the ${failed}. Try another direction or report back. What do you say and do?`)
    assert.equal(d.action.type, 'collect')
    assert.equal(d.action.direction, expected, `after failing to the ${failed}`)
  }
})

// --- Commander stub: review flow passes the real validator end to end ---

test('stub review with little wood orders nothing but keeps watching', async () => {
  const { validateReview } = await import('../src/agents/commander.js')
  const user = 'Logs in the camp chest (last audit): 5. Emeralds left: 10.\nUpdate beliefs. Choose decisions.'
  const d = await askJson({
    agent: 'Commander',
    system: COMMANDER_SYSTEM,
    user,
    validate: validateReview(['Bram', 'Lina', 'Odo'])
  })
  assert.deepEqual(d.decisions, [])
  assert.equal(d.watch, 'Bram')
  assert.deepEqual(Object.keys(d.beliefs), ['Bram', 'Lina', 'Odo'], 'validator fills belief slots for the whole team')
})

test('stub review build order names a real worker and a real section', async () => {
  const { validateReview } = await import('../src/agents/commander.js')
  const { SECTIONS } = await import('../src/blueprint.js')
  const user = 'Logs in the camp chest (last audit): 12. Emeralds left: 10.\nUpdate beliefs. Choose decisions.'
  const d = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user, validate: validateReview(['Bram', 'Lina', 'Odo']) })
  assert.ok(d.decisions.length >= 1)
  const order = d.decisions[0]
  assert.ok(['Bram', 'Lina', 'Odo'].includes(order.agent))
  const named = SECTIONS.find(s => order.say.includes(s) || order.say.includes(s.replace('_', ' ')))
  assert.ok(named, `order should name a section, got: ${order.say}`)
})

// --- Regression tests: an unfinished build order must be resumed from memory ---

test('worker resumes its own pending build order on an idle tick', async () => {
  const user = 'Time: day. You carry 6 logs, 0 planks and 0 emeralds.\n' +
    'Recent memory:\n- Commander said to Bram: "Bram, build the north_wall."\n- (you thought) nothing pressing\n' +
    'NOW: You hear birds. What do you say and do?'
  const d = await workerTurn(user)
  assert.equal(d.action.type, 'build_section')
  assert.equal(d.action.section, 'north_wall')
})

test('worker with a pending order gathers first when empty-handed', async () => {
  const user = 'Time: day. You carry 0 logs, 0 planks and 0 emeralds.\n' +
    'Recent memory:\n- Commander said to Bram: "Bram, build the west_wall."\n' +
    'NOW: You hear birds. What do you say and do?'
  const d = await workerTurn(user)
  assert.equal(d.action.type, 'collect')
})

test('an order addressed to another worker is not my business', async () => {
  const user = 'Time: day. You carry 0 logs, 0 planks and 0 emeralds.\n' +
    'Recent memory:\n- Commander said to Lina: "Lina, build the south_wall."\n' +
    'NOW: You hear birds. What do you say and do?'
  const d = await workerTurn(user)
  assert.equal(d.action.type, 'wait_at_camp')
})

test('a (done) memory line closes the build thread', async () => {
  const user = 'Time: day. You carry 6 logs, 0 planks and 0 emeralds.\n' +
    'Recent memory:\n- Commander said to Bram: "Bram, build the north_wall."\n- (you thought) following the order\n- (done) the north wall is complete\n' +
    'NOW: You hear birds. What do you say and do?'
  const d = await workerTurn(user)
  assert.equal(d.action.type, 'deposit', 'leftovers go to the chest, the wall is done')
})

test('mid-build report with missing blocks resumes the build, not a deposit', async () => {
  const carrying = 'Time: day. You carry 4 logs, 0 planks and 0 emeralds.\n' +
    'Recent memory:\n- Commander said to Bram: "Bram, build the south_wall."\n' +
    'NOW: You placed 3 blocks on the south wall; 10 still missing. You ran out of planks and the chest had too few logs. What do you say and do?'
  const d = await workerTurn(carrying)
  assert.equal(d.action.type, 'build_section')
  assert.equal(d.action.section, 'south_wall')

  const empty = 'Time: day. You carry 0 logs, 0 planks and 0 emeralds.\n' +
    'Recent memory:\n- Commander said to Bram: "Bram, build the south_wall."\n' +
    'NOW: You placed 3 blocks on the south wall; 10 still missing. You ran out of planks and the chest had too few logs. What do you say and do?'
  const d2 = await workerTurn(empty)
  assert.equal(d2.action.type, 'collect', 'gathers first, builds after')
})

test('a gather order does not resurrect as a build', async () => {
  const user = 'Time: day. You carry 0 logs, 0 planks and 0 emeralds.\n' +
    'Recent memory:\n- Commander said to Bram: "Bram, collect 6 logs and bring them to the camp chest."\n' +
    'NOW: You put 6 logs into the camp chest. You still carry 0 logs. What do you say and do?'
  const d = await workerTurn(user)
  assert.equal(d.action.type, 'wait_at_camp')
})

// --- Commander stub: build orders follow the actual hut progress ---

const PROGRESS = 'Hut (last time I looked): north wall 15/15, south wall 0/13, east wall 15/15, west wall 0/9, roof 0/25'

test('commander orders two builders onto two unfinished sections', async () => {
  const { validateReview } = await import('../src/agents/commander.js')
  const user = `Logs in the camp chest (last audit): 30. Emeralds left: 10.\n${PROGRESS}\nUpdate beliefs. Choose decisions.`
  const d = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user, validate: validateReview(['Bram', 'Lina', 'Odo']) })
  assert.equal(d.decisions.length, 2)
  assert.notEqual(d.decisions[0].agent, d.decisions[1].agent, 'two different builders')
  assert.deepEqual(
    d.decisions.map(x => x.say.match(/build the (\w+)/)[1]).sort(),
    ['south_wall', 'west_wall'],
    'the two oldest unfinished sections come first'
  )
})

test('commander orders nothing when the hut is complete', async () => {
  const user = `Logs in the camp chest (last audit): 2. Emeralds left: 10.\nHut (last time I looked): north wall 15/15, south wall 13/13, east wall 9/9, west wall 9/9, roof 25/25\nUpdate beliefs. Choose decisions.`
  const d = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user })
  assert.deepEqual(d.decisions, [])
})

test('commander keeps ordering when it has not seen the hut yet', async () => {
  const user = 'Logs in the camp chest (last audit): 10. Emeralds left: 10.\nUpdate beliefs. Choose decisions.'
  const d = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user })
  assert.equal(d.decisions.length, 2, 'no progress report = assume untouched')
})

test('commander rotates the builder pair as the chest audit changes', async () => {
  const mk = chest => `Logs in the camp chest (last audit): ${chest}. Emeralds left: 10.\n${PROGRESS}\nUpdate beliefs. Choose decisions.`
  const first = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user: mk(30) })
  const second = await askJson({ agent: 'Commander', system: COMMANDER_SYSTEM, user: mk(10) })
  const names = d => d.decisions.map(x => x.agent).join(',')
  assert.equal(names(first), 'Bram,Lina', '30 % 3 = 0 → team head')
  assert.equal(names(second), 'Lina,Odo', '10 % 3 = 1 → rotated')
  assert.ok(second.decisions.every(x => x.kind === 'order'))
})
