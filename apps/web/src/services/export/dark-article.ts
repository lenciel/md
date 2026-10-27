/**
 * Night values for the article, shipped inside the pasted HTML.
 *
 * The paste is a single light rendering — the studio's preview resolves `light-dark()` against its
 * own `color-scheme`, but a reader gets one set of inline values, and WeChat's reader re-paints
 * them with its own dark-mode script. The official adaptation path for a WeChat webview is a
 * `prefers-color-scheme` media query (developers.weixin.qq.com/doc/service/guide/h5/darkmode.html),
 * which is what this block uses: it lands in the article, so a reader in dark mode gets exactly the
 * values the studio shows in dark mode, instead of whatever the reader's script decides.
 *
 * The declarations are `!important` because they have to beat the inlined light values that juice
 * wrote into `style` attributes. Only the lenciel theme ships a block: it is the one theme with a
 * designed night palette, and `lenciel.css` holds the same numbers.
 */
export const LENCIEL_DARK_OVERRIDES = `<style>
@media (prefers-color-scheme: dark) {
  p, li { color: #e6e6e6 !important; }
  h1, h2, h3, h4, h5, h6, a { text-shadow: rgba(176, 161, 161, 0.28) 1px 1px, rgba(176, 161, 161, 0.1) 2px 2px !important; }
  h2 { border-top-color: rgba(176, 161, 161, 0.16) !important; }
  blockquote { background: rgba(176, 161, 161, 0.16) !important; color: #e6e6e6 !important; box-shadow: rgba(176, 161, 161, 0.16) 0 1px 5px inset !important; }
  blockquote p { color: inherit !important; }
  .codespan { background: rgba(176, 161, 161, 0.16) !important; border-color: rgba(176, 161, 161, 0.16) !important; color: #e6e6e6 !important; }
  table { color: #e6e6e6 !important; }
  th { background: rgba(176, 161, 161, 0.16) !important; border-color: rgba(176, 161, 161, 0.16) !important; color: #e6e6e6 !important; }
  td { background: rgba(176, 161, 161, 0.16) !important; border-color: rgba(176, 161, 161, 0.16) !important; color: #e6e6e6 !important; }
  hr { border-color: rgba(176, 161, 161, 0.16) !important; }
  img { border-color: rgba(176, 161, 161, 0.16) !important; box-shadow: rgba(176, 161, 161, 0.16) 0 1px 4px !important; }
  pre.code__pre, .hljs.code__pre { border-color: rgba(176, 161, 161, 0.16) !important; box-shadow: rgba(176, 161, 161, 0.16) 0 6px 16px !important; }
  .pele-diagram svg { --pele-fg: #e6e6e6; --pele-muted: #b0a1a1; --pele-line: rgba(176, 161, 161, 0.55); --pele-surface: rgba(176, 161, 161, 0.16); --pele-surface-alt: rgba(176, 161, 161, 0.16); --pele-border: rgba(176, 161, 161, 0.35); }
}
</style>`

/**
 * Readability floor for the pasted article, shipped for every theme.
 *
 * WeChat's dark-mode pass repaints the page background and the element backgrounds it recognizes,
 * but the inlined *light* ink survives — so a table header written white (grace) or navy (lenciel
 * on its banding) ends up dark-on-dark and unreadable. These rules only fix contrast on the
 * surfaces the reader paints itself; they say nothing about a theme's palette, which is why they
 * are safe for all themes. The lenciel block, when present, is appended after this one and wins.
 */
export const ARTICLE_DARK_READABILITY = `<style>
@media (prefers-color-scheme: dark) {
  th, td, caption, thead { color: #e6e6e6 !important; }
  th, td { background-color: rgba(255, 255, 255, 0.06) !important; border-color: rgba(255, 255, 255, 0.16) !important; }
  blockquote { color: #e6e6e6 !important; }
  .codespan { color: #e6e6e6 !important; }
}
</style>`
