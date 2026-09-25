import { browser, defineBackground } from '#imports'
import { detectInitialLocale } from '@/i18n/detect'
import enUS from '@/i18n/messages/en-US/store'
import jaJP from '@/i18n/messages/ja-JP/store'
import zhCN from '@/i18n/messages/zh-CN/store'
import zhTW from '@/i18n/messages/zh-TW/store'

const EXTENSION_TITLE_BY_LOCALE = {
  'zh-CN': zhCN.store.extension.editorTitle,
  'zh-TW': zhTW.store.extension.editorTitle,
  'en-US': enUS.store.extension.editorTitle,
  'ja-JP': jaJP.store.extension.editorTitle,
} as const

function getExtensionTitle(): string {
  return EXTENSION_TITLE_BY_LOCALE[detectInitialLocale()]
}

interface StudioCopyResult {
  ok: boolean
  reason?: `no-mp-tab` | `relay-failed`
}

async function relayToMpEditor(content: string): Promise<StudioCopyResult> {
  const tabs = await browser.tabs.query({ url: [`https://mp.weixin.qq.com/cgi-bin/appmsg*`] })
  const tab = tabs.find(t => t.id != null)
  if (!tab?.id)
    return { ok: false, reason: `no-mp-tab` }
  try {
    await browser.tabs.sendMessage(tab.id, { type: `copyToMp`, content })
    return { ok: true }
  }
  catch {
    // The tab can be gone or the content script not injected yet.
    return { ok: false, reason: `relay-failed` }
  }
}

export default defineBackground({
  type: `module`,
  main() {
    browser.runtime.onInstalled.addListener((detail) => {
      if (import.meta.env.COMMAND === `serve`) {
        browser.runtime.openOptionsPage()
        return
      }
      if (detail.reason === `install`) {
        browser.tabs.create({ url: `https://md-pages.doocs.org/welcome` })
      }
      else if (detail.reason === `update`) {
        browser.runtime.openOptionsPage()
      }
    })

    browser.runtime.onInstalled.addListener(() => {
      if (typeof browser.sidePanel === `undefined`)
        return
      browser.contextMenus.create({
        id: `openSidePanel`,
        title: getExtensionTitle(),
        documentUrlPatterns: [`https://mp.weixin.qq.com/cgi-bin/appmsg*`],
        contexts: [`all`],
      })
    })

    browser.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === `openSidePanel` && tab?.id)
        browser.sidePanel.open({ tabId: tab.id })
    })

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type !== `studioCopyToMp`)
        return
      return relayToMpEditor(message.content)
    })
  },
})
