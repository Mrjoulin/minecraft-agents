// Terrain survey for seed selection: teleports a probe bot to a spot and grades the
// neighbourhood (flatness, water, trees, biome). Usage:
//   node scripts/survey-seed.js [x z] — survey around given coords (default: camp)
//   node scripts/survey-seed.js spawn — survey around the world spawn
import fs from 'node:fs'
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'

const AT_SPAWN = process.argv[2] === 'spawn'
const [x = -443, z = -441] = AT_SPAWN ? [] : process.argv.slice(2).map(Number)
const RADIUS = 64
const STEP = 8
const HEIGHTS_FROM = 112

const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: 'Probe', version: '1.21.4' })
bot.on('error', e => { console.error('ERR', e.message); process.exit(1) })
bot.on('kicked', r => { console.error('KICKED', JSON.stringify(r)); process.exit(1) })

const surfaceAt = (bx, bz) => {
  for (let y = HEIGHTS_FROM; y > 40; y--) {
    const b = bot.blockAt(new Vec3(bx, y, bz))
    if (!b) continue
    if (b.boundingBox === 'empty' && b.name !== 'water') continue
    if (/leaves|_log|azalea|mangrove_roots/.test(b.name)) continue // treetops are not terrain
    return { y, name: b.name, water: b.name === 'water' }
  }
  return null
}

bot.once('spawn', async () => {
  const cx = AT_SPAWN ? Math.floor(bot.entity.position.x) : x
  const cz = AT_SPAWN ? Math.floor(bot.entity.position.z) : z
  if (!AT_SPAWN) {
    fs.appendFileSync(new URL('../server/console.in', import.meta.url), `tp Probe ${x} 100 ${z}\n`)
    await new Promise(r => setTimeout(r, 1500))
    await bot.waitForChunksToLoad()
  }
  await new Promise(r => setTimeout(r, 2500))

  const samples = []
  let water = 0
  let sand = 0
  let logs = 0
  for (let dx = -RADIUS; dx <= RADIUS; dx += STEP) {
    for (let dz = -RADIUS; dz <= RADIUS; dz += STEP) {
      const s = surfaceAt(cx + dx, cz + dz)
      if (!s) continue
      samples.push({ dx, dz, y: s.y, water: s.water })
      if (s.water) water++
      if (/sand|gravel/.test(s.name)) sand++
    }
  }
  for (const v of bot.findBlocks({ matching: b => b.name.endsWith('_log'), maxDistance: RADIUS, count: 500 })) logs++

  const ys = samples.map(s => s.y)
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const avg = ys.reduce((a, b) => a + b, 0) / ys.length
  const sd = Math.sqrt(ys.reduce((a, y) => a + (y - avg) ** 2, 0) / ys.length)
  const at = (dx, dz) => samples.find(s => s.dx === dx && s.dz === dz)

  // Best camp patch (7x7 samples = 48x48 blocks): only dry land counts, flattest wins.
  let best = null
  for (let dx = -RADIUS; dx <= RADIUS - 6 * STEP; dx += STEP) {
    for (let dz = -RADIUS; dz <= RADIUS - 6 * STEP; dz += STEP) {
      const patch = []
      let wet = 0
      for (let ix = 0; ix <= 6; ix++) {
        for (let iz = 0; iz <= 6; iz++) {
          const s = at(dx + ix * STEP, dz + iz * STEP)
          if (!s) continue
          patch.push(s.y)
          if (s.water) wet += 1
        }
      }
      if (patch.length < 45 || wet > 0) continue
      const spread = Math.max(...patch) - Math.min(...patch)
      if (!best || spread < best.spread) best = { dx, dz, spread, y: Math.round(patch.reduce((a, b) => a + b, 0) / patch.length) }
    }
  }

  const centre = surfaceAt(cx, cz)
  const biome = centre ? bot.blockAt(new Vec3(cx, centre.y, cz))?.biome?.name ?? bot.blockAt(new Vec3(cx, centre.y + 1, cz))?.biome?.name : '?'
  console.log(JSON.stringify({
    seed_area: { x: cx, z: cz },
    surface: centre && { y: centre.y, name: centre.name },
    biome,
    height: { min, max, spread: max - min, avg: +avg.toFixed(1), sd: +sd.toFixed(2) },
    water_samples: `${water}/${samples.length}`,
    sand_samples: sand,
    trees_within_radius: logs,
    flattest_40x40: best && { at: { x: cx + best.dx, y: best.y, z: cz + best.dz }, spread: best.spread }
  }, null, 2))
  bot.quit()
  setTimeout(() => process.exit(0), 500)
})
