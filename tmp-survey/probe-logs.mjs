import fs from 'node:fs'
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'
const FIRE = new Vec3(-93, 71, 61)
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: 'Probe', version: '1.21.4' })
bot.on('error', e => { console.error('ERR', e.message); process.exit(1) })
bot.once('spawn', async () => {
  await bot.waitForChunksToLoad()
  const p = bot.entity.position
  console.log('spawn', p.floored().toString())
  const logs = bot.findBlocks({ matching: b => b.name.endsWith('_log'), maxDistance: 64, count: 300 })
  console.log('logs within 64:', logs.length, logs.slice(0, 10).map(v => v.toString()).join(' '))
  for (const [dx, dz] of [[-4, -13], [5, -18], [-6, -22], [3, -25], [4, 13]]) {
    const col = []
    for (let y = 74; y < 84; y++) col.push(bot.blockAt(FIRE.offset(dx, y - 71, dz))?.name?.[0] ?? '?')
    console.log(`tree spot (${dx},${dz}) y74..83:`, col.join(''))
  }
  bot.quit()
  setTimeout(() => process.exit(0), 400)
})
