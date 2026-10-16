/**
 * Scope CSS selectors to a prefix so styles apply only in the preview area.
 */

import { SELECTOR_MAPPING } from './selectorMapping'

/** Every CSS comment, in place. */
const COMMENT_REGEX = /\/\*[\s\S]*?\*\//g

/**
 * Comments blanked to the same length, so rule scanning can look past them while every offset
 * still points at the same character of the original string.
 *
 * A comment is inert to the browser, but theme stylesheets document their rules by quoting them
 * (`Blog: p { color: #555 }`), and a scan that reads those quoted braces as rule boundaries
 * shifts every rule after it: the comment swallows a selector, the rule loses its `#output`
 * prefix, and a mangled selector list can drop a rule outright.
 */
function maskComments(css: string): string {
  return css.replace(COMMENT_REGEX, comment => `/*${` `.repeat(Math.max(comment.length - 4, 0))}*/`)
}

/** Add scope prefix and map legacy selectors via SELECTOR_MAPPING */
export function wrapCSSWithScope(css: string, scope: string = `#output`): string {
  const masked = maskComments(css)
  const ruleRegex = /([^{}]+)\{[^}]*\}/g
  const out: string[] = []
  let cursor = 0

  for (let match = ruleRegex.exec(masked); match; match = ruleRegex.exec(masked)) {
    const start = match.index
    const end = start + match[0].length
    const selectors = css.slice(start, start + match[1].length)
    const properties = css.slice(start + match[1].length + 1, end - 1)

    // Whatever sits between two rules (comments, blank lines) is carried through untouched.
    out.push(css.slice(cursor, start))
    out.push(scopeRule(selectors, properties, scope))
    cursor = end
  }

  out.push(css.slice(cursor))
  return out.join(``)
}

/**
 * Prefix the selectors of one rule. Comments are lifted in front of the rule they document, so a
 * comment can never land between the prefix and the selector it was written for.
 */
function scopeRule(selectors: string, properties: string, scope: string): string {
  const comments = selectors.match(COMMENT_REGEX) ?? []
  const bare = selectors.replace(COMMENT_REGEX, ` `).replace(/\s+/g, ` `).trim()

  // Comments between two rules belong to the rule that follows: the `@` / `:root` exemption has
  // to look past them, or a documented `:root:is(.dark)` override gets an `#output` prefix it
  // must never have.
  if (!bare || bare.startsWith(`@`) || bare.startsWith(`:root`)) {
    return `${selectors}{${properties}}`
  }

  const wrappedSelectors = bare
    .split(`,`)
    .map((selector: string) => {
      const trimmed = selector.trim()

      if (!trimmed || trimmed.startsWith(scope)) {
        return trimmed
      }

      const mapped = trimmed.replace(/\.md-container\b/g, `.container`)
      const baseSelector = mapped.split(/[\s>+~:[]/, 1)[0].trim()

      if (baseSelector && SELECTOR_MAPPING[baseSelector]) {
        return `${scope} ${mapped.replace(baseSelector, `.${SELECTOR_MAPPING[baseSelector]}`)}`
      }

      // Prefix h1–h6 with section to match preset heading selector specificity
      if (/^h[1-6](?:\s|$|::|[:[])/.test(mapped)) {
        return `${scope} section ${mapped}`
      }

      return `${scope} ${mapped}`
    })
    .filter(Boolean)
    .join(`,\n`)

  const leading = comments.length ? `${comments.join(`\n`)}\n` : ``
  return `${leading}${wrappedSelectors} {${properties}}`
}
