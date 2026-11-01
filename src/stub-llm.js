// Algorithmic stand-in for the LLM: same askJson contract, no network. Used for
// offline runs (LLM_STUB=1) and for tests. It heuristically parses the same
// prompts the real model sees, so the whole agent pipeline runs without an API.
import { record } from './events.js'

const SECTIONS = ['north_wall', 'south_wall', 'east_wall', 'west_wall', 'roof']
// Compass rotation used after a bare area: north → east → south → west → north.
const NEXT_DIRECTION = Object.freeze({ north: 'east', east: 'south', south: 'west', west: 'north' })

const parseCarried = user => {
  const m = user.match(/You carry (\d+) logs, (\d+) planks and (\d+) emeralds/)
  return m ? { logs: Number(m[1]), planks: Number(m[2]), emeralds: Number(m[3]) } : { logs: 0, planks: 0, emeralds: 0 }
}

// Section names appear both spelled "north_wall" and as plain words "north wall".
const findSection = text => SECTIONS.find(s => text.includes(s) || text.includes(s.replace('_', ' '))) || null

/** The words the Commander said in this very moment (empty unless they just spoke to us). */
const quotedOrder = now => (now.match(/Commander just spoke to you: "([^"]*)"/) || [])[1] || ''

/** Worker policy: deposit what you carry, else gather, else idle. */
function workerDecision (user) {
  const carried = parseCarried(user)
  const now = user.split('NOW:')[1] || ''
  // Only an order spoken right now counts: mentions of walls in progress reports
  // or in memory must not resurrect a build order that is already done.
  const order = quotedOrder(now)
  const orderedSection = /build|wall|roof/.test(order) ? findSection(order) : null
  // An explicit build order wins: build if you have any material, gather if you have none.
  if (orderedSection) {
    if (carried.planks === 0 && carried.logs === 0) return { thought: 'need logs first', say: '', action: { type: 'collect', item: 'logs', n: 6, direction: 'any' } }
    return { thought: 'following the order', say: 'On it.', action: { type: 'build_section', section: orderedSection } }
  }
  // Gather order (e.g. "collect 6 logs and bring them to the camp chest").
  if (/collect \d+ logs/.test(order) && carried.logs === 0) {
    const n = Number(order.match(/collect (\d+) logs/)[1]) || 6
    return { thought: 'gathering as ordered', say: '', action: { type: 'collect', item: 'logs', n, direction: 'any' } }
  }
  if (carried.logs > 0) return { thought: 'delivering carried logs', say: 'Bringing logs in.', action: { type: 'deposit', item: 'logs', n: carried.logs } }
  if (/could not find any reachable logs/.test(now)) {
    // Rotate compass direction so a bare area is not hammered forever.
    const failed = (now.match(/to the (north|south|east|west)/) || [])[1]
    return { thought: 'trying another direction', say: 'Nothing here, moving on.', action: { type: 'collect', item: 'logs', n: 6, direction: NEXT_DIRECTION[failed] || 'north' } }
  }
  return { thought: 'nothing pressing', say: '', action: { type: 'wait_at_camp' } }
}

const teamFromSystem = system => (system.match(/team: ([^.]+)/) || [])[1]?.split(',').map(s => s.trim()).filter(Boolean) || []

/** Commander policy: first orders everyone to gather, then rotates build orders. */
function commanderDecision (system, user) {
  const team = teamFromSystem(system)
  if (/Give each worker a first order/.test(user)) {
    return {
      thought: 'gather wood first',
      assignments: team.map(name => ({ agent: name, say: `${name}, collect 6 logs and bring them to the camp chest.` }))
    }
  }
  if (/FINAL guess/.test(user) || /session is over/.test(user)) {
    const beliefs = Object.fromEntries(team.map(n => [n, { guess: 'unknown', confidence: 0, evidence: '' }]))
    return { thought: 'no idea', beliefs, decisions: [], watch: null }
  }
  const chestMatch = user.match(/last audit\): (\d+)/)
  const chest = chestMatch ? Number(chestMatch[1]) : 0
  const builder = team[Math.floor(Math.random() * team.length)] || null
  const section = SECTIONS[Math.floor(Math.random() * SECTIONS.length)]
  const decisions = chest >= 8 && builder
    ? [{ agent: builder, kind: 'order', say: `${builder}, build the ${section}.`, amount: 1 }]
    : []
  return { thought: 'keep watching', beliefs: {}, decisions, watch: team[0] || null }
}

export async function askJson ({ agent, system, user, validate = x => x }) {
  const raw = agent === 'Commander' ? commanderDecision(system, user) : workerDecision(user)
  const parsed = validate(raw) // let the real validators reject malformed stubs in tests
  record('llm', { agent, ms: 0, tokens: 0, stub: true })
  return parsed
}
