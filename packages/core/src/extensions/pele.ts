import type { DiagramMessages } from '@md/shared/types'
import type { MarkedExtension, Token } from 'marked'
import type { PeleToken } from '../types/marked-tokens'
import { asDiagramToken, asTextTokenRenderer, isCodeToken } from '../types/marked-tokens'
import {
  diagramStateAttr,
  formatDiagramMessage,
  MD_DIAGRAM_STATE,
  MD_DIAGRAM_STATE_ATTR,
  resolveDiagramMessages,
} from '../utils/asyncDiagramState'
import { simpleHash } from '../utils/basicHelpers'
import { blockScanLimit, findAtLineStart } from '../utils/scan'
import { createSVGCache } from '../utils/svgCache'

/**
 * A ```` ```pele ```` fence: Mermaid syntax rendered by [Pele](https://pele.run), the
 * zero-dependency Mermaid-to-SVG renderer. It is a separate fence rather than a switch on the
 * mermaid renderer, so a post can pick the engine per diagram.
 *
 * Pele paints through CSS variables (`.pele { --pele-fg: … }`), which is why one render serves both
 * theme modes: the browser re-resolves the variables when the scheme changes, no re-render needed.
 * Loading/error copy is the mermaid one — same syntax, same reader expectation.
 */
let apiPromise: Promise<typeof import('pele')> | null = null

interface PeleOptions {
  diagramMessages?: DiagramMessages
}

type PeleOptionsSource = PeleOptions | (() => PeleOptions | undefined)

let optionsSource: PeleOptionsSource | undefined

function resolveOptions(): PeleOptions | undefined {
  return typeof optionsSource === `function` ? optionsSource() : optionsSource
}

function getDiagramMessages(): DiagramMessages {
  return resolveDiagramMessages(resolveOptions()?.diagramMessages)
}

function getPele() {
  if (!apiPromise)
    apiPromise = import('pele')
  return apiPromise
}

const svgCache = createSVGCache(50)

function renderPele(id: string, code: string, cacheKey: string) {
  if (typeof window === `undefined`)
    return

  const find = () => document.getElementById(id)

  void getPele()
    .then(api => api.render(code, { responsive: true }).svg)
    .then((svg) => {
      svgCache.set(cacheKey, svg)
      const el = find()
      if (el) {
        el.innerHTML = svg
        el.setAttribute(MD_DIAGRAM_STATE_ATTR, MD_DIAGRAM_STATE.ready)
      }
    })
    .catch((error: unknown) => {
      console.error('Failed to render Pele:', error)
      const el = find()
      if (el) {
        const detail = error instanceof Error ? error.message : String(error)
        el.innerHTML = `<div style="color: red; padding: 10px; border: 1px solid red;">${formatDiagramMessage(getDiagramMessages().mermaidError, detail)}</div>`
        el.setAttribute(MD_DIAGRAM_STATE_ATTR, MD_DIAGRAM_STATE.error)
      }
    })
}

export function markedPele(options?: PeleOptionsSource): MarkedExtension {
  optionsSource = options
  const className = 'pele-diagram'

  return {
    extensions: [
      {
        name: 'pele',
        level: 'block',
        start(src: string) {
          return findAtLineStart(src, '```pele', blockScanLimit(src))
        },
        tokenizer(src: string) {
          const match = /^```pele\r?\n([\s\S]*?)\r?\n```/.exec(src)
          if (match) {
            return {
              type: 'pele',
              raw: match[0],
              text: match[1].trim(),
            }
          }
        },
        renderer: asTextTokenRenderer((token: PeleToken) => {
          const code = token.text
          const cacheKey = simpleHash(code)

          const cached = svgCache.get(cacheKey)
          if (cached) {
            return `<!--pele-start--><div class="${className}">${cached}</div><!--pele-end-->`
          }

          const id = `pele-${cacheKey}`
          renderPele(id, code, cacheKey)

          return `<!--pele-start--><div id="${id}" class="${className}" ${diagramStateAttr(MD_DIAGRAM_STATE.loading)}>${getDiagramMessages().mermaidLoading}</div><!--pele-end-->`
        }),
      },
    ],
    walkTokens(token: Token) {
      if (isCodeToken(token) && token.lang === 'pele')
        asDiagramToken<PeleToken>(token, 'pele')
    },
  }
}
