import type { BuiltinThemeName } from './theme-css'

/**
 * Style defaults that differ from `defaultStyleConfig`, keyed by theme.
 *
 * A theme ported from an existing stylesheet only reads like the original at the
 * base size the original used. The lenciel theme scales every heading off
 * `--md-font-size`, and the blog it mirrors runs its body at 18px on a desktop
 * viewport (the blog's `html` font-size is fluid 16→18px), so without the
 * matching base the whole article renders a notch smaller than the blog.
 *
 * Deliberately has no runtime imports (the one type import is erased): the MCP
 * server resolves these defaults in Node, where `style.ts` (via `./theme` →
 * `./theme-css` `?raw` imports) cannot be loaded.
 */
export interface ThemeStyleDefaults {
  fontSize?: string
  lineHeight?: string
}

// `satisfies` keeps the keys honest while the exported map stays string-indexed:
// callers hold a `ThemeName`, which also covers `mp:` marketplace ids.
const overrides = {
  lenciel: {
    fontSize: `18px`,
    // Blog body is 1.618em; 1.65 is the closest value the line-height picker
    // offers, so the style menu keeps a selected option instead of none.
    lineHeight: `1.65`,
  },
} satisfies Partial<Record<BuiltinThemeName, ThemeStyleDefaults>>

/** Overrides for one theme id; themes absent here use `defaultStyleConfig` as-is. */
export const themeStyleDefaults: Record<string, ThemeStyleDefaults | undefined> = overrides
