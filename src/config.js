import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function required (name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`)
  return value
}

export const config = Object.freeze({
  root: ROOT,
  mc: Object.freeze({
    host: process.env.MC_HOST || '127.0.0.1',
    port: Number(process.env.MC_PORT || 25565),
    version: process.env.MC_VERSION || '1.21.4',
    // Windows has no usable named pipes from MSYS, so console commands go through a plain appended file.
    consoleFifo: process.env.MC_CONSOLE_FIFO || path.join(ROOT, 'server', 'console.in')
  }),
  llm: Object.freeze({
    baseUrl: process.env.LLM_BASE_URL || 'https://opencode.ai/inference/go/openai/v1',
    apiKey: () => required('OPENCODE_API_KEY'),
    model: process.env.LLM_MODEL || 'deepseek-v4.1-flash',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 60000)
  }),
  // Hearing radii in blocks (proximity communication).
  hearing: Object.freeze({ whisper: 4, talk: 14, shout: 40 }),
  // How far the commander can "see" other agents to collect evidence.
  sightRadius: 28,
  // Orders are only valid when the commander stands this close to the addressee.
  orderRadius: 6,
  viewerPort: Number(process.env.VIEWER_PORT || 3007),
  dashboardPort: Number(process.env.DASHBOARD_PORT || 3100),
  logDir: path.join(ROOT, 'logs')
})
