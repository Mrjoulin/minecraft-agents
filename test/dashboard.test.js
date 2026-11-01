// Dashboard tests: DASHBOARD_PORT=0 makes the server bind an ephemeral port.
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.DASHBOARD_PORT = '0'
const { startDashboard } = await import('../src/dashboard/server.js')
const { record } = await import('../src/events.js')

const get = async (port, url) => fetch(`http://127.0.0.1:${port}${url}`, { redirect: 'manual' })

/** Read SSE frames from the response body until `count` "data:" lines arrived. */
async function readFrames (res, count) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while ([...buf.matchAll(/^data: /gm)].length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
  }
  reader.cancel().catch(() => {})
  return buf
}

test('dashboard serves the page on / and 404s elsewhere', async () => {
  const dash = startDashboard({ team: ['Bram'], goal: 'build a hut' })
  try {
    await dash.ready()
    const port = dash.port()
    assert.ok(Number.isInteger(port) && port > 0, 'ephemeral port is exposed')
    const page = await get(port, '/')
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type'), /text\/html/)
    assert.ok((await page.text()).includes('<html'))
    const missing = await get(port, '/nope')
    assert.equal(missing.status, 404)
  } finally {
    dash.close()
  }
})

test('SSE stream greets new clients and replays history plus live events', async () => {
  const dash = startDashboard({ team: ['Bram', 'Lina'], goal: 'build a hut' })
  const controller = new AbortController()
  try {
    await dash.ready()
    const port = dash.port()
    const res = await fetch(`http://127.0.0.1:${port}/events`, { signal: controller.signal })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /text\/event-stream/)

    // One event before the client asks for history, one after it connected.
    record('speech', { agent: 'Bram', text: 'replayed line' })
    record('thought', { agent: 'Commander', text: 'live line' })
    const buf = await readFrames(res, 3)
    const frames = buf.split('\n\n').filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, '')))
    assert.equal(frames[0].kind, 'hello')
    assert.deepEqual(frames[0].team, ['Bram', 'Lina'])
    assert.equal(frames[0].viewerPort, 3007)
    const kinds = frames.slice(1).map(f => f.kind)
    assert.ok(kinds.includes('speech'), 'history is replayed')
    assert.ok(kinds.includes('thought'), 'live events arrive')
  } finally {
    // Server-side teardown first: destroying the SSE client from the server also
    // releases undici's socket, whereas a client-side abort alone can leave it open.
    dash.close()
    controller.abort()
  }
})

test('close() shuts the server down', async () => {
  const dash = startDashboard({ team: [], goal: '' })
  await dash.ready()
  const port = dash.port()
  dash.close()
  await assert.rejects(get(port, '/'))
})

test('a busy port degrades gracefully instead of crashing', async () => {
  const first = startDashboard({ team: [], goal: '' })
  await first.ready()
  const second = startDashboard({ team: [], goal: '', port: first.port() })
  await second.ready()
  assert.match(second.error().message, /EADDRINUSE/)
  assert.equal(second.port(), null)
  second.close()
  first.close()
})
