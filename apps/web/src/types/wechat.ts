/**
 * What the WeChat editor needs beyond the article body.
 *
 * Shared by the app (which fills it from front matter and the first picture), the
 * studio bridge and the injected script that types it into mp.weixin.qq.com.
 */
export interface WechatArticle {
  content: string
  title: string
  summary: string
  cover: string
  author: string
}
