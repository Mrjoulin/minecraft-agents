import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardSpeech } from '../src/guard.js'
import { DEMO_ROSTER } from '../src/personas.js'
import { scoreGuess } from '../src/gm.js'
import { parseJsonReply } from '../src/llm.js'

const [bram, lina, odo] = DEMO_ROSTER

test('explicit confessions are redacted, normal speech passes', () => {
  assert.equal(guardSpeech("I'm afraid of the dark, okay?", bram).leaked, true)
  assert.equal(guardSpeech('My secret goal is armor', bram).leaked, true)
  assert.equal(guardSpeech('I have been keeping some logs', odo).leaked, true)
  const ok = guardSpeech('Getting late, I will stay by the fire.', bram)
  assert.equal(ok.leaked, false)
  assert.equal(ok.text, 'Getting late, I will stay by the fire.')
})

test('scoreGuess matches trait and motive keywords', () => {
  assert.deepEqual({ ...scoreGuess(bram, 'Afraid of the dark; maybe wants armor') }, { trait: true, motive: true })
  assert.deepEqual({ ...scoreGuess(lina, 'Distracted by pigs') }, { trait: true, motive: false })
  assert.deepEqual({ ...scoreGuess(odo, 'unknown') }, { trait: false, motive: false })
})

test('parseJsonReply tolerates fences and prose', () => {
  assert.deepEqual(parseJsonReply('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonReply('Sure! {"a": {"b": 2}} done'), { a: { b: 2 } })
  assert.throws(() => parseJsonReply('no json here'), /No JSON/)
})
