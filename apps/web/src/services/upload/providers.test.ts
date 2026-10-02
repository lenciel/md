import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory replacement for the persistent storage engine
const memStore = new Map<string, string>()

vi.mock(`@/i18n/translate`, () => ({
  t: (key: string) => key,
}))

vi.mock(`@/storage`, () => ({
  store: {
    get: async (key: string) => memStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      memStore.set(key, value)
    },
    setJSON: async (key: string, value: unknown) => {
      memStore.set(key, JSON.stringify(value))
    },
  },
}))

vi.mock(`@/services/upload/client`, () => ({
  uploadDefaultImage: vi.fn(),
}))

const { fileUpload, uploadMpMaterial } = await import(`./providers`)

function wechatResponse(body: unknown, contentType: string) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': contentType },
  })
}

interface WechatStubs {
  tokenBody: unknown
  uploadBody: unknown
  // WeChat quirks: uploadimg answers JSON with a text/plain Content-Type
  uploadContentType?: string
}

function stubWechatApi({ tokenBody, uploadBody, uploadContentType = `text/plain` }: WechatStubs) {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes(`stable_token`))
      return Promise.resolve(wechatResponse(tokenBody, `application/json`))
    if (url.includes(`media/uploadimg`) || url.includes(`material/add_material`))
      return Promise.resolve(wechatResponse(uploadBody, uploadContentType))
    return Promise.reject(new Error(`unexpected url: ${url}`))
  })
  vi.stubGlobal(`fetch`, mock)
  return mock
}

const pngFile = () => new File([new Uint8Array(1024)], `a.png`, { type: `image/png` })

describe(`mp (WeChat Official Account) image upload`, () => {
  beforeEach(() => {
    memStore.clear()
    memStore.set(`imgHost`, `mp`)
    memStore.set(`mpConfig`, JSON.stringify({ appID: `wx1234567890`, appsecret: `secret` }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // doocs/md#1877: the upload succeeds on WeChat's side but answers with
  // Content-Type text/plain; the client must still read the returned URL
  it(`returns the image URL when WeChat answers JSON with a text/plain Content-Type`, async () => {
    stubWechatApi({
      tokenBody: { access_token: `TOKEN`, expires_in: 7200 },
      uploadBody: { url: `https://mmbiz.qpic.cn/pic` },
    })

    await expect(fileUpload(`content`, pngFile())).resolves.toBe(`https://mmbiz.qpic.cn/pic`)
  })

  it(`reuses the cached access_token while it is still valid`, async () => {
    const mock = stubWechatApi({
      tokenBody: { access_token: `TOKEN`, expires_in: 7200 },
      uploadBody: { url: `https://mmbiz.qpic.cn/pic` },
    })

    await fileUpload(`content`, pngFile())
    await fileUpload(`content`, pngFile())

    const tokenCalls = mock.mock.calls.filter(([input]) => String(input).includes(`stable_token`))
    expect(tokenCalls).toHaveLength(1)
  })

  it(`throws with the WeChat errcode detail when the upload returns no URL`, async () => {
    stubWechatApi({
      tokenBody: { access_token: `TOKEN`, expires_in: 7200 },
      uploadBody: { errcode: 41005, errmsg: `media data missing` },
    })

    await expect(fileUpload(`content`, pngFile())).rejects.toThrow(
      `upload.provider.uploadNoUrl: [41005] media data missing`,
    )
  })

  it(`throws with the errcode detail when the access_token request fails (e.g. IP not in whitelist)`, async () => {
    stubWechatApi({
      tokenBody: { errcode: 40164, errmsg: `invalid ip 1.2.3.4 not in whitelist hint` },
      uploadBody: { url: `https://mmbiz.qpic.cn/pic` },
    })

    await expect(fileUpload(`content`, pngFile())).rejects.toThrow(
      `upload.provider.accessTokenFailed: [40164] invalid ip 1.2.3.4 not in whitelist hint`,
    )
  })
})

// WeChat answers no CORS header, so a page calling it directly only gets `Failed to fetch`.
// The studio serves its own /cgi-bin reverse proxy, and uploads must go through it.
describe(`mp material upload (article pictures)`, () => {
  beforeEach(() => {
    memStore.clear()
    memStore.set(`mpConfig`, JSON.stringify({ appID: `wx1234567890`, appsecret: `secret` }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(`goes through the studio's same-origin /cgi-bin proxy`, async () => {
    vi.stubGlobal(`window`, {
      __MD_STUDIO__: true,
      location: { href: `http://127.0.0.1:8790/`, origin: `http://127.0.0.1:8790` },
    })
    const mock = stubWechatApi({
      tokenBody: { access_token: `TOKEN`, expires_in: 7200 },
      uploadBody: { media_id: `MID`, url: `https://mmbiz.qpic.cn/pic` },
    })

    await uploadMpMaterial(pngFile())

    const urls = mock.mock.calls.map(([input]) => String(input))
    expect(urls).toHaveLength(2)
    expect(urls.every(url => url.startsWith(`http://127.0.0.1:8790/cgi-bin/`))).toBe(true)
  })

  it(`goes straight to WeChat when no proxy is available (plain web page)`, async () => {
    const mock = stubWechatApi({
      tokenBody: { access_token: `TOKEN`, expires_in: 7200 },
      uploadBody: { media_id: `MID`, url: `https://mmbiz.qpic.cn/pic` },
    })

    await uploadMpMaterial(pngFile())

    const urls = mock.mock.calls.map(([input]) => String(input))
    expect(urls.every(url => url.startsWith(`https://api.weixin.qq.com/cgi-bin/`))).toBe(true)
  })

  // Article pictures are 永久素材 on purpose: they show up in 公众号后台的素材管理 and can be
  // managed there. The 图床's no-quota `media/uploadimg` would keep them out of the library,
  // so this must never gain an uploadimg fallback — not even for the small rasters it prefers.
  it(`uploads through material/add_material, never through the 图床's uploadimg`, async () => {
    const mock = stubWechatApi({
      tokenBody: { access_token: `TOKEN`, expires_in: 7200 },
      uploadBody: { media_id: `MID`, url: `https://mmbiz.qpic.cn/pic` },
    })

    await uploadMpMaterial(pngFile())

    const urls = mock.mock.calls.map(([input]) => String(input))
    expect(urls.some(url => url.includes(`material/add_material`))).toBe(true)
    expect(urls.some(url => url.includes(`media/uploadimg`))).toBe(false)
  })
})
