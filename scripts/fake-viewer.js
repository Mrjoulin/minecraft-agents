// Test helper: joins like a human, waits, then types !start.
import mineflayer from 'mineflayer'
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: 'Viewer', version: '1.21.4' })
bot.once('spawn', () => {
  setTimeout(() => { console.log('gamemode', bot.game.gameMode); bot.chat('!start') }, 6000)
  setTimeout(() => { bot.quit(); process.exit(0) }, 9000)
})
bot.on('messagestr', m => console.log('chat:', m))
bot.on('error', e => { console.error(e.message); process.exit(1) })
