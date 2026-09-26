import { describe, expect, it } from 'vitest'
import { initRenderer } from '../renderer/renderer-impl'
import { renderMarkdown } from '../utils/markdownHelpers'

function render(md: string): string {
  return renderMarkdown(md, initRenderer({})).html
}

describe(`kramdown link IAL`, () => {
  it(`applies target from the IAL and drops the braces`, () => {
    const html = render(`[什么样式](http://baidu.com){:target="_blank"}`)

    expect(html).toContain(`<a href="http://baidu.com" title="什么样式" target="_blank" rel="noopener">什么样式</a>`)
    expect(html).not.toContain(`{:target`)
  })

  it(`renders the same anchor without an IAL`, () => {
    const html = render(`[什么样式](http://baidu.com)`)

    expect(html).toContain(`<a href="http://baidu.com" title="什么样式" target="_blank" rel="noopener">什么样式</a>`)
  })

  it(`accepts the case and value spellings found in existing posts`, () => {
    expect(render(`[a](http://a.com){:target="blank"}`)).toContain(`target="blank"`)
    expect(render(`[a](http://a.com){:TARGET="_BLANK"}`)).toContain(`target="_BLANK"`)
    expect(render(`[a](http://a.com){: target="_self" }`)).toContain(`target="_self"`)
  })

  it(`keeps noopener when the IAL sets rel`, () => {
    expect(render(`[a](http://a.com){:rel="nofollow"}`)).toContain(`rel="nofollow noopener"`)
    expect(render(`[a](http://a.com){:rel="nofollow noopener"}`)).toContain(`rel="nofollow noopener"`)
  })

  it(`lets the IAL override the tooltip title`, () => {
    const html = render(`[文字](http://a.com){:title="悬停说明" target="_blank"}`)

    expect(html).toContain(`title="悬停说明"`)
    expect(html).not.toContain(`{:title`)
  })

  it(`only applies to the link it directly follows`, () => {
    const html = render(`文字{:target="_blank"} 和 [链接](http://a.com){:.external}`)

    expect(html).toContain(`文字{:target="_blank"}`)
    expect(html).toContain(`href="http://a.com" title="链接" target="_blank" rel="noopener">链接</a>{:.external}`)
  })

  it(`leaves block-level IALs such as {:toc} untouched`, () => {
    expect(render(`{:toc}`)).toContain(`{:toc}`)
  })

  it(`escapes attribute values instead of letting them break out of the tag`, () => {
    const html = render(`[a](http://a.com){:title='x" onmouseover="alert(1)'}`)

    expect(html).toContain(`title="x&quot; onmouseover=&quot;alert(1)"`)
    expect(html).not.toContain(` onmouseover="alert(1)"`)
  })
})
