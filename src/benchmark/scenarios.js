// Benchmark scenarios (roadmap Шаг 0): four fixed, repeatable scenarios on the seeded
// test world. Each scenario resets the camp with the self-healing setupCommands, applies
// its own world edits, then drives the skill layer deterministically (no LLM) and checks
// a mechanical success predicate. The point is a comparable baseline across code changes:
// the same primitives the LLM worker gets, executed end-to-end.
import Vec3 from 'vec3'
import { setupCommands } from '../gm.js'
import { collectLogs, countItems, goNear } from '../skills.js'
import { buildCells } from '../building.js'
import { config } from '../config.js'

const WORLD = config.params.world
const BENCH = config.params.benchmark || {}

const LOGS = /_log$/
const SETTLE_COMMAND_MS = BENCH.settle_command_ms ?? 150

const vec = ([x, y, z]) => new Vec3(x, y, z)

/** All coordinates the scenarios need, derived from params.yaml so they follow the camp. */
export function makeContext (username = 'Bench') {
  const c = {
    pad: vec(WORLD.camp.pad),
    chest: vec(WORLD.camp.chest),
    fire: vec(WORLD.camp.fire),
    hut: vec(WORLD.camp.hut),
    table: vec(WORLD.camp.table)
  }
  const f = c.fire
  return Object.freeze({
    username,
    camp: Object.freeze(c),
    // Scenario 2: an unbreakable (protected-blocks) wall between the camp and the north grove —
    // the pathfinder has to route around it, digging through is not an option.
    wall: Object.freeze({ x1: f.x - 4, y1: f.y, z1: f.z - 8, x2: f.x + 4, y2: f.y + 2, z2: f.z - 8 }),
    northAnchor: Object.freeze({ x: f.x, y: f.y, z: f.z - 20 }),
    // Scenario 3: a sealed plank box with logs inside — the target exists and is visible,
    // but every approach must fail. Success = the failure is detected fast, no hang.
    box: Object.freeze({ x: f.x - 10, y: f.y, z: f.z + 10 }),
    // Scenario 4: a 3x3 platform on the camp pad, built cell by cell from coordinates.
    platformCells: Object.freeze([-2, -1, 0].flatMap(dz => [0, 1, 2].map(dx => ({
      x: c.pad.x + 2 + dx, y: c.pad.y, z: c.pad.z + 2 + dz
    }))))
  })
}

/** Fresh, self-healing camp (same machinery as the demo), then the bot teleported to the pad. */
export function baseSetupCommands (ctx) {
  return [
    ...setupCommands({ camp: ctx.camp, workers: [ctx.username], commander: ctx.username }),
    `tp ${ctx.username} ${ctx.camp.pad.x} ${ctx.camp.pad.y} ${ctx.camp.pad.z}`
  ]
}

const wallCommands = ctx => [
  `fill ${ctx.wall.x1} ${ctx.wall.y1} ${ctx.wall.z1} ${ctx.wall.x2} ${ctx.wall.y2} ${ctx.wall.z2} oak_planks`
]

const boxCommands = ctx => {
  const o = ctx.box
  return [
    `fill ${o.x - 2} ${o.y - 1} ${o.z - 2} ${o.x + 2} ${o.y + 3} ${o.z + 2} oak_planks`,
    `fill ${o.x - 1} ${o.y} ${o.z - 1} ${o.x + 1} ${o.y + 2} ${o.z + 1} air`,
    `fill ${o.x - 1} ${o.y} ${o.z - 1} ${o.x + 1} ${o.y} ${o.z + 1} oak_log`
  ]
}

const platformCommands = ctx => [
  `give ${ctx.username} oak_planks 64`
]

export const SCENARIOS = Object.freeze({
  // 1. Find a tree, collect 8 logs, walk back to the camp chest.
  logs_return: Object.freeze({
    id: 'logs_return',
    title: 'Collect 8 logs and return to the camp chest',
    timeoutMs: BENCH.scenario_timeout_ms ?? 180000,
    setupCommands: baseSetupCommands,
    run: async (bot, ctx) => {
      const got = await collectLogs(bot, 8, {})
      const returned = await goNear(bot, ctx.camp.chest, 3)
      return { got, returned }
    },
    evaluate: (bot, r, ctx) => {
      if (r.got < 8) return { success: false, reason: `collected ${r.got}/8 logs` }
      if (!r.returned) return { success: false, reason: 'did not return to the chest' }
      const d = bot.entity.position.distanceTo(ctx.camp.chest)
      if (d > 4.5) return { success: false, reason: `ended ${d.toFixed(1)}m from the chest` }
      return { success: true, reason: null }
    }
  }),

  // 2. The north grove is behind an unbreakable wall — the path must go around it.
  logs_obstacle: Object.freeze({
    id: 'logs_obstacle',
    title: 'Collect 8 logs anchored behind a wall (route around required)',
    timeoutMs: BENCH.scenario_timeout_ms ?? 180000,
    setupCommands: ctx => [...baseSetupCommands(ctx), ...wallCommands(ctx)],
    run: async (bot, ctx) => {
      const got = await collectLogs(bot, 8, { anchor: new Vec3(ctx.northAnchor.x, ctx.northAnchor.y, ctx.northAnchor.z) })
      return { got }
    },
    evaluate: (_bot, r) => r.got >= 8
      ? { success: true, reason: null }
      : { success: false, reason: `collected ${r.got}/8 logs behind the wall` }
  }),

  // 3. Logs sealed inside an unbreakable box: the target is visible but unreachable.
  //    Success means the body detects the failure and terminates — it must not hang.
  logs_sealed: Object.freeze({
    id: 'logs_sealed',
    title: 'Detect unreachable logs (sealed box) and fail fast',
    timeoutMs: BENCH.sealed_timeout_ms ?? 150000,
    setupCommands: ctx => [...baseSetupCommands(ctx), ...boxCommands(ctx)],
    run: async (bot, ctx) => {
      const t0 = Date.now()
      const got = await collectLogs(bot, 8, {})
      return { got, detected: got === 0, elapsedMs: Date.now() - t0 }
    },
    evaluate: (_bot, r) => r.detected
      ? { success: true, reason: null }
      : { success: false, reason: `collected ${r.got} logs from a sealed box (should be unreachable)` }
  }),

  // 4. Build a 3x3 plank platform from explicit coordinates.
  build_platform: Object.freeze({
    id: 'build_platform',
    title: 'Build a 3x3 plank platform at given coordinates',
    timeoutMs: BENCH.scenario_timeout_ms ?? 180000,
    setupCommands: ctx => [...baseSetupCommands(ctx), ...platformCommands(ctx)],
    run: async (bot, ctx) => {
      await goNear(bot, ctx.camp.pad, 3)
      return buildCells(bot, ctx.platformCells)
    },
    evaluate: (_bot, r) => r.remaining === 0
      ? { success: true, reason: null }
      : { success: false, reason: `${r.remaining}/9 cells missing` }
  })
})

/** Human-readable command echo + pacing helper shared by the runner. */
export const commandDelayMs = SETTLE_COMMAND_MS
export const logSummary = bot => ({ carriedLogs: countItems(bot, LOGS) })
