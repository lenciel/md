import { describe, expect, it } from 'vitest'
import { buildSharePageHtml, createShare, readShare } from './share.js'

describe(`local share snapshots`, () => {
  it(`serves the snapshot back as a standalone page`, () => {
    const { id } = createShare({ title: `Fragments 0x000F`, bodyHtml: `<p>正文</p>`, stylesHtml: `<style>.share-content{color:#222}</style>` })

    const share = readShare(id)
    expect(share).not.toBe(null)
    // The phone has to see the same shell the cloud share page uses, styles included.
    expect(share.html).toContain(`<div class="share-content">`)
    expect(share.html).toContain(`<p>正文</p>`)
    expect(share.html).toContain(`.share-content{color:#222}`)
    expect(share.html).toContain(`<title>Fragments 0x000F</title>`)
    expect(share.html).toContain(`width=device-width`)
  })

  it(`escapes the title and keeps ids unguessable`, () => {
    const first = createShare({ title: `<script>alert(1)</script>`, bodyHtml: `x`, stylesHtml: `` })
    const second = createShare({ title: ``, bodyHtml: `x`, stylesHtml: `` })

    expect(readShare(first.id).html).not.toContain(`<script>alert(1)</script>`)
    expect(first.id).not.toBe(second.id)
    expect(first.id).toMatch(/^[0-9a-f]{12}$/)
  })

  it(`answers nothing for an unknown id`, () => {
    expect(readShare(`nope`)).toBe(null)
    expect(readShare(undefined)).toBe(null)
  })

  it(`keeps only the newest snapshots`, () => {
    const ids = []
    for (let i = 0; i < 25; i += 1)
      ids.push(createShare({ title: `t${i}`, bodyHtml: `body ${i}`, stylesHtml: `` }).id)

    expect(readShare(ids.at(-1))).not.toBe(null)
    // The oldest ones are dropped once the cap is reached; the map is capped at 20.
    expect(readShare(ids[0])).toBe(null)
  })
})

describe(`buildSharePageHtml`, () => {
  it(`never inlines an unescaped title`, () => {
    expect(buildSharePageHtml(`a & b "c"`, `body`, ``)).toContain(`<title>a &amp; b &quot;c&quot;</title>`)
  })
})
