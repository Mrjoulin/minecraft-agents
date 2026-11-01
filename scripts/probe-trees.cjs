#!/usr/bin/env node
'use strict'
/*
 * Read-only probe: joins the server, teleports to camp (via console.in) and
 * reports what the BOT-SIDE world copy sees at the planted tree spots —
 * findBlocks for logs, direct blockAt at known trunk positions, loaded column
 * count. Takes no actions, so it does not disturb a running session.
 *
 * Usage: node scripts/probe-trees.cjs
 */
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '..')

async function main () {
  const { createBody } = await import(pathToFileURL(path.join(ROOT, 'src/skills.js')).href)
  const { bot, ready } = createBody('ProbeTrees')
  await ready
  console.log('probe spawned at', bot.entity.position.floored())

  // Teleport to the worker's exact spawn-of-day spot via the server console.
  const consoleIn = path.join(ROOT, 'server', 'console.in')
  fs.appendFileSync(consoleIn, 'tp ProbeTrees -90 71 63\n')
  await new Promise(r => setTimeout(r, 4000))
  console.log('probe at', bot.entity.position.floored(), '| feetY =', bot.entity.position.y, '| columns loaded:', bot.world.getColumns().length)

  // The exact production search, step by step, from the worker's exact tp spot.
  const NATURAL_LOG = /^(oak|birch|spruce|jungle|acacia|dark_oak|cherry|mangrove)_log$/
  const found = bot.findBlocks({ matching: b => b && NATURAL_LOG.test(b.name), maxDistance: 48, count: 80 })
  console.log('findBlocks oak_log within 48:', found.length)
  const feetY = bot.entity.position.y
  console.log('feetY =', feetY, '| filter window: y in [', Math.floor(feetY), ',', feetY + 2, ']')
  const passed = found.filter(p => p.y <= feetY + 2 && p.y >= Math.floor(feetY))
  console.log('candidates after production y-filter:', passed.length)
  for (const p of passed.slice(0, 8)) console.log('  candidate', p.floored() + '', '->', bot.blockAt(p)?.name)

  // Known planted spots (tree_spots around fire (-93,71,61)): vertical trunk slice y=70..77.
  const spots = [[-97, 48], [-88, 43], [-79, 62], [-89, 74], [-75, 66], [-115, 67]]
  const Vec3 = require('vec3')
  for (const [x, z] of spots) {
    const names = []
    for (let y = 70; y <= 77; y++) {
      const b = bot.blockAt(new Vec3(x, y, z))
      names.push(b ? b.name : 'null')
    }
    console.log(`spot (${x},${z}): ` + names.join(','))
  }
  bot.quit()
  setTimeout(() => process.exit(0), 800)
}

main().catch(err => { console.error('probe failed:', err); try { process.exit(1) } catch {} })
