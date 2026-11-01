#!/usr/bin/env node
'use strict'
/*
 * Minimal reproduction attempt for the follow_commander freeze+OOM:
 * Target bot walks a square; Follower bot hammers approachPlayer() — the exact
 * production code path (src/skills.js). A 1s heartbeat prints to stdout; when the
 * heartbeat stops, the process is frozen — profile it externally with
 * scripts/profile-stuck.cjs (run this script with --inspect=9230).
 *
 * Usage: node --inspect=9230 scripts/repro-follow.cjs [seconds=180]
 */
const seconds = Number(process.argv[2] || 180)
const path = require('path')
const { pathToFileURL } = require('url')

async function main () {
  const { createBody, approachPlayer } = await import(pathToFileURL(path.join(__dirname, '../src/skills.js')).href)
  const target = await createBody('ProbeTarget').ready
  const follower = await createBody('ProbeFollower').ready
  console.log('both bots spawned; starting follow loop')

  const pf = await import('mineflayer-pathfinder')
  const goals = (pf.default ?? pf).goals
  const corners = [
    target.entity.position.offset(12, 0, 12),
    target.entity.position.offset(12, 0, -12),
    target.entity.position.offset(-12, 0, -12),
    target.entity.position.offset(-12, 0, 12)
  ]
  let stop = false
  setTimeout(() => { stop = true }, seconds * 1000)

  // Target walks the square forever until the deadline.
  ;(async () => {
    let i = 0
    while (!stop) {
      const c = corners[i++ % corners.length]
      await target.pathfinder.goto(new goals.GoalNear(c.x, c.y, c.z, 1)).catch(() => {})
      await new Promise(r => setTimeout(r, 300))
    }
  })()

  // Follower: the production approachPlayer path, back to back.
  let rounds = 0
  while (!stop) {
    await approachPlayer(follower, 'ProbeTarget', 3, 8000)
    rounds++
  }
  console.log(`NO_FREEZE: survived ${seconds}s, ${rounds} approach rounds`)
  target.quit()
  follower.quit()
  setTimeout(() => process.exit(0), 1000)
}

let beats = 0
setInterval(() => { console.log(`heartbeat ${++beats} rss=${Math.round(process.memoryUsage().rss / 1048576)}MB heap=${Math.round(process.memoryUsage().heapUsed / 1048576)}MB`) }, 1000)
setInterval(() => {}, 1 << 30) // keep the loop alive like the real session

main().catch(err => { console.error('repro failed:', err); process.exit(1) })
