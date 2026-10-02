import { spawn } from 'node:child_process'
import process from 'node:process'
import { isPostPath, listPosts, StudioError } from './workspace.js'

/** Log buffer cap; older events are dropped while `index` keeps counting. */
const EVENT_CAP = 5000
const SIGKILL_DELAY_MS = 5000

/** Config commands may reference the post currently open in the editor. */
const FILE_PLACEHOLDER = '{file}'

/**
 * How the config's commands are run. The default is an interactive login shell, which is
 * what makes `.zshrc` aliases and PATH setup available — at the cost of the prompt plumbing
 * (theme, gitstatus, completion) complaining that it has no terminal. A plain `-c` keeps the
 * environment of whoever started the studio, which is what automation usually wants.
 */
const DEFAULT_SHELL = 'zsh'
const DEFAULT_SHELL_ARGS = ['-lic']

/**
 * Run the command under a pty. Interactive rc files (`gitstatus`, `zle` bindings, `stty`)
 * need a terminal and print errors on every run without one; a pty is what the user's own
 * terminal provides, so the same rc stays quiet. `TERM=dumb` + `NO_COLOR` keep the output
 * line-based for the log view instead of repainting it with escapes.
 *
 * BSD `script` (macOS) takes the command as trailing arguments; util-linux wants `-c`.
 */
function ptyCommand(shell, shellArgs, cmd) {
  if (process.platform === 'darwin')
    return { command: 'script', args: ['-q', '/dev/null', shell, ...shellArgs, cmd] }
  return { command: 'script', args: ['-q', '-e', '-c', [shell, ...shellArgs, cmd].map(shellQuote).join(' '), '/dev/null'] }
}

/** Config's `shell` / `shellArgs`, falling back to the defaults when they are unusable. */
export function resolveShell(config = {}) {
  const shell = typeof config.shell === 'string' && config.shell.trim() ? config.shell.trim() : DEFAULT_SHELL
  const args = Array.isArray(config.shellArgs) && config.shellArgs.length > 0 && config.shellArgs.every(arg => typeof arg === 'string')
    ? config.shellArgs
    : DEFAULT_SHELL_ARGS
  return { shell, args }
}

/** Quote for the shell line: a post name may hold spaces or quotes. */
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function usesFile(cmd) {
  return typeof cmd === `string` && cmd.includes(FILE_PLACEHOLDER)
}

/**
 * Validate the `{file}` reference of a command and return it.
 *
 * Throws a `StudioError` so the exec route can answer with a status code before
 * it commits to a 200 event stream. Returns `null` for commands that ignore the
 * open file.
 */
export function resolveCommandFile(cmd, file) {
  if (!usesFile(cmd))
    return null
  if (typeof file !== `string` || !file)
    throw new StudioError(400, 'no-active-file')
  if (!isPostPath(file))
    throw new StudioError(400, 'bad-path')
  return file
}

/** Expand every `{file}` occurrence; the value is quoted, never taken as shell syntax. */
export function buildCommandLine(cmd, file) {
  if (!usesFile(cmd))
    return cmd
  return cmd.split(FILE_PLACEHOLDER).join(shellQuote(file))
}

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

async function start(job, { cmd, cwd, postsDir, shell = DEFAULT_SHELL, shellArgs = DEFAULT_SHELL_ARGS }) {
  try {
    job.prevMtimes = await snapshotMtimes(cwd, postsDir)
    if (job.stopRequested)
      return

    const { command, args } = ptyCommand(shell, shellArgs, cmd)
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' },
    })
    job.child = child

    let atStart = true
    const decode = (chunk) => {
      // A pty ends its lines with CRLF; the log view only needs the LF.
      const text = chunk.toString().replace(/\r\n/g, `\n`)
      if (!atStart)
        return text

      // p10k's instant prompt clears itself by sending EOT, which a pty echoes as the
      // literal `^D` plus backspaces before the command runs.
      atStart = false
      let start = text.startsWith('^D') ? 2 : 0
      while (start < text.length && text.charCodeAt(start) === 8)
        start += 1
      return text.slice(start)
    }
    child.stdout.on('data', chunk => emit(job, { type: 'stdout', text: decode(chunk) }))
    child.stderr.on('data', chunk => emit(job, { type: 'stderr', text: decode(chunk) }))
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
 *
 * `{file}` is expanded once, at spawn time: attaching to a job that is already
 * running must not depend on the caller still having the same post open.
 */
export function runCommand({ id, cmd, cwd, postsDir = '_posts', file, shell, shellArgs, onEvent }) {
  const existing = jobs.get(id)
  if (existing?.running) {
    return { job: existing, detach: attachJob(id, { from: 0, onEvent }) }
  }

  // Resolved before the job is registered, so a rejected reference cannot leave
  // a half-started job behind.
  const commandLine = buildCommandLine(cmd, resolveCommandFile(cmd, file))

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
  start(job, { cmd: commandLine, cwd, postsDir, shell, shellArgs })

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
