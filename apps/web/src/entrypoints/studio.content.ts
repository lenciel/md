import { defineContentScript } from '#imports'

interface StudioPageMessage {
  source?: string
  type?: string
  content?: string
}

export default defineContentScript({
  matches: [`http://127.0.0.1/*`, `http://localhost/*`],
  runAt: `document_start`,
  main() {
    const reply = (payload: Record<string, unknown>) => {
      window.postMessage({ source: `md-extension`, ...payload }, window.location.origin)
    }

    reply({ type: `ready` })

    window.addEventListener(`message`, async (event) => {
      // Only trust messages posted by the page itself; embedded frames can also postMessage here.
      if (event.source !== window)
        return

      const data = event.data as StudioPageMessage | null
      if (!data || data.source !== `md-studio`)
        return

      if (data.type === `ping`) {
        reply({ type: `ready` })
        return
      }

      if (data.type !== `copyToMp`)
        return

      try {
        const res = await browser.runtime.sendMessage({ type: `studioCopyToMp`, content: data.content })
        reply({ type: `copyToMpResult`, ok: Boolean(res?.ok), reason: res?.reason })
      }
      catch {
        // The extension context is invalidated on reload/update; never throw that into the page.
        reply({ type: `copyToMpResult`, ok: false, reason: `relay-failed` })
      }
    })
  },
})
