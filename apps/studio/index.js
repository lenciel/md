import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import getPort from 'get-port'
import { stopAllRunning } from './exec.js'
import { createStudioApp } from './server.js'
import { createShareApp } from './share.js'

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL('./studio.config.json', import.meta.url))
const DIST_DIR = fileURLToPath(new URL('../../apps/web/dist/', import.meta.url))

function fail(message) {
  console.error(message)
  process.exit(1)
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory()
  }
  catch {
    return false
  }
}

function parseArgv(argv) {
  const options = { configPath: DEFAULT_CONFIG_PATH, root: undefined, port: undefined, open: true }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const inline = eq === -1 ? undefined : arg.slice(eq + 1)
    const value = () => {
      const found = inline ?? argv[++index]
      if (found === undefined)
        throw new Error(`参数缺少值: ${flag}`)
      return found
    }

    if (flag === '--root') {
      options.root = value()
    }
    else if (flag === '--port') {
      const raw = value()
      options.port = Number(raw)
      if (!Number.isInteger(options.port))
        throw new Error(`--port 需要整数: ${raw}`)
    }
    else if (flag === '--config') {
      options.configPath = value()
    }
    else if (flag === '--no-open') {
      options.open = false
    }
    else {
      throw new Error(`未知参数: ${arg}`)
    }
  }

  return options
}

/**
 * The address the phone should use. `en0`/`en1` are the Wi-Fi/Ethernet interfaces on macOS;
 * anything else non-internal is a fallback (docker bridges are internal, so they stay out).
 */
function lanAddress() {
  const interfaces = os.networkInterfaces()
  const preferred = ['en0', 'en1']

  for (const name of preferred) {
    const address = (interfaces[name] ?? []).find(item => item.family === 'IPv4' && !item.internal)
    if (address)
      return address.address
  }

  for (const items of Object.values(interfaces)) {
    const address = (items ?? []).find(item => item.family === 'IPv4' && !item.internal)
    if (address)
      return address.address
  }

  return ''
}

function loadConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  }
  catch (err) {
    fail(`无法读取配置 ${configPath}: ${err.message}`)
  }
}

async function main() {
  const argv = parseArgv(process.argv.slice(2))
  const config = loadConfig(argv.configPath)

  if (argv.root)
    config.root = argv.root
  if (argv.port !== undefined)
    config.port = argv.port

  if (!config.root || !isDirectory(config.root))
    fail(`工作目录不存在: ${config.root ?? '(未配置 root)'}`)

  const postsDir = config.postsDir ?? '_posts'
  const postsPath = path.join(config.root, postsDir)
  if (!isDirectory(postsPath))
    fail(`未找到 posts 目录: ${postsPath}`)

  if (!fs.existsSync(path.join(DIST_DIR, 'index.html')))
    fail('未找到 apps/web/dist，请先运行 pnpm studio:build')

  const port = await getPort({ port: config.port })
  const sharePort = await getPort({ port: config.sharePort ?? port + 1 })
  const lanIp = lanAddress()
  const shareLanOrigin = lanIp && sharePort !== port ? `http://${lanIp}:${sharePort}` : ''

  const app = createStudioApp({
    config,
    distDir: DIST_DIR,
    shareOrigins: { local: `http://127.0.0.1:${port}`, lan: shareLanOrigin },
  })
  const server = app.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`
    if (port !== config.port)
      console.log(`端口 ${config.port} 已被占用，改用 ${port}`)
    console.log(`已连接博客工作目录: ${config.root}`)
    console.log(`打开 ${url}`)

    if (shareLanOrigin)
      console.log(`手机预览（同一 Wi-Fi）: ${shareLanOrigin}/s/…  ← 在「分享」里生成`)

    if (argv.open && process.platform === 'darwin')
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
  })

  server.on('error', err => fail(`服务启动失败: ${err.message}`))

  // A second listener on the LAN that serves share pages and nothing else.
  let shareServer = null
  if (shareLanOrigin) {
    shareServer = createShareApp().listen(sharePort, '0.0.0.0')
    shareServer.on('error', err => console.warn(`手机预览服务未启动: ${err.message}`))
  }

  const shutdown = () => {
    stopAllRunning()
    shareServer?.close()
    server.close(() => process.exit(0))
    // jekyll may ignore SIGINT; never hang the shell on shutdown.
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => fail(err.message))
