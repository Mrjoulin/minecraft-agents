// Prints the blocks around the planned camp so the chest/campfire land on solid ground.
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: 'Probe', version: '1.21.4' })
bot.once('spawn', async () => {
  await bot.waitForChunksToLoad()
  for (const [label, p] of [['chest', new Vec3(-441, 71, -443)], ['fire', new Vec3(-444, 71, -440)], ['pad', new Vec3(-443, 71, -441)]]) {
    const rows = [-1, 0, 1].map(dy => `${p.y + dy}:${bot.blockAt(p.offset(0, dy, 0))?.name}`)
    console.log(label, rows.join(' '))
  }
  const ring = []
  for (let dx = -6; dx <= 6; dx += 2) for (let dz = -6; dz <= 6; dz += 2) {
    const b = bot.blockAt(new Vec3(-443 + dx, 70, -441 + dz)); ring.push(b?.name[0])
  }
  console.log('ground y70 sample (first letters):', ring.join(''))
  bot.quit()
})
bot.on('error', e => { console.error(e.message); process.exit(1) })
