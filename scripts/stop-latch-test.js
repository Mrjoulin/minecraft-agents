// Shows why idle pathfinder.stop() breaks the next walk, and that setGoal(null) does not.
import { Vec3 } from 'vec3'
import { createBody, goNear, lastPathError } from '../src/skills.js'

const { bot, ready } = createBody('Tester')
await ready
await new Promise(resolve => setTimeout(resolve, 1500))
const here = bot.entity.position
const target = new Vec3(Math.floor(here.x) + 6, Math.floor(here.y), Math.floor(here.z))

bot.pathfinder.stop()
console.log('after idle stop():      reached =', await goNear(bot, target, 1, 10000), '|', lastPathError('Tester'))
bot.pathfinder.setGoal(null)
console.log('after idle setGoal(null): reached =', await goNear(bot, here, 1, 10000))
bot.quit()
process.exit(0)
