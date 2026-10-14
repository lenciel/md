# 公众号 OpenAPI 代理（固定出口 IP）

公众号的每个服务端接口都会校验**调用方出口 IP** 是否在后台的 IP 白名单里（设置与开发 → 开发接口管理 → 基本配置 → IP 白名单），而白名单只能逐行填单个 IP、没有开放接口可改。所以在调用链上加一跳**固定出口 IP 的代理**，白名单只配这一次：

```
编辑器 / studio ──► https://<你的代理域名>/<TOKEN>/cgi-bin/… ──► api.weixin.qq.com
                     （跑在固定公网 IP 的机器上）
```

配好之后，无论你在哪台机器、哪个网络编辑，都不需要再动白名单。

> `docs/examples/wechat-openapi-worker`（Cloudflare Worker）解决的是「同源 / CORS」，它的出口是 Cloudflare 的共享网段且会变，**加不了**白名单；要固定出口 IP 用本示例。

## 跑起来

零依赖，Node 18+：

```bash
cd docs/examples/wechat-openapi-proxy
TOKEN=$(openssl rand -hex 16) PORT=8787 node server.mjs
```

| 环境变量       | 默认                        | 说明                                             |
| -------------- | --------------------------- | ------------------------------------------------ |
| `TOKEN`        | 无（必填）                  | 访问口令，作为路径前缀；不知道它就调不动这个代理 |
| `PORT`         | `8787`                      | 监听端口                                         |
| `UPSTREAM`     | `https://api.weixin.qq.com` | 上游地址                                         |
| `ALLOW_ORIGIN` | `*`                         | CORS 允许来源，可填具体站点                      |
| `MAX_BODY`     | `12582912`                  | 请求体上限（图片素材上限 10MB）                  |

自检（会真的打到微信，用一个假 appid 即可，返回的是微信的错误 JSON，说明转发链路通了）：

```bash
curl -s -X POST "http://127.0.0.1:8787/$TOKEN/cgi-bin/stable_token" \
  -H 'content-type: application/json' \
  -d '{"grant_type":"client_credential","appid":"wx0000000000000000","secret":"x"}'
# {"errcode":40013,"errmsg":"invalid appid ..."}
```

## 部署到有固定 IP 的机器

1. **挑一台出口 IP 固定的机器**：VPS（弹性 IP）、云主机、或容器/函数计算挂 NAT 网关 + EIP。**不要**用 Cloudflare Workers / Vercel 这类共享出口 IP 的平台。
2. 用 TLS 反代暴露出去（代理会转发 appsecret，别裸 HTTP）。Caddy 两行：

   ```caddyfile
   mp-proxy.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```

3. 常驻（systemd）：

   ```ini
   # /etc/systemd/system/wechat-openapi-proxy.service
   [Service]
   Environment=TOKEN=换成你自己的随机串
   Environment=PORT=8787
   ExecStart=/usr/bin/node /opt/wechat-openapi-proxy/server.mjs
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

4. 在这台机器上取出口 IP，加到公众号后台的白名单：

   ```bash
   curl -s https://api.ipify.org; echo
   ```

   注意机器可能有多个出口（多网卡 / NAT 网关 / IPv6 优先），以微信报错里 `invalid ip … not in whitelist` 的那个 IP 为准 —— 报错信息就是最准的答案。

## 配到应用里

图床设置 → 公众号 → **代理域名** 填 `https://mp-proxy.example.com/<TOKEN>`（就是上面那个路径前缀，不要再带 `/cgi-bin`）。

之后 `stable_token`、`material/add_material` 上传、发布时的草稿清理都会走这个代理（代码里 `proxyOrigin` 一处配置）。

## 安全

- 这个代理会转发 appsecret，**必须**有访问控制：`TOKEN` 路径前缀是基本盘，另外建议在反代上再加一层（mTLS、basic auth、或只放行你常用的来源 IP）。
- 代理本身不保存任何凭据，日志只记路径不记 query（`access_token` 在 query 里）。
- 路径不是 `<TOKEN>/cgi-bin/…` 一律 404，避免被当成通用转发。

## 排错

| 现象                                                  | 原因                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `[40164] invalid ip … not in whitelist`               | 白名单里没有这台机器的出口 IP，按报错里的 IP 补上                                |
| `[40013] invalid appid` / `[40125] invalid appsecret` | 配置里的 appID / appsecret 不对（和代理无关）                                    |
| 浏览器 `Failed to fetch`                              | 代理没起来、证书/域名不对，或 OPTIONS 预检没被应答（本代理自己应答，不依赖上游） |
| `404 not found`                                       | 代理域名填错了 —— 要带 `<TOKEN>` 前缀                                            |
| `413`                                                 | 图片超过 `MAX_BODY`（素材上限 10MB）                                             |
