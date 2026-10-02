import type { WechatArticle } from '@/types/wechat'

/** The editor mounts its plugin API on the page; only an in-page script can reach it. */
export interface MpEditorApi {
  invoke: (options: {
    apiName: string
    apiParam?: Record<string, unknown>
    sucCb?: (res: unknown) => void
    errCb?: (err: unknown) => void
  }) => void
}

/** Which settings the editor currently holds. A field the editor does not render counts as held. */
export interface EditorFieldState {
  cover: boolean
  title: boolean
  summary: boolean
  author: boolean
}

export function invokeEditorApi(
  api: MpEditorApi | undefined,
  apiName: string,
  apiParam?: Record<string, unknown>,
): void {
  try {
    api?.invoke({
      apiName,
      apiParam,
      sucCb: () => {},
      errCb: (err) => { console.warn(`[md] ${apiName} rejected`, err) },
    })
  }
  catch (error) {
    console.warn(`[md] ${apiName} failed`, error)
  }
}

/**
 * These settings belong to the editor's own framework, so assigning `.value` goes through
 * its setter and the next re-render puts the old value back. Writing through the prototype
 * setter and firing the events a `v-model` listens to is what makes the value stick;
 * whether it did is decided by reading the field back, never by the assignment.
 */
export function fillField(doc: Document, selector: string, value: string): void {
  const field = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!field)
    return

  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), `value`)?.set
  if (setter)
    setter.call(field, value)
  else
    field.value = value

  field.focus()
  for (const type of [`input`, `change`, `blur`])
    field.dispatchEvent(new Event(type, { bubbles: true }))
}

function fieldMatches(doc: Document, selector: string, value: string): boolean {
  const field = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  return field ? field.value === value : true
}

/** The title lives in `#title` or in a ProseMirror, depending on the editor generation. */
function fillTitle(doc: Document, title: string): void {
  const titleEditor = doc.querySelector(`.title-editor__input .ProseMirror`)
  if (titleEditor) {
    titleEditor.textContent = title
    for (const type of [`input`, `change`])
      titleEditor.dispatchEvent(new Event(type, { bubbles: true }))
  }
  fillField(doc, `#title`, title)
}

function titleMatches(doc: Document, title: string): boolean {
  const titleEditor = doc.querySelector(`.title-editor__input .ProseMirror`)
  return fieldMatches(doc, `#title`, title) && (!titleEditor || titleEditor.textContent === title)
}

/** The editor paints the chosen cover into its preview node, which is the only readback. */
function coverApplied(doc: Document): boolean {
  const previews = doc.querySelectorAll(`.js_cover_preview_new, .js_cover_preview_square`)
  // `url("")` is the placeholder the panel ships with, so the value has to be non-empty.
  return [...previews].some(preview => /url\(\s*["']?[^"')\s]+/.test(preview.getAttribute(`style`) ?? ``))
}

/** WeChat fetches `oriImgUrl` itself, and its own example is an https URL. */
function coverUrl(url: string): string {
  return url.replace(/^http:\/\//i, `https://`)
}

/** What the editor holds right now, so a re-render that dropped a field can be spotted. */
export function readEditorFields(doc: Document, article: WechatArticle): EditorFieldState {
  return {
    cover: !article.cover || coverApplied(doc),
    title: !article.title || titleMatches(doc, article.title),
    summary: !article.summary || fieldMatches(doc, `#js_description`, article.summary),
    author: !article.author || fieldMatches(doc, `#author`, article.author),
  }
}

export function fieldsComplete(state: EditorFieldState): boolean {
  return state.cover && state.title && state.summary && state.author
}

/** The body editor's own text and images, used to tell whether the write landed. */
function bodyShape(html: string): { text: number, images: number } {
  const template = document.createElement(`template`)
  template.innerHTML = html
  return {
    text: (template.content.textContent ?? ``).replace(/\s+/g, ``).length,
    images: template.content.querySelectorAll(`img`).length,
  }
}

/**
 * The editor drops `mp_editor_set_content` while it is still mounting, and an empty body
 * is the only symptom. Read the editor back instead of trusting the call.
 */
export function bodyMissing(editorHtml: string, expectedHtml: string): boolean {
  const editor = bodyShape(editorHtml)
  const expected = bodyShape(expectedHtml)
  return editor.text === 0 && editor.images === 0 && (expected.text > 0 || expected.images > 0)
}

/**
 * Write one article into the editor. The cover follows the body, because it references an
 * image the editor was just given; the body is skipped when the publish flow owns it
 * (cose fills that one itself).
 */
export function applyArticle(
  doc: Document,
  api: MpEditorApi | undefined,
  article: WechatArticle,
  options: { withContent: boolean },
): void {
  if (options.withContent)
    invokeEditorApi(api, `mp_editor_set_content`, { content: article.content })

  writeMissingFields(doc, api, article)
}

/** Re-assert whatever the editor dropped; it re-renders while the body loads and on autosave. */
export function writeMissingFields(doc: Document, api: MpEditorApi | undefined, article: WechatArticle): void {
  const state = readEditorFields(doc, article)
  if (!state.cover)
    invokeEditorApi(api, `mp_editor_change_cover`, { oriImgUrl: coverUrl(article.cover) })
  if (!state.title)
    fillTitle(doc, article.title)
  if (!state.summary)
    fillField(doc, `#js_description`, article.summary)
  if (!state.author)
    fillField(doc, `#author`, article.author)
}
