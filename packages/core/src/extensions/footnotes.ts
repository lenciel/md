import type { MarkedExtension, RendererThis, Tokens } from 'marked'
/**
 * A marked extension to support footnotes syntax.
 * Syntax:
 *  This is a footnote reference[^1][^2].
 *
 *  [^1]: .....
 *  [^2]: .....
 */

interface MapContent {
  index: number
  text: string
}

export interface FootnotesExtension extends MarkedExtension {
  /**
   * Definitions for the current document, in definition order, one `p.footnotes` block
   * per entry (the same shape the cited-link list uses). Definitions are collected rather
   * than emitted in place so the renderer can put them under their own title at the end of
   * the article; empty when nothing is defined.
   */
  renderDefinitions: () => string
}

export function markedFootnotes(): FootnotesExtension {
  const fnMap = new Map<string, MapContent>()
  let definitions: string[] = []

  return {
    renderDefinitions() {
      return definitions.join(`\n`)
    },
    hooks: {
      preprocess(markdown) {
        fnMap.clear()
        definitions = []
        return markdown
      },
    },
    extensions: [
      {
        name: `footnoteDef`,
        level: `block`,
        start(src: string) {
          return src.startsWith(`[^`) ? 0 : undefined
        },
        tokenizer(src: string) {
          const match = src.match(/^\[\^(.*)\]:(.*)/)
          if (match) {
            const [raw, fnId, text] = match
            const index = fnMap.size + 1
            fnMap.set(fnId, { index, text })
            return {
              type: `footnoteDef`,
              raw,
              fnId,
              index,
              text,
              // Note bodies are markdown in the sources (links, IALs, emphasis), so
              // they are lexed as inline content instead of being pasted raw.
              tokens: this.lexer.inlineTokens(text),
            }
          }
          return undefined
        },
        renderer(this: RendererThis, token: Tokens.Generic) {
          const { index, text, fnId, tokens } = token
          const body = tokens ? this.parser.parseInline(tokens) : text
          // One block per entry: the gap between entries is then a margin the theme can
          // size, which <br/>-separated lines inside one paragraph cannot express without
          // also loosening the leading inside a wrapped entry.
          definitions.push(
            `<p class="footnotes">`
            + `<code style="font-size: 90%; opacity: 0.6;">${index}.</code> `
            + `<span>${body}</span> `
            + `<a class="md-footnote-back" id="fnDef-${fnId}" href="#fnRef-${fnId}">\u21A9\uFE0E</a>`
            + `</p>`,
          )
          return ``
        },
      },
      {
        name: `footnoteRef`,
        level: `inline`,
        start(src: string) {
          const index = src.indexOf(`[^`)
          return index === -1 ? undefined : index
        },
        tokenizer(src: string) {
          const match = src.match(/^\[\^(.*?)\]/)
          if (match) {
            const [raw, fnId] = match
            return {
              type: `footnoteRef`,
              raw,
              fnId,
            }
          }
        },
        renderer(token: Tokens.Generic) {
          const { fnId } = token
          const reference = fnMap.get(fnId)
          if (!reference) {
            return token.raw
          }

          const { index } = reference
          // Bare number, like the blog's `.sidenote-number`; the bracketed form stays
          // with cited links, and `.md-sidenote-ref` carries the note's own style.
          return `<sup class="md-sidenote-ref" style="color: var(--md-primary-color);"><a href="#fnDef-${fnId}" id="fnRef-${fnId}">${index}</a></sup>`
        },
      },
    ],
  }
}
