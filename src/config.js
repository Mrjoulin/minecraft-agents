import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'yaml'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function required (name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`)
  return value
}

// Simulation tunables live in params.yaml at the project root.
const params = yaml.parse(fs.readFileSync(path.join(ROOT, 'params.yaml'), 'utf8'))

export const config = Object.freeze({
  root: ROOT,
  params,
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
  hearing: Object.freeze({ ...params.speech.hearing }),
  orderRadius: params.speech.order_radius,
  sightRadius: params.speech.sight_radius,
  viewerPort: Number(process.env.VIEWER_PORT || params.viewer_port || 3007),
  dashboardPort: Number(process.env.DASHBOARD_PORT || params.dashboard_port || 3100),
  logDir: path.join(ROOT, 'logs')
})
