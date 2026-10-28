// Standalone check of the commander's finale: crafting table + door, placed into the hut's door gap.
import { Vec3 } from 'vec3'
import { createBody } from '../src/skills.js'
import { craftAndPlaceDoor } from '../src/building.js'
import { createHutBlueprint } from '../src/blueprint.js'
import { consoleCommand } from '../src/gm.js'

const CAMP = { chest: new Vec3(-441, 71, -443), table: new Vec3(-439, 71, -443), hut: new Vec3(-435, 71, -450) }
const { bot, ready } = createBody('Tester')
await ready
consoleCommand('clear Tester')
consoleCommand('give Tester oak_log 5')
consoleCommand(`tp Tester ${process.env.TP || '-441 71 -441'}`)
await new Promise(resolve => setTimeout(resolve, 2500))
const t = Date.now()
const { ok, step } = await craftAndPlaceDoor(bot, { chest: CAMP.chest, table: CAMP.table, door: createHutBlueprint(CAMP.hut).door })
console.log('door placed:', ok, step, 'in', Date.now() - t, 'ms; table:', bot.blockAt(CAMP.table)?.name, '; door cell:', bot.blockAt(createHutBlueprint(CAMP.hut).door.bottom.x ? new Vec3(-435, 71, -448) : null)?.name)
console.log('heap MB', Math.round(process.memoryUsage().heapUsed / 1e6))
bot.quit()
process.exit(0)
