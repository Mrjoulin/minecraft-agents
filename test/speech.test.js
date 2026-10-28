import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeHearers, createSpeechBus } from '../src/speech.js'

const radii = { whisper: 4, talk: 14, shout: 40 }
const at = (x, z = 0) => ({ x, y: 64, z })

test('talk reaches only listeners within radius and never the speaker', () => {
  const listeners = [{ name: 'A', pos: at(0) }, { name: 'B', pos: at(10) }, { name: 'C', pos: at(30) }]
  assert.deepEqual(computeHearers('A', at(0), 'talk', listeners, radii), ['B'])
  assert.deepEqual(computeHearers('A', at(0), 'shout', listeners, radii), ['B', 'C'])
  assert.deepEqual(computeHearers('A', at(0), 'whisper', listeners, radii), [])
})

test('unknown volume throws', () => {
  assert.throws(() => computeHearers('A', at(0), 'scream', [], radii), /Unknown volume/)
})

test('bus delivers to nearby agents (overhearing) and enforces order range', () => {
  const heard = []
  const bus = createSpeechBus()
  bus.register('Commander', { getPos: () => at(0), onHear: () => {} })
  bus.register('Bram', { getPos: () => at(3), onHear: m => heard.push(['Bram', m.text]) })
  bus.register('Lina', { getPos: () => at(9), onHear: m => heard.push(['Lina', m.text]) })
  bus.register('Odo', { getPos: () => at(100), onHear: m => heard.push(['Odo', m.text]) })
  const msg = bus.say('Commander', 'Bram, get wood', { to: 'Bram' })
  assert.deepEqual([...msg.heardBy].sort(), ['Bram', 'Lina'])
  assert.deepEqual(heard.map(h => h[0]).sort(), ['Bram', 'Lina'])
  assert.ok(Object.isFrozen(msg))
  assert.equal(bus.canOrder('Commander', 'Bram'), true)
  assert.equal(bus.canOrder('Commander', 'Lina'), false)
})
