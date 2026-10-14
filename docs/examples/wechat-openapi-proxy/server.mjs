#!/usr/bin/env node
/**
 * 公众号 OpenAPI 代理（固定出口 IP 版）。
 *
 * 背景：每次调用 api.weixin.qq.com 都会校验「调用方出口 IP」是否在公众号后台的 IP 白名单里，
 * 而白名单只能逐行填单个 IP、没有开放接口可改。所以做法是让调用链上多一跳固定出口 IP 的代理：
 * 把它跑在一台有固定公网 IP 的机器上（VPS / 云主机弹性 IP / 容器 + NAT 网关 EIP），
 * 后台把**这台机器的出口 IP 加白名单一次**，然后把「图床设置 → 公众号 → 代理域名」填成
 * `https://<host>/<TOKEN>` —— 之后无论从哪里编辑都不用再动白名单。
 *
 * 与 docs/examples/wechat-openapi-worker（Cloudflare Worker）的区别：Workers 的出口是
 * Cloudflare 的共享网段且会变，加白名单这条路走不通；本代理的出口就是你自己的固定 IP。
 * 另：代理自己应答 CORS 预检（OPTIONS），不依赖上游。
 *
 * 零依赖（node:http + 全局 fetch，Node 18+）。代理不保存 appsecret：凭据由调用方带来再转发；
 * `TOKEN` 是访问口令，作为 URL 路径前缀，不知道它就调不动这个代理。
 *
 *   TOKEN=换成一段随机串 PORT=8787 node server.mjs
 */
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import process from 'node:process'

const UPSTREAM = process.env.UPSTREAM ?? `https://api.weixin.qq.com`
const TOKEN = process.env.TOKEN ?? ``
const PORT = Number(process.env.PORT ?? 8787)
/** `*` 或一个具体来源（例如 `https://md.example.com`）。 */
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? `*`
/** 图片素材上限 10MB，留一点余量。 */
const MAX_BODY = Number(process.env.MAX_BODY ?? 12 * 1024 * 1024)

if (!TOKEN) {
  console.error(`TOKEN is required, e.g. TOKEN=$(openssl rand -hex 16) node server.mjs`)
  process.exit(1)
}

const PREFIX = `/${TOKEN}`

/** 逐跳首部（RFC 9110 §7.6.1）与调用方地址：上游要看到的出口是这台机器。 */
const SKIP_REQUEST_HEADERS = new Set([
  `host`,
  `connection`,
  `keep-alive`,
  `proxy-authorization`,
  `proxy-connection`,
  `te`,
  `trailer`,
  `transfer-encoding`,
  `upgrade`,
  `content-length`,
  `cf-connecting-ip`,
  `x-forwarded-for`,
  `x-forwarded-host`,
  `x-forwarded-proto`,
])
/** 响应体重算，编码由 fetch 解掉，所以这两类首部不转发。 */
const SKIP_RESPONSE_HEADERS = new Set([...SKIP_REQUEST_HEADERS, `content-encoding`])

function corsHeaders(request) {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': `GET, POST, OPTIONS`,
    'Access-Control-Allow-Headers': request.headers[`access-control-request-headers`] ?? `content-type`,
    'Access-Control-Max-Age': `86400`,
    'Vary': `Origin`,
  }
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  response.writeHead(status, { 'Content-Type': `application/json; charset=utf-8`, 'Content-Length': String(body.length) })
  response.end(body)
}

/**
 * 读请求体。超过 MAX_BODY 立即停止缓冲并 reject，但仍把剩余数据排空：直接断开连接会让客户端
 * 先撞到连接重置、读不到这条 413（正常场景就是一张超限图片）。排空量超过 4× 上限（恶意流）才断开。
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let draining = false
    request.on(`data`, (chunk) => {
      size += chunk.length
      if (draining) {
        if (size > MAX_BODY * 4)
          request.destroy()
        return
      }
      if (size > MAX_BODY) {
        draining = true
        chunks.length = 0
        reject(Object.assign(new Error(`body too large`), { status: 413 }))
        return
      }
      chunks.push(chunk)
    })
    request.on(`end`, () => {
      if (!draining)
        resolve(Buffer.concat(chunks))
    })
    request.on(`error`, reject)
  })
}

function pickHeaders(source, skip) {
  const picked = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || skip.has(key))
      continue
    picked[key] = Array.isArray(value) ? value.join(`, `) : value
  }
  return picked
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? `/`, `http://localhost`)
  const started = Date.now()

  if (url.pathname === `/healthz`) {
    sendJson(response, 200, { ok: true })
    return
  }

  // 口令不符（或路径不是 /cgi-bin/）一律 404：既挡掉扫路径的，也避免变成通用转发。
  const path = url.pathname.startsWith(`${PREFIX}/`) ? url.pathname.slice(PREFIX.length) : ``
  if (!path.startsWith(`/cgi-bin/`)) {
    sendJson(response, 404, { error: `not found` })
    return
  }

  if (request.method === `OPTIONS`) {
    response.writeHead(204, corsHeaders(request))
    response.end()
    return
  }

  try {
    const body = request.method === `GET` || request.method === `HEAD` ? undefined : await readBody(request)
    const upstream = await fetch(`${UPSTREAM}${path}${url.search}`, {
      method: request.method,
      headers: pickHeaders(request.headers, SKIP_REQUEST_HEADERS),
      body,
    })
    const payload = Buffer.from(await upstream.arrayBuffer())
    response.writeHead(upstream.status, {
      ...corsHeaders(request),
      ...pickHeaders(Object.fromEntries(upstream.headers), SKIP_RESPONSE_HEADERS),
      'Content-Length': String(payload.length),
    })
    response.end(request.method === `HEAD` ? undefined : payload)
  }
  catch (error) {
    sendJson(response, error?.status ?? 502, { error: error?.message ?? `proxy failed` })
  }

  // 只记路径：query 里带 access_token，不能落日志。
  console.log(`${request.method} ${path} → ${response.statusCode} ${Date.now() - started}ms`)
})

server.listen(PORT, () => {
  console.log(`wechat openapi proxy on :${PORT}, upstream ${UPSTREAM}, token path ${PREFIX}/cgi-bin/…`)
})
