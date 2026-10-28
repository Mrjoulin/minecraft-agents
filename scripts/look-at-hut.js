// Opens a 3D viewer on port 3008 from a spot facing the hut's door (for a quick visual check).
import { mineflayer as attachViewer } from 'prismarine-viewer'
import { createBody } from '../src/skills.js'
import { consoleCommand } from '../src/gm.js'

const { bot, ready } = createBody('Camera')
await ready
consoleCommand('tp Camera -435 71 -441')
await new Promise(resolve => setTimeout(resolve, 2000))
attachViewer(bot, { port: 3008, firstPerson: false, viewDistance: 4 })
setTimeout(() => { bot.quit(); process.exit(0) }, 90000)
