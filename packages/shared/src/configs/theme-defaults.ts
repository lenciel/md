import type { HeadingStyles } from './style'
import type { BuiltinThemeName } from './theme-css'

/**
 * Style settings a ported theme supplies itself, keyed by theme.
 *
 * A theme ported from an existing stylesheet only reads like the original at the values the
 * original used, so for these themes the style menu hides the matching options and stored
 * per-theme values are ignored: the theme CSS is the single source of truth, and the studio
 * preview, the exported/pasted article and the original site all render the same numbers.
 *
 * lenciel comes from `lenciel.com`'s screen.css, which is fluid:
 *   `html { font-size: calc(16px + 2 * ((100vw - 320px) / 880)) }`  → 16.18px at 320px, 18px at 1200px
 *   `article { line-height: 1.618em }`
 * The font stack, the article colours and every size live in `theme-css/lenciel.css`.
 *
 * Deliberately has no runtime imports (the two type imports are erased): the MCP server
 * resolves these in Node, where `style.ts` (via `./theme` → `./theme-css` `?raw` imports)
 * cannot be loaded.
 */
export interface ThemeLockedSettings {
  fontFamily?: string
  fontSize?: string
  lineHeight?: string
  blockSpacing?: string
  primaryColor?: string
  linkColor?: string
  blockquoteBackground?: string
  codeBlockTheme?: string
  isMacCodeBlock?: boolean
  isShowLineNumber?: boolean
  headingStyles?: HeadingStyles
}

/** The blog's body stack, verbatim from screen.css (`.serif, body`). */
const LENCIEL_FONT_FAMILY = `-apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif`

// `satisfies` keeps the keys honest while the exported map stays string-indexed:
// callers hold a `ThemeName`, which also covers `mp:` marketplace ids.
const overrides = {
  lenciel: {
    fontFamily: LENCIEL_FONT_FAMILY,
    /**
     * The blog's own root size at a 400px viewport — `calc(16px + 2 * ((400px - 320px) / 880))`
     * from `html { font-size: calc(16px + 2 * ((100vw - 320px) / 880)) }`.
     *
     * A constant, not the formula: the preview renders in a pane (so `100vw` is the window,
     * not the column) and WeChat's article layout viewport is not the reader's screen either —
     * a `vw` value would land on the 18px desktop cap in both. Pinning the phone value keeps
     * what you preview identical to what you paste, and matches lenciel.com on a phone.
     */
    fontSize: `16.1818px`,
    lineHeight: `1.618em`,
    blockSpacing: `1`,
    /**
     * The blog's code blocks are solarized (`pre { background: #002b36; color: #93a1a1;
     * border: 1px solid #05232b }`). highlight.js' base16 solarized-dark is the same palette,
     * so the code-theme picker is locked to it for this theme.
     */
    codeBlockTheme: `https://cdn-doocs.oss-cn-shenzhen.aliyuncs.com/npm/highlightjs/11.11.1/styles/base16/solarized-dark.min.css`,
    // The blog's code blocks carry no mac-style header row and no gutter.
    isMacCodeBlock: false,
    isShowLineNumber: false,
    primaryColor: `#d0648a`,
    linkColor: `#d0648a`,
    // `default` keeps the theme's own quote box (#f2f2f2) instead of an app-wide colour.
    blockquoteBackground: `default`,
    headingStyles: {},
  },
} satisfies Partial<Record<BuiltinThemeName, ThemeLockedSettings>>

/** Locked settings for one theme id; themes absent here use `defaultStyleConfig` as-is. */
export const themeLockedSettings: Record<string, ThemeLockedSettings | undefined> = overrides

/** Keys the theme owns; callers ignore stored values and hide the matching menu entries. */
export function lockedStyleKeys(theme: string): Set<string> {
  return new Set(Object.keys(themeLockedSettings[theme] ?? {}))
}
