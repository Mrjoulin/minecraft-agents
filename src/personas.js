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
