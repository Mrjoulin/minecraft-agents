// Records the dashboard (3D view + panels) to a video with headless Chrome.
// Usage: node scripts/record.js <seconds> <out.webm>
import puppeteer from 'puppeteer-core'

const seconds = Number(process.argv[2] || 60)
const out = process.argv[3] || 'recordings/raw/demo.webm'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:3100/'

async function waitForServer (url, ms = 60000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`Dashboard not reachable at ${url}`)
}

await waitForServer(URL)
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900']
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 900 })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  const recorder = await page.screencast({ path: out })
  await new Promise(resolve => setTimeout(resolve, seconds * 1000))
  await recorder.stop()
  console.log(`saved ${out}`)
} finally {
  await browser.close()
}
