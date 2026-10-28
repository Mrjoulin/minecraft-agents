// Pure blueprint for a small 5x5 hut: plank walls 3 high, door gap in the south wall, flat roof.
// Positions are plain {x, y, z}; `origin` is the hut centre at ground (feet) level. North = -z.

const HALF = 2
const WALL_HEIGHT = 3

export const SECTIONS = Object.freeze(['north_wall', 'south_wall', 'east_wall', 'west_wall', 'roof'])

const at = (origin, dx, dy, dz) => Object.freeze({ x: origin.x + dx, y: origin.y + dy, z: origin.z + dz })
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

function wall (origin, cells) {
  // Bottom-up so every block rests on the one below it.
  return range(0, WALL_HEIGHT - 1).flatMap(dy => cells.map(([dx, dz]) => at(origin, dx, dy, dz)))
}

function roof (origin) {
  // Outer ring first (supported by the wall tops), then inwards.
  const ring = (dx, dz) => HALF - Math.max(Math.abs(dx), Math.abs(dz))
  return range(-HALF, HALF)
    .flatMap(dx => range(-HALF, HALF).map(dz => [dx, dz]))
    .sort((a, b) => ring(...a) - ring(...b))
    .map(([dx, dz]) => at(origin, dx, WALL_HEIGHT, dz))
}

export function createHutBlueprint (origin) {
  const isDoor = (dx, dy, dz) => dx === 0 && dz === HALF && dy < 2
  const north = wall(origin, range(-HALF, HALF).map(dx => [dx, -HALF]))
  const south = wall(origin, range(-HALF, HALF).map(dx => [dx, HALF]))
    .filter(p => !isDoor(p.x - origin.x, p.y - origin.y, p.z - origin.z))
  const east = wall(origin, range(-HALF + 1, HALF - 1).map(dz => [HALF, dz]))
  const west = wall(origin, range(-HALF + 1, HALF - 1).map(dz => [-HALF, dz]))
  const sections = Object.freeze({
    north_wall: Object.freeze(north),
    south_wall: Object.freeze(south),
    east_wall: Object.freeze(east),
    west_wall: Object.freeze(west),
    roof: Object.freeze(roof(origin))
  })
  return Object.freeze({
    origin,
    sections,
    all: Object.freeze(SECTIONS.flatMap(s => sections[s])),
    door: Object.freeze({ bottom: at(origin, 0, 0, HALF), outside: at(origin, 0, 0, HALF + 1) })
  })
}

export const PLANKS_PER_LOG = 4

/** Pure: progress of each section given a predicate telling whether a position is built. */
export function hutProgress (blueprint, isBuilt) {
  return Object.freeze(Object.fromEntries(SECTIONS.map(s => {
    const cells = blueprint.sections[s]
    return [s, Object.freeze({ built: cells.filter(isBuilt).length, total: cells.length })]
  })))
}

export function describeProgress (progress) {
  return SECTIONS.map(s => `${s.replace('_', ' ')} ${progress[s].built}/${progress[s].total}`).join(', ')
}
