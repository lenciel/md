import { randomUUID } from 'node:crypto'
import express from 'express'

/**
 * Local share snapshots: what the 分享 dialog would have uploaded to the cloud, kept in
 * memory so a phone on the same Wi-Fi can open the 公众号 rendering without an account.
 *
 * Nothing is written to the blog checkout, and the LAN listener that serves these pages
 * exposes nothing else — the studio's file and command APIs stay on loopback.
 */
const MAX_SHARES = 20
const SHARE_TTL_MS = 12 * 60 * 60 * 1000

const shares = new Map()

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Same shell as the cloud share page (apps/api), minus the view counter and its footer. */
export function buildSharePageHtml(title, bodyHtml, stylesHtml) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title || 'Markdown 预览')}</title>
  ${stylesHtml}
  <style>
    body {
      margin: 0;
      background: #f5f5f5;
    }
    .share-page {
      max-width: 750px;
      margin: 0 auto;
      padding: 20px;
      background: #ffffff;
      box-sizing: border-box;
      min-height: 100vh;
    }
    .share-content {
      background: #ffffff;
    }
    .share-page .diagram-download-bar {
      display: none !important;
    }
  </style>
</head>
<body>
  <div class="share-page">
    <div class="share-content">
    ${bodyHtml}
    </div>
  </div>
</body>
</html>`
}

export function createShare({ title, bodyHtml, stylesHtml }) {
  const id = randomUUID().replace(/-/g, '').slice(0, 12)
  const now = Date.now()

  // Oldest first: a preview link stops mattering as soon as the next one is made.
  for (const [key, share] of shares) {
    if (now - share.createdAt > SHARE_TTL_MS)
      shares.delete(key)
  }
  while (shares.size >= MAX_SHARES)
    shares.delete(shares.keys().next().value)

  shares.set(id, { id, createdAt: now, html: buildSharePageHtml(title, bodyHtml, stylesHtml) })
  return { id, createdAt: now }
}

export function readShare(id) {
  const share = typeof id === 'string' ? shares.get(id) : null
  if (!share)
    return null
  if (Date.now() - share.createdAt > SHARE_TTL_MS) {
    shares.delete(share.id)
    return null
  }

  return share
}

/** Shared by the loopback app and the LAN listener, so both serve identical pages. */
export function createShareRouter() {
  const router = express.Router()

  router.get('/s/:id', (req, res) => {
    const share = readShare(req.params.id)
    if (!share) {
      res.status(404).type('html').send('<!DOCTYPE html><meta charset="utf-8">预览已过期，请重新生成。')
      return
    }

    res.type('html').send(share.html)
  })

  return router
}

/** Only the share pages: the LAN interface must never reach the workspace API. */
export function createShareApp() {
  const app = express()
  app.use(createShareRouter())
  app.use((req, res) => {
    res.status(404).type('html').send('<!DOCTYPE html><meta charset="utf-8">本地预览服务只提供 /s/&lt;id&gt; 页面。')
  })
  return app
}
