import type { Plugin } from 'vite'
import process from 'node:process'

/**
 * Vite plugin: dev-mode bridge to the local studio server.
 *
 * Only active when the dev server is started with `MD_STUDIO=1` (see
 * `pnpm studio:serve`); the studio build (`SERVER_ENV=STUDIO`) is served by
 * that same Node server, which injects the identical global itself.
 */
export function studioDevPlugin(): Plugin {
  const isStudioDev = process.env.MD_STUDIO === `1`

  return {
    name: `vite-plugin-studio`,
    config() {
      if (!isStudioDev)
        return

      return {
        server: {
          proxy: {
            // The studio server rejects unknown origins, so the original Host/Origin
            // must survive the hop (changeOrigin: false).
            '/api': {
              target: `http://127.0.0.1:${process.env.MD_STUDIO_PORT ?? 8790}`,
              changeOrigin: false,
            },
          },
        },
      }
    },
    transformIndexHtml() {
      if (!isStudioDev)
        return

      return [
        {
          tag: `script`,
          children: `window.__MD_STUDIO__ = {"apiBase":"/api"};`,
          injectTo: `head`,
        },
      ]
    },
  }
}
