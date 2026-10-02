import { describe, expect, it } from 'vitest'
import { initRenderer } from '../renderer/renderer-impl'
import { renderMarkdown } from '../utils/markdownHelpers'
import { expandJekyllSource } from './jekyll'

function render(md: string): string {
  return renderMarkdown(md, initRenderer({})).html
}

describe(`jekyll source rewrites`, () => {
  it(`renders a numbered footnote whose body is the tag text`, () => {
    const html = render(`正文{% sidenote 'sn-id-1' '这是一个 sidenote 的示例' %}继续。`)

    expect(html).not.toContain(`{% sidenote`)
    expect(html).toContain(`<a href="#fnDef-sn-id-1" id="fnRef-sn-id-1">[1]</a>`)
    expect(html).toContain(`<code>1.</code>`)
    expect(html).toContain(`这是一个 sidenote 的示例`)
  })

  it(`numbers the notes in document order`, () => {
    const html = render([
      `一{% sidenote 'sn-a' '第一条' %}`,
      ``,
      `二{% sidenote 'sn-b' '第二条' %}`,
    ].join(`\n`))

    expect(html).toContain(`id="fnRef-sn-a">[1]`)
    expect(html).toContain(`id="fnRef-sn-b">[2]`)
    expect(html).toContain(`第一条`)
    expect(html).toContain(`第二条`)
  })

  it(`accepts double quotes and an extra argument, like the Liquid plugin`, () => {
    const html = render(`{% sidenote "sn-x" "双引号内容" ignored %}`)

    expect(html).toContain(`id="fnRef-sn-x">[1]`)
    expect(html).toContain(`双引号内容`)
    expect(html).not.toContain(`ignored`)
  })

  it(`keeps the note body as markdown, including link IALs`, () => {
    const html = render(`{% sidenote 'sn-1' '见[框架](https://b.com/x){:target="_blank"}。' %}`)

    expect(html).toContain(`<a href="https://b.com/x" title="框架" target="_blank" rel="noopener">框架</a>`)
    expect(html).not.toContain(`{:target`)
  })

  it(`reuses one definition when the same id repeats`, () => {
    const html = render(`A{% sidenote 'sn-1' '内容' %}B{% sidenote 'sn-1' '内容' %}`)

    expect(html.match(/<code>1\.<\/code>/g)).toHaveLength(1)
    expect(html.match(/id="fnRef-sn-1">\[1\]/g)).toHaveLength(2)
  })

  it(`mixes with regular footnotes in definition order`, () => {
    const html = render([
      `正文[^note] 和 sidenote{% sidenote 'sn-1' '边注' %}`,
      ``,
      `[^note]: 普通脚注`,
    ].join(`\n`))

    expect(html).toContain(`id="fnRef-note">[1]`)
    expect(html).toContain(`id="fnRef-sn-1">[2]`)
    expect(html).toContain(`普通脚注`)
    expect(html).toContain(`边注`)
  })

  it(`leaves Liquid tags inside {% raw %} literal, like Liquid does`, () => {
    const markdown = `{% raw %}{% sidenote 'sn-1' '保持原样' %}{% endraw %}`

    // Jekyll drops the raw delimiters and outputs their body verbatim.
    expect(expandJekyllSource(markdown)).toBe(`{% sidenote 'sn-1' '保持原样' %}`)
  })

  it(`leaves text without a sidenote tag untouched`, () => {
    const markdown = `普通段落，没有边注。\n\n{% picture /a.jpg --alt a %}`

    expect(expandJekyllSource(markdown)).toBe(markdown)
  })

  it(`turns a highlight block into a fenced code block`, () => {
    const html = render(`{% highlight javascript %}\nconst a = 1\n{% endhighlight %}`)

    expect(html).not.toContain(`{% highlight`)
    expect(html).toContain(`language-javascript`)
    expect(expandJekyllSource(`{% highlight javascript linenos %}\nconst a = 1\n{% endhighlight %}`))
      .toBe(`\`\`\`javascript\nconst a = 1\n\`\`\``)
  })

  it(`keeps highlight blocks inside {% raw %} literal, like Liquid does`, () => {
    const markdown = `{% raw %}\n{% highlight javascript %}\nconst a = 1\n{% endhighlight %}\n{% endraw %}`

    expect(expandJekyllSource(markdown)).toContain(`{% highlight javascript %}`)
  })

  it(`replaces the kramdown toc marker list with [TOC]`, () => {
    const html = render([
      `### 目录`,
      `- TOC`,
      `{:toc}`,
      ``,
      `## 第一节`,
    ].join(`\n`))

    expect(html).not.toContain(`{:toc}`)
    expect(html).not.toContain(`>TOC<`)
    expect(html).toContain(`markdown-toc`)
    expect(html).toContain(`第一节`)
  })

  it(`drops raw delimiters but keeps their body`, () => {
    const html = render(`路径是 \`{% raw %}{{ page.url }}{% endraw %}\` 这样。`)

    expect(html).not.toContain(`{% raw %}`)
    expect(html).toContain(`{{ page.url }}`)
  })

  it(`turns a quote block into a markdown blockquote`, () => {
    const html = render(`{% blockquote %}\n「引文一」\n\n「引文二」\n{% endblockquote %}`)

    expect(html).not.toContain(`{% blockquote`)
    expect(html).toContain(`<blockquote`)
    expect(html).toContain(`「引文一」`)
    expect(html).toContain(`「引文二」`)
  })

  it(`renders the quote attribution like the Liquid plugin`, () => {
    const cited = render(`{% blockquote Vincent Vega  http://www.imdb.com/title/tt0110912/ Pulp Fiction(1994)%}\nbody\n{% endblockquote %}`)
    expect(cited).toContain(`<strong>Vincent Vega</strong>`)
    expect(cited).toContain(`<a href="http://www.imdb.com/title/tt0110912/">Pulp Fiction(1994)</a>`)
    expect(cited).not.toContain(`blockquote Vincent`)

    const titled = render(`{% blockquote George Orwell, Nineteen Eighty-Four (1984)%}\nbody\n{% endblockquote %}`)
    expect(titled).toContain(`<strong>George Orwell</strong>`)
    expect(titled).toContain(`<cite>Nineteen Eighty-Four (1984)</cite>`)

    const authorOnly = render(`{% blockquote 《麦田里的守望者》%}\nbody\n{% endblockquote %}`)
    expect(authorOnly).toContain(`<strong>《麦田里的守望者》</strong>`)
    expect(authorOnly).not.toContain(`<cite>`)
  })

  it(`keeps a sidenote inside a quote body`, () => {
    const html = render(`{% blockquote %}\n引文{% sidenote 'sn-q' '注解' %}\n{% endblockquote %}`)

    expect(html).toContain(`<blockquote`)
    expect(html).toContain(`id="fnRef-sn-q">[1]`)
    expect(html).toContain(`注解`)
  })
})

describe(`picture tags`, () => {
  // The tag carries a repo path, so only a host that can serve those bytes (studio)
  // turns it into an image; anywhere else the tag stays as written.
  const SRC_BASE = `/api/studio/asset?path=`

  function renderPicture(md: string): string {
    return renderMarkdown(md, initRenderer({ pictureSrcBase: SRC_BASE })).html
  }

  it(`stays literal while no asset source is configured`, () => {
    const markdown = `{% picture /downloads/images/a.png --alt a %}`
    expect(expandJekyllSource(markdown)).toBe(markdown)
    expect(expandJekyllSource(markdown, {})).toBe(markdown)
  })

  it(`expands into a figure whose image points at the asset source`, () => {
    const html = renderPicture(`{% picture /downloads/images/2026_10/us_economic_1.png --alt us_economic_1.png %}`)

    expect(html).not.toContain(`{% picture`)
    expect(html).toContain(`<figure>`)
    expect(html).toContain(`data-picture-path="downloads/images/2026_10/us_economic_1.png"`)
    expect(html).toContain(`src="${SRC_BASE}downloads%2Fimages%2F2026_10%2Fus_economic_1.png"`)
    expect(html).toContain(`alt="us_economic_1.png"`)
  })

  it(`turns the following small line into the caption`, () => {
    const html = renderPicture([
      `{% picture /downloads/images/a.png --alt a %}\\`,
      `<small>图 1. 美股历史新高</small>`,
      ``,
      `正文。`,
    ].join(`\n`))

    expect(html).toContain(`<figcaption`)
    expect(html).toContain(`图 1. 美股历史新高`)
    expect(html).toContain(`font-size: 12px`)
    expect(html).toContain(`text-align: center`)
    expect(html).toContain(`font-style: italic`)
    expect(html).not.toContain(`<small>`)
    // The caption must not swallow the paragraph that follows the tag pair.
    expect(html).toContain(`>正文。`)
  })

  it(`keeps the paragraph after a caption-less tag separate`, () => {
    const html = renderPicture(`{% picture /downloads/images/a.png %}\n正文。`)

    expect(html).toContain(`data-picture-path="downloads/images/a.png"`)
    expect(html).toContain(`alt="a.png"`)
    expect(html).not.toContain(`<figcaption`)
    expect(html).toContain(`>正文。`)
  })

  it(`forwards width and height but drops the blog's layout classes`, () => {
    const html = renderPicture(`{% picture /downloads/images/wengan.jpg --img width="178" height="248" class="left" %}`)

    expect(html).toContain(`width="178"`)
    expect(html).toContain(`height="248"`)
    expect(html).not.toContain(`class="left"`)
  })

  it(`prefers the caption text as alt when the tag has no --alt`, () => {
    const html = renderPicture(`{% picture /downloads/images/a.png %}\n<small>一句说明</small>`)

    expect(html).toContain(`alt="一句说明"`)
    expect(html).toContain(`一句说明</figcaption>`)
  })

  it(`leaves picture tags inside {% raw %} literal`, () => {
    expect(expandJekyllSource(`{% raw %}{% picture /a.png %}{% endraw %}`, { pictureSrcBase: SRC_BASE }))
      .toBe(`{% picture /a.png %}`)
  })
})
