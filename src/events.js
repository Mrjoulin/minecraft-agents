// Central telemetry: every event goes to a JSONL file and to live listeners (dashboard).
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { config } from './config.js'

const emitter = new EventEmitter()
emitter.setMaxListeners(50)

fs.mkdirSync(config.logDir, { recursive: true })
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const logFile = path.join(config.logDir, `run-${runId}.jsonl`)
const startedAt = Date.now()

/**
 * Record an event.
 * kind: speech | thought | action | observation | belief | incentive | gm | error | status
 */
export function record (kind, data) {
  const event = Object.freeze({ ...data, t: Date.now() - startedAt, kind })
  try {
    fs.appendFileSync(logFile, JSON.stringify(event) + '\n')
  } catch (err) {
    console.error('[events] failed to write log:', err.message)
  }
  emitter.emit('event', event)
  return event
}

export function onEvent (listener) {
  emitter.on('event', listener)
  return () => emitter.off('event', listener)
}

export const runInfo = Object.freeze({ runId, logFile, startedAt })
