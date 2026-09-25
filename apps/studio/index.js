import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import getPort from 'get-port'
import { stopAllRunning } from './exec.js'
import { createStudioApp } from './server.js'

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
  const app = createStudioApp({ config, distDir: DIST_DIR })
  const server = app.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`
    if (port !== config.port)
      console.log(`端口 ${config.port} 已被占用，改用 ${port}`)
    console.log(`已连接博客工作目录: ${config.root}`)
    console.log(`打开 ${url}`)

    if (argv.open && process.platform === 'darwin')
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
  })

  server.on('error', err => fail(`服务启动失败: ${err.message}`))

  const shutdown = () => {
    stopAllRunning()
    server.close(() => process.exit(0))
    // jekyll may ignore SIGINT; never hang the shell on shutdown.
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => fail(err.message))
