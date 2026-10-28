// Reproduces a delivery: teleports a test bot ~20 blocks north of camp with logs and deposits them.
import { Vec3 } from 'vec3'
import { createBody, depositToChest, countItems, lastPathError } from '../src/skills.js'
import { consoleCommand } from '../src/gm.js'

const CHEST = new Vec3(-441, 71, -443)
const { bot, ready } = createBody('Tester')
await ready
consoleCommand('clear Tester')
consoleCommand('give Tester oak_log 5')
consoleCommand(`execute positioned ${CHEST.x - 3} 0 ${CHEST.z - 20} positioned over motion_blocking_no_leaves run tp Tester ~ ~ ~`)
await new Promise(resolve => setTimeout(resolve, 3000))
console.log('start', bot.entity.position.floored().toString(), 'logs', countItems(bot, /_log$/))
const t = Date.now()
const deposited = await depositToChest(bot, CHEST, /_log$/, 5)
console.log('deposited', deposited, 'in', Date.now() - t, 'ms; end', bot.entity.position.floored().toString(), 'pathError', lastPathError('Tester'))
bot.quit()
process.exit(0)
