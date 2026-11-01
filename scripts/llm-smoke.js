// One real round-trip against the configured endpoint: run this before a session to
// verify key, base URL, model and JSON mode. Usage:
//   node scripts/llm-smoke.js [model]   (model arg overrides LLM_MODEL for this call)
if (process.argv[2]) process.env.LLM_MODEL = process.argv[2]
const { config } = await import('../src/config.js')
const { askJson } = await import('../src/llm.js')

const key = config.llm.apiKey()
console.log(`endpoint : ${config.llm.baseUrl}/chat/completions`)
console.log(`model    : ${config.llm.model}`)
console.log(`key      : ${key.slice(0, 6)}…${key.slice(-4)}`)

const started = Date.now()
const d = await askJson({
  agent: 'Smoke',
  system: 'You are a test probe. Reply ONLY with a JSON object.',
  user: 'Return {"ok": true, "mood": "one short phrase about building huts"}.',
  validate: x => {
    if (x.ok !== true) throw new Error('expected {"ok":true}')
    return x
  },
  temperature: 0,
  maxTokens: 200
})
console.log(`reply    : ${JSON.stringify(d)} (${Date.now() - started} ms)`)
