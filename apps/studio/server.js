import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import { attachJob, isRunning, listRunning, runCommand, stopCommand } from './exec.js'
import {
  buildPostContent,
  computeNextFragments,
  isValidSlug,
  listPosts,
  readPostFile,
  resolvePostPath,
  shanghaiNow,
  StudioError,
  writeFilePreservingMode,
} from './workspace.js'

// Vite's dev proxy forwards the original Origin, so both loopback spellings are allowed.
const ORIGIN_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/
// Module/asset requests send `*/*`; only a literal `text/html` may fall back to the SPA shell.
const HTML_ACCEPT_RE = /text\/html/i
const STUDIO_GLOBAL = `<script>window.__MD_STUDIO__={"apiBase":"/api"};</script>`

function injectStudioGlobal(html) {
  if (html.includes('window.__MD_STUDIO__'))
    return html

  // Function form: the replacement must not be parsed for `$&` patterns.
  return html.replace('</head>', () => `${STUDIO_GLOBAL}</head>`)
}

function readIndexHtml(distDir) {
  if (!distDir)
    return null

  try {
    return injectStudioGlobal(readFileSync(path.join(distDir, 'index.html'), 'utf8'))
  }
  catch {
    return null
  }
}

function publicCommand(command) {
  const { id, label, mode, url } = command
  return url ? { id, label, mode, url } : { id, label, mode }
}

/** `409` only when the disk copy moved on since the client last read it. */
async function findStale(absPath, baseMtimeMs) {
  let stat
  try {
    stat = await fs.stat(absPath)
  }
  catch (err) {
    if (err.code === 'ENOENT')
      return null
    throw err
  }

  if (stat.mtimeMs === Number(baseMtimeMs))
    return null

  return { content: await fs.readFile(absPath, 'utf8'), mtimeMs: stat.mtimeMs }
}

export function createStudioApp({ config, distDir }) {
  const postsDir = config.postsDir ?? '_posts'
  const commands = config.commands ?? []
  const indexHtml = readIndexHtml(distDir)
  const app = express()

  app.use(express.json({ limit: '10mb' }))

  // The custom header forces a CORS preflight, so no token/CORS handling is needed.
  app.use('/api', (req, res, next) => {
    if (req.get('X-MD-Studio') !== '1') {
      res.status(403).json({ error: 'missing-header' })
      return
    }

    const origin = req.get('Origin')
    if (origin && !ORIGIN_RE.test(origin)) {
      res.status(403).json({ error: 'bad-origin' })
      return
    }

    if (req.method !== 'GET' && !req.is('application/json')) {
      res.status(415).json({ error: 'json-only' })
      return
    }

    next()
  })

  app.get('/api/studio/state', (req, res) => {
    res.json({
      root: config.root,
      postsDir,
      distOk: indexHtml != null,
      running: listRunning(),
      commands: commands.map(publicCommand),
    })
  })

  app.get('/api/studio/posts', async (req, res) => {
    const posts = await listPosts(config.root, postsDir)
    res.json({ posts, nextFragments: computeNextFragments(posts, shanghaiNow().date) })
  })

  app.get('/api/studio/file', async (req, res) => {
    res.json(await readPostFile(config.root, req.query.path))
  })

  app.put('/api/studio/file', async (req, res) => {
    const { path: rel, content, baseMtimeMs } = req.body ?? {}
    if (typeof content !== 'string')
      throw new StudioError(400, 'bad-content')

    const absPath = resolvePostPath(config.root, rel)

    if (baseMtimeMs != null) {
      const stale = await findStale(absPath, baseMtimeMs)
      if (stale)
        throw new StudioError(409, 'stale', stale)
    }

    const stat = await writeFilePreservingMode(absPath, content)
    res.json({ ok: true, mtimeMs: stat.mtimeMs })
  })

  app.post('/api/studio/post', async (req, res) => {
    const { kind } = req.body ?? {}
    if (kind !== 'post' && kind !== 'fragments')
      throw new StudioError(400, 'bad-kind')

    const now = shanghaiNow()
    let title
    let name

    if (kind === 'fragments') {
      // The counter owns both title and file name; any client-provided values are ignored.
      const next = computeNextFragments(await listPosts(config.root, postsDir), now.date)
      title = next.title
      name = next.filename
    }
    else {
      title = typeof req.body.title === 'string' ? req.body.title.trim() : ''
      const slug = typeof req.body.slug === 'string' ? req.body.slug.trim() : ''
      if (!title)
        throw new StudioError(400, 'bad-title')
      if (!isValidSlug(slug))
        throw new StudioError(400, 'bad-slug')
      name = `${now.date}-${slug}.markdown`
    }

    const rel = `${postsDir}/${name}`
    const absPath = resolvePostPath(config.root, rel)
    const content = buildPostContent({ kind, title, datetime: now.datetime })

    try {
      // `wx` makes the exist-check atomic; this path must never overwrite.
      await fs.writeFile(absPath, content, { flag: 'wx' })
    }
    catch (err) {
      if (err.code === 'EEXIST')
        throw new StudioError(409, 'exists')
      throw err
    }

    const created = await fs.stat(absPath)
    res.status(201).json({ path: rel, name, content, mtimeMs: created.mtimeMs })
  })

  app.post('/api/studio/exec', (req, res) => {
    const { commandId, from } = req.body ?? {}
    const command = commands.find(item => item.id === commandId)
    if (!command)
      throw new StudioError(404, 'unknown-command')

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.flushHeaders()

    const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`)
    const offset = Number.isFinite(Number(from)) ? Number(from) : 0

    const detach = isRunning(commandId)
      ? attachJob(commandId, { from: offset, onEvent: send })
      : runCommand({
        id: commandId,
        cmd: command.cmd,
        cwd: config.root,
        postsDir,
        onEvent: send,
      }).detach

    // Closing the dialog only detaches the stream; the command keeps running.
    res.on('close', () => detach?.())
  })

  app.post('/api/studio/stop', (req, res) => {
    const { commandId } = req.body ?? {}
    if (!commands.some(item => item.id === commandId))
      throw new StudioError(404, 'unknown-command')

    stopCommand(commandId)
    res.json({ ok: true })
  })

  if (distDir)
    app.use(express.static(distDir, { index: false }))

  // `app.get('*')` is rejected by express 5's path-to-regexp; a plain fallback is safe.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }

    if (!indexHtml || !HTML_ACCEPT_RE.test(req.get('Accept') ?? '')) {
      next()
      return
    }

    res.type('html').send(indexHtml)
  })

  app.use((req, res) => {
    res.status(404).json({ error: 'not-found' })
  })

  app.use((err, req, res, _next) => {
    if (res.headersSent) {
      res.end()
      return
    }

    if (err instanceof StudioError) {
      res.status(err.status).json({ error: err.code, ...err.extra })
      return
    }

    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'bad-json' })
      return
    }

    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'too-large' })
      return
    }

    console.error('studio api error:', err)
    res.status(500).json({ error: 'internal' })
  })

  return app
}
