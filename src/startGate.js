// Lets a human join as a spectator and decide when the session starts.
import readline from 'node:readline'
import { consoleCommand, announce } from './gm.js'
import { record } from './events.js'

const START_WORD = '!start'
const REMINDER_MS = 30000

/** Every non-bot player who joins becomes a spectator so they cannot disturb the agents. */
export function manageSpectators (bot, botNames) {
  const bots = new Set(botNames)
  const welcome = name => {
    consoleCommand(`gamemode spectator ${name}`)
    consoleCommand(`tellraw ${name} ${JSON.stringify({ text: 'You are a spectator. Left-click a bot to see through its eyes, Shift to leave. Type !start in chat when your recording is ready.', color: 'yellow' })}`)
    record('gm', { text: `${name} joined as a spectator.` })
  }
  Object.keys(bot.players).filter(n => !bots.has(n)).forEach(welcome)
  bot.on('playerJoined', player => { if (!bots.has(player.username)) welcome(player.username) })
}

/** Resolves when a non-bot player types !start in game chat, or Enter is pressed in the terminal. */
export function waitForStart (bot, botNames) {
  const bots = new Set(botNames)
  record('gm', { text: `Waiting: type ${START_WORD} in Minecraft chat (or press Enter in the terminal) to start.` })
  announce(`Agents are ready. Type ${START_WORD} in chat to begin.`)
  return new Promise(resolve => {
    const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin }) : null
    const reminder = setInterval(() => announce(`Waiting for ${START_WORD}…`), REMINDER_MS)
    const finish = who => {
      clearInterval(reminder)
      bot.off('chat', onChat)
      rl?.close()
      record('gm', { text: `Session started by ${who}.` })
      announce('Session starting!')
      resolve()
    }
    const onChat = (username, message) => {
      if (!bots.has(username) && message.trim().toLowerCase() === START_WORD) finish(username)
    }
    bot.on('chat', onChat)
    rl?.once('line', () => finish('terminal'))
  })
}
