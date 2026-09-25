import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { load as loadYaml } from 'js-yaml'

/** Only single-level `_posts/*.md|.markdown` paths are reachable through the API. */
export const POST_FILE_RE = /^_posts\/[^/]+\.(?:md|markdown)$/

const POST_EXT_RE = /\.(?:md|markdown)$/i
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}-/
const FRAGMENTS_NUM_RE = /fragments-0x([0-9a-f]+)/i

// Same shape as packages/core/src/utils/front-matter.ts, minus the `= yaml =` variants.
const FRONT_MATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

// The title sits at the top of the file; listing 500+ posts must not read every body.
const FRONT_MATTER_BYTES = 4096

export class StudioError extends Error {
  constructor(status, code, extra) {
    super(code)
    this.name = 'StudioError'
    this.status = status
    this.code = code
    this.extra = extra ?? {}
  }
}

export function isPostPath(rel) {
  return typeof rel === 'string' && POST_FILE_RE.test(rel)
}

export function resolvePostPath(root, rel) {
  if (typeof rel !== 'string' || rel.includes('\0') || !isPostPath(rel))
    throw new StudioError(400, 'bad-path')

  // `postDir` is fixed to `_posts` and `rel` holds a bare file name, so no traversal is possible.
  return path.join(root, rel)
}

export function parseFrontMatterTitle(text) {
  if (typeof text !== 'string')
    return null

  const match = FRONT_MATTER_RE.exec(text)
  if (!match)
    return null

  try {
    const data = loadYaml(match[1] ?? '')
    const title = data && typeof data === 'object' ? data.title : null
    return typeof title === 'string' && title.trim() ? title : null
  }
  catch {
    return null
  }
}

export function titleFromName(name) {
  return name.replace(POST_EXT_RE, '').replace(DATE_PREFIX_RE, '')
}

export function computeNextFragments(posts, today = shanghaiNow().date) {
  const highest = (posts ?? []).reduce((acc, post) => {
    const match = FRAGMENTS_NUM_RE.exec(post?.name ?? '')
    return match ? Math.max(acc, Number.parseInt(match[1], 16)) : acc
  }, 0)

  const num = `0x${(highest + 1).toString(16).padStart(4, '0')}`
  return {
    num,
    title: `Fragments ${num}`,
    slug: `fragments-${num}`,
    filename: `${today}-fragments-${num}.markdown`,
  }
}

// All posts are written with a +0800 timestamp, so the date never comes from the host timezone.
const SHANGHAI_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function shanghaiNow() {
  const parts = Object.fromEntries(
    SHANGHAI_FORMATTER.formatToParts(new Date()).map(part => [part.type, part.value]),
  )
  const date = `${parts.year}-${parts.month}-${parts.day}`
  return { date, datetime: `${date} ${parts.hour}:${parts.minute}:${parts.second} +0800` }
}

export function buildPostContent({ kind, title, datetime }) {
  if (kind === 'fragments') {
    return `---\nlayout: post\ncomments: true\ndescription: '摘要'\ntitle: '${title}'\ndate: ${datetime}\ncategories: [useless-songs, wxmp]\n---\n\n`
  }

  if (kind === 'post') {
    // Escaping the backslash first keeps later replacements from doubling it.
    const escaped = String(title)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/&/g, '&amp;')
    return `---\nlayout: post\ncomments: true\ndescription: "摘要"\ntitle: "${escaped}"\ndate: ${datetime}\ncategories:\n---\n\n`
  }

  throw new StudioError(400, 'bad-kind')
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length <= 80 && SLUG_RE.test(slug)
}

async function readHead(absPath, bytes) {
  const handle = await fs.open(absPath, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  }
  finally {
    await handle.close()
  }
}

export async function listPosts(root, postsDir = '_posts') {
  const absDir = path.join(root, postsDir)
  const entries = await fs.readdir(absDir, { withFileTypes: true })
  const names = entries
    .filter(entry => entry.isFile() && POST_EXT_RE.test(entry.name))
    .map(entry => entry.name)

  const posts = []
  for (const name of names) {
    const absPath = path.join(absDir, name)
    const stat = await fs.stat(absPath)
    const title = parseFrontMatterTitle(await readHead(absPath, FRONT_MATTER_BYTES)) ?? titleFromName(name)
    posts.push({
      path: `${postsDir}/${name}`,
      name,
      slug: name.replace(POST_EXT_RE, ''),
      ext: path.extname(name).toLowerCase(),
      title,
      date: name.slice(0, 10),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    })
  }

  return posts.sort((a, b) => b.name.localeCompare(a.name))
}

export async function writeFilePreservingMode(absPath, content) {
  let mode = 0o644
  try {
    mode = (await fs.stat(absPath)).mode & 0o777
  }
  catch (err) {
    if (err.code !== 'ENOENT')
      throw err
  }

  const tmpPath = path.join(
    path.dirname(absPath),
    `.${path.basename(absPath)}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  )

  try {
    await fs.writeFile(tmpPath, content, 'utf8')
    await fs.chmod(tmpPath, mode)
    await fs.rename(tmpPath, absPath)
  }
  catch (err) {
    await fs.rm(tmpPath, { force: true })
    throw err
  }

  return fs.stat(absPath)
}

export async function readPostFile(root, rel) {
  const absPath = resolvePostPath(root, rel)

  try {
    const [content, stat] = await Promise.all([
      fs.readFile(absPath, 'utf8'),
      fs.stat(absPath),
    ])
    return { path: rel, content, mtimeMs: stat.mtimeMs }
  }
  catch (err) {
    if (err.code === 'ENOENT')
      throw new StudioError(404, 'not-found')
    throw err
  }
}
