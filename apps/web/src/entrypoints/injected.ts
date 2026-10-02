import type { WechatArticle } from '@/types/wechat'
import { applyArticle, bodyMissing, fieldsComplete, readEditorFields, writeMissingFields } from '@/lib/wechat/editor-fields'

/** The editor repaints its settings for a while after the body lands; keep re-asserting. */
const REASSERT_WINDOW_MS = 6000
const REASSERT_POLL_MS = 500
/** The body is re-injected at most this often when the editor reported an empty one. */
const MAX_BODY_RETRIES = 2

interface MpEditorApiLike {
  invoke: (options: {
    apiName: string
    apiParam?: Record<string, unknown>
    sucCb?: (res: unknown) => void
    errCb?: (err: unknown) => void
  }) => void
}

function editorApi(): MpEditorApiLike | undefined {
  return (window as unknown as { __MP_Editor_JSAPI__?: MpEditorApiLike }).__MP_Editor_JSAPI__
}

/**
 * Write the article and then watch the editor, which is what cose does around its own
 * title/body fill: it never waits for readiness, it just writes and checks. Every field is
 * read back — the framework repaints its settings while the body loads, and a write that
 * was dropped has no other symptom.
 */
function pushArticle(article: WechatArticle, metadataOnly: boolean): void {
  const api = editorApi()
  const withContent = !metadataOnly

  applyArticle(document, api, article, { withContent })

  // Diagnostic only: `isNew: false` means the editor is the older generation, where these
  // plugin APIs may not answer at all.
  api?.invoke({
    apiName: `mp_editor_get_isready`,
    sucCb: res => console.info(`[md] 公众号编辑器状态`, res),
    errCb: () => {},
  })

  let bodyRetries = 0
  const requestedBody = withContent ? article.content : ``
  const deadline = Date.now() + REASSERT_WINDOW_MS

  const timer = setInterval(() => {
    const state = readEditorFields(document, article)

    if (withContent && bodyRetries < MAX_BODY_RETRIES) {
      api?.invoke({
        apiName: `mp_editor_get_content`,
        sucCb: (res) => {
          const body = (res as { content?: string } | undefined)?.content ?? ``
          if (bodyMissing(body, requestedBody)) {
            bodyRetries += 1
            console.warn(`[md] 正文未写入，重试 ${bodyRetries}/${MAX_BODY_RETRIES}`)
            api?.invoke({ apiName: `mp_editor_set_content`, apiParam: { content: requestedBody }, sucCb: () => {}, errCb: () => {} })
          }
        },
        errCb: () => {},
      })
    }

    if (fieldsComplete(state)) {
      clearInterval(timer)
      console.info(`[md] 公众号草稿字段已写入`, state)
      window.postMessage({ type: `mdFillReport`, state })
      return
    }

    writeMissingFields(document, api, article)
    if (Date.now() > deadline) {
      clearInterval(timer)
      console.warn(`[md] 部分字段未能写入公众号编辑器`, state)
      window.postMessage({ type: `mdFillReport`, state })
    }
  }, REASSERT_POLL_MS)
}

export default defineUnlistedScript(() => {
  window.addEventListener(`message`, (event) => {
    if (event.data?.type !== `copyToMp`)
      return

    const article = event.data.article as WechatArticle | undefined
    if (!article?.content)
      return

    pushArticle(article, event.data.metadataOnly === true)
  })
})
