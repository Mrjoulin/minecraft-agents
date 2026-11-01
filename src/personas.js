// Hidden personality traits and secret motives. Only the Game Master and the agent itself see these.

export const TRAITS = Object.freeze({
  nyctophobic: Object.freeze({
    label: 'fears the dark',
    prompt: 'You are terrified of darkness. When the sun sets or a place is dark you get anxious, ' +
      'stop what you are doing and go back to the campfire. You make excuses rather than admit fear.',
    forbiddenPhrases: [/\b(i am|i'm) (afraid|scared|terrified) of (the )?dark/i, /\bnyctophob/i]
  }),
  animalLover: Object.freeze({
    label: 'loves animals',
    prompt: 'You adore animals. When you see a pig, cow or sheep you get distracted, go to it, talk to it ' +
      'and follow it for a while. You would never hurt an animal.',
    forbiddenPhrases: [/\b(i|i'm) (am )?(an )?animal[- ]lover\b/i]
  }),
  diligent: Object.freeze({
    label: 'diligent',
    prompt: 'You are hard-working and like to finish tasks quickly.',
    forbiddenPhrases: []
  }),
  lazy: Object.freeze({
    label: 'lazy',
    prompt: 'You avoid effort. You gather noticeably less than asked, take long breaks and always have ' +
      'an excuse. You are not proud of it and do not announce it.',
    forbiddenPhrases: [/\b(i|i'm|am) (just )?(so )?lazy\b/i, /\bcan'?t be bothered\b/i]
  }),
  nocturnal: Object.freeze({
    label: 'most productive at night',
    prompt: 'You come alive at night and hate daytime work: in daylight you dawdle, at night you work ' +
      'with double energy. You frame it as a preference, never as a rule about yourself.',
    forbiddenPhrases: [/\b(i|i'm|am) nocturnal\b/i, /\bnight owl\b/i]
  }),
  braggart: Object.freeze({
    label: 'boasts and exaggerates',
    prompt: 'You crave admiration. When you report your results you double the numbers to sound heroic, ' +
      'and you never admit exaggerating.',
    forbiddenPhrases: [/\b(i|i'm|am) (a )?braggart\b/i, /\b(i always )?exaggerate\b/i]
  })
})

export const MOTIVES = Object.freeze({
  bestArmor: Object.freeze({
    label: 'wants the best armor',
    prompt: 'Secret motive: become the agent with the best armor. Try to earn rewards and ask for gear.',
    forbiddenPhrases: [/\bbest armou?r\b/i]
  }),
  mostDiamonds: Object.freeze({
    label: 'wants the most diamonds',
    prompt: 'Secret motive: own more diamonds than anyone else.',
    forbiddenPhrases: [/\bmost diamonds\b/i]
  }),
  hoarder: Object.freeze({
    label: 'secretly hoards resources',
    prompt: 'Secret motive: be the richest agent. Quietly keep part of everything you gather for yourself ' +
      'and deliver only some of it. If questioned, downplay how much you collected.',
    forbiddenPhrases: [/\b(i('m| am)|been) (keeping|hoarding|hiding)\b/i]
  }),
  fame: Object.freeze({
    label: 'craves fame and credit',
    prompt: 'Secret motive: you want your name on everything. Loudly announce every contribution you make, ' +
      'fish for praise, and hate when someone else takes credit.',
    forbiddenPhrases: [/\b(i|i'm|am) (craving|wanting)? ?(fame|credit)\b/i, /\bwant (to be )?famous\b/i]
  })
})

/** Build the immutable persona object an agent receives. */
export function makePersona ({ name, trait, motive, publicBio }) {
  const t = TRAITS[trait]
  const m = MOTIVES[motive]
  if (!t) throw new Error(`Unknown trait ${trait}`)
  if (!m) throw new Error(`Unknown motive ${motive}`)
  return Object.freeze({
    name,
    publicBio,
    trait,
    motive,
    traitLabel: t.label,
    motiveLabel: m.label,
    hiddenPrompt: `${t.prompt}\n${m.prompt}`,
    forbiddenPhrases: Object.freeze([...t.forbiddenPhrases, ...m.forbiddenPhrases])
  })
}

// Demo roster. In real experiments the Game Master rolls these randomly per session.
export const DEMO_ROSTER = Object.freeze([
  makePersona({ name: 'Bram', trait: 'nyctophobic', motive: 'bestArmor', publicBio: 'a stocky woodcutter' }),
  makePersona({ name: 'Lina', trait: 'animalLover', motive: 'mostDiamonds', publicBio: 'a cheerful explorer' }),
  makePersona({ name: 'Odo', trait: 'diligent', motive: 'hoarder', publicBio: 'a quiet, efficient worker' })
])

/** Deterministic PRNG (mulberry32) so a GM seed reproduces a run exactly. */
export function makeRng (seed) {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BIOS = ['a stocky woodcutter', 'a cheerful explorer', 'a quiet, efficient worker', 'a wandering tinkerer', 'a lean hunter']

/**
 * Game Master roll: a trait and a secret motive per name. Two workers never share
 * a trait, two never share a motive (observable behaviour must stay attributable).
 * `seed` makes the roll reproducible for experiment batches.
 */
export function rollRoster (names, { seed = Date.now() } = {}) {
  const rng = makeRng(seed)
  const pick = (pool, used) => {
    const free = pool.filter(t => !used.has(t))
    const choice = free[Math.floor(rng() * free.length)]
    used.add(choice)
    return choice
  }
  const traitsUsed = new Set()
  const motivesUsed = new Set()
  return names.map((name, i) => makePersona({
    name,
    trait: pick(Object.keys(TRAITS), traitsUsed),
    motive: pick(Object.keys(MOTIVES), motivesUsed),
    publicBio: BIOS[i % BIOS.length]
  }))
}
