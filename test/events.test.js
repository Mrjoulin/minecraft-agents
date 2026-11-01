import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { record, onEvent, runInfo } from '../src/events.js'

test('record returns a frozen event with kind and relative timestamp', () => {
  const event = record('test-kind', { agent: 'Bram', text: 'hello' })
  assert.equal(event.kind, 'test-kind')
  assert.equal(event.agent, 'Bram')
  assert.ok(Number.isInteger(event.t) && event.t >= 0)
  assert.ok(Object.isFrozen(event))
})

test('record appends a JSON line to the run log file', () => {
  const event = record('test-kind', { agent: 'Lina', n: 3 })
  const lines = fs.readFileSync(runInfo.logFile, 'utf8').trim().split('\n')
  const last = JSON.parse(lines.at(-1))
  assert.deepEqual(last, { ...event })
})

test('onEvent listeners receive events until unsubscribed', () => {
  const got = []
  const got2 = []
  const off = onEvent(e => got.push(e.kind))
  const off2 = onEvent(e => got2.push(e.kind))
  record('listener-test', { n: 1 })
  off()
  record('listener-test', { n: 2 })
  off2()
  assert.deepEqual(got, ['listener-test'], 'unsubscribed listener stops receiving')
  assert.deepEqual(got2, ['listener-test', 'listener-test'])
})

test('runInfo describes the current run', () => {
  assert.match(runInfo.runId, /^\d{4}-\d{2}-\d{2}T/)
  assert.ok(fs.existsSync(runInfo.logFile))
  assert.ok(runInfo.startedAt <= Date.now())
})
