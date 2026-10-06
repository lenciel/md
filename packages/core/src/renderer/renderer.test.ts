import { describe, expect, it } from 'vitest'
import { postProcessHtml, renderMarkdown } from '../utils/markdownHelpers'
import { initRenderer } from './renderer-impl'

describe('initRenderer', () => {
  it('renders headings and paragraphs', () => {
    const renderer = initRenderer({})
    const { html } = renderMarkdown(`# Hello\n\nWorld`, renderer)

    expect(html).toContain(`<h1`)
    expect(html).toContain(`Hello`)
    expect(html).toContain(`World`)
  })

  it('strips script tags during sanitization', () => {
    const renderer = initRenderer({})
    const { html } = renderMarkdown(`<script>alert(1)</script>\n\nSafe text`, renderer)

    expect(html).not.toContain(`<script>`)
    expect(html).toContain(`Safe text`)
  })

  it('renders GFM alert blocks', () => {
    const renderer = initRenderer({})
    const { html } = renderMarkdown(`> [!NOTE]\n> Alert body`, renderer)

    expect(html).toContain(`markdown-alert`)
    expect(html).toContain(`Alert body`)
  })

  it('parses YAML front matter', () => {
    const renderer = initRenderer({})
    const { markdownContent, readingTime, yamlData } = renderer.parseFrontMatterAndContent(
      `---\ntitle: Test\n---\n\n# Body`,
    )

    expect(yamlData).toEqual({ title: `Test` })
    expect(markdownContent.trim()).toBe(`# Body`)
    expect(readingTime.words).toBeGreaterThan(0)
  })

  it('includes reading time stats in postProcessHtml output', () => {
    const renderer = initRenderer({ countStatus: true, isMacCodeBlock: false })
    const { html, readingTime } = renderMarkdown(`# Hi`, renderer)
    const output = postProcessHtml(html, readingTime, renderer)

    expect(output).toContain(`words`)
    expect(output).toContain(`Hi`)
  })

  it('uses injected renderMessages for footnotes and unknown components', () => {
    const renderer = initRenderer({
      citeStatus: true,
      renderMessages: {
        footnoteTitle: `引用リンク`,
        sidenoteTitle: `注釈`,
        unknownComponent: `不明: {name}`,
        katexLoading: `数式読込中`,
      },
    })

    const withCite = renderMarkdown(`[Doocs](https://github.com/doocs)`, renderer)
    const withCiteHtml = postProcessHtml(withCite.html, withCite.readingTime, renderer)
    expect(withCiteHtml).toContain(`引用リンク`)

    const unknown = renderMarkdown(`<FakeWidget foo="1" />`, renderer)
    expect(unknown.html).toContain(`[不明: FakeWidget]`)
  })

  it('uses injected countMessages summary template', () => {
    const renderer = initRenderer({
      countStatus: true,
      countMessages: { summary: `単語 {words} / {minutes} 分` },
    })
    const { html, readingTime } = renderMarkdown(`# Hi`, renderer)
    const output = postProcessHtml(html, readingTime, renderer)
    expect(output).toMatch(/単語 \d+ \/ \d+ 分/)
  })

  it('renders single-line block formula as katex-block without paragraph wrapper', () => {
    const renderer = initRenderer({})
    const formula = `$$ITE_{i}=Y_{i,1}-Y_{i,0} \\tag{1}$$`
    const { html } = renderMarkdown(formula, renderer)

    expect(html).toContain(`katex-block`)
    expect(html).toContain(`data-math-raw`)
    expect(html).not.toMatch(/<p[^>]*>\s*<section class="katex-block"/)
  })

  it('renders list item followed by single-line block formula without paragraph wrapper', () => {
    const renderer = initRenderer({})
    const userMd = `1.比如识别段落之间带有编号的latex公式，如 

$$ITE_{i}=Y_{i,1}-Y_{i,0} \\tag{1}$$`
    const { html } = renderMarkdown(userMd, renderer)

    expect(html).toContain(`data-math-raw`)
    expect(html).toContain(`\\tag{1}`)
    expect(html).not.toMatch(/<p[^>]*>\s*<section class="katex-block"/)
  })

  it('collects headings in document order with plain text', () => {
    const renderer = initRenderer({})
    renderMarkdown(`# Title\n\n## Sub \`code\` & **bold**\n\nBody\n\n### Third`, renderer)

    expect(renderer.getHeadings()).toEqual([
      { level: 1, text: `Title` },
      { level: 2, text: `Sub code & bold` },
      { level: 3, text: `Third` },
    ])
  })

  it('decodes named and numeric entities in heading text like textContent', () => {
    const renderer = initRenderer({})
    renderMarkdown(`# Fish &amp; Chips &mdash; &#x2026; &nbsp;end`, renderer)

    expect(renderer.getHeadings()).toEqual([
      { level: 1, text: `Fish & Chips — … \u00A0end` },
    ])
  })

  it('includes the footnote title after postProcessHtml', () => {
    const renderer = initRenderer({
      citeStatus: true,
      renderMessages: { footnoteTitle: `脚注`, sidenoteTitle: `边注`, unknownComponent: ``, katexLoading: `` },
    })
    const { html, readingTime } = renderMarkdown(`# Doc\n\n[link](https://example.com)`, renderer)
    postProcessHtml(html, readingTime, renderer)

    const headings = renderer.getHeadings()
    expect(headings[0]).toEqual({ level: 1, text: `Doc` })
    expect(headings[headings.length - 1]).toEqual({ level: 4, text: `脚注` })
  })

  it('separates the reference list from the body with a paste-safe divider', () => {
    const renderer = initRenderer({
      citeStatus: true,
      renderMessages: { footnoteTitle: `脚注`, sidenoteTitle: `边注`, unknownComponent: ``, katexLoading: `` },
    })
    const { html, readingTime } = renderMarkdown(`# Doc\n\n[link](https://example.com)`, renderer)
    const processed = postProcessHtml(html, readingTime, renderer)

    const dividerIndex = processed.indexOf(`<section class="md-divider"`)
    expect(dividerIndex).toBeGreaterThan(-1)
    expect(dividerIndex).toBeLessThan(processed.indexOf(`脚注`))
    // WeChat drops <hr> on paste, so the divider must not be one.
    expect(processed).not.toContain(`<hr`)
  })

  it('omits the reference divider when nothing is cited', () => {
    const renderer = initRenderer({
      citeStatus: true,
      renderMessages: { footnoteTitle: `脚注`, sidenoteTitle: `边注`, unknownComponent: ``, katexLoading: `` },
    })
    const { html, readingTime } = renderMarkdown(`# Doc\n\nplain text`, renderer)

    expect(postProcessHtml(html, readingTime, renderer)).not.toContain(`md-divider`)
  })

  it('puts sidenote bodies in their own list under the divider, without citations', () => {
    const renderer = initRenderer({
      citeStatus: false,
      renderMessages: { footnoteTitle: `脚注`, sidenoteTitle: `边注`, unknownComponent: ``, katexLoading: `` },
    })
    const { html, readingTime } = renderMarkdown(`# Doc\n\n正文[^a] 结束\n\n[^a]: 边注内容`, renderer)
    const processed = postProcessHtml(html, readingTime, renderer)

    const dividerIndex = processed.indexOf(`<section class="md-divider"`)
    const titleIndex = processed.indexOf(`边注`)
    const bodyIndex = processed.indexOf(`边注内容`)
    expect(dividerIndex).toBeGreaterThan(-1)
    expect(dividerIndex).toBeLessThan(titleIndex)
    expect(titleIndex).toBeLessThan(bodyIndex)
    // The definition left the body: only the collected list carries it now.
    expect(processed.match(/边注内容/g)).toHaveLength(1)
    expect(processed).toContain(`id="fnDef-a"`)
    expect(processed).not.toContain(`脚注`)
  })

  it('lists sidenotes before cited links under one divider', () => {
    const renderer = initRenderer({
      citeStatus: true,
      renderMessages: { footnoteTitle: `引用链接`, sidenoteTitle: `脚注`, unknownComponent: ``, katexLoading: `` },
    })
    const { html, readingTime } = renderMarkdown(`# Doc\n\n正文[^a] 与 [link](https://example.com)\n\n[^a]: note body`, renderer)
    const processed = postProcessHtml(html, readingTime, renderer)

    const divider = processed.indexOf(`<section class="md-divider"`)
    const sidenote = processed.indexOf(`脚注`)
    const citedTitle = processed.indexOf(`引用链接`)
    expect(divider).toBeGreaterThan(-1)
    expect(divider).toBeLessThan(sidenote)
    expect(sidenote).toBeLessThan(citedTitle)
    expect(processed.indexOf(`note body`)).toBeLessThan(citedTitle)
    expect(processed.match(/md-divider/g)).toHaveLength(1)
  })

  it('clears collected headings on reset', () => {
    const renderer = initRenderer({})
    renderMarkdown(`# Old`, renderer)
    expect(renderer.getHeadings()).toHaveLength(1)

    renderer.reset({})
    expect(renderer.getHeadings()).toHaveLength(0)

    renderMarkdown(`## New`, renderer)
    expect(renderer.getHeadings()).toEqual([{ level: 2, text: `New` }])
  })

  it('resolves <Emoji> tags through assetResolver', () => {
    const renderer = initRenderer({
      assetResolver: id => `https://cdn.example/${id}.png`,
    })
    const { html } = renderMarkdown(`hello <Emoji id="liulei" alt="流泪" />`, renderer)

    expect(html).toContain(`md-emoji`)
    expect(html).toContain(`https://cdn.example/liulei.png`)
    expect(html).toContain(`data-emoji-id="liulei"`)
    expect(html).not.toContain(`about:blank`)
  })
})
