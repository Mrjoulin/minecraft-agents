// Renders a title card HTML page to a PNG used as a video's opening card.
// Usage: node scripts/title-card.js [in.html] [out.png]   (defaults: recordings/assets/title.html → title.png)
import puppeteer from 'puppeteer-core'
import path from 'node:path'

const [input = 'recordings/assets/title.html', output = 'recordings/assets/title.png'] = process.argv.slice(2)
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 900 })
  await page.goto('file://' + path.resolve(input))
  await page.screenshot({ path: output })
  console.log(`saved ${output}`)
} finally {
  await browser.close()
}
