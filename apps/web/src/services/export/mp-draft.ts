import { mpApiCall } from '@/services/upload/providers'

/**
 * 公众号草稿箱 housekeeping for publishing.
 *
 * The publish flow saves through the WeChat editor, which always opens a *new* draft — so a
 * post published twice ends up with two drafts of the same title, and `draft/update` cannot
 * help there (it updates the article set this app would have created itself). The old draft
 * is therefore deleted before the editor pushes the new one.
 *
 * The 草稿箱 API lists the same drafts the 公众号后台 shows, so drafts created or edited by
 * hand are matched too — the toggle in the 公众号 图床 settings (`replaceDraft`) is the way
 * out for anyone who keeps hand-made drafts around.
 */

/** WeChat returns at most 20 drafts per call. */
const DRAFT_PAGE_SIZE = 20
/** Newest drafts come first, so a same-title draft is always within the first pages. */
const MAX_DRAFT_PAGES = 5

interface MpDraftNewsItem {
  title?: string
}

interface MpDraftListResponse {
  total_count?: number
  item_count?: number
  item?: { media_id?: string, content?: { news_item?: MpDraftNewsItem[] } }[]
  errcode?: number
  errmsg?: string
}

interface MpWriteResponse {
  errcode?: number
  errmsg?: string
}

/** Every title a draft carries: a 图文消息 can hold several articles. */
function draftTitles(draft: { content?: { news_item?: MpDraftNewsItem[] } }): string[] {
  return (draft.content?.news_item ?? [])
    .map(item => (item.title ?? ``).trim())
    .filter(Boolean)
}

function wechatDetail(result: MpWriteResponse): string {
  return `[${result.errcode}] ${result.errmsg ?? ``}`
}

/**
 * Draft ids whose title matches `title` exactly (compared trimmed).
 *
 * Listing failures are thrown: an unknown draft box state must not look like "nothing to
 * replace", or the publish would silently pile another copy on top.
 */
export async function findSameTitleDrafts(title: string): Promise<string[]> {
  const wanted = title.trim()
  if (!wanted)
    return []

  const mediaIds: string[] = []
  for (let page = 0; page < MAX_DRAFT_PAGES; page += 1) {
    const res = await mpApiCall<MpDraftListResponse>(`/cgi-bin/draft/batchget?`, {
      offset: page * DRAFT_PAGE_SIZE,
      count: DRAFT_PAGE_SIZE,
    })
    if (res.errcode)
      throw new Error(wechatDetail(res))

    const items = res.item ?? []
    for (const draft of items) {
      if (draft.media_id && draftTitles(draft).includes(wanted))
        mediaIds.push(draft.media_id)
    }

    if (items.length < DRAFT_PAGE_SIZE)
      break
    if ((res.total_count ?? 0) <= (page + 1) * DRAFT_PAGE_SIZE)
      break
  }

  return mediaIds
}

/**
 * Delete every draft carrying `title` and answer how many are gone.
 *
 * 40007 means the draft disappeared between the listing and the delete (removed in 后台, or a
 * second publish in flight) — that is the state this call is after, so it counts as removed.
 */
export async function replaceDraftsWithTitle(title: string): Promise<number> {
  const mediaIds = await findSameTitleDrafts(title)
  let removed = 0

  for (const mediaId of mediaIds) {
    const res = await mpApiCall<MpWriteResponse>(`/cgi-bin/draft/delete?`, { media_id: mediaId })
    if (res.errcode && res.errcode !== 40007)
      throw new Error(wechatDetail(res))
    removed += 1
  }

  return removed
}
