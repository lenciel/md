# 公众号 OpenAPI 代理（固定出口 IP）

公众号的每个服务端接口都会校验**调用方出口 IP** 是否在后台的 IP 白名单里（设置与开发 → 开发接口管理 → 基本配置 → IP 白名单），而白名单只能逐行填单个 IP、没有开放接口可改。所以在调用链上加一跳**固定出口 IP 的代理**，白名单只配这一次：

```
编辑器 / studio ──► https://<你的代理域名>/<TOKEN>/cgi-bin/… ──► api.weixin.qq.com
                     （跑在固定公网 IP 的机器上）
```

配好之后，无论你在哪台机器、哪个网络编辑，都不需要再动白名单。

> `docs/examples/wechat-openapi-worker`（Cloudflare Worker）解决的是「同源 / CORS」，它的出口是 Cloudflare 的共享网段且会变，**加不了**白名单；要固定出口 IP 用本示例。

## 跑起来

零依赖，Node 18+。配置**只走环境变量**，推荐放一个 `0600` 的 env 文件（systemd / Node / docker 都认这种 `KEY=value` 文件）：

```bash
cd docs/examples/wechat-openapi-proxy

# 配置只走环境变量。env 文件放哪都行（部署时建议 /etc/wechat-openapi-proxy.env）；
# 本目录下的 *.env 已被 .gitignore 忽略，别把口令提交进仓库。
umask 077
cat > proxy.env <<EOF
# 必填：URL 路径前缀，等号后换成 openssl rand -hex 16 的输出
TOKEN=换成一串随机口令
PORT=8787
# 以下可选，不写就用默认值：
# UPSTREAM=https://api.weixin.qq.com
# ALLOW_ORIGIN=https://md.example.com
# MAX_BODY=12582912
EOF

node --env-file=proxy.env server.mjs
```

> **别把口令放在命令行参数或 unit 文件里**：前者会进 shell history 和 `ps` 输出，后者 `/etc/systemd/system/*.service` 默认 0644、任何本地用户都能读到。口令只放一处：这个 0600 的 env 文件。

| 环境变量       | 默认                        | 说明                                             |
| -------------- | --------------------------- | ------------------------------------------------ |
| `TOKEN`        | 无（必填）                  | 访问口令，作为路径前缀；不知道它就调不动这个代理 |
| `PORT`         | `8787`                      | 监听端口                                         |
| `UPSTREAM`     | `https://api.weixin.qq.com` | 上游地址                                         |
| `ALLOW_ORIGIN` | `*`                         | CORS 允许来源，可填具体站点                      |
| `MAX_BODY`     | `12582912`                  | 请求体上限（图片素材上限 10MB）                  |

几种跑法，env 的来源不同而已：

| 场景                       | 用法                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 前台 / 本机                | `node --env-file=./proxy.env server.mjs`                                                                     |
| 直接给环境变量（不落文件） | `TOKEN=… PORT=8787 node server.mjs`                                                                          |
| systemd                    | `EnvironmentFile=/etc/wechat-openapi-proxy.env`（见下面部署步骤）                                            |
| docker                     | `docker run --rm -p 127.0.0.1:8787:8787 --env-file=proxy.env -v "$PWD:/app" -w /app node:22 node server.mjs` |

配置只有上面这 5 个标量，所以不另做 JSON/YAML 配置文件：上面几种运行时都原生认 `KEY=value`，多一层自定义配置格式就多一处权限和字段校验要维护。

**改完 env 文件要重启进程才生效**（`systemctl restart wechat-openapi-proxy`）。轮换口令：改 `TOKEN` → 重启 → 同步改应用里的「代理域名」为 `https://<域名>/<新TOKEN>`（旧地址立刻 404）。

自检（会真的打到微信，用一个假 appid 即可，返回的是微信的错误 JSON，说明转发链路通了）：

```bash
curl -s -X POST "http://127.0.0.1:8787/$TOKEN/cgi-bin/stable_token" \
  -H 'content-type: application/json' \
  -d '{"grant_type":"client_credential","appid":"wx0000000000000000","secret":"x"}'
# {"errcode":40013,"errmsg":"invalid appid ..."}
```

## 部署到有固定 IP 的机器

1. **挑一台出口 IP 固定的机器**：VPS（弹性 IP）、云主机、或容器/函数计算挂 NAT 网关 + EIP。**不要**用 Cloudflare Workers / Vercel 这类共享出口 IP 的平台。
2. **用 TLS 反代暴露出去**：代理会转发 appsecret，绝不要裸 HTTP 暴露。下面是最常见的 nginx 方案（Debian/Ubuntu 路径，RHEL 系把配置放 `/etc/nginx/conf.d/` 同理）。

   ```nginx
   # /etc/nginx/sites-available/wechat-openapi-proxy.conf
   server {
     # 老版本 nginx 请用 `listen 443 ssl http2;`；这里不写 http2，避免 `http2 on`（1.25.1+ 才有）在
     # Debian 12 / Ubuntu 22.04–24.04 上直接 `nginx -t` 失败。纯 API 代理也用不上 h2。
     listen 443 ssl;
     server_name mp-proxy.example.com;

     ssl_certificate     /etc/letsencrypt/live/mp-proxy.example.com/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/mp-proxy.example.com/privkey.pem;

     # 图片素材上限 10MB，nginx 默认只收 1MB：不放开会在上传图片时 413
     client_max_body_size 12m;

     location / {
       # <TOKEN> 那段照旧留在地址里（它本身就是口令），nginx 原样转发
       proxy_pass http://127.0.0.1:8787;
       proxy_http_version 1.1;
       proxy_set_header Host              $host;
       proxy_set_header X-Real-IP         $remote_addr;
       proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       # 上传素材比普通请求慢，给足超时；预检由 Node 代理自己应答，这里不要拦 OPTIONS
       proxy_read_timeout 120s;
       proxy_send_timeout 120s;
     }
   }

   # 可选：80 跳 443（certbot --nginx 会自动补这段）
   server {
     listen 80;
     server_name mp-proxy.example.com;
     return 301 https://$host$request_uri;
   }
   ```

   ```bash
   sudo ln -s /etc/nginx/sites-available/wechat-openapi-proxy.conf /etc/nginx/sites-enabled/
   sudo certbot --nginx -d mp-proxy.example.com   # 没有证书时先签发；已有证书可跳过
   sudo nginx -t && sudo systemctl reload nginx
   ```

   做完自检一次，确认 `浏览器/curl → nginx → Node 代理 → 微信` 整条链通了：

   ```bash
   curl -s -X POST "https://mp-proxy.example.com/<TOKEN>/cgi-bin/stable_token" \
     -H 'content-type: application/json' \
     -d '{"grant_type":"client_credential","appid":"wx0000000000000000","secret":"x"}'
   # {"errcode":40013,"errmsg":"invalid appid ..."} —— 链路通了，40013 只是 appid 是假的
   ```

   想顺手加固（任一即可）：`allow <你常用的出口 IP>; deny all;`、`auth_basic`、或客户端证书（mTLS）。注意加固后**别把自己挡在门外**：用编辑器的那台机器/网络要能访问这个域名。

   不用 nginx 的话，Caddy 两行等价（自动签证书，且默认不限制请求体大小）：

   ```caddyfile
   mp-proxy.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```

3. 常驻（systemd）：

   ```ini
   # /etc/systemd/system/wechat-openapi-proxy.service
   [Service]
   # 口令放 0600 的 env 文件；unit 文件本身默认 0644，别把 secret 写在这里
   EnvironmentFile=/etc/wechat-openapi-proxy.env
   ExecStart=/usr/bin/node /opt/wechat-openapi-proxy/server.mjs
   Restart=always
   WorkingDirectory=/opt/wechat-openapi-proxy

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo install -m 600 /dev/null /etc/wechat-openapi-proxy.env
   sudo sh -c 'umask 077; printf "TOKEN=%s\nPORT=8787\n" "$(openssl rand -hex 16)" > /etc/wechat-openapi-proxy.env'
   sudo systemctl daemon-reload && sudo systemctl enable --now wechat-openapi-proxy
   systemctl status wechat-openapi-proxy --no-pager   # 起来后日志里那行会打印 token 路径
   ```

   （不想用 systemd 也一样：`node --env-file=/etc/wechat-openapi-proxy.env server.mjs`，docker 则是 `docker run --env-file …`。）

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
- 口令为什么在 URL 路径里：应用侧「代理域名」只有一个字符串字段，路径前缀是**零改动**就能带上口令的载体；想换成请求头（如 `x-proxy-token`）或 basic auth 也可以，但要同时改应用侧代码（`proxyOrigin` 之外再加一个请求头），本示例不默认这么做。
- 代理本身不保存任何凭据，日志只记路径不记 query（`access_token` 在 query 里）。
- 路径不是 `<TOKEN>/cgi-bin/…` 一律 404，避免被当成通用转发。

## 排错

| 现象                                                  | 原因                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `[40164] invalid ip … not in whitelist`               | 白名单里没有这台机器的出口 IP，按报错里的 IP 补上                                                   |
| `[40013] invalid appid` / `[40125] invalid appsecret` | 配置里的 appID / appsecret 不对（和代理无关）                                                       |
| 浏览器 `Failed to fetch`                              | 代理没起来、证书/域名不对，或 OPTIONS 预检没被应答（本代理自己应答，不依赖上游）                    |
| `404 not found`                                       | 代理域名填错了 —— 要带 `<TOKEN>` 前缀                                                               |
| `413`                                                 | 图片超过 `MAX_BODY`（素材上限 10MB）；走 nginx 时还要确认 `client_max_body_size` 已放开（默认 1MB） |
