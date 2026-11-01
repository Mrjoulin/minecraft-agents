// Game Master: controls the world through the server console and owns the ground truth.
import fs from 'node:fs'
import { config } from './config.js'
import { record } from './events.js'

const WORLD = config.params.world
const SUNSET = Object.freeze({ ...WORLD.sunset })
// Oak grove and pastures are defined in params.yaml, relative to the campfire.
const TREE_SPOTS = Object.freeze(WORLD.tree_spots)
const PASTURES = Object.freeze(WORLD.pastures)

export function consoleCommand (command, fifoPath = config.mc.consoleFifo) {
  try {
    fs.appendFileSync(fifoPath, `${command}\n`)
  } catch (err) {
    throw new Error(`Cannot write to server console ${fifoPath}: ${err.message}`)
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Pure: the full server-console command list for a fresh session. Drops and pastures
// from previous sessions are culled, each grove plot is cleared high and levelled, and
// the tree is planted at an explicit height — re-running the demo on a used world can
// neither stack new trees on old stumps nor plant them out of the bots' reach.
export function setupCommands ({ camp, workers, commander }) {
  const c = camp
  return [
    'gamerule doDaylightCycle false',
    'gamerule doMobSpawning false',
    'gamerule sendCommandFeedback false',
    'gamerule announceAdvancements false',
    'weather clear',
    'time set 1000',
    // Animals first: their loot then gets swept by the item pass below.
    'kill @e[type=pig]',
    'kill @e[type=cow]',
    'kill @e[type=sheep]',
    'kill @e[type=chicken]',
    'kill @e[type=item]',
    // Flat 11x11 camp pad so chest and campfire stand on solid ground.
    `fill ${c.pad.x - 5} ${c.pad.y - 2} ${c.pad.z - 5} ${c.pad.x + 5} ${c.pad.y - 1} ${c.pad.z + 5} grass_block`,
    `fill ${c.pad.x - 5} ${c.pad.y} ${c.pad.z - 5} ${c.pad.x + 5} ${c.pad.y + 3} ${c.pad.z + 5} air`,
    ...TREE_SPOTS.flatMap(([dx, dz]) => {
      const x = c.fire.x + dx
      const z = c.fire.z + dz
      return [
        `fill ${x - 2} ${c.fire.y} ${z - 2} ${x + 2} 120 ${z + 2} air`,
        `fill ${x - 2} ${c.fire.y - 1} ${z - 2} ${x + 2} ${c.fire.y - 1} ${z + 2} grass_block`,
        // Explicit height: "positioned over" once planted trees on top of leftovers.
        `execute positioned ${x} ${c.fire.y} ${z} run place feature minecraft:oak`
      ]
    }),
    // Flat, empty 9x9 building plot for the hut (after the trees, so no leaves hang into it).
    `fill ${c.hut.x - 4} ${c.hut.y - 2} ${c.hut.z - 4} ${c.hut.x + 4} ${c.hut.y - 1} ${c.hut.z + 4} grass_block`,
    `fill ${c.hut.x - 4} ${c.hut.y} ${c.hut.z - 4} ${c.hut.x + 4} ${c.hut.y + 6} ${c.hut.z + 4} air`,
    `setblock ${c.chest.x} ${c.chest.y} ${c.chest.z} air`,
    `setblock ${c.chest.x} ${c.chest.y} ${c.chest.z} chest`,
    `setblock ${c.fire.x} ${c.fire.y} ${c.fire.z} campfire`,
    `clear ${commander}`,
    `give ${commander} emerald 10`,
    `give ${commander} oak_log 4`, // reserved for the crafting table and the door
    ...workers.flatMap((w, i) => [
      `clear ${w}`,
      `give ${w} stone_axe 1`,
      `tp ${w} ${c.fire.x + 2 + i} ${c.fire.y} ${c.fire.z + 2}`
    ]),
    `tp ${commander} ${c.fire.x - 2} ${c.fire.y} ${c.fire.z}`,
    // Grazing animals scattered around the tree areas.
    ...PASTURES.map(([dx, dz, kind]) => `summon ${kind} ${c.fire.x + dx} ${c.fire.y + 6} ${c.fire.z + dz}`)
  ]
}

export async function setupWorld ({ camp, workers, commander }) {
  for (const cmd of setupCommands({ camp, workers, commander })) {
    consoleCommand(cmd)
    await sleep(150)
  }
  record('gm', { text: 'World ready: camp chest + campfire placed, workers given stone axes, commander given 10 emeralds.' })
}

/** Pure: the `time set` ticks of a gradual sunset, earliest first, with a 1→0 light level. */
export function sunsetTimeline ({ from = SUNSET.from, to = SUNSET.to, steps = SUNSET.steps } = {}) {
  return Array.from({ length: steps + 1 }, (_, i) =>
    Object.freeze({ time: Math.round(from + (to - from) * i / steps), level: 1 - i / steps }))
}

/** Gradual sunset so it is visible on video. */
export async function sunset () {
  record('gm', { text: 'The sun is setting…' })
  announce('The sun is setting…')
  for (const { time, level } of sunsetTimeline()) {
    consoleCommand(`time set ${time}`)
    record('daylight', { level })
    await sleep(1000)
  }
  record('gm', { text: 'Night has fallen.' })
}

const CHAT_COLORS = Object.freeze({ Commander: 'gold', Bram: 'aqua', Lina: 'light_purple', Odo: 'green' })

/** Show an agent utterance in the in-game chat so a human spectator (and their recording) sees it. */
export function mirrorToGameChat (message) {
  const target = message.to ? ` → ${message.to}` : ''
  const parts = [
    { text: `${message.speaker}${target}: `, color: CHAT_COLORS[message.speaker] || 'white', bold: true },
    { text: message.text, color: 'white' }
  ]
  consoleCommand(`tellraw @a ${JSON.stringify(parts)}`)
}

/** Game Master line in chat (yellow). */
export function announce (text) {
  consoleCommand(`tellraw @a ${JSON.stringify([{ text: '[GM] ', color: 'yellow', bold: true }, { text, color: 'yellow' }])}`)
}

const TRAIT_KEYWORDS = Object.freeze({
  nyctophobic: ['dark', 'night', 'fire', 'afraid', 'fear', 'scared'],
  animalLover: ['animal', 'pig', 'cow', 'sheep', 'distract'],
  diligent: ['diligent', 'hard-working', 'hardworking', 'efficient', 'reliable', 'productive']
})
const MOTIVE_KEYWORDS = Object.freeze({
  hoarder: ['hoard', 'keep', 'kept', 'withhold', 'skim', 'steal', 'missing', 'pocket', 'stash'],
  bestArmor: ['armor', 'armour', 'gear'],
  mostDiamonds: ['diamond']
})

/** Pure: did the commander's free-text guess identify the trait / motive? */
export function scoreGuess (persona, guessText) {
  const text = (guessText || '').toLowerCase()
  const hit = words => words.some(w => text.includes(w))
  return Object.freeze({
    trait: hit(TRAIT_KEYWORDS[persona.trait] || []),
    motive: hit(MOTIVE_KEYWORDS[persona.motive] || [])
  })
}

export function revealTruth (roster, finalBeliefs) {
  const rows = roster.map(p => {
    const guess = finalBeliefs?.[p.name]?.guess || ''
    return Object.freeze({ name: p.name, trait: p.traitLabel, motive: p.motiveLabel, guess, score: scoreGuess(p, guess) })
  })
  record('reveal', { rows })
  return rows
}
