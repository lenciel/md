import { describe, expect, it } from 'vitest'
import { wrapCSSWithScope } from './cssScopeWrapper'

describe(`wrapCSSWithScope`, () => {
  it(`prefixes ordinary selectors`, () => {
    expect(wrapCSSWithScope(`p, a { color: #222; }`)).toBe(`#output p,\n#output a { color: #222; }`)
  })

  it(`leaves a :root rule alone even when a comment precedes it`, () => {
    const css = `/* Dark preview: code surfaces */\n:root:is(.dark) #output .codespan {\n  color: #b6ddef;\n}`

    const out = wrapCSSWithScope(css)

    expect(out).toContain(`:root:is(.dark) #output .codespan {`)
    expect(out).not.toContain(`#output :root`)
  })

  it(`leaves an @media block alone even when a comment precedes it`, () => {
    const out = wrapCSSWithScope(`/* Blog port */\n@media (prefers-color-scheme: dark) {\n  pre {\n    color: #93a1a1;\n  }\n}`)

    expect(out).toContain(`@media (prefers-color-scheme: dark)`)
    expect(out).not.toContain(`#output @media`)
  })

  it(`scopes the selector a comment documents`, () => {
    const out = wrapCSSWithScope(`/* Blog: links */\na {\n  color: #d0648a;\n}`)

    expect(out).toContain(`/* Blog: links */`)
    expect(out.replace(/\/\*[\s\S]*?\*\//g, ``)).toContain(`#output a {`)
  })

  it(`keeps scoping the rules that follow a comment quoting CSS`, () => {
    // Theme stylesheets document their rules by quoting them, so braces and commas inside a
    // comment are ordinary — a scan that reads them as rule boundaries silently un-scopes (or
    // drops) every rule after the comment.
    const css = [
      `/* Blog: \`body { color: #222 }\`, \`th { background: #b9c9fe }\` */`,
      `p,`,
      `section.container {`,
      `  color: #222;`,
      `}`,
      ``,
      `/* Another comment, with a comma, and \`pre { color: #93a1a1 }\` */`,
      `.codespan {`,
      `  color: #555;`,
      `}`,
    ].join(`\n`)

    const out = wrapCSSWithScope(css)
    const bare = out.replace(/\/\*[\s\S]*?\*\//g, ``)

    expect(out).toContain(`#output p,\n#output section.container {`)
    expect(out).toContain(`#output .codespan {`)
    // Nothing a comment said may end up outside a comment.
    expect(bare).not.toContain(`b9c9fe`)
    expect(bare).not.toContain(`#222 }`)
  })
})
