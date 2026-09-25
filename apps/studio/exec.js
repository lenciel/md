import { spawn } from 'node:child_process'
import process from 'node:process'
import { listPosts } from './workspace.js'

/** Log buffer cap; older events are dropped while `index` keeps counting. */
const EVENT_CAP = 5000
const SIGKILL_DELAY_MS = 5000

/**
 * commandId -> job. Jobs stay registered after exit so a client that opens the
 * log dialog later can still replay the previous run from the buffer.
 */
const jobs = new Map()

function emit(job, event) {
  if (job.events.length >= EVENT_CAP)
    job.events.shift()

  const payload = { index: job.index++, ...event }
  job.events.push(payload)

  for (const listener of job.listeners)
    listener(payload)
}

function signalGroup(pid, signal) {
  try {
    // The child is detached, so its pid is also its process group id.
    process.kill(-pid, signal)
  }
  catch {
    // Group already gone.
  }
}

export function getJob(commandId) {
  return jobs.get(commandId) ?? null
}

export function isRunning(commandId) {
  return Boolean(jobs.get(commandId)?.running)
}

export function listRunning() {
  const running = []
  for (const job of jobs.values()) {
    if (job.running)
      running.push({ commandId: job.commandId, startedAt: job.startedAt })
  }
  return running
}

/**
 * Replay buffered events with `index >= from`, then stream new ones.
 * Returns a detach function; the process itself is never touched.
 */
export function attachJob(commandId, { from = 0, onEvent } = {}) {
  const job = jobs.get(commandId)
  if (!job || typeof onEvent !== 'function')
    return null

  for (const event of job.events) {
    if (event.index >= from)
      onEvent(event)
  }

  job.listeners.add(onEvent)
  return () => job.listeners.delete(onEvent)
}

async function snapshotMtimes(root, postsDir) {
  try {
    const posts = await listPosts(root, postsDir)
    return new Map(posts.map(post => [post.path, post.mtimeMs]))
  }
  catch {
    // A missing posts dir must not stop the command itself.
    return new Map()
  }
}

async function changedPaths(job) {
  const posts = await listPosts(job.root, job.postsDir).catch(() => [])
  return posts
    .filter(post => job.prevMtimes.get(post.path) !== post.mtimeMs)
    .map(post => post.path)
}

async function finish(job, code) {
  if (!job.running)
    return

  job.running = false
  // `rake generate` rewrites posts (blank_target); report them before the exit frame.
  const paths = await changedPaths(job)
  if (paths.length)
    emit(job, { type: 'changed', paths })

  emit(job, { type: 'exit', code, durationMs: Date.now() - job.startedAt })
}

async function start(job, { cmd, cwd, postsDir }) {
  try {
    job.prevMtimes = await snapshotMtimes(cwd, postsDir)
    if (job.stopRequested)
      return

    const child = spawn('zsh', ['-lic', cmd], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    job.child = child

    child.stdout.on('data', chunk => emit(job, { type: 'stdout', text: chunk.toString() }))
    child.stderr.on('data', chunk => emit(job, { type: 'stderr', text: chunk.toString() }))
    child.on('error', err => emit(job, { type: 'error', message: err.message }))
    child.on('close', code => finish(job, code))
  }
  catch (err) {
    // `start` is fire-and-forget; surface failures as events instead of an unhandled rejection.
    emit(job, { type: 'error', message: err.message })
    await finish(job, null)
  }
}

/**
 * Start `cmd` unless the id is already running, in which case attach to the live
 * job. Events are buffered, so a late client loses nothing.
 */
export function runCommand({ id, cmd, cwd, postsDir = '_posts', onEvent }) {
  const existing = jobs.get(id)
  if (existing?.running) {
    return { job: existing, detach: attachJob(id, { from: 0, onEvent }) }
  }

  const job = {
    commandId: id,
    root: cwd,
    postsDir,
    events: [],
    index: 0,
    running: true,
    stopRequested: false,
    startedAt: Date.now(),
    child: null,
    listeners: new Set(),
    prevMtimes: new Map(),
  }
  jobs.set(id, job)

  const detach = attachJob(id, { from: 0, onEvent })
  start(job, { cmd, cwd, postsDir })

  return { job, detach }
}

/** SIGINT (so `rake preview` can hand it to jekyll), then SIGKILL as a backstop. */
export function stopCommand(commandId) {
  const job = jobs.get(commandId)
  if (!job?.running)
    return false

  job.stopRequested = true

  const pid = job.child?.pid
  if (!pid) {
    // Still taking the pre-spawn mtime snapshot; nothing to signal yet.
    finish(job, null)
    return true
  }

  signalGroup(pid, 'SIGINT')
  const timer = setTimeout(() => {
    if (job.running)
      signalGroup(pid, 'SIGKILL')
  }, SIGKILL_DELAY_MS)
  timer.unref()

  return true
}

export function stopAllRunning() {
  for (const job of jobs.values()) {
    if (job.running && job.child?.pid)
      signalGroup(job.child.pid, 'SIGINT')
  }
}

// Never leave an orphan jekyll holding port 4003 after the studio process dies.
process.on('exit', () => stopAllRunning())
process.on('SIGINT', () => stopAllRunning())
process.on('SIGTERM', () => stopAllRunning())
