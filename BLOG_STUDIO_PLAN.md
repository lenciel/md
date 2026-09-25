# 博客可视化编辑环境（blog-studio）

## Context

在 `doocs/md` 这个 monorepo（工作副本就是 `/Users/lenciel/Projects/rants/md`，remote 是 `lenciel/md`）之上，给 Jekyll 博客 `/Users/lenciel/Projects/rants/lenciel.github.io` 做一个可视化编辑环境：

- 以博客目录为工作目录，浏览/打开/编辑/新建 `_posts/*.md` 与 `_posts/*.markdown`（当前 507 个 `.markdown` + 7 个 `.md`），改动自动落盘。
- 复用现有公众号能力：`复制`（公众号格式，juice 内联）手动粘贴到公众号后台；并在装好仓库自带浏览器扩展时，把内容直接注入已打开的公众号编辑器（`mp_editor_set_content`）。其他平台（知乎/掘金/CSDN 等 36 个）由现有 `PostInfo.vue` + `doocs/cose` 扩展覆盖，不改。
- 在同一个面板里执行：`rake prepare_deploy`、`rake preview`（本地 4003 预览）、`upblog`（rsync 发布到 `aliblog:/usr/share/nginx/blog/`），并流式显示日志、可停止。

用户已明确的选择（不要再改动这些决定）：front matter 不做结构化表单编辑（继续手写 YAML）；图片处理完全不动（因此 `{% picture %}`/`/downloads` 相对路径在编辑器预览和公众号里不会自动转成绝对 URL，公众号侧图片依赖手动粘贴时编辑器的抓取行为）；公众号先走手动粘贴，再补扩展推送；命令面板只放 `rake prepare_deploy`、`upblog`、`rake preview` 三个命令。

关键既成事实（已核对源码/线上）：

- 网页端已有的本地文件能力是 File System Access API（`apps/web/src/stores/folderSource.ts`），只能写回编辑器内容、只认 `.md`、无法执行 shell，因此本方案另建一个本地 Node 服务作为工作目录的唯一数据源；File System Access 面板保持原样（只补 `.markdown` 支持）。
- `packages/md-cli` 的 `dist/` 是死代码：`packages/md-cli/server.js` 把所有未匹配请求反向代理到 `https://md.doocs.org/`，从不读本地构建产物。所以本地构建必须由新服务自己托管。
- `apps/web` 已经会用 `parseFrontMatterAndContent` 剥掉 front matter 再渲染预览（`packages/core/src/utils/markdownHelpers.ts` → `renderMarkdown`），且 `EditorPanel.vue` 已有 `watch(() => currentPost.value?.content)` → `syncEditorToPostContent()`，外部改写 `post.content` 会自动同步进 CodeMirror 文档。工作目录的“从磁盘重载”直接复用这条链路，不新增编辑器同步代码。
- 部署命令必须跑真实的 Ruby/rsync：`zsh -lic` 下 `rake`/`jekyll`（rbenv shims）、`pagefind_extended`（`~/bin`）、`rsync` 均可解析，alias `upblog` 也可用（实测 `zsh -lic 'alias upblog'` 输出 `rsync -avzrO --no-perms --delete _ftp/ aliblog:/usr/share/nginx/blog/ --exclude ".DS_Store" -H --progress`）。
- `rake generate`（`prepare_deploy` 与 `preview` 都会调用）里的 `blank_target` 会用 sed 改写 `_posts/*.markdown`（给链接补 `{:target="_blank"}`），所以跑完命令必须处理“磁盘上的文件被部署流程改了”。
- 博客仓库里 184 个 post 在 git index 里是 `100755`，330 个是 `100644`，因此写文件必须保留原 mode，否则 `git diff` 会多出 mode 变更。

## Approach

### 1. 新增 `apps/studio`：本地工作目录服务

新包 `@md/studio`（private，`type: module`，纯 JS ESM，风格对齐 `packages/md-cli`：无分号、单引号、2 空格缩进；代码注释用英文）。

`apps/studio/package.json`

```json
{
  "name": "@md/studio",
  "type": "module",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "start": "node index.js",
    "build:web": "pnpm --filter @md/web run build:studio",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": { "node": ">=22.22.2" },
  "dependencies": { "express": "^5.2.1", "get-port": "7.2.0", "js-yaml": "^5.4.2" },
  "devDependencies": { "vitest": "catalog:" }
}
```

`apps/studio/studio.config.json`（用户可改；只此一个配置文件，不做 env/多份 merge）：

```json
{
  "root": "/Users/lenciel/Projects/rants/lenciel.github.io",
  "port": 8790,
  "postsDir": "_posts",
  "commands": [
    { "id": "prepare", "label": "构建站点 (rake prepare_deploy)", "cmd": "rake prepare_deploy", "mode": "run" },
    { "id": "preview", "label": "本地预览 (rake preview)", "cmd": "rake preview", "mode": "service", "url": "http://localhost:4003" },
    { "id": "upload", "label": "上传博客 (upblog)", "cmd": "upblog", "mode": "run" }
  ]
}
```

`label` 是用户配置文本，不进 i18n。

`apps/studio/workspace.js` — 纯函数 + 文件操作，`export` 下列符号（单测直接覆盖）：

- `POST_FILE_RE = /^_posts\/[^/]+\.(?:md|markdown)$/`，`isPostPath(rel)`。
- `resolvePostPath(root, rel)`：不是 string、含 `\0`、`isPostPath` 不通过 → `throw new StudioError(400, 'bad-path')`；返回 `path.join(root, rel)`（`rel` 已限定为 `_posts/` 单层文件名，天然无穿越）。
- `parseFrontMatterTitle(text)`：用 `/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/`（与 `packages/core/src/utils/front-matter.ts` 的 `FRONT_MATTER_RE` 同形）取块，`js-yaml` 的 `load` 包 try/catch，取 `data.title` 为非空 string 则返回，否则返回 `null`。
- `titleFromName(name)`：去掉扩展名与开头 `YYYY-MM-DD-` 前缀（`2026-09-24-fragments-0x000b.markdown` → `fragments-0x000b`）。
- `listPosts(root, postsDir = '_posts')`：读目录，过滤 `.md`/`.markdown`，每个文件 `fs.stat` + 只读前 4096 字节用于 front matter，返回按 `name` 倒序（`localeCompare`）的数组，元素为
  `{ path: '_posts/xxx.markdown', name, slug: <name 去扩展名>, ext, title: <front matter title ?? titleFromName>, date: <文件名前 10 字符>, mtimeMs, size }`。
- `computeNextFragments(posts, today)`：对 `name` 匹配 `/fragments-0x([0-9a-f]+)/i`，`next = max(toInt(16))+1`（无匹配则 1），`num = '0x' + next.toString(16).padStart(4, '0')`，返回
  `{ num, title: 'Fragments ' + num, slug: 'fragments-' + num, filename: today + '-fragments-' + num + '.markdown' }`（与 Rakefile `new_fr` 的 `format('0x%04x')` 一致，小写 hex）。
- `shanghaiNow()`：用 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', ... })` 组装，返回 `{ date: '2026-09-25', datetime: '2026-09-25 14:03:02 +0800' }`；不依赖服务器本地时区（现有全部 post 都是 `+0800`）。
- `buildPostContent({ kind, title, datetime })`：写出的完整文件内容。
  - `kind: 'fragments'`（对应 `rake new_fr`）：
    ```
    ---
    layout: post
    comments: true
    description: '摘要'
    title: 'Fragments 0x000c'
    date: <datetime>
    categories: [useless-songs, wxmp]
    ---
    <空行>
    ```
  - `kind: 'post'`（对应 `rake new_post`）：`description: "摘要"`、`title: "<title>"`（转义顺序：`\` → `\\`，`"` → `\"`，`&` → `&amp;`）、`date: <datetime>`、`categories:`（空值，不带 Rakefile 那行尾空格）。
  - 两种情况都以 `---\n\n` 结尾（多一个空行，和现有 post 正文前留白一致）。
- `SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`，`isValidSlug(slug)` 且 `slug.length <= 80`。
- `writeFilePreservingMode(absPath, content)`：`stat` 取原 `mode`（文件不存在则用 `0o644`），写同目录临时文件 `.<basename>.tmp-<pid>-<rand>`、`chmod(mode)`、`rename` 覆盖（原子且保留 mode）。
- `readPostFile(root, rel)` → `{ path, content, mtimeMs }`。
- `class StudioError extends Error { constructor(status, code, extra) }`。

`apps/studio/exec.js` — 命令执行与日志缓冲：

- `runCommand({ id, cmd, cwd, onEvent })`：
  `spawn('zsh', ['-lic', cmd], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env })`。
  用 `detached` 拿到独立进程组（便于 `kill(-pid)`）。stdout/stderr 的 `data` 直接 `onEvent({ type: 'stdout'|'stderr', text })`；`spawn` 的 `error` → `onEvent({ type:'error', message })`；`close` → `onEvent({ type:'exit', code, durationMs })`。
  `zsh -lic` 会打印 `stty: stdin isn't a terminal`、nvm 版本切换、gitstatus 报错等噪声到 stderr，这是预期现象，不做过滤。
- `stopCommand(id)`：`process.kill(-pid, 'SIGINT')`，5 秒后仍未退出则 `process.kill(-pid, 'SIGKILL')`（`rake preview` 的 trap 会把 SIGINT 转给 jekyll，所以必须先 SIGINT）。
- 作业登记表 `jobs = Map<commandId, { child, events: [], cap: 5000, running, startedAt, listeners:Set }>`：
  - 事件累积在 `events`（`{ index, ...payload }`，超过 `cap` 丢最旧的并保持 `index` 递增），多个 SSE 客户端可同时 attach 并从 `from` 重放 → 关掉对话框/刷新页面不会丢日志，也不会重复启动命令。
  - 同一 `commandId` 已在运行时直接 attach，不重复 spawn。
- `onExit` 时对 `_posts` 重新 `listPosts` 并和启动前的 `mtimeMs` 快照 diff，若命令确实改动了 post（如 `blank_target`），在 `exit` 之前发 `{ type:'changed', paths: [...] }`。
- 进程退出钩子：`process.on('exit'|'SIGINT'|'SIGTERM')` 里对登记表中仍在运行的服务发 `SIGINT` 到其进程组，避免留下孤儿 jekyll 占着 4003。

`apps/studio/server.js` — `createStudioApp({ config, distDir })`：

1. 中间件：`express.json({ limit: '10mb' })`。
2. `/api` 守卫（放在所有 API 之前）：
   - 缺 `X-MD-Studio: 1` 头 → `403 { error: 'missing-header' }`；
   - 有 `Origin` 且不匹配 `/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/` → `403 { error: 'bad-origin' }`（Vite 开发代理转发原始 Origin，所以 localhost/127.0.0.1 都要放行）；
   - 非 GET 且 `!req.is('application/json')` → `415 { error: 'json-only' }`。
     自定义头会强制跨源预检，因此本地不会成为恶意网页的可写入目标（无需 CORS、无需 token）。
3. 路由（全部 JSON，错误统一 `{ error: code, ...extra }` + 对应状态码；`StudioError` 用其 `status`，其它异常 500）：
   - `GET /api/studio/state` → `{ root, postsDir, distOk: <bool>, running: [{ commandId, startedAt }], commands: [{ id, label, mode, url? }] }`。
   - `GET /api/studio/posts` → `{ posts: [...listPosts], nextFragments: {...} }`。
   - `GET /api/studio/file?path=_posts/x.markdown` → `readPostFile`。
   - `PUT /api/studio/file` body `{ path, content, baseMtimeMs? }`：
     若传了 `baseMtimeMs` 且与当前 `stat.mtimeMs` 不等 → `409 { error: 'stale', content: <磁盘当前内容>, mtimeMs }`；
     否则 `writeFilePreservingMode` → `{ ok: true, mtimeMs }`。
   - `POST /api/studio/post` body `{ kind: 'post'|'fragments', title, slug }`：
     校验 `kind`/`title` 非空/`isValidSlug(slug)`（不合法 → `400 { error:'bad-slug' }`）；
     `kind === 'fragments'` 时忽略 body 的 title/slug，用 `computeNextFragments(await listPosts(root))` 的结果；
     文件名 `<shanghaiNow().date>-<slug>.markdown`，写前再检查一次存在性；用 `fs.writeFile(abs, content, { flag: 'wx' })`（EEXIST → `409 { error:'exists' }`；此路径不做临时文件替换，因为要的就是“不存在才创建”）；
     返回 `201 { path, name, content, mtimeMs }`。
   - `POST /api/studio/exec` body `{ commandId, from?: number }` → `Content-Type: text/event-stream`，先重放 `jobs.get(commandId).events` 中 `index >= from` 的事件，然后 attach 继续推送；每个事件一帧 `data: <JSON>\n\n`；`res.on('close')` 只 detach，不杀进程。
   - `POST /api/studio/stop` body `{ commandId }` → `{ ok: true }`（不存在的 job 也返回 `ok: true`，幂等）。
   - 未知 `commandId` → `404 { error: 'unknown-command' }`。
4. 静态托管：`GET` 非 `/api/*` 请求交给 `express.static(distDir, { index: false })`，未命中且有 `Accept: text/html` → 返回注入后的 `index.html`（用 `app.use()` 兜底，不要用 `app.get('*')`，express 5 的 path-to-regexp 不接受裸 `*`）。
   启动时读一次 `<distDir>/index.html`，在 `</head>` 前插入 `<script>window.__MD_STUDIO__={"apiBase":"/api"};</script>` 并缓存；`distDir` 下的文件直接静态返回。
   `Accept` 不含 text/html 时不返回 HTML（保持默认 404 JSON）。

`apps/studio/index.js`：

- `parseArgv`：支持 `--root <dir>`、`--port <n>`、`--config <file>`、`--no-open`；默认读 `apps/studio/studio.config.json`。
- 校验 `root` 存在且 `<root>/_posts` 是目录，否则打印明确错误并以非 0 退出。
- `distDir = <repo>/apps/web/dist`（由 `new URL('../../apps/web/dist', import.meta.url)` 解析）；`index.html` 不存在时打印 `未找到 apps/web/dist，请先运行 pnpm studio:build` 并退出 1。
- 端口：`getPort({ port: config.port })`，占用则自动换端口并打印实际端口。
- `app.listen(port, '127.0.0.1')`，打印 `http://127.0.0.1:<port>/`；非 `--no-open` 且 `process.platform === 'darwin'` 时 `spawn('open', [url])`。
- 处理 `SIGINT`/`SIGTERM`：停掉所有 running 服务后退出。

### 2. `apps/web`：工作目录模式（构建模式 + 客户端 + store）

- `apps/web/package.json`：加 `"build:studio": "cross-env SERVER_ENV=STUDIO vite build"`。
- `apps/web/vite.config.ts`：加 `const isStudio = process.env.SERVER_ENV === 'STUDIO'`，并把 `base` 表达式改为 `isNetlify || isCfWorkers || isCfPages || isStudio ? '/' : isUTools ? './' : '/md/'`（`SERVER_ENV` 目前只影响 base 和 uTools 插件，见 `apps/web/vite.config.ts:15-16` 与 `apps/web/plugins/vite-plugin-utools-local-assets.ts:24`）。
- 开发迭代用插件 `apps/web/plugins/vite-plugin-studio.ts`：导出 `studioDevPlugin()`；当 `process.env.MD_STUDIO === '1'` 时
  - `config()` 返回 `{ server: { proxy: { '/api': { target: 'http://127.0.0.1:' + (process.env.MD_STUDIO_PORT ?? 8790), changeOrigin: false } } } }`；
  - `transformIndexHtml()` 在 `</head>` 前插入 `window.__MD_STUDIO__ = {"apiBase":"/api"}` 的 script。
    在 `vite.config.ts` 的 `plugins` 数组里始终挂上（不满足条件时内部返回空，不产生副作用）。这样 `MD_STUDIO=1 pnpm web dev` + 另开 `pnpm studio:serve` 就有 HMR 迭代能力。
- `apps/web/src/types/global.d.ts`：`Window` 增加 `__MD_STUDIO__?: { apiBase: string }`。
- `apps/web/src/services/studio/client.ts`：`studioApi`，全部请求带 `X-MD-Studio: 1`（非 GET 带 `Content-Type: application/json`），`apiBase = window.__MD_STUDIO__?.apiBase ?? '/api'`：
  - `state()`、`posts()`、`readFile(path)`、`writeFile({ path, content, baseMtimeMs })`、`createPost({ kind, title, slug })`；
  - `execStream(commandId, { from, signal, onEvent })`：`fetch` + `response.body.getReader()` + `TextDecoder`，按 `\n\n` 切帧、去掉 `data: ` 前缀后 `JSON.parse`；
  - `stop(commandId)`；
  - 非 2xx 时抛 `StudioHttpError`（带 `status` 与已解析的 payload），`409 stale` 需要读 payload。
- `apps/web/src/stores/studio.ts`（`useStudioStore`，setup 风格 + `store.reactive(addPrefix(...))` 持久化）：
  - state：`isActive`、`root`、`commands`、`distOk`、`posts`、`nextFragments`、`isLoading`、`loadError`、`activePath`、`activeBaseMtimeMs`、`saveState: 'idle'|'saving'|'saved'|'error'`、`conflict: { path, diskContent } | null`、`runningCommandId`、`commandEvents`、`commandStatus`。
  - `init()`：`window.__MD_STUDIO__` 不存在直接 return（`isActive=false`）；否则 `state()` + `posts()`；失败时 `loadError` 落值。
  - `openPost(path)`：
    1. 若已有 `activePath` 且不同 → 先 `await flushActive()`；
    2. `readFile(path)`；
    3. 复用缓冲：`postStore.posts.find(p => p.sourcePath === path)` 命中就 `postStore.currentPostId = post.id`，否则 `postStore.addPost(title)`（`title` = 列表项的 `title`）再用该新 post 的 id；
    4. `postStore.updatePostContent(id, content)`；`post.sourcePath = path`；
    5. `activePath = path`、`activeBaseMtimeMs = mtimeMs`、`conflict = null`、`saveState = 'saved'`。
  - `saveActive()`（自动保存）：`!activePath` / `!conflict` 之外直接 return；取 `postStore.currentPost.content` 与 `activeBaseMtimeMs` PUT；
    单飞行 + 合并：`if (saving) { queued = true; return }`，完成后若 `queued` 再跑一次；
    成功 → `activeBaseMtimeMs = res.mtimeMs`、`saveState='saved'`；
    `409 stale` → `conflict = { path, diskContent }`、`saveState='error'`，不覆盖磁盘。
  - 自动保存的 watcher 放在 store 内部（`watch(() => postStore.currentPost?.content, ...)`，800ms debounce；`packages/.../stores/post.ts` 已在 store 内用 `watch`/`onMounted`，同一模式），因此面板关闭也不会停止落盘；切换文件时用 `flushActive()`（先 `useEditorStore().flushContentToPostStore()`，再 `cancel + saveActive()`）保证旧文件先写完。
  - `flushActive()` 也注册到 `pagehide` + `visibilitychange(hidden)`，用 `fetch(..., { keepalive: true })`（不能用 `sendBeacon`：它无法带 `X-MD-Studio` 头）。
  - `resolveConflict(action: 'keep-mine' | 'use-disk')`：`keep-mine` → 以 `baseMtimeMs: null` 直接 PUT 当前编辑器内容；`use-disk` → `postStore.updatePostContent(currentPostId, conflict.diskContent)`（`EditorPanel.vue:628` 的 `watch(currentPost.value?.content)` → `syncEditorToPostContent` 会自动替换文档），然后清 `conflict`。
  - `createPost(kind, title, slug)` → 调 API，成功后 `posts.value` 重新拉取并 `openPost(res.path)`。
  - `runCommand(commandId)`：清空 `commandEvents`、`commandStatus='running'`、打开命令对话框；`execStream(commandId, { from: 0, onEvent })`；收到 `changed` 时记录；收到 `exit` 时 `commandStatus = code === 0 ? 'done' : 'failed'`（service 停止后 code 可能是 null/143，视为 stopped）。
  - `handleChangedPaths(paths)`（`exit` 前收到 `changed` 后调用）：`await posts()` 刷新列表；若 `paths.includes(activePath)` → 重新 `readFile(activePath)` 并 `postStore.updatePostContent(currentPostId, diskContent)` + `activeBaseMtimeMs` 更新 + toast（磁盘版本会带上 `{:target="_blank"}`，编辑器历史被重置是可接受代价）。
  - `stopCommand()`。
  - `activePostTitle`/`activeStatusLabel` 这类展示用 computed。
- `apps/web/src/composables/useStudioBootstrap.ts`：`if (!window.__MD_STUDIO__) return`；`installStudioCopyToMpBridge()` + `studioStore.init()`。在 `App.vue` 的 `<script setup>` 里像 `useAccountSyncBootstrap()` 一样调用一次。
- `apps/web/src/components/editor/editor-header/index.vue` 的 `copy()` 末尾已经在所有非 md 复制模式下 `window.dispatchEvent(new CustomEvent('copyToMp', { detail: { content: output.value } }))`（约 190 行），不改动它——新的 bridge 直接复用这个事件。

### 3. `apps/web`：工作目录面板与对话框

- `apps/web/src/stores/ui.ts`：加
  - `isOpenStudioPanel = store.reactive(addPrefix('is_open_studio_panel'), false)`
  - `isShowStudioNewPostDialog = ref(false)`、`studioNewPostKind = ref<'post'|'fragments'>('post')`
  - `isShowStudioCommandDialog = ref(false)`
  - `toggleStudioPanel()`：`isOpenStudioPanel = !isOpenStudioPanel; if (isOpenStudioPanel) isOpenFolderPanel = false`
  - `toggleFolderPanel()`：反向排斥
  - `openStudioNewPostDialog(kind)`、`toggleShowStudioCommandDialog(v)`（`ui.ts` 里已有一批同形的 dialog 开关，照抄写法）。
- `apps/web/src/components/editor/studio-panel/index.vue`（新，async 加载，参考 `folder-source-panel/index.vue` 的容器/移动端类名与 `<style scoped>` 写法）：
  - 头部：标题（`t('studio.title')`）、root 路径（截断 + `title` 提示）、刷新按钮（`studioStore.init()` + `posts()`）、关闭按钮（`uiStore.isOpenStudioPanel = false`）。
  - `!studioStore.isActive` 时整块显示 `t('studio.notActive')` 提示，不渲染其余 UI。
  - 新建区：两个 `Button` → `openStudioNewPostDialog('post'|'fragments')`。
  - 搜索框（`Input`，按 title/name 过滤 `posts`）+ 列表：每行显示 `title` 与 `date`/文件名，当前 `activePath` 高亮；`v-for` 直接渲染（514 条不虚拟化）；`@click` → `studioStore.openPost(post.path)`。
  - 处于 `conflict` 时在列表上方显示 `Alert`：`t('studio.conflictTitle')` + 两个按钮 `keep-mine` / `use-disk`。
  - 状态行：`saveState` 文案（已保存/保存中/保存失败）+ 当前文件名。
  - 底部命令区：对 `studioStore.commands` 渲染按钮（`mode === 'service'` 且正在运行时换成 `停止`；有 `url` 时额外一个 `window.open(url)` 的按钮），点击 → `studioStore.runCommand(id)`（会打开命令对话框）。
  - 面板宽度沿用 folder 面板档位：`default-size` 18 / `min-size` 12 / `max-size` 28（仅在 `!isMobile && isOpenStudioPanel` 时）。
- `apps/web/src/components/editor/dialogs/StudioNewPostDialog.vue`（新，参考 `dialogs/ImportMarkdownDialog.vue` 的 Dialog 结构）：
  - 字段：`标题`（`post` 时预填空、`fragments` 时预填 `nextFragments.title` 且只读）、`文件名`（`Input`，预填 `title` 的 ascii slug：小写、非 `[a-z0-9]` 折叠成 `-`、去首尾 `-`；`fragments` 时固定为 `nextFragments.slug` 且只读）、`将创建 _posts/<date>-<slug>.markdown` 预览行。
  - slug 不合法时按钮禁用 + `t('studio.slugInvalid')` 提示；提交 → `studioStore.createPost(...)`，`409 exists` → `t('studio.exists')` toast，成功后关闭。
- `apps/web/src/components/editor/dialogs/StudioCommandDialog.vue`（新）：
  - 标题 = 命令 label；正文是 `<pre>`（`overflow-auto`、等宽、`whitespace-pre-wrap`）渲染 `commandEvents` 的 `text`，`stdout`/`stderr` 用不同 class 区分；每次事件后 `scrollTop = scrollHeight`；`exit`/`error` 事件渲染成一行状态（`退出码 {code}` / 报错文本）。
  - 运行中显示 `Loader2` 旋转图标 + 停止按钮（service 命令）；`done` 时若非 0 显示红色状态；有 `url` 且 `preview` 类命令显示“打开预览”按钮。
  - 对话框关闭不停止进程；重新打开时 `from: 0` 重放（服务端已有缓冲），因此页面刷新后仍能看到日志。
- `apps/web/src/components/editor/CodemirrorEditor.vue`：
  - `const StudioPanel = defineAsyncComponent(() => import('@/components/editor/studio-panel/index.vue'))`、`StudioNewPostDialog`、`StudioCommandDialog` 同形声明；
  - `storeToRefs(uiStore)` 取出 `isOpenStudioPanel`、`isShowStudioNewPostDialog`、`isShowStudioCommandDialog`；
  - 在 folder 面板那段（约 260-275 行）之后，插入一个同形 `ResizablePanel` + `ResizableHandle`（`v-if="!isMobile && isOpenStudioPanel"`），内部 `<StudioPanel v-if="isOpenStudioPanel" />`；
  - 模板里挂 `<StudioNewPostDialog v-if="isShowStudioNewPostDialog" />`、`<StudioCommandDialog v-if="isShowStudioCommandDialog" />`（和现有 dialog 的挂法一致）。
- `apps/web/src/components/editor/editor-header/FileDropdown.vue`：两处 `isOpenFolderPanel = !isOpenFolderPanel`（第 71、180 行）改成 `uiStore.toggleFolderPanel()`，并各加一条 `StudioPanel` 菜单项调用 `uiStore.toggleStudioPanel()`（`v-if="studioStore.isActive"`，图标用 `@lucide/vue` 里已有的 `FolderKanban`）。
- `apps/web/src/composables/useCommandPalette.ts`：`toggle-folder-panel` 那条改调 `uiStore.toggleFolderPanel()`；新增 `toggle-studio-panel` 条目（`group: t('commandPalette.group.panel')`）调 `uiStore.toggleStudioPanel()`。
- `.markdown` 支持（同一处功能的必要修正）：
  - `apps/web/src/stores/folderSource.ts` 的 `buildFileTree`：`entry.name.toLowerCase().endsWith('.md')` → `/\.(?:md|markdown)$/i.test(entry.name)`；
  - `apps/web/src/components/editor/folder-source-panel/index.vue` 的 `handleOpenFile`：`node.name.replace(/\.md$/i, '')` → `node.name.replace(/\.(?:md|markdown)$/i, '')`。
- i18n：新增 `apps/web/src/i18n/messages/{zh-CN,zh-TW,en-US,ja-JP}/studio.ts`（默认导出 `{ studio: { ... } }`，加进各自 `index.ts` 的 import 与 spread）。键至少包含：
  `title`（博客工作目录）、`notActive`（未连接到本地工作目录服务，请用 pnpm studio 启动）、`refresh`、`searchPlaceholder`、`newPost`、`newFragments`、`empty`、`openFailed`、`saveSaved`、`saveSaving`、`saveFailed`、`conflictTitle`、`conflictKeepMine`、`conflictUseDisk`、`commands`、`runCommand`、`stopCommand`、`openPreview`、`commandFailed`、`commandDone`、`changedReloaded`（部署流程改写了 {count} 个文件，已重新载入当前文件）、`newPostDialogTitle`、`fieldTitle`、`fieldSlug`、`fieldPathPreview`（将创建）、`create`、`cancel`、`slugInvalid`、`createFailed`、`exists`、`pushToMpOk`、`pushToMpNoTab`、`pushToMpFailed`。
  zh-CN 的文案即为上面括号内的中文，其余三个 locale 写等价译文。

### 4. `apps/web`：扩展推送桥（手动粘贴之外的那一步）

- `apps/web/src/entrypoints/studio.content.ts`（新 WXT content script）：
  ```ts
  export default defineContentScript({
    matches: [`http://127.0.0.1/*`, `http://localhost/*`],
    runAt: `document_start`,
    main() {
      const reply = (payload: unknown) => window.postMessage({ source: `md-extension`, ...payload }, window.location.origin)
      reply({ type: `ready` })
      window.addEventListener(`message`, async (event) => {
        if (event.source !== window)
          return
        const data = event.data
        if (!data || data.source !== `md-studio`)
          return
        if (data.type === `ping`) { reply({ type: `ready` }); return }
        if (data.type !== `copyToMp`)
          return
        const res = await browser.runtime.sendMessage({ type: `studioCopyToMp`, content: data.content })
        reply({ type: `copyToMpResult`, ok: Boolean(res?.ok), reason: res?.reason })
      })
    },
  })
  ```
  match pattern 支持可选端口、未写端口时匹配该 host 的所有端口（Chrome 官方 match patterns 文档），所以不写端口、只匹配 `127.0.0.1` / `localhost`。
- `apps/web/src/entrypoints/background.ts`：在 `main()` 里加消息处理（顶部加 `relayToMpEditor` 函数）：

  ```ts
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== `studioCopyToMp`)
      return
    return relayToMpEditor(message.content)
  })

  async function relayToMpEditor(content: string) {
    const tabs = await browser.tabs.query({ url: [`https://mp.weixin.qq.com/cgi-bin/appmsg*`] })
    const tab = tabs.find(t => t.id != null)
    if (!tab?.id)
      return { ok: false, reason: `no-mp-tab` }
    try {
      await browser.tabs.sendMessage(tab.id, { type: `copyToMp`, content })
      return { ok: true }
    }
    catch {
      return { ok: false, reason: `relay-failed` }
    }
  }
  ```

  已有的 `appmsg.content.ts` → `injected.js`（`__MP_Editor_JSAPI__.invoke('mp_editor_set_content')`）链路保持不变；不追求微信侧的 ack（上游也忽略 `sucCb`）。

- `apps/web/wxt.config.ts`：`permissions` 增加 `'tabs'`（`tabs.query` 的 `url` 过滤需要它）。
- `apps/web/src/lib/studio/copy-to-mp-bridge.ts`：
  ```ts
  export function installStudioCopyToMpBridge()
  ```
  行为：`!window.__MD_STUDIO__` 直接 return；接 `window` 的 `message`（校验 `event.source === window && data.source === 'md-extension'`）：`ready` → `extensionReady = true`（并冲刷 `pendingContent`），`copyToMpResult` → 按 `ok`/`reason` toast（`pushToMpOk` / `pushToMpNoTab` / `pushToMpFailed`）；监听 `copyToMp` CustomEvent：`extensionReady` 时 `window.postMessage({ source:'md-studio', type:'copyToMp', content }, location.origin)`，否则**静默**（没有装扩展时行为与现在完全一致）；安装时发一次 `{ source:'md-studio', type:'ping' }`（content script 在 `document_start` 就绪，可能早于页面监听器，靠 ping 兜底）。
- 不改 `apps/web/src/sidepanel.ts`（它只在扩展侧边栏上下文生效）。

### 5. 根脚本与测试

- 根 `package.json`：
  - 新增 `"studio": "pnpm --filter @md/studio build:web && pnpm --filter @md/studio start"`、`"studio:build": "pnpm --filter @md/studio build:web"`、`"studio:serve": "pnpm --filter @md/studio start"`（放在 `"web"`/`"mcp"` 那组里）；
  - `"test"` 追加 `&& pnpm --filter @md/studio test`。
- `apps/studio/workspace.test.js`（vitest，纯函数，不碰真实博客目录，用 `fs.mkdtemp` 造临时目录）：
  - `parseFrontMatterTitle('---\ntitle: "A: B"\n---\nbody')` → `'A: B'`；无 front matter / YAML 非法 → `null`。
  - `titleFromName('2026-09-24-fragments-0x000b.markdown')` → `'fragments-0x000b'`。
  - `computeNextFragments` 从 `fragments-0x000b` 起 → `num === '0x000c'`、`filename.endsWith('-fragments-0x000c.markdown')`；空目录 → `0x0001`。
  - `isPostPath`：`_posts/a.md`/`_posts/a.markdown` 通过；`_posts/a.txt`、`_posts/sub/a.md`、`../x.md`、`_site/a.md` 不通过；`resolvePostPath(root, '../_posts/a.md')` 抛 `StudioError` 400。
  - `buildPostContent`：`kind:'fragments'` 的输出逐字节等于固定字符串（含 `categories: [useless-songs, wxmp]` 与结尾 `---\n\n`）；`kind:'post'` 的 title 含 `&` 时输出 `&amp;`。
  - `writeFilePreservingMode`：预置一个 `0o755` 的文件，写入后 `fs.stat().mode & 0o777 === 0o755`；预置存在文件时会话内两次写入内容都正确（覆盖语义）。

## Critical files & anchors

- `apps/web/src/components/editor/CodemirrorEditor.vue` — 顶层布局，约 255-275 行是 ResizablePanel 组（folder 面板插槽），新面板与两个 dialog 挂在这里。
- `apps/web/src/stores/post.ts` — `currentPostId`/`currentPost`/`addPost`/`updatePostContent`（编辑器内容真源）；`apps/web/src/components/editor/EditorPanel.vue:628` 的 `watch(currentPost.content)` → `syncEditorToPostContent` 是“从磁盘重载”依赖的既有通路。
- `apps/web/src/components/editor/editor-header/index.vue` — `copy()`（约 95-205 行）里已派发 `copyToMp` CustomEvent，桥接直接复用，不改这个文件。
- `apps/web/src/types/post.ts` + `apps/web/src/storage/db.ts`（`StoredDocument`）+ `apps/web/src/storage/repositories/documents.ts`（`toStored`/`fromStored`）+ `apps/web/src/lib/post-signature.ts` — 这四处必须同步加上 `sourcePath?: string`（`postSignature` 里拼 `post.sourcePath ?? ''`），否则文件 → 缓冲映射不持久化。
- `apps/web/src/stores/folderSource.ts` + `apps/web/src/components/editor/folder-source-panel/index.vue` — `.markdown` 过滤/取标题两处修正。
- `apps/web/wxt.config.ts` — manifest `permissions` 加 `tabs`；`apps/web/src/entrypoints/background.ts`、`apps/web/src/entrypoints/appmsg.content.ts` 是扩展链路锚点。

## Verification

前置：`pnpm install` 已在 `/Users/lenciel/Projects/rants/md` 完成；以下命令除注明外都在该目录执行。

1. 单测：`pnpm --filter @md/studio test` → 全绿（覆盖路径校验、计数器、模板字节、mode 保留）。
2. 构建：`pnpm studio:build` → 生成 `apps/web/dist/index.html`。
3. 起服务：`pnpm studio`（终端保持运行）→ 打印 `http://127.0.0.1:8790/` 并打开浏览器；随后：
   - `curl -s -H 'X-MD-Studio: 1' http://127.0.0.1:8790/api/studio/state` → JSON 含 `root` 与 3 条 commands；
   - `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8790/api/studio/state` → `403`；
   - `curl -s -H 'X-MD-Studio: 1' 'http://127.0.0.1:8790/api/studio/file?path=../Rakefile'` → `400`；
   - `curl -s -H 'X-MD-Studio: 1' http://127.0.0.1:8790/api/studio/posts | jq '.posts | length'` → `514`，`jq '.posts[0].title'` 为 `Fragments 0x000B`（取决于最新一篇），`jq '.nextFragments'` 为 `0x000c`。
4. 打开/编辑/落盘（浏览器，控件用中文文案）：File 菜单 → `博客工作目录` → 面板列出 514 篇（带标题，最新的在最上）→ 点 `2026-09-24-fragments-0x000b.markdown`，正文进编辑器；改一个字后等 1 秒，然后
   - `stat -f '%Lp %m' /Users/lenciel/Projects/rants/lenciel.github.io/_posts/2026-09-24-fragments-0x000b.markdown` → 权限仍是 `755`，mtime 变化；
   - `git -C /Users/lenciel/Projects/rants/lenciel.github.io diff --stat` 显示该文件被改；
   - 验证完 `git -C ... checkout -- _posts/2026-09-24-fragments-0x000b.markdown` 恢复，保持工作树干净。
5. 冲突保护：在浏览器打开某篇 post 后，用命令行 `printf '\n<!--probe-->\n' >> <该文件>` 改同一文件，再在编辑器里改一个字 → 面板出现冲突 `Alert`；点 `载入磁盘版本` → 编辑器出现 `<!--probe-->`；再点/恢复后 `git checkout --` 干净。
6. 新建：`新建 Fragments` → 预览显示 `将创建 _posts/<今天>-fragments-0x000c.markdown` → 创建后 `head -8` 输出
   ```
   ---
   layout: post
   comments: true
   description: '摘要'
   title: 'Fragments 0x000c'
   date: <今天> HH:MM:SS +0800
   categories: [useless-songs, wxmp]
   ```
   并确认编辑器已打开该文件；验证完 `rm` 掉这个新建文件。
7. 构建与发布（会真实改动工作树/线上，按需触发）：
   - 点 `构建站点 (rake prepare_deploy)` → 日志流式输出、结尾显示退出码 0；`stat -f %m _ftp/index.html` 为刚刚的时间；若当前打开的文件在 `changed` 列表里，面板提示“已重新载入当前文件”且编辑器内容里出现了 `{:target="_blank"}`（这属于该 Rakefile 的固有行为；若不想留痕，`git checkout -- _posts`）。
   - 点 `本地预览 (rake preview)` → `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4003` → `200`；点面板里的“打开预览”能打开；点 `停止` → 再 curl 失败（连接被拒），且 `pgrep -fl jekyll` 无残留（验证 SIGINT 打到进程组）。
   - 点 `上传博客 (upblog)` → 日志出现 rsync 传输/`sent` 统计、退出码 0（该命令会真的同步到 `aliblog:/usr/share/nginx/blog/`，在准备发布时再点）。
8. 公众号：
   - 手动粘贴：编辑器点 `复制`（公众号格式）→ 粘贴到公众号后台编辑器，样式与之前一致（此链路未改动）。
   - 扩展推送：`pnpm web ext:zip`（产物在 `apps/web/.output/chrome-mv3`）→ chrome://extensions 开发者模式加载该目录 → 在用户自己的 Chrome profile 里打开公众号图文编辑页（`https://mp.weixin.qq.com/cgi-bin/appmsg*`）→ 回到 studio 页面点 `复制` → 出现“已推送到公众号编辑器标签页” toast，且公众号编辑器正文被替换；关掉该标签页再点 `复制` → 出现“未找到已打开的公众号编辑器页面”；禁用扩展后点 `复制` → 无任何新 toast（行为与改动前一致）。
9. 迭代链路：终端 A `pnpm studio:serve`，终端 B `MD_STUDIO=1 pnpm web dev` → 打开 `http://localhost:5173/md/`，面板/命令/日志可用（证明开发代理与注入生效）。
10. 仓库门禁：`pnpm lint`、`pnpm type-check`、`pnpm test` 全绿（`test` 现在包含 `@md/studio`）。

## Assumptions & contingencies

- 端口 8790：若被占用，服务用 `get-port` 自动换端口并打印实际 URL；此时开发模式的代理端口要用 `MD_STUDIO_PORT=<实际端口> MD_STUDIO=1 pnpm web dev`。扩展 content script 不写端口，因此换端口不影响推送。
- 命令解析依赖 `zsh -lic`（登录+交互式）才能拿到 rbenv 的 `rake`/`jekyll`、`~/bin/pagefind_extended` 和 `~/.aliases` 里的 `upblog`；已实测可用。命令日志里出现 `stty: stdin isn't a terminal`、nvm 切换提示、gitstatus 报错属预期噪声，不修。若日后 `upblog` 改名/改定义，只改 `studio.config.json` 里的 `cmd` 即可（`cmd` 是 shell 字符串，会由 `zsh -lic` 解释，因此 alias 仍然生效）。
- `rake preview` 起在 4003；若端口被占，rake 自身报错会显示在日志面板，本方案不做端口探测。
- `rake prepare_deploy`/`rake preview` 会经 `blank_target` 改写 `_posts/*.markdown`（补 `{:target="_blank"}`）；面板按“命令结束 → 比对 mtime → 重载当前文件”处理，不额外提交/回滚 git。用户若希望保持工作树干净，沿用现有习惯自行 commit 或 `git checkout -- _posts`。
- 写盘竞态：同一文件在 studio 之外被改（如命令行）时，PUT 返回 409，面板要求用户显式选“覆盖磁盘/载入磁盘版本”，不做自动合并。
- 扩展推送只在用户手动加载了仓库构建出的扩展、且 Chrome 的 `host_permissions` 允许访问 `https://*.weixin.qq.com/*`（现有 manifest 已声明）时生效；未加载扩展时行为与改动前完全一致（复制后手动粘贴）。
- `apps/web` 默认构建（`pnpm web build`，base `/md/`）行为不变；新加的 `build:studio` 只改 `base` 为 `/`。若后续上游改了 `SERVER_ENV` 的用法，`build:studio` 需要跟着同步（目前 `SERVER_ENV` 只影响 base 与 uTools 插件）。
- 不做的事情（用户已明确选择）：front matter 结构化编辑、图片上传/相对路径转绝对 URL、其他平台的发布改动、浏览器 File System Access 面板的功能扩展（仅修 `.markdown`）。
