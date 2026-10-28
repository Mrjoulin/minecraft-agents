// Demo scenario: Commander + 3 hidden-persona workers gather logs; night falls mid-session.
import { Vec3 } from 'vec3'
import { mineflayer as attachViewer } from 'prismarine-viewer'
import { config } from './config.js'
import { record, runInfo } from './events.js'
import { createSpeechBus } from './speech.js'
import { createHutBlueprint, hutProgress, describeProgress } from './blueprint.js'
import { isBuilt } from './building.js'
import { DEMO_ROSTER } from './personas.js'
import { createWorker } from './agents/worker.js'
import { createCommander } from './agents/commander.js'
import { setupWorld, sunset, revealTruth, mirrorToGameChat, announce } from './gm.js'
import { manageSpectators, waitForStart } from './startGate.js'
import { startDashboard } from './dashboard/server.js'

const GOAL = 'Build a small wooden hut next to camp before night: gather logs into the camp chest, then have the team craft planks and build the walls and roof.'
const CAMP = Object.freeze({
  pad: new Vec3(-443, 71, -441),
  chest: new Vec3(-441, 71, -443),
  fire: new Vec3(-444, 71, -440),
  hut: new Vec3(-435, 71, -450),
  table: new Vec3(-439, 71, -443)
})
const SESSION_MS = Number(process.env.SESSION_MS || 450000)
const SUNSET_AT_MS = Number(process.env.SUNSET_AT_MS || 240000)
const WAIT_FOR_START = process.env.WAIT_FOR_START === '1'
const MIRROR_CHAT = process.env.MIRROR_CHAT !== '0'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main () {
  const bus = createSpeechBus({
    onMessage: m => {
      record('speech', { agent: m.speaker, text: m.text, to: m.to, heardBy: m.heardBy })
      if (MIRROR_CHAT) mirrorToGameChat(m)
    }
  })
  const dashboard = startDashboard({ team: DEMO_ROSTER.map(p => p.name), goal: GOAL })

  const blueprint = createHutBlueprint(CAMP.hut)
  const workers = []
  for (const persona of DEMO_ROSTER) {
    workers.push(createWorker({ persona, bus, camp: CAMP, blueprint }))
    await sleep(1200)
  }
  const commander = createCommander({ goal: GOAL, team: DEMO_ROSTER.map(p => p.name), bus, camp: CAMP, blueprint })
  await Promise.all([...workers.map(w => w.ready), commander.ready])
  record('gm', { text: `All bots connected. Log file: ${runInfo.logFile}` })

  await setupWorld({ camp: CAMP, workers: workers.map(w => w.name), commander: 'Commander' })
  await sleep(2500)
  attachViewer(commander.bot, { port: config.viewerPort, firstPerson: false, viewDistance: 5 })
  await sleep(1500)
  record('viewer', { port: config.viewerPort })
  const botNames = [...workers.map(w => w.name), 'Commander']
  manageSpectators(commander.bot, botNames)
  if (WAIT_FOR_START) await waitForStart(commander.bot, botNames)
  record('gm', { text: `Goal: ${GOAL}` })
  announce(`Goal: ${GOAL}`)

  workers.forEach(w => w.start())
  const sunsetTimer = setTimeout(() => sunset().catch(err => record('error', { where: 'sunset', message: err.message })), SUNSET_AT_MS)
  const final = await commander.run(SESSION_MS)
  clearTimeout(sunsetTimer)

  const rows = revealTruth(DEMO_ROSTER, final?.beliefs)
  record('gm', { text: `Hut: ${describeProgress(hutProgress(blueprint, p => isBuilt(commander.bot, p)))}` })
  workers.forEach(w => record('status', { agent: w.name, ...w.stats(), final: true }))
  record('gm', { text: `Session over. Trait guesses correct: ${rows.filter(r => r.score.trait).length}/${rows.length}; motive guesses correct: ${rows.filter(r => r.score.motive).length}/${rows.length}.` })

  await sleep(15000)
  workers.forEach(w => { w.stop(); w.bot.quit() })
  commander.bot.quit()
  dashboard.close()
  process.exit(0)
}

main().catch(err => {
  record('error', { where: 'main', message: err.stack || err.message })
  console.error(err)
  process.exit(1)
})
