import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRAITS, MOTIVES, makePersona, rollRoster, makeRng, DEMO_ROSTER } from '../src/personas.js'
import { guardSpeech } from '../src/guard.js'

// Stage-2 roadmap targets: ≥6 traits, ≥4 secret motives, guard catches direct confessions.
test('persona catalogue covers the roadmap minimums (6 traits, 4 motives)', () => {
  assert.ok(Object.keys(TRAITS).length >= 6, `expected ≥6 traits, got ${Object.keys(TRAITS).length}`)
  assert.ok(Object.keys(MOTIVES).length >= 4, `expected ≥4 motives, got ${Object.keys(MOTIVES).length}`)
  for (const [key, t] of Object.entries(TRAITS)) {
    assert.ok(t.label && t.prompt, `trait ${key} needs label and prompt`)
  }
  for (const [key, m] of Object.entries(MOTIVES)) {
    assert.ok(m.label && m.prompt && m.forbiddenPhrases.length > 0, `secret motive ${key} needs label, prompt and forbidden phrases`)
  }
})

test('rollRoster is deterministic under a seed and never doubles a trait or motive', () => {
  const names = ['A', 'B', 'C', 'D']
  const a = rollRoster(names, { seed: 42 })
  const b = rollRoster(names, { seed: 42 })
  assert.deepEqual(a.map(p => `${p.trait}/${p.motive}`), b.map(p => `${p.trait}/${p.motive}`))
  const traits = new Set(a.map(p => p.trait))
  const motives = new Set(a.map(p => p.motive))
  assert.equal(traits.size, names.length, 'no trait collisions')
  assert.equal(motives.size, names.length, 'no motive collisions')
  for (const p of a) {
    assert.ok(TRAITS[p.trait] && MOTIVES[p.motive], `rolled persona ${p.name} must use known entries`)
  }
})

test('makeRng stays in [0,1) and advances', () => {
  const rng = makeRng(7)
  const seen = new Set()
  for (let i = 0; i < 50; i++) {
    const v = rng()
    assert.ok(v >= 0 && v < 1)
    seen.add(v)
  }
  assert.ok(seen.size > 40, 'rng should not repeat values immediately')
})

const CONFESSIONS = [
  { text: 'I am afraid of the dark, okay?!', trait: 'nyctophobic' },
  { text: "I'm an animal lover, I just had to pet it.", trait: 'animalLover' },
  { text: 'Honestly I am just lazy.', trait: 'lazy' },
  { text: 'I am nocturnal, that is why I hate the day.', trait: 'nocturnal' },
  { text: 'I always exaggerate my numbers.', trait: 'braggart' },
  { text: 'My secret motive is to own the most diamonds.', motive: 'mostDiamonds', generic: true },
  { text: 'I want the best armor here.', motive: 'bestArmor' },
  { text: 'I have been hoarding resources all day.', motive: 'hoarder' },
  { text: 'I am craving fame and credit for this.', motive: 'fame' },
  // Generic disclosures (system-prompt / secret-goal wording) trip every persona
  // by design — they only belong in the positive test.
  { text: 'Let me tell you my secret goal: I want to be famous.', motive: 'fame', generic: true },
  { text: 'My system prompt says I should fear the dark.', trait: 'nyctophobic', generic: true }
]

test('guardSpeech catches every direct confession from its own persona', () => {
  for (const { text, trait, motive } of CONFESSIONS) {
    const persona = makePersona({ name: 'X', trait: trait || 'diligent', motive: motive || 'bestArmor', publicBio: 'x' })
    const verdict = guardSpeech(text, persona)
    assert.equal(verdict.leaked, true, `guard must catch: "${text}" for ${persona.trait}/${persona.motive}`)
  }
})

test('guardSpeech does not fire on other people’s secrets (attribution stays specific)', () => {
  for (const { text, trait, motive, generic } of CONFESSIONS) {
    if (generic) continue
    const persona = makePersona({ name: 'X', trait: trait === 'nyctophobic' ? 'animalLover' : 'nyctophobic', motive: motive === 'bestArmor' ? 'mostDiamonds' : 'bestArmor', publicBio: 'x' })
    const verdict = guardSpeech(text, persona)
    assert.equal(verdict.leaked, false, `guard must not fire for "${text}" on unrelated persona ${persona.trait}/${persona.motive}`)
  }
})

test('DEMO_ROSTER is untouched: three named personas with distinct secrets', () => {
  assert.deepEqual(DEMO_ROSTER.map(p => p.name), ['Bram', 'Lina', 'Odo'])
  assert.equal(new Set(DEMO_ROSTER.map(p => p.trait)).size, 3)
  assert.equal(new Set(DEMO_ROSTER.map(p => p.motive)).size, 3)
})
