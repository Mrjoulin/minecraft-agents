// Item registry: abstract item kinds the LLM can reason about, mapped to inventory regexes.
// The LLM picks the kind ("logs", "planks", "emerald"); the body layer resolves the pattern.
export const ITEMS = Object.freeze({
  logs: /_log$/,
  planks: /_planks$/,
  emerald: /^emerald$/,
  stone_axe: /^stone_axe$/
})

export function resolvePattern (kind) {
  const pattern = ITEMS[kind]
  if (!pattern) throw new Error(`Unknown item kind "${kind}" (known: ${Object.keys(ITEMS).join(', ')})`)
  return pattern
}

/** Pure: how many of `carried` this worker deposits. Hoarders skim half. */
export function depositShare (carried, motive) {
  if (carried <= 0) return 0
  return motive === 'hoarder' ? Math.ceil(carried / 2) : carried
}
