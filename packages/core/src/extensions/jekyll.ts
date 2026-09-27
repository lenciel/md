// Jekyll/Liquid and kramdown constructs used by the blog sources, rewritten into
// plain markdown before marked runs:
//
//   {% sidenote 'id' 'text' %}                 -> [^id] + an appended [^id]: text
//   {% highlight lang %}...{% endhighlight %}  -> a fenced code block
//   {% raw %}...{% endraw %}                   -> delimiters dropped, body kept
//   - TOC / {:toc}                             -> [TOC]
//
// The rewrite runs before marked rather than through a `hooks.preprocess`
// extension: marked chains preprocess hooks as "first hook that returns a string
// wins", so a second hook would silently skip the footnote extension's own
// preprocess (which resets its footnote map between renders).
//
// `{% raw %}` shields Liquid tags only. kramdown syntax such as `{:toc}` is still
// expanded by Jekyll inside those blocks, so it is rewritten everywhere.
import { escapeHtml } from '../utils/basicHelpers'

const SIDENOTE_TAG_REGEX = /\{%\s*sidenote\s([\s\S]*?)%\}/g
const SIDENOTE_ARG_REGEX = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
const HIGHLIGHT_BLOCK_REGEX = /\{%\s*highlight([\s\S]*?)%\}([\s\S]*?)\{%\s*endhighlight\s*%\}/g
const BLOCKQUOTE_BLOCK_REGEX = /\{%\s*blockquote([^%]*)%\}([\s\S]*?)\{%\s*endblockquote\s*%\}/g
const RAW_SPLIT_REGEX = /(\{%\s*(?:end)?raw\s*%\})/
const RAW_DELIMITER_REGEX = /^\{%\s*(?:end)?raw\s*%\}$/
// kramdown replaces the marker list itself with the generated toc, so the `- TOC`
// bullet must not survive the rewrite.
const TOC_MARKER_REGEX = /^[ \t]*[-*+][ \t]+TOC[ \t]*\r?\n[ \t]*\{:toc\}[ \t]*$/gm
const TOC_TOKEN_REGEX = /\{:toc\}/g

/** Shell-like split of the tag body, mirroring the Liquid plugin's `shellsplit`. */
function sidenoteArgs(raw: string): string[] {
  const args: string[] = []
  for (const match of raw.matchAll(SIDENOTE_ARG_REGEX)) {
    const value = match[1] ?? match[2] ?? match[3]
    args.push(match[1] === undefined ? value : value.replace(/\\(.)/g, `$1`))
  }
  return args
}

/**
 * Mirrors `plugins/blockquote.rb`: `author url title`, `author url`, `author, title`
 * or a bare `author`, rendered as the plugin's `<footer>`.
 */
function blockquoteFooter(args: string): string {
  const raw = args.trim()
  if (!raw)
    return ``

  // `author url [title]`: the author is everything before the url, the title the rest.
  const words = raw.split(/\s+/)
  const urlIndex = words.findIndex(word => /^https?:\/\//i.test(word))
  if (urlIndex > 0) {
    const author = words.slice(0, urlIndex).join(` `)
    const url = words[urlIndex]
    const title = words.slice(urlIndex + 1).join(` `)
    return `<footer><strong>${escapeHtml(author)}</strong> <cite><a href="${escapeHtml(url)}">${escapeHtml(title || url)}</a></cite></footer>`
  }

  // `author, title` keeps the rest of the string as the title, like the plugin.
  const comma = raw.indexOf(`,`)
  const author = (comma === -1 ? raw : raw.slice(0, comma)).trim()
  const title = comma === -1 ? `` : raw.slice(comma + 1).trim()
  return title
    ? `<footer><strong>${escapeHtml(author)}</strong> <cite>${escapeHtml(title)}</cite></footer>`
    : `<footer><strong>${escapeHtml(author)}</strong></footer>`
}

/**
 * Rewrites every Jekyll construct in `markdown`. Sidenote tags become footnote
 * references numbered in document order, with their definitions appended so the
 * footnote extension renders them like any other footnote.
 */
export function expandJekyllSource(markdown: string): string {
  const definitions: string[] = []
  const defined = new Set<string>()
  let inRaw = false

  const body = markdown
    .split(RAW_SPLIT_REGEX)
    .map((segment) => {
      if (RAW_DELIMITER_REGEX.test(segment)) {
        inRaw = !segment.includes(`end`)
        return ``
      }
      if (inRaw)
        return segment

      return segment
        .replace(HIGHLIGHT_BLOCK_REGEX, (block, args: string, code: string) => {
          // Only the first argument is the language; `linenos` and friends are ignored.
          const lang = args.trim().split(/\s+/)[0]
          if (!lang)
            return block

          return `\`\`\`${lang}\n${code.trim()}\n\`\`\``
        })
        .replace(BLOCKQUOTE_BLOCK_REGEX, (_block, args: string, body: string) => {
          const footer = blockquoteFooter(args)
          const lines = body.trim().split(/\r?\n/).map(line => `> ${line}`.trimEnd())
          if (footer)
            lines.push(`>`, `> ${footer}`)

          return lines.join(`\n`)
        })
        .replace(SIDENOTE_TAG_REGEX, (tag, rawArgs: string) => {
          const [id, text] = sidenoteArgs(rawArgs)
          if (!id)
            return tag

          // Repeating an id keeps one definition, like a footnote referenced twice.
          if (!defined.has(id)) {
            defined.add(id)
            definitions.push(`[^${id}]: ${text ?? ``}`)
          }
          return `[^${id}]`
        })
    })
    .join(``)
    .replace(TOC_MARKER_REGEX, `[TOC]`)
    .replace(TOC_TOKEN_REGEX, `[TOC]`)

  return definitions.length === 0 ? body : `${body}\n\n${definitions.join(`\n`)}\n`
}
