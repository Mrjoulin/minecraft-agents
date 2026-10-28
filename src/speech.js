// Proximity communication: an utterance is delivered only to agents within hearing radius.
import { config } from './config.js'

export const VOLUMES = Object.freeze(Object.keys(config.hearing))

export function distance (a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/** Pure: which listeners can hear `speakerPos` at `volume`. listeners: [{name, pos}] */
export function computeHearers (speakerName, speakerPos, volume, listeners, radii = config.hearing) {
  const radius = radii[volume]
  if (radius === undefined) throw new Error(`Unknown volume "${volume}"`)
  return listeners
    .filter(l => l.name !== speakerName && distance(l.pos, speakerPos) <= radius)
    .map(l => l.name)
}

/**
 * Bus holding a registry of agents. Each agent provides getPos() and onHear(message).
 * Messages are frozen objects; the bus never mutates them.
 */
export function createSpeechBus ({ onMessage = () => {} } = {}) {
  let agents = new Map()

  function register (name, { getPos, onHear }) {
    agents = new Map(agents).set(name, { getPos, onHear })
  }

  function listeners () {
    return [...agents.entries()]
      .map(([name, a]) => ({ name, pos: a.getPos() }))
      .filter(l => l.pos)
  }

  function say (speaker, text, { volume = 'talk', to = null } = {}) {
    const entry = agents.get(speaker)
    const pos = entry?.getPos()
    if (!pos) throw new Error(`Speaker ${speaker} is not registered or has no position`)
    const heardBy = computeHearers(speaker, pos, volume, listeners())
    const message = Object.freeze({ speaker, text, volume, to, heardBy: Object.freeze(heardBy), at: Date.now() })
    onMessage(message)
    for (const name of heardBy) {
      try {
        agents.get(name).onHear(message)
      } catch (err) {
        console.error(`[speech] ${name} failed to handle message:`, err.message)
      }
    }
    return message
  }

  /** True when `a` is close enough to give an in-person order to `b`. */
  function canOrder (a, b, radius = config.orderRadius) {
    const pa = agents.get(a)?.getPos()
    const pb = agents.get(b)?.getPos()
    return Boolean(pa && pb && distance(pa, pb) <= radius)
  }

  return Object.freeze({ register, say, canOrder })
}
