// Connects one bot and reports what is around spawn (trees, animals, terrain).
import mineflayer from 'mineflayer'
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: 'Probe', version: '1.21.4' })
bot.once('spawn', async () => {
  await bot.waitForChunksToLoad()
  const p = bot.entity.position
  console.log('spawn', p.floored().toString(), 'time', bot.time.timeOfDay)
  const logs = bot.findBlocks({ matching: b => b.name.endsWith('_log'), maxDistance: 48, count: 200 })
  const kinds = {}
  for (const v of logs) { const n = bot.blockAt(v).name; kinds[n] = (kinds[n] || 0) + 1 }
  console.log('logs within 48:', logs.length, kinds, 'nearest', logs[0]?.toString())
  const ents = Object.values(bot.entities).filter(e => e !== bot.entity)
  console.log('entities:', ents.map(e => `${e.name}@${e.position.floored()}`).slice(0, 30).join(' '))
  const ground = bot.blockAt(p.offset(0, -1, 0))
  console.log('standing on', ground?.name)
  bot.quit()
})
bot.on('error', e => { console.error('ERR', e.message); process.exit(1) })
bot.on('kicked', r => { console.error('KICKED', r); process.exit(1) })
