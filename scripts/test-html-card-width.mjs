/**
 * HTML 卡片「可用宽度」端到端验证（真 Chrome + 真 sandbox iframe）。
 *
 * 为什么必须有这个测试（而不是只靠源码正则断言）：
 *
 *   `--dsh-card-w` 的价值全在「**宿主什么都不做时也能拿到**」。只断言源码里有
 *   `syncWidth` 是自欺欺人 —— 真问题全在运行时：srcdoc 异步解析、首帧
 *   clientWidth 还是 0、sandbox 下父页读不到内部 DOM。这些只有把真浏览器拉起来
 *   跑一遍才看得见。
 *
 * 覆盖两个场景：
 *   A. 宿主**一条消息都不发**（第三方宿主 / ready 回推丢失）→ 仍自动跟随视口；
 *   B. 宿主下发 width → 以**下发值优先**，且非法值不清零。
 *
 * 跳过策略：没有 Chrome 就 skip（CI / 无 GUI 机器不该因此红），但**本机必须真跑**——
 * 开发机上静默跳过等于没测，所以跳过时会打印醒目提示。
 *
 * 用法：node scripts/test-html-card-width.mjs
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (chromePath === undefined) {
  console.log('SKIP  html-card-width e2e — 未找到 Chrome（本机开发请装 Chrome，否则这条等于没测）')
  process.exit(0)
}

const requirePlugin = createRequire(resolve(ROOT, 'package.json'))
const esbuild = requirePlugin('esbuild')

/** ws 依赖来自 DSH 运行时（插件本身不带 ws）。 */
function loadWebSocket() {
  for (const base of [ROOT, 'D:/AI/Dsh/dsh-runtime']) {
    try {
      return createRequire(resolve(base, 'package.json'))('ws')
    } catch { /* 换下一个 */ }
  }
  return null
}
const WebSocket = loadWebSocket()
if (WebSocket === null) {
  console.log('SKIP  html-card-width e2e — 找不到 ws（DSH 运行时未安装）')
  process.exit(0)
}

// ── 打包 bridge.ts，直接用它的 assembleHtmlDocument ──────────────────────
// 必须 bundle 而不是 transform：bridge.ts 还引着 ./kit.ts 与 ./runtime.ts，
// 单文件 transform 出来的产物带着裸相对路径 import（且指向 .ts），Node 直接
// ERR_MODULE_NOT_FOUND —— 测试会以「找不到模块」而不是断言失败的形式挂掉。
const tmp = mkdtempSync(resolve(tmpdir(), 'dsh-cardw-'))
const bridgeFile = resolve(tmp, 'bridge.mjs')
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/client/html-embed/bridge.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: bridgeFile,
  logLevel: 'silent',
})
const bridge = await import(pathToFileURL(bridgeFile).href)

/** iframe 内探针：把当前宽度变量报给父页（沙箱下父页读不到内部 DOM）。 */
const PROBE = `<script>
setInterval(function(){
  var cs = getComputedStyle(document.documentElement);
  parent.postMessage({ t: 'report',
    cssVar: cs.getPropertyValue('--dsh-card-w').trim(),
    jsVar: window.__dshCardWidth,
    viewport: document.documentElement.clientWidth }, '*');
}, 200);
<\/script>`

function buildFrameDoc() {
  let doc = bridge.assembleHtmlDocument('<div style="height:120px;font:14px sans-serif">x</div>')
  return doc.replace('</body>', PROBE + '</body>')
}

/**
 * 宿主页。`withPush` 决定是否实现 width 下发 —— 场景 A 用 false（第三方宿主），
 * 场景 B 用 true。两边共用同一份 iframe 文档，差异只在宿主行为。
 */
function buildHostPage(withPush) {
  const frameDoc = buildFrameDoc()
  return `<!doctype html><html><body style="margin:0">
<iframe id="f" sandbox="allow-scripts" style="width:900px;height:240px;border:0"></iframe>
<script>
window.__reports = [];
addEventListener('message', function (e) {
  if (e.data && e.data.t === 'report') window.__reports.push(e.data);
});
document.getElementById('f').srcdoc = ${JSON.stringify(frameDoc).replace(/<\//g, '<\\/')};
${withPush ? `window.__push = function (w) {
  document.getElementById('f').contentWindow.postMessage({ source: 'dsh-html-card-host', kind: 'width', width: w }, '*');
};` : ''}
<\/script></body></html>`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 一个 CDP 会话：起 Chrome → 开页 → 跑断言 → 关掉。 */
async function withChrome(port, run) {
  const profile = mkdtempSync(resolve(tmpdir(), 'dsh-cardw-prof-'))
  const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', 'about:blank'], { stdio: 'ignore' })
  let ws = null
  try {
    for (let i = 0; i < 80; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break } catch { /* wait */ }
      await sleep(250)
    }
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page === undefined) throw new Error('没有可用的 page target')
    ws = await new Promise((res, rej) => {
      const s = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
      s.on('open', () => res(s)); s.on('error', rej)
    })
    let nextId = 1
    const send = (method, params = {}) => {
      const id = nextId++
      return new Promise((res, rej) => {
        const onMessage = (raw) => {
          const msg = JSON.parse(raw.toString())
          if (msg.id !== id) return
          ws.off('message', onMessage)
          if (msg.error !== undefined) rej(new Error(`${method}: ${JSON.stringify(msg.error)}`))
          else res(msg.result)
        }
        ws.on('message', onMessage)
        ws.send(JSON.stringify({ id, method, params }))
      })
    }
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails !== undefined) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
      return r.result?.value
    }
    await send('Page.enable')
    await send('Runtime.enable')
    await run({ evaluate, open: async (html) => {
      await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) })
      await sleep(2200)
    } })
  } finally {
    try { ws?.close() } catch { /* ignore */ }
    chrome.kill()
    await sleep(300)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

const failures = []
function need(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail === undefined ? '' : `  — ${detail}`}`)
  if (!ok) failures.push(name)
}

// ── 场景 A：宿主什么都不做，宽度必须自动跟随 ─────────────────────────────
await withChrome(9336, async ({ evaluate, open }) => {
  await open(buildHostPage(false))

  const a1 = await evaluate('window.__reports[window.__reports.length - 1] || null')
  need('宿主零消息下自动拿到宽度（900px）', a1 !== null && a1.cssVar === '900px', JSON.stringify(a1))

  await evaluate(`document.getElementById('f').style.width = '512px'`)
  await sleep(1100)
  const a2 = await evaluate('window.__reports[window.__reports.length - 1] || null')
  need('视口变窄自动跟随（512px）', a2 !== null && a2.cssVar === '512px', JSON.stringify(a2))

  await evaluate(`document.getElementById('f').style.width = '1180px'`)
  await sleep(1100)
  const a3 = await evaluate('window.__reports[window.__reports.length - 1] || null')
  need('视口变宽自动跟随（1180px）', a3 !== null && a3.cssVar === '1180px', JSON.stringify(a3))
})

// ── 场景 B：宿主下发时以下发值优先，非法值不清零 ─────────────────────────
await withChrome(9337, async ({ evaluate, open }) => {
  await open(buildHostPage(true))

  const b1 = await evaluate('window.__reports[window.__reports.length - 1] || null')
  need('无下发时先落到自身视口（900px）', b1 !== null && b1.cssVar === '900px', JSON.stringify(b1))

  await evaluate('window.__push(600)')
  await sleep(800)
  const b2 = await evaluate('window.__reports[window.__reports.length - 1] || null')
  need('下发值优先（600px）', b2 !== null && b2.cssVar === '600px' && b2.jsVar === 600, JSON.stringify(b2))

  await evaluate('window.__push(-5)')
  await sleep(700)
  const b3 = await evaluate('window.__reports[window.__reports.length - 1] || null')
  need('非法下发值被忽略，保持上次有效值', b3 !== null && b3.cssVar === '600px', JSON.stringify(b3))
})

try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }

if (failures.length > 0) {
  console.log(`\nHTML CARD WIDTH E2E FAILED — ${failures.length} 条不通过：\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('\nHTML CARD WIDTH E2E PASSED — 6/6')
