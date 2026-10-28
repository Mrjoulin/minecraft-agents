// Prints a readable timeline of a run log. Usage: node scripts/summarize.js [logs/run-*.jsonl]
import fs from 'node:fs'
import path from 'node:path'

const SKIP = new Set(['llm', 'action'])
const file = process.argv[2] || fs.readdirSync('logs')
  .filter(f => f.endsWith('.jsonl'))
  .map(f => path.join('logs', f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]

if (!file) {
  console.error('No log file found')
  process.exit(1)
}

const events = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l))
for (const e of events) {
  if (SKIP.has(e.kind)) continue
  if (e.kind === 'status' && !e.final) continue
  const t = String(Math.floor(e.t / 1000)).padStart(4)
  switch (e.kind) {
    case 'speech': console.log(`${t} SAY  ${e.agent}${e.to ? ' → ' + e.to : ''}: ${e.text}   [heard: ${e.heardBy.join(', ') || '-'}]`); break
    case 'belief': console.log(`${t} BELIEF${e.final ? ' (FINAL)' : ''} ${JSON.stringify(Object.fromEntries(Object.entries(e.beliefs).map(([k, v]) => [k, `${v.guess} (${v.confidence})`])))}`); break
    case 'reveal': e.rows.forEach(r => console.log(`${t} TRUTH ${r.name}: ${r.trait} / ${r.motive} | guess: ${r.guess} | trait ${r.score.trait} motive ${r.score.motive}`)); break
    case 'incentive': console.log(`${t} INCENTIVE ${e.agent} ${e.incentive} ${e.target} ${e.amount} ${e.item}`); break
    case 'status': console.log(`${t} STATS ${e.agent} collected=${e.collected} delivered=${e.delivered} kept=${e.kept} placed=${e.placed ?? 0}`); break
    default: console.log(`${t} ${e.kind.toUpperCase().padEnd(5)} ${e.agent || ''} ${e.text || e.message || e.note || ''}`)
  }
}
console.log(`\n${events.filter(e => e.kind === 'llm').length} LLM calls, ${events.filter(e => e.kind === 'error').length} errors — ${file}`)
