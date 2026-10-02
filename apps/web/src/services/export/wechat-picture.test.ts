// @vitest-environment jsdom
import type { StudioAssetInfo, StudioWxmpRecord } from '@/services/studio/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reusableMaterialUrl } from './wechat-picture'

const ASSET: StudioAssetInfo = {
  path: `downloads/images/2026_10/x.png`,
  size: 215350,
  sha256: `6c7eabf8`,
  mime: `image/png`,
}

const RECORD: StudioWxmpRecord = {
  mode: `material`,
  url: `http://mmbiz.qpic.cn/x`,
  size: ASSET.size,
  sha256: ASSET.sha256,
  media_id: `32UljMYChYTgro`,
}

describe(`reusableMaterialUrl`, () => {
  it(`reuses a material record for the same bytes`, () => {
    expect(reusableMaterialUrl(RECORD, ASSET)).toBe(RECORD.url)
  })

  it(`re-uploads when the file changed, the mode differs, or no id was recorded`, () => {
    expect(reusableMaterialUrl({ ...RECORD, sha256: `other` }, ASSET)).toBe(``)
    expect(reusableMaterialUrl({ ...RECORD, size: ASSET.size + 1 }, ASSET)).toBe(``)
    // uploadimg records are the 图床's, not the article's: the rake task re-uploads them too.
    expect(reusableMaterialUrl({ ...RECORD, mode: `uploadimg` }, ASSET)).toBe(``)
    // The rake task treats a material record without a media id as not uploaded.
    expect(reusableMaterialUrl({ ...RECORD, media_id: undefined }, ASSET)).toBe(``)
    expect(reusableMaterialUrl(undefined, ASSET)).toBe(``)
  })
})

// The publish paths (复制到公众号 and the 发布 dialog) both end up here; WeChat keeps every
// image it is handed, so anything uploaded twice shows up twice in the 素材库.
const state = vi.hoisted(() => ({
  manifest: {} as Record<string, StudioWxmpRecord>,
  assets: new Map<string, StudioAssetInfo>(),
  saved: [] as Record<string, StudioWxmpRecord>[],
  uploads: 0,
}))

vi.mock(`@/i18n/translate`, () => ({ t: (key: string) => key }))

vi.mock(`@/services/upload/providers`, () => ({
  uploadMpMaterial: async () => {
    state.uploads += 1
    return { url: `http://mmbiz.qpic.cn/m${state.uploads}`, mediaId: `mid-${state.uploads}` }
  },
}))

vi.mock(`@/services/studio/client`, () => ({
  StudioHttpError: class StudioHttpError extends Error {
    constructor(public status: number, message: string) {
      super(message)
    }
  },
  studioApi: {
    wxmpManifest: async () => ({ manifest: state.manifest }),
    assetInfo: async (rel: string) => {
      const asset = state.assets.get(rel)
      if (!asset)
        throw new Error(`not-found`)
      return asset
    },
    assetBlob: async (rel: string) => new Blob([new Uint8Array(state.assets.get(rel)?.size ?? 0)]),
    saveWxmpManifest: async (updates: Record<string, StudioWxmpRecord>) => {
      state.saved.push(updates)
      Object.assign(state.manifest, updates)
      return { manifest: state.manifest }
    },
  },
}))

const { resolvePictureHtml } = await import(`./wechat-picture`)

const REL = ASSET.path
const FILE = `<figure><img data-picture-path="${REL}" src="/api/studio/asset?path=${encodeURIComponent(REL)}" alt="x"></figure>`

function pictureHtml(...rels: string[]): string {
  return rels.map(rel => `<figure><img data-picture-path="${rel}" src="/api/studio/asset?path=x" alt="x"></figure>`).join(``)
}

function srcs(html: string): string[] {
  return [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]!)
}

describe(`resolvePictureImages (publish flow)`, () => {
  beforeEach(() => {
    vi.stubGlobal(`window`, { __MD_STUDIO__: { apiBase: `/api` } })
    state.manifest = {}
    state.saved = []
    state.uploads = 0
    state.assets = new Map([[REL, { ...ASSET }]])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(`keeps a recorded picture as it is when the post is edited and published again`, async () => {
    state.manifest = { [REL]: { ...RECORD } }

    const first = await resolvePictureHtml(`<p>v1</p>${FILE}`)
    const second = await resolvePictureHtml(`<p>v2 with more text</p>${FILE}`)

    expect(state.uploads).toBe(0)
    expect(srcs(first)).toEqual([RECORD.url])
    expect(srcs(second)).toEqual([RECORD.url])
    expect(state.saved).toEqual([])
  })

  it(`uploads a file referenced twice in one publish only once`, async () => {
    const html = await resolvePictureHtml(pictureHtml(REL, REL))

    expect(state.uploads).toBe(1)
    expect(srcs(html)).toEqual([`http://mmbiz.qpic.cn/m1`, `http://mmbiz.qpic.cn/m1`])
    expect(state.saved).toHaveLength(1)
    expect(state.saved[0]![REL]).toMatchObject({ mode: `material`, size: ASSET.size, sha256: ASSET.sha256, media_id: `mid-1` })
  })

  it(`uploads again once the file's bytes changed, replacing the record`, async () => {
    state.manifest = { [REL]: { ...RECORD } }
    state.assets.set(REL, { ...ASSET, size: ASSET.size + 7, sha256: `edited` })

    const html = await resolvePictureHtml(FILE)

    expect(state.uploads).toBe(1)
    expect(srcs(html)).toEqual([`http://mmbiz.qpic.cn/m1`])
    expect(state.saved[0]![REL]).toMatchObject({ size: ASSET.size + 7, sha256: `edited` })
  })
})
