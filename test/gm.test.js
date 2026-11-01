// gm.js tests. MC_CONSOLE_FIFO must point at a temp file before the dynamic import.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-gm-'))
process.env.MC_CONSOLE_FIFO = path.join(dir, 'console.in')

const { consoleCommand, announce, mirrorToGameChat, sunsetTimeline, revealTruth, scoreGuess } = await import('../src/gm.js')
const { DEMO_ROSTER } = await import('../src/personas.js')

const FIFO = path.join(dir, 'console.in')
const commands = () => fs.existsSync(FIFO) ? fs.readFileSync(FIFO, 'utf8').split('\n').filter(Boolean) : []
const lastCommand = () => commands().at(-1)
const lastJson = () => JSON.parse(lastCommand().replace(/^tellraw @a /, ''))

test('consoleCommand appends commands to the server console file', () => {
  const before = commands().length
  consoleCommand('say hello')
  consoleCommand('time set 1000')
  const all = commands()
  assert.deepEqual(all.slice(before), ['say hello', 'time set 1000'])
  assert.ok(lastCommand().endsWith('1000'))
})

test('consoleCommand wraps IO failures with a clear message', () => {
  const bogus = path.join(dir, 'missing-dir', 'console.in')
  assert.throws(() => consoleCommand('say hi', bogus), /Cannot write to server console/)
})

test('announce speaks as yellow [GM] via tellraw', () => {
  const before = commands().length
  announce('Session starting!')
  assert.equal(commands().length, before + 1)
  assert.ok(lastCommand().startsWith('tellraw @a '))
  assert.deepEqual(lastJson(), [
    { text: '[GM] ', color: 'yellow', bold: true },
    { text: 'Session starting!', color: 'yellow' }
  ])
})

test('mirrorToGameChat colors known agents and marks the addressee', () => {
  mirrorToGameChat({ speaker: 'Bram', text: 'on my way', to: 'Commander' })
  assert.deepEqual(lastJson(), [
    { text: 'Bram → Commander: ', color: 'aqua', bold: true },
    { text: 'on my way', color: 'white' }
  ])
  mirrorToGameChat({ speaker: 'Stranger', text: 'hi', to: null })
  assert.equal(lastJson()[0].color, 'white', 'unknown agents fall back to white')
})

test('sunsetTimeline walks time and light level monotonically', () => {
  const t = sunsetTimeline()
  assert.equal(t.length, 21, 'default: 20 steps + start')
  assert.deepEqual({ time: t[0].time, level: t[0].level }, { time: 11000, level: 1 })
  assert.deepEqual({ time: t.at(-1).time, level: t.at(-1).level }, { time: 14500, level: 0 })
  for (let i = 1; i < t.length; i++) assert.ok(t[i].time >= t[i - 1].time)
  const custom = sunsetTimeline({ from: 0, to: 10, steps: 2 })
  assert.deepEqual(custom.map(p => p.time), [0, 5, 10])
  assert.deepEqual(custom.map(p => p.level), [1, 0.5, 0])
})

test('revealTruth scores guesses against the hidden truth', () => {
  const rows = revealTruth(DEMO_ROSTER, {
    Bram: { guess: 'He is afraid of the dark and probably wants the best armor.' },
    Lina: { guess: 'no idea' }
  })
  assert.equal(rows.length, 3)
  const bram = rows.find(r => r.name === 'Bram')
  assert.deepEqual({ ...bram.score }, { trait: true, motive: true })
  const lina = rows.find(r => r.name === 'Lina')
  assert.deepEqual({ ...lina.score }, { trait: false, motive: false })
  assert.ok(rows.every(r => Object.isFrozen(r) && typeof r.trait === 'string' && typeof r.motive === 'string'))
})

test('scoreGuess is forgiving about phrasing but not about silence', () => {
  const odo = DEMO_ROSTER.find(p => p.name === 'Odo')
  assert.deepEqual({ ...scoreGuess(odo, 'I think he keeps some resources for himself') }, { trait: false, motive: true })
  assert.deepEqual({ ...scoreGuess(odo, null) }, { trait: false, motive: false })
  assert.deepEqual({ ...scoreGuess(odo, '') }, { trait: false, motive: false })
})
