// @vitest-environment jsdom
import { initRenderer } from '@md/core/renderer'
import { describe, expect, it } from 'vitest'
import { articleMetadata, firstContentImage, resolveWechatArticle } from './wechat-article'

const renderer = initRenderer({})

const POST = [
  `---`,
  `title: 'Fragments 0x000F'`,
  `description: '...代码写得再快再好，也必须与它所嵌入的系统和组织的价值观、上下文和约束条件保持一致...'`,
  `author: 'Lenciel'`,
  `---`,
  ``,
  `Body text.`,
].join(`\n`)

describe(`articleMetadata`, () => {
  it(`takes 标题/摘要 from the front matter`, () => {
    expect(articleMetadata(POST, renderer)).toEqual({
      title: `Fragments 0x000F`,
      summary: `...代码写得再快再好，也必须与它所嵌入的系统和组织的价值观、上下文和约束条件保持一致...`,
      author: `Lenciel`,
    })
  })

  it(`accepts summary as an alias and truncates to WeChat's 120 characters`, () => {
    const long = `x`.repeat(200)
    const metadata = articleMetadata(`---\nsummary: ${long}\n---\nbody`, renderer)

    expect(metadata.summary).toHaveLength(120)
    expect(metadata.title).toBe(``)
  })

  it(`answers empty fields for a document without front matter`, () => {
    expect(articleMetadata(`# Just a heading\n\ntext`, renderer)).toEqual({ title: ``, summary: ``, author: `` })
  })
})

describe(`firstContentImage`, () => {
  it(`skips inline emoji and data URLs, and wants a remote image`, () => {
    const html = [
      `<p><img class="md-emoji" src="data:image/png;base64,AAAA"></p>`,
      `<figure><img src="http://mmbiz.qpic.cn/mmbiz_png/abc/0"></figure>`,
      `<p><img src="https://example.com/second.png"></p>`,
    ].join(``)

    expect(firstContentImage(html)).toBe(`http://mmbiz.qpic.cn/mmbiz_png/abc/0`)
  })

  it(`answers nothing when the article has no remote image`, () => {
    expect(firstContentImage(`<p>text</p><img src="data:image/png;base64,AAAA">`)).toBe(``)
  })
})

describe(`resolveWechatArticle`, () => {
  it(`falls back to the blog author and points the cover at the article's first image`, async () => {
    const content = `<section><p>x</p><img src="http://mmbiz.qpic.cn/mmbiz_png/abc/0"></section>`

    const article = await resolveWechatArticle(content, POST, renderer, `Lenciel`)

    expect(article).toEqual({
      content,
      title: `Fragments 0x000F`,
      summary: `...代码写得再快再好，也必须与它所嵌入的系统和组织的价值观、上下文和约束条件保持一致...`,
      cover: `http://mmbiz.qpic.cn/mmbiz_png/abc/0`,
      author: `Lenciel`,
    })
  })
})
