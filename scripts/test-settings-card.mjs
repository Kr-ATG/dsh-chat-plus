/**
 * 大盘设置卡片端到端验证（真 Chrome + 真 DSH Web，2026-10-18）。
 *
 * 为什么必须有真浏览器脚本：本轮改动全是「错了也不报错、只看着不对」的运行时事实 ——
 * 卡片有没有真的从右栏那棵子树里跳出来（portal）、几何是不是**居中卡片**而不是
 * 贴右边缘的抽屉、两栏有没有真的排成两列、减弱动效下会不会因为抹掉 transform
 * 而贴到视口右下角。源码正则断言（smoke-client.mjs）只能证明代码写了什么。
 *
 * 判据：
 *   A. 顶栏齿轮仍在 Seeker 标签右侧（位置没被这轮改动带偏）；
 *   B. 点齿轮 → 卡片 data-open=true、可见、pointer-events:auto；
 *   C. 几何：宽 ≥ 900px、**水平居中**（左右留白差 ≤ 4px）、**纵向浮起**
 *      （上下都露遮罩，不是全高抽屉）；
 *   D. 卡片不在 .kr-split__side 子树里（portal 到 body 了），且它的最近定位
 *      祖先不是右栏 —— 这是「弹卡片」与「右栏浮层」的分界；
 *   E. 两栏布局：body 是 grid 且算出**两列**，左栏放提示词通道、右栏放
 *      工作区记忆 + 展示；
 *   F. 三条关闭通路：再点齿轮（DOM 通路）、Esc、点遮罩；
 *   G. 减弱动效下内容完整可见**且仍然居中**（这条最容易踩：把 transform
 *      整体归零会连居中一起丢）；
 *   H. 截图存档，截前在 DOM 层把真实邮箱地址与本地用户路径脱敏。
 *
 * 环境与凭据：带令牌的 DSH Web 地址从环境变量 `DSH_WEB_AUTH_URL` 读
 * （**不把 token 写进脚本**）；缺失时回退到 DSH_HOME 下的 web-auth-url.json。
 *
 * 用法：node scripts/test-settings-card.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const CHROME_CANDIDATES = [
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (chromePath === undefined) {
  console.log('SKIP  settings-card e2e — 未找到 Chrome（本机开发请装 Chrome，否则这条等于没测）')
  process.exit(0)
}

const OUT_DIR = 'D:/AI/Dsh/_tmp'
const SHOT = `${OUT_DIR}/settings-card-open.png`
const RESULT = `${OUT_DIR}/settings-card-e2e-result.txt`

/** 每次跑都用独立端口 + 独立 user-data-dir（理由见 test-mail-drawer.mjs）。 */
const PORT = 9700 + (process.pid % 300)
const PROFILE = mkdtempSync(resolve(tmpdir(), 'dsh-settings-card-'))

/** 带令牌地址：环境变量优先，其次 DSH_HOME 下那份（都不硬编码 token）。 */
function resolveAuthUrl() {
  const fromEnv = process.env.DSH_WEB_AUTH_URL
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  const dshHome = process.env.DSH_HOME ?? resolve(homedir(), '.dsh')
  const file = resolve(dshHome, 'web-auth-url.json')
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof parsed?.url === 'string' && parsed.url.trim() !== '') return parsed.url.trim()
    } catch { /* 文件损坏 → 当没读到 */ }
  }
  return null
}

const authUrl = resolveAuthUrl()
if (authUrl === null) {
  console.log('SKIP  settings-card e2e — 读不到 DSH Web 带令牌地址（设 DSH_WEB_AUTH_URL，或让 DSH 写出 web-auth-url.json）')
  process.exit(0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, '--window-size=1680,1000',
  '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${PROFILE}`,
  authUrl,
], { stdio: 'ignore' })

function cleanupProfile() {
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch { /* 下次跑会另建一个 */ }
}

let ws = null
let idSeq = 0
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const myId = ++idSeq
    const handler = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== myId) return
      ws.removeEventListener('message', handler)
      if (msg.error !== undefined) rej(new Error(`${method}: ${JSON.stringify(msg.error).slice(0, 300)}`))
      else res(msg.result)
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails !== undefined) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
  return r.result.value
}

/** 真实鼠标点击（press + release），不是 DOM 的 .click()。 */
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await sleep(60)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(40)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}

/** 按钮中心坐标。 */
function buttonCenter(id) {
  return evaluate(`(function(){
    var el = document.getElementById(${JSON.stringify(id)});
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`)
}

/** 设置卡片的当前状态快照（几何 + 可见性 + 两栏 + portal 归属）。 */
const CARD_STATE = `(function(){
  var d = document.querySelector('.kr-settings');
  var s = document.querySelector('.kr-settings__scrim');
  if (!d || !s) return { missing: true };
  var db = d.getBoundingClientRect(), cb = getComputedStyle(d);
  var body = d.querySelector('.kr-settings__body');
  var main = d.querySelector('.kr-settings__col--main');
  var aside = d.querySelector('.kr-settings__col--aside');
  var bs = body ? getComputedStyle(body) : null;
  // 最近定位祖先：portal 成功后应该是 body / html 一级，而不是 .kr-split__side。
  var anchor = d.parentElement, anchorCls = '(body)';
  while (anchor && anchor !== document.body) {
    if (getComputedStyle(anchor).position !== 'static') { anchorCls = anchor.className || anchor.tagName; break }
    anchor = anchor.parentElement;
  }
  return {
    open: d.getAttribute('data-open'),
    // 关闭态**必须**没有 aria-modal="true"：官方快捷键服务用纯 DOM 查询判定模态，
    // 不看可见性。常驻 DOM 的卡片写死 true 会吞掉整个应用的官方快捷键。
    ariaModal: d.getAttribute('aria-modal'),
    visibility: cb.visibility,
    opacity: Number(cb.opacity),
    pointerEvents: cb.pointerEvents,
    width: Math.round(db.width),
    height: Math.round(db.height),
    left: Math.round(db.left),
    right: Math.round(db.right),
    top: Math.round(db.top),
    bottom: Math.round(db.bottom),
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    scrimLeft: Math.round(s.getBoundingClientRect().left),
    scrimPE: getComputedStyle(s).pointerEvents,
    inSplitSide: d.closest('.kr-split__side') !== null,
    anchorCls: anchorCls,
    bodyDisplay: bs ? bs.display : null,
    gridColumns: bs ? bs.gridTemplateColumns : null,
    hasMain: main !== null,
    hasAside: aside !== null,
    mainWidth: main ? Math.round(main.getBoundingClientRect().width) : 0,
    asideWidth: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
    asideBorder: aside ? getComputedStyle(aside).borderLeftWidth : null,
    rows: d.querySelectorAll('.kr-settings__row').length,
    switches: d.querySelectorAll('.kr-settings__switch').length,
    groups: d.querySelectorAll('.kr-settings__group').length,
  };
})()`

async function main() {
  const lines = []
  const log = (s) => { lines.push(s); console.log(s) }
  const ok = (s) => log('ok   ' + s)
  const fail = (s) => { lines.push('FAIL ' + s); console.log('FAIL ' + s); process.exitCode = 1 }

  // ── 起 Chrome、连 CDP ───────────────────────────────────────────────────
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) break
    } catch { /* 还没起来 */ }
    await sleep(500)
  }
  await sleep(1200)
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (page === undefined) throw new Error('没有可用的 page target')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Page.enable')
  await send('Runtime.enable')

  // ── 等应用就绪（带令牌地址首次进入要种 cookie，偶发白屏重试一次）──
  let ready = false
  for (let round = 0; round < 2 && !ready; round += 1) {
    if (round > 0) {
      await send('Page.navigate', { url: authUrl })
      await sleep(1500)
    }
    for (let i = 0; i < 60; i += 1) {
      ready = await evaluate(`Boolean(window.__dshClientCtx__ && document.querySelector('[data-conversation-content]'))`).catch(() => false)
      if (ready) break
      await sleep(1000)
    }
  }
  log('app ready=' + ready)
  if (!ready) {
    fail(`DSH Web 未就绪（url=${authUrl.replace(/token=[^&]+/, 'token=***')}）——带令牌地址是否还有效？`)
    try { ws.close() } catch { /* ignore */ }
    chrome.kill()
    cleanupProfile()
    writeFileSync(RESULT, lines.join('\n'))
    process.exit(1)
  }
  await sleep(2500)

  // ── 进入一个已有会话（顶栏 tablist 只在会话开张后渲染）─────────────────
  const entered = await evaluate(`(function(){
    var ctx = window.__dshClientCtx__;
    if (!ctx) return 'NO_CTX';
    var ws = ctx.get('uiWorkspace');
    if (!ws || typeof ws.openSession !== 'function') return 'NO_OPEN_SESSION';
    var s = ctx.get('sessions');
    var snap = s && s.list && s.list.getSnapshot ? s.list.getSnapshot() : (s && s.getSnapshot ? s.getSnapshot() : null);
    var ids = snap && snap.byId ? Object.keys(snap.byId) : [];
    if (ids.length === 0) return 'NO_SESSIONS';
    ws.openSession(ids[0]);
    return 'opened:' + ids[0];
  })()`)
  log('enterSession=' + entered)
  await sleep(6000)

  // ── A. 齿轮仍在 Seeker 右侧 ────────────────────────────────────────────
  const order = await evaluate(`(function(){
    var gear = document.getElementById('kr-panel-settings-btn');
    var seeker = document.getElementById('kr-chat-tab-btn');
    if (!gear) return { missing: 'kr-panel-settings-btn' };
    var prev = gear.previousElementSibling;
    return {
      prevId: prev ? prev.id : null,
      seekerExists: Boolean(seeker),
      gearW: Math.round(gear.getBoundingClientRect().width),
    };
  })()`)
  log('ORDER=' + JSON.stringify(order))
  if (order.missing !== undefined) fail('顶栏找不到齿轮 #kr-panel-settings-btn')
  else if (order.prevId !== 'kr-chat-tab-btn') fail(`齿轮前一个兄弟是 ${order.prevId}，应为 kr-chat-tab-btn`)
  else ok('顶栏齿轮仍在 Seeker 标签右侧（位置没被这轮改动带偏）')

  // ── B. 点齿轮 → 卡片打开 ───────────────────────────────────────────────
  const before = await evaluate(CARD_STATE)
  if (before.missing !== true && before.open === 'true') fail('卡片初始就已打开（state 泄漏）')
  const clickPt = await buttonCenter('kr-panel-settings-btn')
  if (clickPt !== null) await realClick(clickPt.x, clickPt.y)
  await sleep(2200)

  const opened = await evaluate(CARD_STATE)
  log('OPEN=' + JSON.stringify(opened))
  if (opened.missing === true) {
    fail('页面上没有 .kr-settings / .kr-settings__scrim（卡片没挂上）')
  } else {
    if (opened.open !== 'true') fail('点齿轮后卡片 data-open 不是 true')
    else if (opened.visibility !== 'visible' || opened.opacity < 0.99) {
      fail(`卡片 data-open=true 但不可见（visibility=${opened.visibility} opacity=${opened.opacity}）——可见性依赖了动画末帧`)
    } else if (opened.pointerEvents !== 'auto') {
      fail(`卡片打开后 pointer-events=${opened.pointerEvents}，面板点不动`)
    } else {
      ok(`点齿轮后卡片打开且可见（visibility=visible / opacity=${opened.opacity} / pointer-events=auto）`)
    }

    // ── C. 几何：宽 + 水平居中 + 纵向浮起 ───────────────────────────────
    if (opened.width < 900) fail(`卡片宽度 ${opened.width}px < 900px（还是抽屉那套窄几何，两栏排不下）`)
    else ok(`卡片宽度 ${opened.width}px × 高度 ${opened.height}px（视口 ${opened.viewportW}×${opened.viewportH}）`)
    const gapLeft = opened.left - opened.scrimLeft
    const gapRight = opened.viewportW - opened.right
    if (gapLeft <= 0 || gapRight <= 0) {
      fail(`卡片没有落在视口内：左留白 ${gapLeft}px / 右留白 ${gapRight}px（贴边就不是弹卡片了）`)
    } else if (Math.abs(gapLeft - gapRight) > 4) {
      fail(`卡片不居中：左留白 ${gapLeft}px vs 右留白 ${gapRight}px（差 ${Math.abs(gapLeft - gapRight)}px）`)
    } else {
      ok(`卡片水平居中：左右留白各约 ${gapLeft}px / ${gapRight}px`)
    }
    if (opened.top <= 0 || opened.bottom >= opened.viewportH) {
      fail(`卡片纵向贴边（top=${opened.top} bottom=${opened.bottom} 视口高=${opened.viewportH}）——这是抽屉的几何，不是卡片`)
    } else {
      ok(`卡片纵向浮起：上留白 ${opened.top}px / 下留白 ${opened.viewportH - opened.bottom}px`)
    }

    // ── D. portal：不在右栏子树里 ───────────────────────────────────────
    if (opened.inSplitSide) {
      fail('卡片仍在 .kr-split__side 子树里（没 portal 出去，最宽只能盖住右栏且会被 overflow:hidden 裁掉）')
    } else {
      ok(`卡片已 portal 出右栏（closest('.kr-split__side')=null，定位祖先 ${opened.anchorCls}）`)
    }

    // ── E. 两栏布局 ─────────────────────────────────────────────────────
    log('LAYOUT=' + JSON.stringify({
      display: opened.bodyDisplay, cols: opened.gridColumns,
      main: opened.mainWidth, aside: opened.asideWidth, border: opened.asideBorder,
    }))
    const colCount = opened.gridColumns === null ? 0 : opened.gridColumns.split(' ').filter(s => s !== '').length
    if (opened.bodyDisplay !== 'grid') fail(`设置正文 display=${opened.bodyDisplay}，应为 grid（两栏布局）`)
    else if (colCount !== 2) fail(`设置正文算出 ${colCount} 列，应为 2 列（gridTemplateColumns=${opened.gridColumns}）`)
    else if (!opened.hasMain || !opened.hasAside) fail('缺 kr-settings__col--main / --aside 容器（三组没拆成两栏）')
    else if (opened.mainWidth <= opened.asideWidth) fail(`左栏 ${opened.mainWidth}px 应比右栏 ${opened.asideWidth}px 宽（左栏放长说明）`)
    else if (opened.asideBorder !== '1px') fail(`右栏左侧分隔线宽 ${opened.asideBorder}，应为 1px`)
    else ok(`两栏布局在位：grid ${colCount} 列（左 ${opened.mainWidth}px / 右 ${opened.asideWidth}px，中间 1px 分隔）`)

    // 内容完整性：10 行 + 10 个开关 + 3 组
    if (opened.rows !== 10) fail(`卡片里 ${opened.rows} 行设置，应为 10 行`)
    else if (opened.switches !== 10) fail(`卡片里 ${opened.switches} 个开关，应为 10 个`)
    else if (opened.groups !== 3) fail(`卡片里 ${opened.groups} 组，应为 3 组`)
    else ok('卡片内容完整：10 行设置 / 10 个开关 / 3 组（提示词通道 + 工作区记忆 + 展示）')

    // ── G. 截图（截前脱敏）──────────────────────────────────────────────
    const scrubbed = await evaluate(`(function(){
      var EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g;
      var USERPATH = /[A-Za-z]:\\\\Users\\\\[^\\\\\\s]+/g;
      var roots = [document.querySelector('.kr-settings'), document.querySelector('header')].filter(Boolean);
      if (roots.length === 0) return { changed: 0, missing: true };
      var n = 0;
      roots.forEach(function(root){
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(function(t){
          var before = t.nodeValue;
          var after = before.replace(EMAIL, 'agent@example.com').replace(USERPATH, 'C:\\\\Users\\\\user');
          if (after !== before) { t.nodeValue = after; n++; }
        });
      });
      return { changed: n, roots: roots.length };
    })()`)
    log('SCRUB=' + JSON.stringify(scrubbed))
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
    log('screenshot=' + SHOT)
  }

  // ── F1. 再点齿轮 → 关闭（DOM 通路：遮罩会挡住真实坐标点击）────────────
  await evaluate(`document.getElementById('kr-panel-settings-btn').click(); 'clicked'`)
  await sleep(700)
  const afterBtn = await evaluate(CARD_STATE)
  const btnAttr = await evaluate(`(function(){
    var b = document.getElementById('kr-panel-settings-btn');
    return { open: b.getAttribute('data-open'), expanded: b.getAttribute('aria-expanded') };
  })()`)
  log('CLOSE_BTN=' + JSON.stringify({ ...afterBtn, btn: btnAttr }))
  if (afterBtn.open !== 'false') fail('再点齿轮后卡片没关（store 与按钮没接上）')
  else if (afterBtn.visibility !== 'hidden' || afterBtn.pointerEvents !== 'none') {
    fail(`卡片关闭后仍可见或仍拦点击（visibility=${afterBtn.visibility} pointer-events=${afterBtn.pointerEvents}）`)
  } else if (afterBtn.opacity > 0.02) fail(`卡片关闭后 opacity 仍有 ${afterBtn.opacity}（退场没走完 / 可见性依赖动画）`)
  else if (btnAttr.open !== 'false' || btnAttr.expanded !== 'false') fail(`按钮打开态属性未复位：${JSON.stringify(btnAttr)}`)
  else ok(`再点齿轮关闭成：卡片 hidden + pointer-events:none + opacity ${afterBtn.opacity}，按钮 data-open/aria-expanded 复位`)

  // ── F2. Esc → 关闭 ────────────────────────────────────────────────────
  await evaluate(`document.getElementById('kr-panel-settings-btn').click(); 'open'`)
  await sleep(900)
  const reopened = await evaluate(CARD_STATE)
  if (reopened.open !== 'true') fail('第二次打开失败（Esc 通路无法验证）')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(700)
  const afterEsc = await evaluate(CARD_STATE)
  if (afterEsc.open !== 'false') fail('按 Esc 没关掉大盘设置卡片')
  else ok('Esc 关闭通路可用')

  // ── F3. 点遮罩 → 关闭（真实鼠标，落在卡片左侧留白）────────────────────
  await evaluate(`document.getElementById('kr-panel-settings-btn').click(); 'open'`)
  await sleep(900)
  const forScrim = await evaluate(CARD_STATE)
  if (forScrim.open !== 'true') fail('第三次打开失败（点遮罩通路无法验证）')
  const scrimX = Math.max(8, Math.round((forScrim.scrimLeft + forScrim.left) / 2))
  await realClick(scrimX, Math.round(500))
  await sleep(700)
  const afterScrim = await evaluate(CARD_STATE)
  if (afterScrim.open !== 'false') fail(`点遮罩（x=${scrimX}）没关掉卡片`)
  else ok(`点遮罩关闭通路可用（点 x=${scrimX}，落在卡片左侧可点区）`)

  // ── 关闭态不拦指针 / 不污染官方快捷键 ─────────────────────────────────
  const idle = await evaluate(CARD_STATE)
  if (idle.open === 'false' && (idle.scrimPE !== 'none' || idle.pointerEvents !== 'none')) {
    fail(`卡片关着时仍在拦指针（scrim=${idle.scrimPE} card=${idle.pointerEvents}）——页面上会点不动任何东西`)
  } else {
    ok('卡片关闭态不拦指针（scrim/card 都是 pointer-events:none）')
  }
  if (idle.open === 'false') {
    if (idle.ariaModal === 'true') {
      fail('卡片关闭态仍带 aria-modal="true" —— 官方快捷键（Mod+/ 速查等）会被整层吞掉')
    } else {
      ok('卡片关闭态未占用 aria-modal（不污染官方快捷键）')
    }
    const modalCount = await evaluate(`(function(){
      var els = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="menu"]');
      var hit = [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.className && String(el.className).indexOf('kr-settings') >= 0) hit.push(String(el.className));
      }
      return hit;
    })()`)
    if (Array.isArray(modalCount) && modalCount.length > 0) {
      fail(`关闭态下选择器仍命中卡片：${JSON.stringify(modalCount)}`)
    } else {
      ok('关闭态下官方模态选择器命中卡片数 = 0')
    }
  }

  // ── H. prefers-reduced-motion：内容完整可见且**仍然居中** ─────────────
  // 这条是本轮最容易踩的坑：减弱动效下若把 transform 整体归零，卡片会贴到
  // 视口右下角去 —— 内容看得见，位置全错，而这不报错也不打日志。
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await send('Page.reload', { ignoreCache: false })
  await sleep(1500)
  let rmReady = false
  for (let i = 0; i < 60; i += 1) {
    rmReady = await evaluate(`Boolean(window.__dshClientCtx__ && document.querySelector('[data-conversation-content]'))`).catch(() => false)
    if (rmReady) break
    await sleep(1000)
  }
  if (!rmReady) {
    fail('开启 prefers-reduced-motion 后刷新，应用没再就绪')
  } else {
    await sleep(2500)
    await evaluate(`(function(){
      var ctx = window.__dshClientCtx__;
      var ws = ctx && ctx.get('uiWorkspace');
      var s = ctx && ctx.get('sessions');
      var snap = s && s.list && s.list.getSnapshot ? s.list.getSnapshot() : (s && s.getSnapshot ? s.getSnapshot() : null);
      var ids = snap && snap.byId ? Object.keys(snap.byId) : [];
      if (ws && ids.length) ws.openSession(ids[0]);
    })()`)
    await sleep(4000)
    const rmBtn = await buttonCenter('kr-panel-settings-btn')
    if (rmBtn === null) {
      fail('减弱动效重载后顶栏找不到齿轮')
    } else {
      await realClick(rmBtn.x, rmBtn.y)
      await sleep(900)
      const rm = await evaluate(CARD_STATE)
      log('REDUCED_MOTION=' + JSON.stringify(rm))
      const mediaMatches = await evaluate(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`)
      const animName = await evaluate(`(function(){
        var r = document.querySelector('.kr-settings__row');
        return r ? getComputedStyle(r).animationName : null;
      })()`)
      if (!mediaMatches) fail('CDP 没能模拟出 prefers-reduced-motion（本断言前提失效）')
      else if (rm.open !== 'true') fail('减弱动效下卡片打不开')
      else if (rm.visibility !== 'visible' || rm.opacity < 0.99) {
        fail(`减弱动效下卡片不可见（visibility=${rm.visibility} opacity=${rm.opacity}）——可见性依赖了动画末帧`)
      } else if (rm.pointerEvents !== 'auto') {
        fail(`减弱动效下卡片 pointer-events=${rm.pointerEvents}，内容看得见却点不动`)
      } else if (Math.abs((rm.left - rm.scrimLeft) - (rm.viewportW - rm.right)) > 4) {
        fail(`减弱动效下卡片没有居中（左留白 ${rm.left - rm.scrimLeft}px / 右留白 ${rm.viewportW - rm.right}px）——transform 被整体归零了`)
      } else if (rm.bodyDisplay !== 'grid') {
        fail(`减弱动效下两栏失效（body display=${rm.bodyDisplay}）`)
      } else if (animName !== null && animName !== 'none') {
        fail(`减弱动效下卡片内容仍有动画（animation-name=${animName}）`)
      } else {
        ok(`减弱动效下内容完整可见且居中：opacity=${rm.opacity} / pointer-events=auto / 两栏在位 / animation-name=${animName}`)
      }
      await evaluate(`document.getElementById('kr-panel-settings-btn').click(); 'close'`)
      await sleep(300)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] })

  const passed = process.exitCode !== 1
  console.log('\n=== ' + (passed ? 'SETTINGS CARD E2E PASSED' : 'SETTINGS CARD E2E FAILED') + ' ===')
  lines.push('', '=== ' + (passed ? 'SETTINGS CARD E2E PASSED' : 'SETTINGS CARD E2E FAILED') + ' ===')
  lines.push('screenshot=' + SHOT)
  try { writeFileSync(RESULT, lines.join('\n')) } catch { /* 结果文件写不进去不影响退出码 */ }
  try { ws.close() } catch { /* ignore */ }
  chrome.kill()
  await sleep(300)
  cleanupProfile()
  process.exit(process.exitCode ?? 0)
}

main().catch((err) => {
  console.error('ERR ' + (err && err.message ? err.message : String(err)))
  try { writeFileSync(RESULT, 'ERR ' + (err && err.stack ? err.stack : String(err))) } catch { /* ignore */ }
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  cleanupProfile()
  process.exit(1)
})
