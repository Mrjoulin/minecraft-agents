// startGate tests. MC_CONSOLE_FIFO must point at a temp file before the dynamic import.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-startgate-'))
process.env.MC_CONSOLE_FIFO = path.join(dir, 'console.in')

const { manageSpectators, waitForStart } = await import('../src/startGate.js')

const FIFO = path.join(dir, 'console.in')
const commands = () => fs.existsSync(FIFO) ? fs.readFileSync(FIFO, 'utf8').split('\n').filter(Boolean) : []

test('non-bot players are turned into spectators, bots are left alone', () => {
  const bot = new EventEmitter()
  bot.players = { Bram: {}, Steve: {} }
  const before = commands().length
  manageSpectators(bot, ['Bram', 'Commander'])
  const issued = commands().slice(before)
  assert.ok(issued.includes('gamemode spectator Steve'), issued.join('\n'))
  assert.ok(issued.some(c => c.startsWith(`tellraw Steve `) && c.includes('spectator')))
  assert.ok(!issued.some(c => c.includes('Bram')), 'bots must not be touched')
  assert.equal(issued.filter(c => c === 'gamemode spectator Steve').length, 1)

  // A human joining later is welcomed too; a bot joining is not.
  const mid = commands().length
  bot.emit('playerJoined', { username: 'Alex' })
  bot.emit('playerJoined', { username: 'Bram' })
  const nowIssued = commands().slice(mid)
  assert.ok(nowIssued.includes('gamemode spectator Alex'))
  assert.equal(nowIssued.filter(c => c.startsWith('gamemode')).length, 1, 'bots are skipped')
})

test('waitForStart ignores bots and wrong words, resolves on a spectator !start', async t => {
  const bot = new EventEmitter()
  const started = waitForStart(bot, ['Bram'])
  let resolved = false
  started.then(() => { resolved = true })
  // Safety net: always start the session so the reminder interval is cleared.
  t.after(() => bot.emit('chat', 'Closer', '!start'))

  bot.emit('chat', 'Bram', '!start')
  bot.emit('chat', 'Steve', 'not yet!')
  await new Promise(setImmediate)
  assert.equal(resolved, false, 'bot chat and other words must not start the session')

  bot.emit('chat', 'Steve', '  !Start  ')
  await Promise.race([started, new Promise((_, rej) => setTimeout(() => rej(new Error('!start did not resolve')), 500))])
  assert.ok(commands().some(c => c.includes('Session starting!')))
})
