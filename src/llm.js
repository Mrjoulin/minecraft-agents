// Minimal OpenAI-compatible chat client with JSON-object responses.
// LLM_STUB=1 swaps the network client for the algorithmic driver (src/stub-llm.js):
// same prompts, same validators, no API key needed.
import { config } from './config.js'
import { record } from './events.js'

const MAX_ATTEMPTS = 3
const STUB = process.env.LLM_STUB === '1'

/** Extract the first JSON object from a model reply (tolerates code fences / prose). */
export function parseJsonReply (text) {
  if (typeof text !== 'string') throw new Error('LLM reply is not text')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('No JSON object in LLM reply')
  return JSON.parse(body.slice(start, end + 1))
}

async function postChat (messages, { sessionId, temperature, maxTokens }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.llm.timeoutMs)
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.llm.apiKey()}`,
        'Content-Type': 'application/json',
        'User-Agent': 'minecraft-mas/0.1',
        'x-opencode-session': sessionId
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' }
      })
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${JSON.stringify(payload).slice(0, 300)}`)
    const content = payload?.choices?.[0]?.message?.content
    if (!content) throw new Error('LLM returned empty content')
    return { content, usage: payload.usage }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ask the model for a JSON object. `validate` throws if the shape is wrong, triggering a retry.
 */
export async function askJson (opts) {
  if (STUB) return (await import('./stub-llm.js')).askJson(opts)
  return realAskJson(opts)
}

async function realAskJson ({ agent, system, user, validate = x => x, temperature = 0.7, maxTokens = 1200 }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now()
    try {
      const { content, usage } = await postChat(messages, { sessionId: `mas-${agent}`, temperature, maxTokens })
      const parsed = validate(parseJsonReply(content))
      record('llm', { agent, ms: Date.now() - started, tokens: usage?.total_tokens ?? null })
      return parsed
    } catch (err) {
      lastError = err
      record('error', { agent, where: 'llm', attempt, message: err.message })
    }
  }
  throw new Error(`LLM failed for ${agent} after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`)
}
