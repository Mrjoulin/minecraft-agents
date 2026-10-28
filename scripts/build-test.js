// Standalone check of crafting + building: one bot crafts planks and builds the whole hut.
import { Vec3 } from 'vec3'
import { createBody, countItems } from '../src/skills.js'
import { craftPlanks, buildCells, isBuilt, PLANKS } from '../src/building.js'
import { createHutBlueprint, hutProgress, describeProgress, SECTIONS } from '../src/blueprint.js'
import { consoleCommand, setupWorld } from '../src/gm.js'

const CAMP = { pad: new Vec3(-443, 71, -441), chest: new Vec3(-441, 71, -443), fire: new Vec3(-444, 71, -440), hut: new Vec3(-435, 71, -450) }
const { bot, ready } = createBody('Tester')
await ready
await setupWorld({ camp: CAMP, workers: [], commander: 'Tester' })
consoleCommand('give Tester oak_log 20')
await new Promise(resolve => setTimeout(resolve, 2000))
const planks = await craftPlanks(bot, 72)
console.log('planks crafted', planks, 'logs left', countItems(bot, /_log$/))
const bp = createHutBlueprint(CAMP.hut)
const started = Date.now()
for (const s of SECTIONS) {
  const r = await buildCells(bot, bp.sections[s])
  console.log(s, r, `${Math.round((Date.now() - started) / 1000)}s`)
}
console.log(describeProgress(hutProgress(bp, p => isBuilt(bot, p))), 'planks left', countItems(bot, PLANKS))
bot.quit()
process.exit(0)
