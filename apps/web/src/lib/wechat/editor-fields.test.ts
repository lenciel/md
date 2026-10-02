// @vitest-environment jsdom
import type { WechatArticle } from '@/types/wechat'
import { describe, expect, it, vi } from 'vitest'
import { applyArticle, bodyMissing, fieldsComplete, readEditorFields, writeMissingFields } from './editor-fields'

/** The 公众号 draft settings panel, reduced to the nodes the filler touches. */
function editorDom(options: { withAuthor?: boolean } = {}) {
  document.body.innerHTML = `
    <div id="js_cover_area" class="setting-group__cover setting-group__cover_primary">
      <div class="js_cover_preview_new select-cover__preview first_appmsg_cover" style="display: none; background-image: url(&quot;&quot;);"></div>
      <div class="js_cover_preview_square select-cover__preview preview-square" style="display: none;"></div>
    </div>
    <input id="title" value="">
    ${options.withAuthor === false ? `` : `<input id="author" value="">`}
    <div id="js_description_area" class="setting-group__abstract js_desc_area">
      <div id="js_description_span" class="frm_textarea_box">
        <textarea id="js_description" name="digest" max-length="120" class="frm_textarea js_desc"></textarea>
        <em class="frm_input_append frm_counter">0/120</em>
      </div>
    </div>`
  return document
}

const ARTICLE: WechatArticle = {
  content: `<section><p>正文</p></section>`,
  title: `Fragments 0x000F`,
  summary: `摘要文字`,
  cover: `http://mmbiz.qpic.cn/mmbiz_jpg/abc/0`,
  author: `Lenciel`,
}

function stubApi() {
  const calls: { apiName: string, apiParam?: Record<string, unknown> }[] = []
  const invoked = () => calls
  return {
    calls,
    invoked,
    api: { invoke: (options: { apiName: string, apiParam?: Record<string, unknown> }) => calls.push(options) },
  }
}

/** The editor repaints the preview once it has fetched the cover. */
function paintCover() {
  document.querySelector(`.js_cover_preview_new`)?.setAttribute(`style`, `background-image: url("https://mmbiz.qpic.cn/abc/0");`)
}

describe(`applyArticle`, () => {
  it(`writes 标题/摘要/作者 and asks the editor for the cover`, () => {
    editorDom()
    const { calls, api } = stubApi()

    applyArticle(document, api, ARTICLE, { withContent: true })

    expect((document.querySelector(`#title`) as HTMLInputElement).value).toBe(`Fragments 0x000F`)
    expect((document.querySelector(`#js_description`) as HTMLTextAreaElement).value).toBe(`摘要文字`)
    expect((document.querySelector(`#author`) as HTMLInputElement).value).toBe(`Lenciel`)
    expect(calls.map(call => call.apiName)).toEqual([`mp_editor_set_content`, `mp_editor_change_cover`])
    // WeChat fetches the URL itself; its own example is https.
    expect(calls[1].apiParam).toEqual({ oriImgUrl: `https://mmbiz.qpic.cn/mmbiz_jpg/abc/0` })
  })

  it(`leaves the body alone when the publish flow owns it`, () => {
    editorDom()
    const { calls, api } = stubApi()

    applyArticle(document, api, ARTICLE, { withContent: false })

    expect(calls.map(call => call.apiName)).toEqual([`mp_editor_change_cover`])
  })

  it(`reports a field the editor dropped and writes it again`, () => {
    editorDom()
    const { api } = stubApi()
    applyArticle(document, api, ARTICLE, { withContent: false })

    // What a re-render looks like: the framework puts its own (empty) state back.
    ;(document.querySelector(`#js_description`) as HTMLTextAreaElement).value = ``
    expect(readEditorFields(document, ARTICLE).summary).toBe(false)
    expect(fieldsComplete(readEditorFields(document, ARTICLE))).toBe(false)

    writeMissingFields(document, api, ARTICLE)

    expect((document.querySelector(`#js_description`) as HTMLTextAreaElement).value).toBe(`摘要文字`)
    paintCover()
    expect(fieldsComplete(readEditorFields(document, ARTICLE))).toBe(true)
  })

  it(`treats a field the editor does not render as nothing to fill`, () => {
    editorDom({ withAuthor: false })
    const { api } = stubApi()

    applyArticle(document, api, ARTICLE, { withContent: false })
    paintCover()

    expect(fieldsComplete(readEditorFields(document, ARTICLE))).toBe(true)
  })

  it(`uses the prototype setter, because the field belongs to a framework component`, () => {
    editorDom()
    const textarea = document.querySelector(`#js_description`) as HTMLTextAreaElement
    const set = vi.fn()
    // A component that intercepts the plain setter, the way a framework-managed field does.
    Object.defineProperty(textarea, `value`, { set, get: () => `` })

    applyArticle(document, stubApi().api, ARTICLE, { withContent: false })

    expect(set).not.toHaveBeenCalled()
  })
})

describe(`bodyMissing`, () => {
  it(`spots an empty editor and the placeholder WeChat ships with`, () => {
    expect(bodyMissing(``, ARTICLE.content)).toBe(true)
    expect(bodyMissing(`<p>从这里开始写正文</p>`, ARTICLE.content)).toBe(false)
  })

  it(`accepts a body that arrived, text or image only`, () => {
    expect(bodyMissing(`<section><p>正文</p></section>`, ARTICLE.content)).toBe(false)
    expect(bodyMissing(`<section><img src="x"></section>`, `<section><img src="y"></section>`)).toBe(false)
  })
})
