import { beforeEach, describe, expect, it, vi } from 'vitest'

const mpApiCall = vi.hoisted(() => vi.fn())

vi.mock(`@/services/upload/providers`, () => ({ mpApiCall }))

const { findSameTitleDrafts, replaceDraftsWithTitle } = await import(`./mp-draft`)

function draft(mediaId: string, ...titles: string[]) {
  return { media_id: mediaId, content: { news_item: titles.map(title => ({ title })) } }
}

/** A full page of drafts that match nothing, so paging has to continue. */
function pageOfUnrelated(count: number) {
  return Array.from({ length: count }, (_, i) => draft(`other-${i}`, `其他标题 ${i}`))
}

beforeEach(() => {
  mpApiCall.mockReset()
})

describe(`findSameTitleDrafts`, () => {
  it(`keeps only the drafts whose title matches exactly, trimmed`, async () => {
    mpApiCall.mockResolvedValueOnce({
      total_count: 4,
      item_count: 4,
      item: [draft(`m1`, `标题`), draft(`m2`, `  标题  `), draft(`m3`, `标题（2）`), draft(`m4`, `别的`)],
    })

    await expect(findSameTitleDrafts(`标题`)).resolves.toEqual([`m1`, `m2`])
    expect(mpApiCall).toHaveBeenCalledWith(`/cgi-bin/draft/batchget?`, { offset: 0, count: 20 })
  })

  it(`looks at every article a draft carries`, async () => {
    mpApiCall.mockResolvedValueOnce({
      total_count: 1,
      item_count: 1,
      item: [draft(`m1`, `第一篇`, `标题`)],
    })

    await expect(findSameTitleDrafts(`标题`)).resolves.toEqual([`m1`])
  })

  it(`pages until a short page`, async () => {
    mpApiCall
      .mockResolvedValueOnce({ total_count: 25, item_count: 20, item: pageOfUnrelated(20) })
      .mockResolvedValueOnce({ total_count: 25, item_count: 5, item: [...pageOfUnrelated(4), draft(`m9`, `标题`)] })

    await expect(findSameTitleDrafts(`标题`)).resolves.toEqual([`m9`])
    expect(mpApiCall).toHaveBeenNthCalledWith(2, `/cgi-bin/draft/batchget?`, { offset: 20, count: 20 })
  })

  it(`is a no-op without a title, and reports listing failures`, async () => {
    await expect(findSameTitleDrafts(`   `)).resolves.toEqual([])
    expect(mpApiCall).not.toHaveBeenCalled()

    mpApiCall.mockResolvedValueOnce({ errcode: 45009, errmsg: `api daily quota limit` })
    await expect(findSameTitleDrafts(`标题`)).rejects.toThrow(`[45009] api daily quota limit`)
  })
})

describe(`replaceDraftsWithTitle`, () => {
  it(`deletes every match, counting an already-removed draft as gone`, async () => {
    mpApiCall
      .mockResolvedValueOnce({ total_count: 2, item_count: 2, item: [draft(`m1`, `标题`), draft(`m2`, `标题`)] })
      .mockResolvedValueOnce({ errcode: 0, errmsg: `ok` })
      .mockResolvedValueOnce({ errcode: 40007, errmsg: `invalid media_id` })

    await expect(replaceDraftsWithTitle(`标题`)).resolves.toBe(2)
    expect(mpApiCall).toHaveBeenNthCalledWith(2, `/cgi-bin/draft/delete?`, { media_id: `m1` })
    expect(mpApiCall).toHaveBeenNthCalledWith(3, `/cgi-bin/draft/delete?`, { media_id: `m2` })
  })

  it(`surfaces a deletion the account is not allowed to make`, async () => {
    mpApiCall
      .mockResolvedValueOnce({ total_count: 1, item_count: 1, item: [draft(`m1`, `标题`)] })
      .mockResolvedValueOnce({ errcode: 48001, errmsg: `api unauthorized` })

    await expect(replaceDraftsWithTitle(`标题`)).rejects.toThrow(`[48001] api unauthorized`)
  })

  it(`uploads nothing and touches nothing when no draft matches`, async () => {
    mpApiCall.mockResolvedValueOnce({ total_count: 1, item_count: 1, item: [draft(`m1`, `别的`)] })

    await expect(replaceDraftsWithTitle(`标题`)).resolves.toBe(0)
    expect(mpApiCall).toHaveBeenCalledTimes(1)
  })
})
