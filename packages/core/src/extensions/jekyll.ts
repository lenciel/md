// Jekyll/Liquid and kramdown constructs used by the blog sources, rewritten into
// plain markdown before marked runs:
//
//   {% sidenote 'id' 'text' %}                 -> [^id] + an appended [^id]: text
//   {% highlight lang %}...{% endhighlight %}  -> a fenced code block
//   {% picture path --alt x %}                 -> a <figure> around the repo asset
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
import type { IOpts } from '@md/shared/types'
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

// jekyll_picture_tag. The optional tail is the blog's caption idiom: a trailing `\`
// hard break, then a `<small>` line, which becomes the figure's caption. The tail
// stays inside the optional group so a tag without a caption keeps its line ending
// (consuming it would glue the next paragraph onto the figure's raw HTML block).
const PICTURE_TAG_REGEX = /\{%\s*picture\s([^%]*)%\}(?:\\?\s*<small>([\s\S]*?)<\/small>)?/g
// `--alt text`, `--img width="178" height="248" class="left"`: each value runs to the next flag.
const PICTURE_FLAG_REGEX = /--([a-z]+)\s+/g
const PICTURE_SIZE_REGEX = /(width|height)\s*=\s*['"]?(\d+)/g
// Captions are pinned rather than themed: the blog's `<small>` line is 12px italic
// under the image, and `legend`-driven figcaptions are unrelated to it.
const PICTURE_CAPTION_STYLE = `text-align: center; font-size: 12px; font-style: italic;`

/** Shell-like split of the tag body, mirroring the Liquid plugin's `shellsplit`. */
function sidenoteArgs(raw: string): string[] {
  const args: string[] = []
  for (const match of raw.matchAll(SIDENOTE_ARG_REGEX)) {
    const value = match[1] ?? match[2] ?? match[3]
    args.push(match[1] === undefined ? value : value.replace(/\\(.)/g, `$1`))
  }
  return args
}

/** Flag values in tag order, so repeated flags keep the tag's own precedence. */
function pictureArgs(rawArgs: string): Record<string, string> {
  const flags = [...rawArgs.matchAll(PICTURE_FLAG_REGEX)]
  const args: Record<string, string> = {}

  flags.forEach((flag, index) => {
    const start = (flag.index ?? 0) + flag[0].length
    const end = index + 1 < flags.length ? flags[index + 1].index : rawArgs.length
    args[flag[1]] = rawArgs.slice(start, end).trim()
  })

  return args
}

/** `--alt "two words"` / `--alt 'two words'` / `--alt two` are all one value. */
function unquote(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]
  const quoted = (quote === `"` || quote === `'`) && trimmed[trimmed.length - 1] === quote && trimmed.length > 1
  return quoted ? trimmed.slice(1, -1) : trimmed
}

/**
 * jekyll_picture_tag resolves a repo-relative path, so the emitted `<img>` points at
 * whatever serves those bytes locally; `srcBase` carries the query prefix the host
 * (studio) expects. The original path stays on the element for the publish step,
 * which swaps in the uploaded asset URL.
 */
function pictureFigure(body: string, caption: string | undefined, srcBase: string): string {
  const trimmed = body.trim()
  const cut = trimmed.search(/\s/)
  const rel = (cut === -1 ? trimmed : trimmed.slice(0, cut)).replace(/^\/+/, ``)
  if (!rel)
    return ``

  const args = pictureArgs(cut === -1 ? `` : trimmed.slice(cut))
  const text = caption?.trim() ?? ``
  const altArg = unquote(args.alt ?? ``)
  const alt = altArg || text || rel.split(`/`).pop() || rel
  const captionHtml = text
    ? `<figcaption class="figcaption" style="${PICTURE_CAPTION_STYLE}">${escapeHtml(text)}</figcaption>`
    : ``
  // `width`/`height` only: the blog's `class` hints (e.g. `left`) have no WeChat counterpart.
  const sizes = [...(args.img ?? ``).matchAll(PICTURE_SIZE_REGEX)]
    .map(match => ` ${match[1]}="${match[2]}"`)
    .join(``)
  // The trailing blank line closes the raw HTML block, so whatever follows the tag
  // stays its own markdown block instead of being swallowed as literal HTML text.
  return `<figure><img data-picture-path="${escapeHtml(rel)}" src="${escapeHtml(srcBase + encodeURIComponent(rel))}" alt="${escapeHtml(alt)}"${sizes}>${captionHtml}</figure>\n\n`
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
 *
 * `{% picture %}` is rewritten only when `opts.pictureSrcBase` is set — that base
 * is served by the local workspace, so without it the tag has no image to point at
 * and is left for the reader (and for the blog's own Jekyll build).
 */
export function expandJekyllSource(markdown: string, opts: Pick<IOpts, `pictureSrcBase`> = {}): string {
  const pictureSrcBase = opts.pictureSrcBase
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
        .replace(PICTURE_TAG_REGEX, (tag, tagBody: string, caption?: string) => {
          if (!pictureSrcBase)
            return tag

          return pictureFigure(tagBody, caption, pictureSrcBase)
        })
    })
    .join(``)
    .replace(TOC_MARKER_REGEX, `[TOC]`)
    .replace(TOC_TOKEN_REGEX, `[TOC]`)

  return definitions.length === 0 ? body : `${body}\n\n${definitions.join(`\n`)}\n`
}
