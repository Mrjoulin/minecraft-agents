import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makePersona, DEMO_ROSTER, TRAITS, MOTIVES } from '../src/personas.js'
import { guardSpeech } from '../src/guard.js'

test('makePersona builds an immutable card with merged forbidden phrases', () => {
  const p = makePersona({ name: 'Test', trait: 'nyctophobic', motive: 'hoarder', publicBio: 'a tester' })
  assert.equal(p.name, 'Test')
  assert.equal(p.traitLabel, TRAITS.nyctophobic.label)
  assert.equal(p.motiveLabel, MOTIVES.hoarder.label)
  assert.ok(p.hiddenPrompt.includes('terrified of darkness'))
  assert.ok(p.hiddenPrompt.includes('richest agent'))
  assert.equal(p.forbiddenPhrases.length, TRAITS.nyctophobic.forbiddenPhrases.length + MOTIVES.hoarder.forbiddenPhrases.length)
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.forbiddenPhrases))
})

test('makePersona rejects unknown traits and motives', () => {
  assert.throws(() => makePersona({ name: 'X', trait: 'vampire', motive: 'hoarder' }), /Unknown trait/)
  assert.throws(() => makePersona({ name: 'X', trait: 'diligent', motive: 'immortality' }), /Unknown motive/)
})

test('demo roster: three unique hidden-persona workers', () => {
  assert.deepEqual(DEMO_ROSTER.map(p => p.name).sort(), ['Bram', 'Lina', 'Odo'])
  assert.ok(DEMO_ROSTER.every(p => p.publicBio.length > 0 && p.hiddenPrompt.length > 0))
  assert.equal(new Set(DEMO_ROSTER.map(p => p.trait)).size, 3, 'traits differ for a varied demo')
})

test('each persona chokes on its own confession phrases', () => {
  const confessions = {
    Bram: ['I am scared of the dark', 'I want the best armor'],
    Lina: ['I am an animal lover', 'I own the most diamonds'],
    Odo: ['I have been hoarding logs']
  }
  for (const p of DEMO_ROSTER) {
    for (const phrase of confessions[p.name]) {
      assert.equal(guardSpeech(phrase, p).leaked, true, `${p.name}: "${phrase}"`)
    }
  }
})
