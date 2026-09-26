import type { MarkedExtension, Token, Tokens, TokensList } from 'marked'
import type { LinkAttrs, LinkAttrsToken } from '../types/marked-tokens'
import { asGenericTokenRenderer } from '../types/marked-tokens'
import { escapeHtml } from '../utils/basicHelpers'

// Kramdown inline attribute list, as written in Jekyll posts:
// `[text](https://example.com){:target="_blank"}`.
const IAL_REGEX = /^\{:([^}]*)\}/
const ATTR_REGEX = /([.#]?[\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'`]+)))?/g

// Attributes the link renderer can express. Anything else (classes, ids, …)
// keeps the IAL literal instead of dropping the information silently.
const LINK_ATTRS: Record<string, true> = { target: true, rel: true, title: true }

function parseAttrs(raw: string): LinkAttrs | undefined {
  const attrs: LinkAttrs = {}
  for (const match of raw.matchAll(ATTR_REGEX)) {
    const key = match[1].toLowerCase()
    if (LINK_ATTRS[key] !== true) {
      return undefined
    }
    // Values end up inside quoted HTML attributes verbatim, so they are escaped here.
    attrs[key as keyof LinkAttrs] = escapeHtml(match[2] ?? match[3] ?? match[4] ?? ``)
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined
}

/** `rel` keeps `noopener`: an IAL must not be able to drop tab-nabbing protection. */
function withNoopener(rel: string): string {
  const parts = rel.split(/\s+/).filter(Boolean)
  if (!parts.some(part => part.toLowerCase() === `noopener`)) {
    parts.push(`noopener`)
  }
  return parts.join(` `)
}

/**
 * Kramdown inline attribute lists on links (`[text](url){:target="_blank"}`).
 * Attributes are merged into the preceding link token and the IAL token itself
 * renders nothing, so the braces never leak into the preview.
 *
 * Limitation: the IAL must follow the link immediately and may only carry
 * `target` / `rel` / `title`; other IALs (on images, blocks, classes) stay literal.
 */
export function markedLinkAttrs(): MarkedExtension {
  return {
    extensions: [
      {
        name: `linkAttrs`,
        level: `inline`,
        start(src: string) {
          const index = src.indexOf(`{:`)
          return index === -1 ? undefined : index
        },
        tokenizer(src: string, tokens: Token[] | TokensList) {
          const match = IAL_REGEX.exec(src)
          if (!match) {
            return undefined
          }

          const previous = tokens[tokens.length - 1]
          if (previous?.type !== `link`) {
            return undefined
          }

          const attrs = parseAttrs(match[1])
          if (!attrs) {
            return undefined
          }

          const link = previous as Tokens.Link & LinkAttrs
          if (attrs.target !== undefined) {
            link.target = attrs.target
          }
          if (attrs.title !== undefined) {
            link.title = attrs.title
          }
          if (attrs.rel !== undefined) {
            link.rel = withNoopener(attrs.rel)
          }

          return { type: `linkAttrs`, raw: match[0], text: ``, attrs }
        },
        renderer: asGenericTokenRenderer<LinkAttrsToken>(() => ``),
      },
    ],
  }
}
