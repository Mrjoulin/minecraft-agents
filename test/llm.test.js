// Tests for the real LLM client path with a mocked fetch (no network).
// Env must be set before the dynamic import: config.js reads it at load time.
// LLM_API_KEY wins over OPENCODE_API_KEY, so pin it too — the developer's real
// .env must not leak into these assertions.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.LLM_API_KEY = 'test-key'
process.env.OPENCODE_API_KEY = 'test-key'
process.env.LLM_RETRY_BASE_MS = '1' // keep retry ladders instant in tests
process.env.LLM_BASE_URL = 'http://llm.test/v1'
const { askJson, parseJsonReply } = await import('../src/llm.js')

const okReply = content => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage: { total_tokens: 9 } }) })
const errReply = status => ({ ok: false, status, json: async () => ({ error: 'boom' }) })

test('askJson posts a chat completion and returns the validated JSON', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls.push({ url, opts })
    return okReply('{"ok":true}')
  })
  const out = await askJson({ agent: 'Tester', system: 'be brief', user: 'hi', validate: x => x })
  assert.deepEqual(out, { ok: true })
  const { url, opts } = calls[0]
  assert.equal(url, 'http://llm.test/v1/chat/completions')
  assert.equal(opts.headers.Authorization, 'Bearer test-key')
  const body = JSON.parse(opts.body)
  assert.deepEqual(body.messages, [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }])
  assert.deepEqual(body.response_format, { type: 'json_object' })
})

test('parseJsonReply tolerates prose, fences and braces inside strings', () => {
  assert.deepEqual(parseJsonReply('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonReply('```\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonReply('Sure: {"a": {"b": [1,2]}} thanks'), { a: { b: [1, 2] } })
  assert.deepEqual(parseJsonReply('{"a":"curly }{ braces"}'), { a: 'curly }{ braces' })
})

test('parseJsonReply rejects non-text and jsonless replies', () => {
  assert.throws(() => parseJsonReply(42), /not text/)
  assert.throws(() => parseJsonReply('no json here'), /No JSON/)
  assert.throws(() => parseJsonReply('{ only open'), /No JSON|Unexpected|JSON/)
  assert.throws(() => parseJsonReply('{"a": }'), /JSON|Unexpected/)
})

test('askJson retries after an HTTP error and then succeeds', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1
    return calls === 1 ? errReply(500) : okReply('{"fine":1}')
  })
  const out = await askJson({ agent: 'Tester', system: 's', user: 'u', validate: x => x })
  assert.deepEqual(out, { fine: 1 })
  assert.equal(calls, 2)
})

test('askJson gives up after three attempts and reports the last error', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return errReply(503) })
  await assert.rejects(
    askJson({ agent: 'Tester', system: 's', user: 'u', validate: x => x }),
    /LLM failed for Tester after 5 attempts/
  )
  assert.equal(calls, 5)
})

test('a validator rejection also triggers the retry ladder', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return okReply('{"shape":"wrong"}') })
  await assert.rejects(
    askJson({ agent: 'Tester', system: 's', user: 'u', validate: () => { throw new Error('bad shape') } }),
    /bad shape/
  )
  assert.equal(calls, 5)
})

test('an empty model reply is treated as a retriable failure', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return okReply('') })
  await assert.rejects(askJson({ agent: 'Tester', system: 's', user: 'u', validate: x => x }), /empty content/)
  assert.equal(calls, 5)
})

test('every attempt is recorded as an error event until success', async t => {
  const { onEvent } = await import('../src/events.js')
  const attempts = []
  const off = onEvent(e => { if (e.kind === 'error' && e.where === 'llm' && e.agent === 'Recorder') attempts.push(e.attempt) })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return calls === 1 ? errReply(500) : okReply('{"a":1}') })
  await askJson({ agent: 'Recorder', system: 's', user: 'u', validate: x => x })
  off()
  assert.deepEqual(attempts, [1])
})

test('LLM_API_KEY takes precedence over OPENCODE_API_KEY at call time', async () => {
  const { config } = await import('../src/config.js')
  process.env.LLM_API_KEY = 'glm-key'
  assert.equal(config.llm.apiKey(), 'glm-key')
  delete process.env.LLM_API_KEY
  assert.equal(config.llm.apiKey(), 'test-key', 'falls back to OPENCODE_API_KEY')
})

test('LLM_EXTRA_BODY is merged into the request body', async t => {
  process.env.LLM_EXTRA_BODY = JSON.stringify({ thinking: { type: 'disabled' } })
  let body = null
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    body = JSON.parse(opts.body)
    return okReply('{"ok":1}')
  })
  await askJson({ agent: 'Extras', system: 's', user: 'u', validate: x => x })
  delete process.env.LLM_EXTRA_BODY
  assert.deepEqual(body.thinking, { type: 'disabled' })
})

test('invalid LLM_EXTRA_BODY warns once and is ignored', async t => {
  const errors = []
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')))
  process.env.LLM_EXTRA_BODY = '{not json'
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls += 1
    const body = JSON.parse(opts.body)
    assert.equal(body.thinking, undefined, 'broken extra body must not leak into the request')
    return okReply('{"ok":1}')
  })
  await askJson({ agent: 'BadExtras', system: 's', user: 'u', validate: x => x })
  await askJson({ agent: 'BadExtras', system: 's', user: 'u', validate: x => x })
  delete process.env.LLM_EXTRA_BODY
  assert.equal(calls, 2, 'requests still went through')
  assert.equal(errors.length, 1, 'warned once, not per call')
})
