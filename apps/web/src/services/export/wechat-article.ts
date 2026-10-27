import type { RendererAPI } from '@md/shared/types'
import type { WechatArticle } from '@/types/wechat'
import { ARTICLE_DARK_READABILITY, LENCIEL_DARK_OVERRIDES } from './dark-article'
import { resolvePictureHtml } from './wechat-picture'

/** WeChat caps 摘要 at 120 characters; anything longer is silently clipped there. */
const SUMMARY_LIMIT = 120

function frontMatterText(yamlData: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = yamlData[key]
    if (typeof value === `string` && value.trim())
      return value.trim()
  }
  return ``
}

/** The blog keeps 标题/摘要 in front matter; a document without it falls back to its own text. */
export function articleMetadata(markdown: string, renderer: RendererAPI): { title: string, summary: string, author: string } {
  let yamlData: Record<string, unknown> = {}
  try {
    yamlData = renderer.parseFrontMatterAndContent(markdown).yamlData
  }
  catch (error) {
    console.warn(`[wechat-article] front matter parse failed`, error)
  }

  const summary = frontMatterText(yamlData, `description`, `summary`)
  return {
    title: frontMatterText(yamlData, `title`),
    summary: summary.length > SUMMARY_LIMIT ? summary.slice(0, SUMMARY_LIMIT) : summary,
    author: frontMatterText(yamlData, `author`),
  }
}

/**
 * The cover is the article's first real image. Inline emoji render as `<img class="md-emoji">`
 * (often data URLs, which WeChat cannot fetch), so only remote non-emoji sources count.
 */
export function firstContentImage(html: string): string {
  const template = document.createElement(`template`)
  template.innerHTML = html

  const image = [...template.content.querySelectorAll(`img`)]
    .find(img => /^https?:/i.test(img.getAttribute(`src`) ?? ``) && !img.classList.contains(`md-emoji`))
  return image?.getAttribute(`src`) ?? ``
}

/**
 * Turn the copied HTML plus the document's markdown into the 公众号 article fields.
 * `siteAuthor` is the blog's own author (`_config.yml`), used when the post has none.
 */
export async function resolveWechatArticle(
  html: string,
  markdown: string,
  renderer: RendererAPI | null | undefined,
  siteAuthor = ``,
  theme = ``,
): Promise<WechatArticle> {
  const content = await resolvePictureHtml(html)
  // The draft never goes through the clipboard, so the same `prefers-color-scheme` block is appended
  // here: a reader's dark mode is decided on their side (see dark-article.ts).
  // The readability floor ships for every theme; the lenciel block comes after it and wins.
  const themed = `${content}${ARTICLE_DARK_READABILITY}${theme === `lenciel` ? LENCIEL_DARK_OVERRIDES : ``}`
  const metadata = renderer ? articleMetadata(markdown, renderer) : { title: ``, summary: ``, author: `` }

  return {
    content: themed,
    title: metadata.title,
    summary: metadata.summary,
    cover: firstContentImage(content),
    author: metadata.author || siteAuthor,
  }
}
