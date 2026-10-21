import { describe, expect, it } from 'vitest'
import { defaultPerThemeSettings, resolvePerThemeSettings } from './style'
import { themeLockedSettings } from './theme-defaults'

describe(`resolvePerThemeSettings`, () => {
  it(`drops stored values for the keys a theme owns`, () => {
    const settings = resolvePerThemeSettings(`lenciel`, {
      ...defaultPerThemeSettings(`lenciel`),
      fontSize: `16px`,
      lineHeight: `1.75`,
      primaryColor: `#FA5151`,
      linkColor: `#576b95`,
      blockquoteBackground: `transparent`,
      blockSpacing: `1.15`,
      fontFamily: `Menlo, monospace`,
      headingStyles: { h2: `border-bottom` },
    })

    expect(settings.fontSize).toBe(`16.1818px`)
    expect(settings.lineHeight).toBe(`1.618em`)
    expect(settings.primaryColor).toBe(`#d0648a`)
    expect(settings.linkColor).toBe(`#d0648a`)
    expect(settings.blockquoteBackground).toBe(`default`)
    expect(settings.blockSpacing).toBe(`1`)
    expect(settings.fontFamily).toContain(`-apple-system`)
    expect(settings.headingStyles).toEqual({})
  })

  it(`locks the code block theme and chrome`, () => {
    const settings = resolvePerThemeSettings(`lenciel`, {
      ...defaultPerThemeSettings(`lenciel`),
      codeBlockTheme: `https://example.com/github-dark.min.css`,
      // Stored values are the opposite of what the theme owns, so this also proves the override.
      isMacCodeBlock: false,
      isShowLineNumber: true,
    })

    expect(settings.codeBlockTheme).toContain(`base16/solarized-dark.min.css`)
    expect(settings.isMacCodeBlock).toBe(true)
    expect(settings.isShowLineNumber).toBe(false)
  })

  it(`keeps every stored value for a theme that owns nothing`, () => {
    const settings = resolvePerThemeSettings(`default`, {
      ...defaultPerThemeSettings(`default`),
      fontSize: `14px`,
      primaryColor: `#FA5151`,
    })

    expect(settings.fontSize).toBe(`14px`)
    expect(settings.primaryColor).toBe(`#FA5151`)
  })

  it(`locks every style key the lenciel theme provides`, () => {
    // Nothing in the style menu can pull this theme off its stylesheet.
    expect(Object.keys(themeLockedSettings.lenciel ?? {})).toEqual(expect.arrayContaining([
      `fontFamily`,
      `fontSize`,
      `lineHeight`,
      `blockSpacing`,
      `primaryColor`,
      `linkColor`,
      `blockquoteBackground`,
      `codeBlockTheme`,
      `isMacCodeBlock`,
      `isShowLineNumber`,
      `headingStyles`,
    ]))
  })

  it(`ships the blog's own numbers as the lenciel defaults`, () => {
    const settings = defaultPerThemeSettings(`lenciel`)

    // screen.css at a 400px viewport: `html { font-size: 16.1818px }` (its own
    // `calc(16px + 2 * ((100vw - 320px) / 880))`), `article { line-height: 1.618em }`,
    // links `#d0648a`.
    expect(settings.fontSize).toBe(`16.1818px`)
    expect(settings.lineHeight).toBe(`1.618em`)
    expect(settings.linkColor).toBe(`#d0648a`)
    expect(settings.fontFamily).toContain(`"PingFang SC"`)
  })
})
