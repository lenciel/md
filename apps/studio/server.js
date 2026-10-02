import { Buffer } from 'node:buffer'
import { readFileSync, statSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import { attachJob, isRunning, listRunning, resolveCommandFile, resolveShell, runCommand, stopCommand, usesFile } from './exec.js'
import { createShare, createShareRouter } from './share.js'
import {
  buildPostContent,
  computeNextFragments,
  isValidSlug,
  listPosts,
  readAssetFile,
  readPostFile,
  readSiteAuthor,
  readWxmpManifest,
  resolvePostPath,
  shanghaiNow,
  StudioError,
  writeFilePreservingMode,
  writeWxmpManifest,
} from './workspace.js'

const WECHAT_API_ORIGIN = 'https://api.weixin.qq.com'

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

/**
 * The SPA shell, re-read whenever the build changes. `pnpm studio:build` while the server is
 * running swaps the hashed bundle names, and a cached shell would then point at files that
 * no longer exist — the page would load with a blank body and 404s in the console.
 */
function createIndexHtmlReader(distDir) {
  let cached = null
  let cachedMtimeMs = -1

  return () => {
    let mtimeMs = -1
    try {
      mtimeMs = statSync(path.join(distDir ?? '', 'index.html')).mtimeMs
    }
    catch {
      return null
    }

    if (cached && mtimeMs === cachedMtimeMs)
      return cached

    cached = readIndexHtml(distDir)
    cachedMtimeMs = mtimeMs
    return cached
  }
}

function publicCommand(command) {
  const { id, label, mode, url } = command
  // `needsFile` lets the panel disable the button until a post is open.
  const base = { id, label, mode, needsFile: usesFile(command.cmd) }
  return url ? { ...base, url } : base
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

export function createStudioApp({ config, distDir, shareOrigins = {} }) {
  const postsDir = config.postsDir ?? '_posts'
  const commands = config.commands ?? []
  const shell = resolveShell(config)
  const readShell = createIndexHtmlReader(distDir)
  const app = express()

  // WeChat's API sends no CORS header, so a page calling it directly only gets `Failed to fetch`.
  // The deployed app proxies through its own Worker (apps/web/worker); locally the studio plays that
  // role: `/cgi-bin/*` is forwarded verbatim to api.weixin.qq.com.
  // Registered before express.json so the body stays raw bytes (multipart material uploads).
  app.use('/cgi-bin', express.raw({ type: () => true, limit: '32mb' }), async (req, res) => {
    const target = `${WECHAT_API_ORIGIN}${req.originalUrl}`

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: { 'content-type': req.get('content-type') ?? 'application/json' },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
        redirect: 'follow',
      })
      res.status(upstream.status)
      res.set('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
      res.send(Buffer.from(await upstream.arrayBuffer()))
    }
    catch (err) {
      console.warn(`[studio] WeChat API unreachable: ${target.replace(/\?.*$/, '')} — ${err.message}`)
      res.status(502).json({ error: 'wechat-unreachable', message: err.message })
    }
  })

  app.use(express.json({ limit: '10mb' }))

  // The custom header forces a CORS preflight, so no token/CORS handling is needed.
  app.use('/api', (req, res, next) => {
    // `<img src>` cannot carry the header, so the one read-only asset route is exempt.
    // It stays gated by the `downloads/` allowlist, and without CORS headers a foreign
    // page can display such an image but never read its bytes back.
    const isAssetRead = req.method === 'GET' && req.path === '/studio/asset'

    if (!isAssetRead && req.get('X-MD-Studio') !== '1') {
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

  app.get('/api/studio/state', async (req, res) => {
    res.json({
      root: config.root,
      author: await readSiteAuthor(config.root),
      postsDir,
      distOk: readShell() != null,
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

  /** A picture the editor cannot resolve is worth a line here: the browser only says "failed". */
  async function serveAsset(path, send) {
    try {
      await send(path)
    }
    catch (err) {
      if (err instanceof StudioError && err.status === 404)
        console.warn(`[studio] missing asset referenced by the post: ${path}`)
      throw err
    }
  }

  // Byte facts only: the picture resolver checks the manifest before pulling bytes.
  app.get('/api/studio/asset-info', async (req, res) => {
    await serveAsset(req.query.path, async (path) => {
      const { rel, size, sha256, mime } = await readAssetFile(config.root, path)
      res.json({ path: rel, size, sha256, mime })
    })
  })

  app.get('/api/studio/asset', async (req, res) => {
    await serveAsset(req.query.path, async (path) => {
      const { rel, mime, buffer } = await readAssetFile(config.root, path)
      res.set('Content-Type', mime)
      res.set('X-MD-Asset-Path', rel)
      res.send(buffer)
    })
  })

  // Local share: the 分享 dialog's snapshot, served to the phone instead of uploaded.
  // Same page as the cloud share, so the 公众号 rendering is what the phone shows.
  app.post('/api/studio/share', (req, res) => {
    const { title = '', bodyHtml, stylesHtml } = req.body ?? {}
    if (typeof bodyHtml !== 'string' || !bodyHtml)
      throw new StudioError(400, 'bad-snapshot')

    const { id } = createShare({ title: String(title), bodyHtml, stylesHtml: typeof stylesHtml === 'string' ? stylesHtml : '' })
    res.json({
      id,
      url: `${shareOrigins.local ?? ''}/s/${id}`,
      lanUrl: shareOrigins.lan ? `${shareOrigins.lan}/s/${id}` : '',
    })
  })

  app.use(createShareRouter())

  // The blog manifest `rake wxmp:upload` also reads and writes, so a picture already
  // uploaded by a deploy is never uploaded again from the editor.
  app.get('/api/studio/wxmp-manifest', async (req, res) => {
    res.json({ manifest: await readWxmpManifest(config.root) })
  })

  app.put('/api/studio/wxmp-manifest', async (req, res) => {
    res.json({ manifest: await writeWxmpManifest(config.root, req.body?.updates) })
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
    const { commandId, from, file } = req.body ?? {}
    const command = commands.find(item => item.id === commandId)
    if (!command)
      throw new StudioError(404, 'unknown-command')

    // Attaching to a run that is already going ignores `file`; only a fresh spawn
    // needs it. Resolve here because once the SSE headers are flushed the
    // response can no longer carry an error status.
    const attaching = isRunning(commandId)
    if (!attaching)
      resolveCommandFile(command.cmd, file)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.flushHeaders()

    const send = event => res.write(`data: ${JSON.stringify(event)}\n\n`)
    const offset = Number.isFinite(Number(from)) ? Number(from) : 0

    const detach = attaching
      ? attachJob(commandId, { from: offset, onEvent: send })
      : runCommand({
        id: commandId,
        cmd: command.cmd,
        cwd: config.root,
        postsDir,
        file,
        shell: shell.shell,
        shellArgs: shell.args,
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

    const indexHtml = readShell()
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
