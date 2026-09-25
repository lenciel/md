import { t } from '@/i18n/translate'

interface StudioExtensionMessage {
  source?: string
  type?: string
  ok?: boolean
  reason?: string
}

// A content script that never answers (extension absent) must not keep a stale copy around
// for a later page session to flush.
const PENDING_TIMEOUT_MS = 3000

/**
 * Bridges the editor's `copyToMp` CustomEvent to the browser extension.
 *
 * Without the extension installed this is a no-op: the event is dropped silently, exactly like
 * before the studio existed.
 */
export function installStudioCopyToMpBridge(): void {
  if (!window.__MD_STUDIO__)
    return

  let extensionReady = false
  let pendingContent: string | null = null
  let pendingTimer: number | null = null

  const postToExtension = (message: { type: string, content?: string }) => {
    window.postMessage({ source: `md-studio`, ...message }, window.location.origin)
  }

  const clearPendingTimer = () => {
    if (pendingTimer != null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
  }

  const flushPending = () => {
    if (pendingContent == null)
      return
    const content = pendingContent
    pendingContent = null
    postToExtension({ type: `copyToMp`, content })
  }

  window.addEventListener(`message`, (event) => {
    if (event.source !== window)
      return

    const data = event.data as StudioExtensionMessage | null
    if (!data || data.source !== `md-extension`)
      return

    if (data.type === `ready`) {
      extensionReady = true
      clearPendingTimer()
      flushPending()
      return
    }

    if (data.type === `copyToMpResult`) {
      if (data.ok)
        toast.success(t(`studio.pushToMpOk`))
      else if (data.reason === `no-mp-tab`)
        toast.warning(t(`studio.pushToMpNoTab`))
      else
        toast.error(t(`studio.pushToMpFailed`))
    }
  })

  window.addEventListener(`copyToMp`, (event) => {
    const content = (event as CustomEvent<{ content?: string }>).detail?.content
    if (typeof content !== `string` || !content)
      return

    if (extensionReady) {
      postToExtension({ type: `copyToMp`, content })
      return
    }

    // The content script injects at document_start, so its `ready` can land after this listener:
    // hold one copy until it shows up.
    pendingContent = content
    pendingTimer ??= window.setTimeout(() => {
      pendingContent = null
      pendingTimer = null
    }, PENDING_TIMEOUT_MS)
  })

  postToExtension({ type: `ping` })
}
