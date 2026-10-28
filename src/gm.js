// Game Master: controls the world through the server console and owns the ground truth.
import fs from 'node:fs'
import { config } from './config.js'
import { record } from './events.js'

const SUNSET_STEPS = 20
const SUNSET_FROM = 11000
const SUNSET_TO = 14500
// Oak grove planted around camp each session (dx, dz from the campfire) so every run has the same wood supply.
const TREE_SPOTS = Object.freeze([
  [-4, -13], [5, -18], [-6, -22], [3, -25], [4, 13], [-5, 18], [6, 22], [-3, 25],
  [14, 1], [18, 5], [22, -6], [25, 3], [-13, 4], [-18, -5], [-22, 6], [-25, -3]
])
const PASTURES = Object.freeze([
  [14, 3, 'pig'], [15, -2, 'sheep'], [-15, 2, 'pig'], [-14, -3, 'cow'],
  [2, -16, 'sheep'], [-3, -15, 'pig'], [3, 15, 'cow'], [-2, 16, 'pig']
])

export function consoleCommand (command) {
  try {
    fs.appendFileSync(config.mc.consoleFifo, `${command}\n`)
  } catch (err) {
    throw new Error(`Cannot write to server console ${config.mc.consoleFifo}: ${err.message}`)
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function setupWorld ({ camp, workers, commander }) {
  const c = camp
  const commands = [
    'gamerule doDaylightCycle false',
    'gamerule doMobSpawning false',
    'gamerule sendCommandFeedback false',
    'gamerule announceAdvancements false',
    'weather clear',
    'time set 1000',
    // Flat 11x11 camp pad so chest and campfire stand on solid ground.
    `fill ${c.pad.x - 5} ${c.pad.y - 2} ${c.pad.z - 5} ${c.pad.x + 5} ${c.pad.y - 1} ${c.pad.z + 5} grass_block`,
    `fill ${c.pad.x - 5} ${c.pad.y} ${c.pad.z - 5} ${c.pad.x + 5} ${c.pad.y + 3} ${c.pad.z + 5} air`,
    ...TREE_SPOTS.map(([dx, dz]) =>
      `execute positioned ${c.fire.x + dx} 0 ${c.fire.z + dz} positioned over motion_blocking_no_leaves run place feature minecraft:oak`),
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
  for (const cmd of commands) {
    consoleCommand(cmd)
    await sleep(150)
  }
  record('gm', { text: 'World ready: camp chest + campfire placed, workers given stone axes, commander given 10 emeralds.' })
}

/** Gradual sunset so it is visible on video. */
export async function sunset () {
  record('gm', { text: 'The sun is setting…' })
  announce('The sun is setting…')
  for (let i = 0; i <= SUNSET_STEPS; i++) {
    consoleCommand(`time set ${Math.round(SUNSET_FROM + (SUNSET_TO - SUNSET_FROM) * i / SUNSET_STEPS)}`)
    record('daylight', { level: 1 - i / SUNSET_STEPS })
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
