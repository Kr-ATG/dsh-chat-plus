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
  var wsZone = d.querySelector('.kr-settings__ws-zone');
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
    wsRows: d.querySelectorAll('.kr-settings__ws-row').length,
    // 工作区记忆区块（2026-10-25 搬到下方通栏）：这三个值一起证明它**不在**
    // body 之内、并且真的在 body 之后（DOM 顺序 = 视觉顺序，不靠 order 反排）。
    hasWsZone: wsZone !== null,
    zoneInBody: wsZone !== null && body !== null && body.contains(wsZone),
    // compareDocumentPosition 的 4 = wsZone 在 body 之后（DOCUMENT_POSITION_FOLLOWING）。
    zoneAfterBody: wsZone !== null && body !== null
      ? (body.compareDocumentPosition(wsZone) & 4) !== 0
      : false,
    zoneBg: wsZone ? getComputedStyle(wsZone).backgroundColor : null,
    // 行是不是真的排成了三列（开关对齐的前提）。
    rowCols: (function(){
      var r = d.querySelector('.kr-settings__row');
      return r ? getComputedStyle(r).gridTemplateColumns : null;
    })(),
    // 说明常态是不是封顶一行（拥挤的直接指标：11 行说明各占几行）。
    hintLines: (function(){
      var h = d.querySelector('.kr-settings__row .kr-settings__hint');
      if (!h) return null;
      var cs = getComputedStyle(h);
      return { clamp: cs.webkitLineClamp || cs.lineClamp, maxH: cs.maxHeight, height: Math.round(h.getBoundingClientRect().height) };
    })(),
    // 两栏各几行 / 两栏底部各空多少（视觉重心是否偏左或偏右的量化指标）。
    mainRows: main ? main.querySelectorAll('.kr-settings__row').length : 0,
    asideRows: aside ? aside.querySelectorAll('.kr-settings__row').length : 0,
    asideSlackPx: (function(){
      if (!aside || !body) return null;
      var rows = aside.querySelectorAll('.kr-settings__row');
      if (rows.length === 0) return null;
      var last = rows[rows.length - 1].getBoundingClientRect().bottom;
      var bs = getComputedStyle(body);
      var bodyBottom = body.getBoundingClientRect().bottom - parseFloat(bs.paddingBottom || '0');
      return Math.round(bodyBottom - last);
    })(),
    /*
     * 左栏底部留白。两栏都要量：只量右栏时，左栏空一块会完全看不见 ——
     * 2026-10-25 就是这样漏掉的（右栏 slack=0 一路绿灯，而左栏空出 70px）。
     * 判据不该是「某一栏没空」，而是「**两栏**都不该空出一大块」。
     */
    mainSlackPx: (function(){
      if (!main || !body) return null;
      var rows = main.querySelectorAll('.kr-settings__row');
      if (rows.length === 0) return null;
      var last = rows[rows.length - 1].getBoundingClientRect().bottom;
      var bs = getComputedStyle(body);
      var bodyBottom = body.getBoundingClientRect().bottom - parseFloat(bs.paddingBottom || '0');
      return Math.round(bodyBottom - last);
    })(),
    // 两栏里较高的那一栏占了多少高度（用于判断卡片够不够塞满）。
    colGapPx: (function(){
      if (!main || !aside) return null;
      var mr = main.getBoundingClientRect(), ar = aside.getBoundingClientRect();
      return Math.round(Math.abs(mr.height - ar.height));
    })(),
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

  // ── 进入一个**有对话轮次**的会话，并等右栏真的长出来 ────────────────────
  //
  // ⚠ 两个坑，都是 2026-10-25 实测踩到的：
  //
  // 1. **不能取 byId 的第一个**。打开的往往是空白新会话，而 kr-chat-controller
  //    对空白新会话整块不渲染右栏（判据 hasConversationContent()：官方 header
  //    在 blank 态隐藏 tablist，且对话流里没有 [data-chat-turn]）。于是齿轮不在、
  //    设置卡片没挂载，后面每条断言都报「找不到 .kr-settings」—— 看起来像本轮
  //    改动把卡片改坏了，其实是脚本选错了会话。
  // 2. **不能 openSession 完就断言**。右栏是 contentGate 通过之后才挂的，而 gate
  //    依赖 DOM 里出现 [data-chat-turn]；官方渲染是异步的。所以必须**轮询等**
  //    .kr-split__side 出现，最多 20 秒。
  //
  // 判据用会话快照里的 turnOutline / sessionStats（有轮次才有），这是 host 侧
  // 事实，不依赖当前 DOM。
  const entered = await evaluate(`(function(){
    var ctx = window.__dshClientCtx__;
    if (!ctx) return 'NO_CTX';
    var ws = ctx.get('uiWorkspace');
    if (!ws || typeof ws.openSession !== 'function') return 'NO_OPEN_SESSION';
    var s = ctx.get('sessions');
    var snap = s && s.list && s.list.getSnapshot ? s.list.getSnapshot() : (s && s.getSnapshot ? s.getSnapshot() : null);
    var byId = (snap && snap.byId) || {};
    var proj = (snap && snap.projectionsBySession) || {};
    var ids = Object.keys(byId);
    if (ids.length === 0) return 'NO_SESSIONS';
    // 有轮次的会话优先：turnOutline 非空 / sessionStats.turns > 0 / 有 title。
    function score(id) {
      var vals = (proj[id] && proj[id].values) || {};
      var n = 0;
      if (Array.isArray(vals.turnOutline)) n += vals.turnOutline.length * 10;
      var stats = vals.sessionStats;
      if (stats && typeof stats.turns === 'number') n += stats.turns * 10;
      if (typeof vals.title === 'string' && vals.title.trim() !== '') n += 1;
      return n;
    }
    var scored = ids.map(function(id){ return { id: id, n: score(id) } })
                    .sort(function(a, b){ return b.n - a.n; });
    window.__probeCandidates = scored.slice(0, 5);
    ws.openSession(scored[0].id);
    return 'opened:' + scored[0].id + ' (score=' + scored[0].n + ', candidates=' + ids.length + ')';
  })()`)
  log('enterSession=' + entered)
  // 等右栏真的长出来（contentGate 依赖 [data-chat-turn]，官方渲染是异步的）。
  // 轮询而不是固定 sleep：固定 6 秒在大会话上够、在冷启动上不够，偶发失败最难查。
  let panelReady = false
  for (let i = 0; i < 40; i += 1) {
    panelReady = await evaluate(`Boolean(document.querySelector('.kr-split__side') || document.getElementById('kr-panel-settings-btn'))`).catch(() => false)
    if (panelReady) break
    await sleep(500)
  }
  const candidates = await evaluate(`window.__probeCandidates ?? null`)
  log('panelReady=' + panelReady + ' candidates=' + JSON.stringify(candidates))
  if (!panelReady) {
    fail('打开了会话但右栏始终没渲染出来（.kr-split__side 不存在）—— 会话可能仍是空白态，hasConversationContent() 不通过；见 enterSession 的 score')
  }
  await sleep(1200)

  // ── A. 齿轮在**操作面板卡头右上角**（2026-10-25 搬家后）────────────────
  //
  // 历史：2026-10-18 这里断言「齿轮在顶栏 Seeker 标签右侧」（那时是裸 DOM 注入
  // 顶栏 tablist 的）。2026-10-25 用户要求「这两个图标都移动到操作面板的右上角
  // 去」，齿轮与邮箱搬进 SeekerHead，于是**旧的断言永久失效**（prevId 恒为 null、
  // seekerExists 恒 false）。留着它会让人误以为搬家没做成功。
  //
  // 新判据三条：
  //   · 齿轮存在且**不在**顶栏 tablist 里（搬走了）；
  //   · 它在 .kr-plain-head__tools 之内（卡头右上角那一组）；
  //   · 它的定位祖先是 .kr-plain-head（绝对定位的基准，见 styles 的注释）。
  const order = await evaluate(`(function(){
    var gear = document.getElementById('kr-panel-settings-btn');
    if (!gear) return { missing: 'kr-panel-settings-btn' };
    var head = gear.closest('.kr-plain-head');
    var tools = gear.closest('.kr-plain-head__tools');
    var inTablist = gear.closest('header [role="tablist"]') !== null;
    return {
      hasHead: head !== null,
      hasTools: tools !== null,
      inTablist: inTablist,
      gearW: Math.round(gear.getBoundingClientRect().width),
      headPos: head ? getComputedStyle(head).position : null,
    };
  })()`)
  log('ORDER=' + JSON.stringify(order))
  if (order.missing !== undefined) fail('页面上找不到齿轮 #kr-panel-settings-btn（右栏没渲染？见上一步 contentScore）')
  else if (order.inTablist) fail('齿轮仍在顶栏 tablist 里（2026-10-25 应已搬到操作面板卡头右上角）')
  else if (!order.hasTools) fail('齿轮不在 .kr-plain-head__tools 之内（没进卡头右上角那一组）')
  else if (!order.hasHead) fail('齿轮的定位祖先不是 .kr-plain-head（绝对定位会相对别处，位置漂）')
  else if (order.headPos !== 'relative') fail(`.kr-plain-head 的 position=${order.headPos}，应为 relative（右上角按钮组的定位基准）`)
  else ok(`齿轮在操作面板卡头右上角（不在顶栏 / 在 .kr-plain-head__tools 内 / 基准 relative / 宽 ${order.gearW}px）`)

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

    // 内容完整性：9 行固定设置 + 3 组 + 逐工作区列表。
    //
    // 9 = 提示词通道 4 行（中文 / 交互卡片 / 团队协作 / 邮箱）+ 任务清单 2 行
    //   （任务清单纪律 / 回合结束自动收口）+ 展示 3 行。2026-10-21「灵魂注入」那一行随
    //   灵魂模块整块删除、2026-10-23 新增 step 纪律一行（2026-10-28 换成任务清单纪律），
    //   所以是 9 不是 8 ——
    // 这个数字与 smoke-client 里 `<SettingsRow` 的计数必须同步（那处按源码推导，
    // 这里是**渲染后**的实际行数，两者互为印证：源码写了但没渲染出来同样算错）。
    // 邮箱那个三态行在 DOM 里只有一行（'不可用' 时换成分支渲染，不叠加）。
    /*
     * 行数是**渲染后**的实际行数，不是源码里 <SettingsRow> 的出现次数。
     *
     * 源码有 10 处 <SettingsRow>，但「Agent 邮箱」写了两个分支（可用 / 不可用），
     * 运行时只渲染其中一个 —— 所以卡片上恒定是 **9 行**：
     *   提示词通道 4（中文 / 交互卡片 / 团队 / 邮箱）
     *   + 展示 3（总结卡外框 / 工具调用卡 / 操作面板）
     *   + 任务清单 2（任务清单纪律 / 回合结束自动收口）
     * 这个数字与 smoke-client 里「源码 <SettingsRow> 计数 = 10」是两个不同口径，
     * 两边互为印证（源码写了但没渲染出来同样算错），但**数字本来就不相等**。
     */
    if (opened.rows !== 9) fail(`卡片里 ${opened.rows} 行固定设置，应为 9 行（源码 10 处 SettingsRow − 邮箱两分支只渲染一个）`)
    // 组数 3（2026-10-25 最终形态，2026-10-28 组名恢复「任务清单」）：提示词通道 / 展示 / 任务清单；
    // 工作区记忆是通栏区块（.kr-settings__ws-zone），不计入 group。
    // 任务清单组里的两行**没有合并成一个开关**（用户问过能不能合）：作用机理相反，
    // 一个往提示词里写约束、一个由 host 在回合结束时改清单状态，绑在一起会强迫
    // 用户做无意义的交易。归到同一组负责「看起来归一类」，不负责「共用一个开关」。
    else if (opened.groups !== 3) fail(`卡片里 ${opened.groups} 组，应为 3 组（提示词通道 + 展示 + 任务清单；工作区记忆是独立区块）`)
    else ok(`卡片内容完整：9 行固定设置 / 3 组 + 1 个独立区块（提示词通道 + 展示 + 任务清单 + 工作区记忆）`)

    // ── E1b0. 两栏平衡：**两栏**都不许空出一大块 ─────────────────────────
    //
    // 2026-10-25 实测两次反向失衡，都是这条断言该抓住的：
    //   ① 工作区记忆搬走后右栏只剩 3 行 → 右栏底部空 127px；
    //   ② 把 step 纪律也挪进右栏的「任务清单」组后 → 左栏只剩 4 行、底部空 70px，
    //      而当时只量右栏（slack=0）一路绿灯，图片里才看出来。
    // 结论：判据必须是「两栏各空多少」两个数，不能只看一栏。
    //
    // 阈值 60px ≈ 一行半：再大就是一块看得见的空白。写"差值"而不是绝对高度，
    // 字号轴缩放后不会假失败。
    const slackAside = opened.asideSlackPx
    const slackMain = opened.mainSlackPx
    log('SLACK=' + JSON.stringify({
      aside: slackAside, main: slackMain, mainRows: opened.mainRows, asideRows: opened.asideRows, colGap: opened.colGapPx,
    }))
    if (typeof slackAside !== 'number' || typeof slackMain !== 'number') {
      fail('量不到两栏底部留白（asideSlackPx / mainSlackPx 缺失）')
    } else if (slackAside > 60 || slackMain > 90) {
      /*
       * 两栏阈值**不对称**，这是刻意的（右侧更严）：
       *
       *  · 右栏 > 60px：右栏是「展示 + 任务清单」两组固定 5 行，它一空就意味着
       *    卡片右侧塌下去一块，而卡片高度是由左栏撑的 —— 视觉上非常明显。
       *  · 左栏 > 90px：左栏是「提示词通道」组，行数由**实际有几个通道**决定。
       *     2026-10-25 把 step 纪律挪进「任务清单」组之后它只剩 4 行（中文 /
       *     交互卡片 / 团队 / 邮箱），比右栏矮一行约 70px —— 这是内容真实差异，
       *     不是排版错误。为凑齐高度把语义不对的行塞回来（比如把邮箱拆出去）
       *     才是真错误：分组要跟行为一致，高度是次要的。
       *
       * 所以左栏给 90px 的容差（一行半），超过才报 —— 那样说明是真的塌了一块。
       */
      fail(`有一栏底部空太多（右 ${slackAside}px / 左 ${slackMain}px，左 ${opened.mainRows} 行 / 右 ${opened.asideRows} 行）—— 右侧容差 60px、左侧 90px`)
    } else {
      ok(`两栏平衡：右栏留白 ${slackAside}px / 左栏留白 ${slackMain}px（左 ${opened.mainRows} 行 / 右 ${opened.asideRows} 行；左右容差 60/90px 不对称，理由见断言注释）`)
    }

    // ── E1b. 工作区记忆：下方通栏独立区块（2026-10-25 用户要求）─────────
    //
    // 用户原话：「我觉得工作区记忆应该放在下方独立的空间」。
    //
    // 三条判据，缺一条就退回旧形态（而旧形态看起来「也能用」，只是挤）：
    //   · 它存在，且**不在** .kr-settings__body 之内 —— 在里面会被 body 的内边距
    //     切断极淡底色，变成悬空的内嵌面板；
    //   · 它在 DOM 顺序上晚于 body（视觉下方，不靠 order 反排）；
    //   · 它有底色（分区读得出来）且**没有**圆角/阴影（不得套卡片外框 = 卡中卡）。
    const zoneBg = await evaluate(`(function(){
      var z = document.querySelector('.kr-settings__ws-zone');
      if (!z) return null;
      var cs = getComputedStyle(z);
      return { bg: cs.backgroundColor, radius: cs.borderRadius, shadow: cs.boxShadow, borderTop: cs.borderTopWidth };
    })()`)
    log('WS_ZONE=' + JSON.stringify({ has: opened.hasWsZone, inBody: opened.zoneInBody, afterBody: opened.zoneAfterBody, style: zoneBg }))
    if (!opened.hasWsZone) {
      fail('卡片里没有 .kr-settings__ws-zone（工作区记忆没被搬成独立区块）')
    } else if (opened.zoneInBody) {
      fail('工作区记忆区块仍在 .kr-settings__body 之内（会被内边距切断底色，读成悬空的内嵌面板）')
    } else if (!opened.zoneAfterBody) {
      fail('工作区记忆区块不在 body 之后（DOM 顺序与视觉顺序不一致，靠 order 反排会在读屏里念错序）')
    } else if (zoneBg === null || zoneBg.bg === 'rgba(0, 0, 0, 0)') {
      fail(`工作区记忆区块没有底色（backgroundColor=${zoneBg && zoneBg.bg}）—— 分区读不出来，和上面两栏糊成一片`)
    } else if (zoneBg.radius !== '0px') {
      fail(`工作区记忆区块有圆角 ${zoneBg.radius} —— 设置面板里再套一层圆角容器就是卡中卡（本仓库老坑）`)
    } else if (zoneBg.shadow !== 'none') {
      fail(`工作区记忆区块有阴影 —— 只能靠底色分区，不得分层（卡中卡）`)
    } else {
      ok(`工作区记忆是下方通栏独立区块（在 body 之外、DOM 之后；底色 ${zoneBg.bg} / 无圆角 / 无阴影 / 上边线 ${zoneBg.borderTop}）`)
    }

    // ── E1c. 行排版：三列 grid + 说明封顶一行（「拥挤」的直接解药）─────────
    //
    // 这两个值就是用户抱怨的两件事的量化形态：
    //   · rowCols 是三条定宽 → 开关排成一列（flex 时它随文字长度浮动）；
    //   · hint.height ≈ 一行高（16-17px）→ 11 个开关不再各占 2-3 行说明。
    // 判据写成「值本身合理」而不是「等于某个具体 px」：字号轴会缩放，写死数字
    // 会在用户调字号后假失败。
    log('ROWS=' + JSON.stringify({ cols: opened.rowCols, hint: opened.hintLines }))
    const colCount2 = opened.rowCols === null ? 0 : opened.rowCols.split(' ').filter(s => s !== '').length
    if (colCount2 !== 3) {
      fail(`设置行算出 ${colCount2} 列（gridTemplateColumns=${opened.rowCols}），应为 3 列（标签定宽 / 说明弹性 / 开关定宽）——否则开关不对齐`)
    } else if (opened.hintLines === null) {
      fail('找不到 .kr-settings__row .kr-settings__hint（说明文字没渲染？）')
    } else if (Number(opened.hintLines.height) > 26) {
      fail(`说明行高 ${opened.hintLines.height}px 超过一行（clamp=${opened.hintLines.clamp}）—— 拥挤的根因就是说明常驻多行`)
    } else {
      ok(`行排版到位：三列 grid（${opened.rowCols}）+ 说明封顶一行（高 ${opened.hintLines.height}px / clamp=${opened.hintLines.clamp}）`)
    }

    // ── E2. 工作区列表：全部工作区 + 每行两个开关 ──────────────────────
    // 用户点名：「显示出来所有工作区每个单独进行开关，并且还需要有个开关是否排除注入」。
    // 三条：列表非空、每行两枚开关、当前工作区有「当前」标。
    const ws = await evaluate(`(function(){
      var card = document.querySelector('.kr-settings');
      if (!card) return { missing: true };
      var rows = [...card.querySelectorAll('.kr-settings__ws-row')];
      return {
        rows: rows.length,
        names: rows.map(r => (r.querySelector('.kr-settings__ws-name') || {}).textContent || ''),
        perRow: rows.map(r => r.querySelectorAll('.kr-settings__switch--mini').length),
        current: rows.filter(r => r.getAttribute('data-current') === 'true').length,
        hasPath: rows.every(r => Boolean(r.querySelector('.kr-settings__ws-path'))),
        listScrolls: (function(){
          var list = card.querySelector('.kr-settings__ws-list');
          return list ? getComputedStyle(list).overflowY : null;
        })(),
        /*
         * 名称与路径是否**同一行**（2026-10-25 用户：「这样是不是太浪费空间了」）。
         *
         * 上一版名称/路径上下叠两行，通栏 960px 下每行只用到左边 350px 却占两个
         * 文字行的高度。判据：两者 top 相差不超过 6px（同一行的正常抖动），
         * 且名称右缘到路径左缘的**空隙不超过 40px** —— 后者是「名称列固定 180px
         * 导致中间空 170px」那次的教训：只判同一行还不够，空太开同样是浪费。
         */
        geometry: rows.map(function(r){
          var n = r.querySelector('.kr-settings__ws-name');
          var p = r.querySelector('.kr-settings__ws-path');
          if (!n || !p) return null;
          var nr = n.getBoundingClientRect(), pr = p.getBoundingClientRect();
          return {
            sameLine: Math.abs(nr.top - pr.top) <= 6,
            gap: Math.round(pr.left - nr.right),
            rowH: Math.round(r.getBoundingClientRect().height),
          };
        }),
      };
    })()`)
    log('WORKSPACES=' + JSON.stringify(ws))
    if (ws.missing === true) {
      fail('卡片里没有 .kr-settings__ws-row（工作区列表没渲染）')
    } else if (ws.rows < 1) {
      fail('工作区列表是空的（本机至少有 D:\\AI\\Dsh 一个工作区）')
    } else if (!ws.perRow.every(n => n === 2)) {
      fail(`工作区行不是每行两个开关：${JSON.stringify(ws.perRow)}（应各 2 个：记录 / 不注入）`)
    } else if (ws.current !== 1) {
      fail(`「当前」标命中 ${ws.current} 行，应恰好 1 行`)
    } else if (!ws.hasPath) {
      fail('工作区行缺路径副标题（重名工作区分不开）')
    } else if (ws.listScrolls !== 'auto') {
      fail(`工作区列表 overflow-y=${ws.listScrolls}，应为 auto（工作区多了会把展示组顶出卡片）`)
    } else if (!Array.isArray(ws.geometry) || ws.geometry.some(g => g === null)) {
      fail('量不到工作区行的名称/路径几何（geometry 缺失）')
    } else if (!ws.geometry.every(g => g.sameLine)) {
      /*
       * 名称与路径必须**同一行**（2026-10-25 用户：「这样是不是太浪费空间了」）。
       *
       * 上一版它们是上下叠两行 —— 那是 390px 窄栏时代的写法，搬进 960px 通栏之后
       * 早就不需要了：每行只用到左边 350px，却占两个文字行的高度，中间还空着
       * 一大片。并排之后行高直接减半。
       */
      fail(`工作区行的名称与路径不在同一行：${JSON.stringify(ws.geometry)}（浪费一整行高度）`)
    } else if (!ws.geometry.every(g => g.gap <= 40)) {
      /*
       * 名称右缘到路径左缘的空隙不超过 40px —— 这是「名称列固定 180px 导致
       * 中间空 170px」那次的教训。只判同一行还不够：并排了但中间隔着一大片真空，
       * 同样是浪费空间。40px ≈ 一个词距，再大就是固定列宽留下的空档。
       */
      fail(`工作区行的名称与路径之间空隙过大：${JSON.stringify(ws.geometry.map(g => g.gap))}px（应是紧邻的一对，容差 40px）`)
    } else {
      ok(`工作区列表在位：${ws.rows} 个工作区，每个 2 枚开关（记录 / 不注入），当前工作区已标注；名称与路径同一行且紧邻（空隙 ${ws.geometry.map(g => g.gap).join('/')}px，行高 ${ws.geometry.map(g => g.rowH).join('/')}px）`)
    }
    // ── E3. 开关真的能拨、真的落盘 ───────────────────────────────────────
    // 光有开关不算做到位：点下去要变成 aria-checked 的反面，并且 host 侧真的改了
    // meta.json（这里直接回读 /api/dsh-memory/projects 核对，不看 UI 的乐观值）。
    // 测「不注入」而不是「记录」：它是反语义开关（开=排除），接反了 UI 与行为相反。
    const pick = await evaluate(`(function(){
      var card = document.querySelector('.kr-settings');
      if (!card) return { missing: true };
      var row = card.querySelector('.kr-settings__ws-row[data-current="true"]')
        || card.querySelector('.kr-settings__ws-row');
      if (!row) return { missing: 'row' };
      var switches = row.querySelectorAll('.kr-settings__switch--mini');
      if (switches.length !== 2) return { missing: 'switches', got: switches.length };
      return { hash: row.getAttribute('data-hash'), before: switches[1].getAttribute('aria-checked') };
    })()`)
    log('TOGGLE_BEFORE=' + JSON.stringify(pick))
    if (pick.missing !== undefined) {
      fail(`拨开关前置条件不满足：${JSON.stringify(pick)}`)
    } else if (pick.hash === null || pick.hash === '') {
      fail('工作区行缺 data-hash（e2e 没法按工作区定位开关）')
    } else {
      // 选择器整段由 Node 侧拼好再塞进页面：页面里那层不该再做模板插值。
      const rowSel = `.kr-settings__ws-row[data-hash=${JSON.stringify(pick.hash)}]`
      const clickFlag = `(function(){
        var card = document.querySelector('.kr-settings');
        var row = card.querySelector(${JSON.stringify(rowSel)});
        if (!row) return false;
        row.querySelectorAll('.kr-settings__switch--mini')[1].click();
        return true;
      })()`
      const readFlag = `(function(){
        var card = document.querySelector('.kr-settings');
        var row = card.querySelector(${JSON.stringify(rowSel)});
        var s = row ? row.querySelectorAll('.kr-settings__switch--mini')[1] : null;
        return s ? s.getAttribute('aria-checked') : null;
      })()`
      // host 侧真相：直接读 /projects，不看 UI 的乐观值。
      const hostFlag = `fetch('/api/dsh-memory/projects').then(function(r){ return r.json() }).then(function(d){
        var hit = (d.projects || []).filter(function(p){ return p.hash === ${JSON.stringify(pick.hash)} })[0];
        return hit ? hit.injectExcluded === true : null;
      })`

      const clicked = await evaluate(clickFlag)
      if (clicked !== true) fail('找不到目标工作区行，开关点不到')
      await sleep(1800)
      const after = await evaluate(readFlag)
      const hostAfter = await evaluate(hostFlag)
      log('TOGGLE_AFTER=' + JSON.stringify({ before: pick.before, after, hostAfter }))
      const wantAfter = pick.before !== 'true'
      if (after === null) fail('拨完开关后那一行找不到了（列表被重渲染成别的形状）')
      else if (after === pick.before) fail(`拨「不注入」后 aria-checked 仍是 ${after}（点击没接上写入）`)
      else if (hostAfter !== wantAfter) {
        fail(`UI 显示 ${after} 但 host 落盘的是 injectExcluded=${String(hostAfter)}（乐观更新骗了人）`)
      } else {
        ok(`「不注入」开关可拨且真落盘：UI ${pick.before} → ${after}，host injectExcluded=${String(hostAfter)}`)
      }

      // 拨回原值，别把用户的真实配置改掉。
      await evaluate(clickFlag)
      await sleep(1800)
      const restored = await evaluate(readFlag)
      const hostRestored = await evaluate(hostFlag)
      if (restored !== pick.before || hostRestored !== (pick.before === 'true')) {
        fail(`拨回原值失败：UI 期望 ${pick.before} 实得 ${restored}，host 期望 ${pick.before === 'true'} 实得 ${String(hostRestored)}（用户配置被改动了）`)
      } else {
        ok('「不注入」开关拨回原值成功（测试不污染用户配置）')
      }
    }

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
  /*
   * 只有**卡片本体**的 data-open 必须显式是 "false"（它是常驻 DOM 的模态，靠这个
   * 属性决定可见性，而 .kr-settings[data-open="false"] 就是关闭态）。
   *
   * 齿轮按钮不一样：它渲染成 `data-open={settingsOpen || undefined}`，关闭时**整个
   * 属性都不写**（getAttribute 得到 null）—— 这是布尔属性的正常惯例，样式表只按
   * `[data-open="true"]` 命中打开态即可。旧断言要求字符串 "false"，等于把实现细节
   * 当契约，2026-10-25 排查时确认这是脚本过严、不是按钮坏了。
   *
   * 真正要钉的是「关闭后按钮不再显示打开态」：aria-expanded 必须是 "false"，
   * 且 data-open 不能残留 "true"（残留会让按钮一直亮着）。
   */
  else if (btnAttr.expanded !== 'false') fail(`按钮 aria-expanded 未复位：${JSON.stringify(btnAttr)}`)
  else if (btnAttr.open === 'true') fail(`按钮 data-open 仍残留 "true"（关闭后图标一直亮着）：${JSON.stringify(btnAttr)}`)
  else ok(`再点齿轮关闭成：卡片 hidden + pointer-events:none + opacity ${afterBtn.opacity}，按钮 aria-expanded=false / data-open=${JSON.stringify(btnAttr.open)}（属性移除，非 "false"）`)

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
    /*
     * 重载后要重新打开一个**有轮次**的会话 —— 与上面 enterSession 同一个坑：
     * 取 ids[0] 往往命中空白新会话，右栏整块不渲染，齿轮就不存在。
     * 这里复用同一个打分逻辑（turnOutline 越长越优先）。
     */
    const rmOpen = await evaluate(`(function(){
      var ctx = window.__dshClientCtx__;
      var ws = ctx && ctx.get('uiWorkspace');
      var s = ctx && ctx.get('sessions');
      var snap = s && s.list && s.list.getSnapshot ? s.list.getSnapshot() : (s && s.getSnapshot ? s.getSnapshot() : null);
      var byId = (snap && snap.byId) || {};
      var proj = (snap && snap.projectionsBySession) || {};
      var ids = Object.keys(byId);
      if (!ws || ids.length === 0) return;
      function score(id) {
        var vals = (proj[id] && proj[id].values) || {};
        var n = 0;
        if (Array.isArray(vals.turnOutline)) n += vals.turnOutline.length * 10;
        var stats = vals.sessionStats;
        if (stats && typeof stats.turns === 'number') n += stats.turns * 10;
        return n;
      }
      ids.sort(function(a, b){ return score(b) - score(a); });
      ws.openSession(ids[0]);
      return 'opened:' + ids[0] + ' score=' + score(ids[0]) + ' n=' + ids.length;
    })()`)
    log('RM_OPEN=' + JSON.stringify(rmOpen))
    // 等右栏长出来（同 enterSession 的理由：contentGate 依赖异步渲染的 DOM）。
    let rmPanel = false
    for (let i = 0; i < 40; i += 1) {
      rmPanel = await evaluate(`Boolean(document.getElementById('kr-panel-settings-btn'))`).catch(() => false)
      if (rmPanel) break
      await sleep(500)
    }
    log('RM_PANEL=' + rmPanel + ' panelCount=' + await evaluate(`document.querySelectorAll('.kr-split__side').length`))
    /*
     * 拿坐标要**重试**，不能一次就判死。
     *
     * 重载后 DOM 已挂载（rmPanel=true）不等于已经布局完：headless 下首帧的
     * getBoundingClientRect 可能还是 0×0（触发条件与字体/滚动容器就绪相关）。
     * buttonCenter 对 0 尺寸返回 null，上一次就是这么误报「找不到齿轮」的 ——
     * 而它其实一秒钟后就出现了。
     */
    let rmBtn = null
    for (let i = 0; i < 20 && rmBtn === null; i += 1) {
      rmBtn = await buttonCenter('kr-panel-settings-btn')
      if (rmBtn === null) await sleep(400)
    }
    if (rmBtn === null) {
      const diag = await evaluate(`(function(){
        var g = document.getElementById('kr-panel-settings-btn');
        if (!g) return { missing: true };
        var r = g.getBoundingClientRect();
        var cs = getComputedStyle(g);
        var head = g.closest('.kr-plain-head');
        var tools = g.closest('.kr-plain-head__tools');
        var hr = head ? head.getBoundingClientRect() : null;
        var tr = tools ? tools.getBoundingClientRect() : null;
        return {
          gear: { w: Math.round(r.width), h: Math.round(r.height), disp: cs.display, vis: cs.visibility, op: cs.opacity },
          tools: tr ? { w: Math.round(tr.width), h: Math.round(tr.height) } : null,
          head: hr ? { w: Math.round(hr.width), h: Math.round(hr.height) } : null,
          panelRect: (function(){ var p = document.querySelector('.kr-split__side'); if(!p) return null; var b=p.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left) } })(),
          inDom: document.body.contains(g),
        };
      })()`)
      fail(`减弱动效重载后齿轮量不到可点坐标 —— 诊断：${JSON.stringify(diag)}`)
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
