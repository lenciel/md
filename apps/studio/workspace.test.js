import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildPostContent,
  computeNextFragments,
  findAssetFile,
  isPostPath,
  isValidSlug,
  listPosts,
  parseFrontMatterTitle,
  readAssetFile,
  readSiteAuthor,
  readWxmpManifest,
  resolveAssetPath,
  resolvePostPath,
  StudioError,
  titleFromName,
  writeFilePreservingMode,
  writeWxmpManifest,
} from './workspace.js'

const tempDirs = []

/** Every case gets its own temp root, so the real blog repo is never touched. */
async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `md-studio-test-`))
  tempDirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
})

describe(`parseFrontMatterTitle`, () => {
  it(`reads a quoted title`, () => {
    expect(parseFrontMatterTitle(`---\ntitle: "A: B"\n---\nbody`)).toBe(`A: B`)
  })

  it(`returns null without front matter or without a usable title`, () => {
    expect(parseFrontMatterTitle(`# No front matter`)).toBeNull()
    expect(parseFrontMatterTitle(`---\nlayout: post\n---\nbody`)).toBeNull()
    expect(parseFrontMatterTitle(`---\ntitle: ""\n---\nbody`)).toBeNull()
  })

  it(`returns null when the YAML is invalid`, () => {
    expect(parseFrontMatterTitle(`---\ntitle: "unterminated\n---\nbody`)).toBeNull()
  })
})

describe(`titleFromName`, () => {
  it(`drops the date prefix and the extension`, () => {
    expect(titleFromName(`2026-09-24-fragments-0x000b.markdown`)).toBe(`fragments-0x000b`)
    expect(titleFromName(`2024-01-02-hello.md`)).toBe(`hello`)
  })

  it(`keeps names that have no date prefix`, () => {
    expect(titleFromName(`draft.md`)).toBe(`draft`)
  })
})

describe(`computeNextFragments`, () => {
  it(`continues from the highest counter as lowercase hex`, () => {
    expect(computeNextFragments([{ name: `2026-09-24-fragments-0x000b.markdown` }], `2026-09-25`)).toEqual({
      num: `0x000c`,
      title: `Fragments 0x000c`,
      slug: `fragments-0x000c`,
      filename: `2026-09-25-fragments-0x000c.markdown`,
    })
  })

  it(`compares counters numerically, not as strings`, () => {
    const posts = [{ name: `a-fragments-0x0009.markdown` }, { name: `b-fragments-0x0010.markdown` }]
    expect(computeNextFragments(posts, `2026-09-25`).num).toBe(`0x0011`)
  })

  it(`starts at 0x0001 for an empty posts directory`, () => {
    expect(computeNextFragments([], `2026-09-25`)).toEqual({
      num: `0x0001`,
      title: `Fragments 0x0001`,
      slug: `fragments-0x0001`,
      filename: `2026-09-25-fragments-0x0001.markdown`,
    })
  })
})

describe(`isPostPath`, () => {
  it(`accepts single-level md/markdown files under _posts`, () => {
    expect(isPostPath(`_posts/a.md`)).toBe(true)
    expect(isPostPath(`_posts/2026-09-24-fragments-0x000b.markdown`)).toBe(true)
  })

  it(`rejects other extensions, nesting and every path outside _posts`, () => {
    for (const rel of [
      `_posts/a.txt`,
      `_posts/a.md.bak`,
      `_posts/sub/a.md`,
      `_posts/`,
      `_posts/../a.md`,
      `../x.md`,
      `_site/a.md`,
      `_posts\\a.md`,
      undefined,
    ]) {
      expect(isPostPath(rel)).toBe(false)
    }
  })
})

describe(`resolvePostPath`, () => {
  it(`joins a valid relative path to the root`, () => {
    expect(resolvePostPath(`/blog`, `_posts/a.md`)).toBe(path.join(`/blog`, `_posts/a.md`))
  })

  it(`throws a 400 StudioError for traversal`, () => {
    let error = null
    try {
      resolvePostPath(`/blog`, `../_posts/a.md`)
    }
    catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(StudioError)
    expect(error.status).toBe(400)
    expect(error.code).toBe(`bad-path`)
  })
})

describe(`buildPostContent`, () => {
  const datetime = `2026-09-25 14:03:02 +0800`

  it(`writes the fragments template byte for byte`, () => {
    const content = buildPostContent({ kind: `fragments`, title: `Fragments 0x000c`, datetime })

    expect(content).toBe([
      `---`,
      `layout: post`,
      `comments: true`,
      `description: '摘要'`,
      `title: 'Fragments 0x000c'`,
      `date: ${datetime}`,
      `categories: [useless-songs, wxmp]`,
      `---`,
      ``,
      ``,
    ].join(`\n`))
  })

  it(`escapes the post title and leaves categories empty`, () => {
    const content = buildPostContent({ kind: `post`, title: `A & B "C" \\ D`, datetime })

    expect(content).toBe([
      `---`,
      `layout: post`,
      `comments: true`,
      `description: "摘要"`,
      `title: "A &amp; B \\"C\\" \\\\ D"`,
      `date: ${datetime}`,
      `categories:`,
      `---`,
      ``,
      ``,
    ].join(`\n`))
  })
})

describe(`isValidSlug`, () => {
  it(`accepts lowercase dashed slugs`, () => {
    expect(isValidSlug(`fragments-0x000c`)).toBe(true)
    expect(isValidSlug(`hello-world-2`)).toBe(true)
  })

  it(`rejects uppercase, spaces, edge dashes and slugs longer than 80 chars`, () => {
    for (const slug of [`Fragments`, `hello world`, `-a`, `a-`, `a--b`, `a_b`, `a`.repeat(81)]) {
      expect(isValidSlug(slug)).toBe(false)
    }

    expect(isValidSlug(`a`.repeat(80))).toBe(true)
  })
})

describe(`writeFilePreservingMode`, () => {
  it(`keeps the mode of an existing file while replacing its content`, async () => {
    const dir = await makeTempDir()
    const file = path.join(dir, `mode.markdown`)
    await fs.writeFile(file, `first`, `utf8`)
    await fs.chmod(file, 0o755)

    await writeFilePreservingMode(file, `second`)
    expect(await fs.readFile(file, `utf8`)).toBe(`second`)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o755)

    await writeFilePreservingMode(file, `third`)
    expect(await fs.readFile(file, `utf8`)).toBe(`third`)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o755)

    expect((await fs.readdir(dir)).sort()).toEqual([`mode.markdown`])
  })

  it(`creates a missing file with 0o644 and leaves no temp file behind`, async () => {
    const dir = await makeTempDir()
    const file = path.join(dir, `new.markdown`)

    await writeFilePreservingMode(file, `created`)

    expect(await fs.readFile(file, `utf8`)).toBe(`created`)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o644)
    expect(await fs.readdir(dir)).toEqual([`new.markdown`])
  })
})

describe(`listPosts`, () => {
  it(`lists md/markdown files newest first, preferring the front matter title`, async () => {
    const root = await makeTempDir()
    const postsDir = path.join(root, `_posts`)
    await fs.mkdir(postsDir)
    await fs.mkdir(path.join(postsDir, `sub`))
    await fs.writeFile(path.join(postsDir, `notes.txt`), `ignore me`, `utf8`)
    await fs.writeFile(
      path.join(postsDir, `2024-01-02-beta.md`),
      `---\ntitle: Beta & Co\n---\nbody`,
      `utf8`,
    )
    await fs.writeFile(path.join(postsDir, `2024-01-03-alpha.markdown`), `no front matter`, `utf8`)

    const posts = await listPosts(root)

    expect(posts.map(post => post.name)).toEqual([`2024-01-03-alpha.markdown`, `2024-01-02-beta.md`])
    expect(posts[0]).toMatchObject({
      path: `_posts/2024-01-03-alpha.markdown`,
      slug: `2024-01-03-alpha`,
      ext: `.markdown`,
      title: `alpha`,
      date: `2024-01-03`,
    })
    expect(posts[1]).toMatchObject({
      path: `_posts/2024-01-02-beta.md`,
      slug: `2024-01-02-beta`,
      ext: `.md`,
      title: `Beta & Co`,
    })
    expect(posts[0].mtimeMs).toBeGreaterThan(0)
    expect(posts[0].size).toBeGreaterThan(0)
  })
})

describe(`blog assets`, () => {
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02])

  async function makeAssetRoot() {
    const root = await makeTempDir()
    await fs.mkdir(path.join(root, `downloads`, `images`, `2026_10`), { recursive: true })
    await fs.writeFile(path.join(root, `downloads`, `images`, `2026_10`, `shot.jpg`), PNG_BYTES)
    return root
  }

  it(`rejects anything outside downloads`, async () => {
    const root = await makeAssetRoot()

    for (const bad of [`downloads/../_config.yml`, `_posts/a.md`, `/downloads/a.png`, `downloads`, undefined])
      expect(() => resolveAssetPath(root, bad)).toThrowError(/bad-path/)
  })

  it(`finds a tag path that omits the extension`, async () => {
    const root = await makeAssetRoot()

    const file = await findAssetFile(root, `downloads/images/2026_10/shot`)
    expect(file.rel).toBe(`downloads/images/2026_10/shot.jpg`)
    expect(file.size).toBe(PNG_BYTES.length)

    await expect(findAssetFile(root, `downloads/images/2026_10/missing`)).rejects.toThrowError(/not-found/)
  })

  it(`hashes the bytes and trusts them over the extension`, async () => {
    const root = await makeAssetRoot()

    const asset = await readAssetFile(root, `downloads/images/2026_10/shot`)

    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(asset.size).toBe(PNG_BYTES.length)
    // A .jpg holding PNG bytes is exactly what WeChat rejects when the extension is believed.
    expect(asset.mime).toBe(`image/png`)
  })
})

describe(`wxmp manifest`, () => {
  const RECORD = { mode: `material`, url: `http://mmbiz.qpic.cn/x`, size: 12, sha256: `a`.repeat(64), media_id: `mid-1` }

  it(`reads an empty manifest when the blog has none`, async () => {
    expect(await readWxmpManifest(await makeTempDir())).toEqual({})
  })

  it(`merges into the shared blog manifest, sorted and rake-formatted`, async () => {
    const root = await makeTempDir()
    const existing = {
      'downloads/z.png': { mode: `uploadimg`, url: `http://a`, size: 1, sha256: `b`.repeat(64) },
      'downloads/a.png': { mode: `material`, url: `http://b`, size: 2, sha256: `c`.repeat(64), media_id: `m` },
    }
    await fs.writeFile(path.join(root, `.wxmp-upload.json`), `${JSON.stringify(existing, null, 2)}\n`, `utf8`)

    const written = await writeWxmpManifest(root, { 'downloads/images/new.png': RECORD })

    expect(Object.keys(written)).toEqual([`downloads/a.png`, `downloads/images/new.png`, `downloads/z.png`])
    expect(written['downloads/a.png']).toEqual(existing['downloads/a.png'])
    // Byte-identical to `rake wxmp:upload`'s output, so the two tools never fight over the file.
    expect(await fs.readFile(path.join(root, `.wxmp-upload.json`), `utf8`)).toBe(
      `${JSON.stringify(written, null, 2)}\n`,
    )
  })

  it(`refuses entries that would poison the rake task's cache`, async () => {
    const root = await makeTempDir()

    await expect(writeWxmpManifest(root, { 'downloads/ok.png': { ...RECORD, mode: `uploadimg` } }))
      .rejects
      .toThrowError(/bad-entry/)
    await expect(writeWxmpManifest(root, { '../outside.png': RECORD })).rejects.toThrowError(/bad-path/)
    await expect(writeWxmpManifest(root, { 'downloads/ok.png': { mode: `material`, url: `` } }))
      .rejects
      .toThrowError(/bad-entry/)
  })
})

describe(`site author`, () => {
  it(`reads the blog author once from _config.yml`, async () => {
    const root = await makeTempDir()
    await fs.writeFile(path.join(root, `_config.yml`), `title: "@Lenciel"\nauthor: "Lenciel"\n`, `utf8`)
    expect(await readSiteAuthor(root)).toBe(`Lenciel`)
  })

  it(`answers empty when the workspace has no author to give`, async () => {
    const root = await makeTempDir()
    expect(await readSiteAuthor(root)).toBe(``)

    await fs.writeFile(path.join(root, `_config.yml`), `title: "@Lenciel"\n`, `utf8`)
    expect(await readSiteAuthor(root)).toBe(``)
  })
})
