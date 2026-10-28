// Renders the side-panel overlay (transparent PNG frames) for a gameplay recording, from a run's event log.
// Usage: node scripts/render-overlay.js <run.jsonl> <outDir> <offsetSec> <videoSec> [speed=2] [fps=5] [tailSec=14]
//   offsetSec: log time (s) that matches the first frame of the recording
//   videoSec:  recording length (s); the tail shows the final result over a frozen last frame
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const [logFile, outDir, offsetArg, videoArg, speedArg = '2', fpsArg = '5', tailArg = '14'] = process.argv.slice(2)
if (!logFile || !outDir || !offsetArg || !videoArg) {
  console.error('Usage: node scripts/render-overlay.js <run.jsonl> <outDir> <offsetSec> <videoSec> [speed] [fps] [tailSec]')
  process.exit(1)
}
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const offsetMs = Number(offsetArg) * 1000
const speed = Number(speedArg)
const fps = Number(fpsArg)
const gameplayOut = Number(videoArg) / speed
const totalOut = gameplayOut + Number(tailArg)
const frames = Math.ceil(totalOut * fps)

const events = fs.readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
const goal = (events.find(e => e.kind === 'gm' && e.text?.startsWith('Goal: '))?.text || '').replace(/^Goal: /, '')
const startT = events.find(e => e.kind === 'gm' && e.text?.startsWith('Session started'))?.t ?? offsetMs
const finalT = Math.max(...events.map(e => e.t))

fs.mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  await page.goto('file://' + path.resolve('recordings/assets/overlay.html'))
  await page.evaluate((evs, s, g) => window.load(evs, s, g), events, startT, goal)
  for (let i = 0; i < frames; i++) {
    const outT = i / fps
    const inTail = outT >= gameplayOut
    const logT = inTail ? finalT : offsetMs + outT * speed * 1000
    await page.evaluate((t, card) => window.renderAt(t, card), logT, inTail)
    await page.screenshot({ path: path.join(outDir, `f${String(i).padStart(5, '0')}.png`), omitBackground: true })
    if (i % 100 === 0) console.log(`frame ${i}/${frames}`)
  }
  console.log(`done: ${frames} frames at ${fps} fps (${totalOut.toFixed(1)} s)`)
} finally {
  await browser.close()
}
