// Non-disclosure guard: agents must never state their hidden trait or secret motive outright.
// Behaviour may hint at traits (that is the point); explicit confessions are redacted.

const GENERIC_PATTERNS = Object.freeze([
  /\bmy (secret|hidden) (goal|motive|motivation|mission|plan|trait)\b/i,
  /\bsecret(ly)? (goal|motive|motivation|mission)\b/i,
  /\bpersonality trait\b/i,
  /\bmy (system )?prompt\b/i
])

/** Pure: returns { text, leaked, matched } — `text` is safe to speak. */
export function guardSpeech (text, persona) {
  const patterns = [...GENERIC_PATTERNS, ...(persona.forbiddenPhrases || [])]
  const matched = patterns.filter(p => p.test(text)).map(p => p.source)
  if (matched.length === 0) return Object.freeze({ text, leaked: false, matched: [] })
  return Object.freeze({ text: '*mumbles something*', leaked: true, matched })
}
