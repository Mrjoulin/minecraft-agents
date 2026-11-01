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

const COLLECT = n => ({ thought: 'need logs first', say: '', action: { type: 'collect', item: 'logs', n, direction: 'any' } })
const BUILD = section => ({ thought: 'following the order', say: 'On it.', action: { type: 'build_section', section } })

/**
 * The build order I still owe, read from memory (newest lines first): an order to me
 * counts unless a newer `(done)` line closed it. Thought/event lines are skipped.
 */
function pendingBuild (system, user) {
  const me = (system.match(/^You are (\w+),/m) || [])[1]
  if (!me) return null
  const lines = (user.match(/^- (.+)$/gm) || []).map(l => l.replace(/^- /, '')).reverse()
  for (const line of lines) {
    if (/^\(done\) the .+ is/.test(line)) return null
    const m = line.match(new RegExp(`Commander said to ${me}: "([^"]*)"`))
    if (m && /build|wall|roof/.test(m[1])) return findSection(m[1])
  }
  return null
}

/** Worker policy: obey the moment's order, resume an unfinished one, else haul or idle. */
function workerDecision (system, user) {
  const carried = parseCarried(user)
  const now = user.split('NOW:')[1] || ''
  // Only an order spoken right now counts: mentions of walls in progress reports
  // or in memory must not resurrect a build order that is already done.
  const order = quotedOrder(now)
  const orderedSection = /build|wall|roof/.test(order) ? findSection(order) : null
  // An explicit build order wins: build if you have any material, gather if you have none.
  if (orderedSection) {
    if (carried.planks === 0 && carried.logs === 0) return COLLECT(6)
    return BUILD(orderedSection)
  }
  // Gather order (e.g. "collect 6 logs and bring them to the camp chest").
  if (/collect \d+ logs/.test(order) && carried.logs === 0) {
    const n = Number(order.match(/collect (\d+) logs/)[1]) || 6
    return { thought: 'gathering as ordered', say: '', action: { type: 'collect', item: 'logs', n, direction: 'any' } }
  }
  // Resume my own pending build (the "0 still missing"/"already finished" reports close it).
  const pending = /already finished|; 0 still missing/.test(now) ? null : pendingBuild(system, user)
  if (pending) {
    if (carried.planks === 0 && carried.logs === 0) return COLLECT(6)
    return BUILD(pending)
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

/** Hut progress as reported in the review prompt ("north wall 3/15, …"), best effort. */
const parseHutProgress = user => {
  const line = (user.match(/Hut \(last time I looked\): (.*)/) || [])[1] || ''
  const progress = {}
  for (const part of line.split(', ')) {
    const m = part.match(/(\d+)\/(\d+)$/)
    const section = findSection(part)
    if (section && m) progress[section] = { built: Number(m[1]), total: Number(m[2]) }
  }
  return progress
}

/** Commander policy: first orders everyone to gather, then builds unfinished sections two at a time. */
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
  const progress = parseHutProgress(user)
  // Sections with no reported progress count as untouched (the commander may not have looked yet).
  const unfinished = SECTIONS.filter(s => !progress[s] || progress[s].built < progress[s].total)
  const decisions = []
  if (chest >= 8) {
    // Rotate the builder pair with the audit value so the work (and the blame) is shared.
    const start = chest % Math.max(1, team.length)
    for (let i = 0; i < Math.min(2, team.length, unfinished.length); i++) {
      const agent = team[(start + i) % team.length]
      const section = unfinished[i]
      decisions.push({ agent, kind: 'order', say: `${agent}, build the ${section}.`, amount: 1 })
    }
  }
  return { thought: 'keep watching', beliefs: {}, decisions, watch: team[0] || null }
}

export async function askJson ({ agent, system, user, validate = x => x }) {
  const raw = agent === 'Commander' ? commanderDecision(system, user) : workerDecision(system, user)
  const parsed = validate(raw) // let the real validators reject malformed stubs in tests
  record('llm', { agent, ms: 0, tokens: 0, stub: true })
  return parsed
}
