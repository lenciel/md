import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { studioApi } from './client'

vi.mock(`@/i18n/translate`, () => ({
  t: (key: string) => key,
}))

// A browser-level rejection carries no status, so `request` has to name the URL: otherwise a
// studio that was restarted (or a proxy in between) only ever reports `Failed to fetch`.
describe(`studio client network failures`, () => {
  beforeEach(() => {
    vi.stubGlobal(`window`, { __MD_STUDIO__: { apiBase: `/api` } })
    vi.stubGlobal(`fetch`, vi.fn(() => Promise.reject(new TypeError(`Failed to fetch`))))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(`names the endpoint a request never reached`, async () => {
    await expect(studioApi.readFile(`_posts/a.md`)).rejects.toThrow(
      `network.unreachable: /api/studio/file?path=_posts%2Fa.md`,
    )
  })

  it(`names the asset URL when the bytes cannot be fetched`, async () => {
    await expect(studioApi.assetBlob(`downloads/images/2026_10/a.webp`)).rejects.toThrow(
      `network.unreachable: /api/studio/asset?path=downloads%2Fimages%2F2026_10%2Fa.webp`,
    )
  })

  it(`keeps the original rejection for an aborted stream`, async () => {
    vi.stubGlobal(`fetch`, vi.fn(() => Promise.reject(new DOMException(`aborted`, `AbortError`))))

    await expect(studioApi.readFile(`_posts/a.md`)).rejects.toThrow(`aborted`)
  })
})
