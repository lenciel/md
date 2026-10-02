import { browser, defineContentScript, injectScript } from '#imports'

export default defineContentScript({
  matches: [`https://mp.weixin.qq.com/cgi-bin/appmsg*`],
  async main() {
    await injectScript(`/injected.js`, {
      keepInDom: true,
    })

    browser.runtime.onMessage.addListener((message) => {
      if (message.type === `copyToMp`) {
        const customEventData = { type: `copyToMp`, article: message.article, metadataOnly: message.metadataOnly }
        window.postMessage(customEventData)
        return Promise.resolve(true)
      }
      return true
    })

    // A draft opened later (cose creates its own) still gets the 标题/摘要/封面/作者 the
    // app queued, which is why the article is kept on the extension side at all.
    const article = await browser.runtime.sendMessage({ type: `mdPendingArticle` })
    if (article)
      window.postMessage({ type: `copyToMp`, article, metadataOnly: true })

    window.addEventListener(`message`, (event) => {
      if (event.source !== window || event.data?.type !== `mdFillReport`)
        return
      void browser.runtime.sendMessage({ type: `mdPendingArticleApplied` })
    })
  },
})
