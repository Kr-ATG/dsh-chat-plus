/**
 * 邮箱入口端到端验证（真 Chrome + 真 DSH Web，2026-10-15；2026-10-18 改卡片）。
 *
 * 为什么必须是真浏览器脚本：本轮的诉求全是「错了也不报错、只看着不对」的
 * 运行时事实 —— 按钮有没有真的插进官方标签行、顺序对不对、点了卡片开不开、
 * 退场动画有没有把内容卡在不可见态、卡片是否真的铺得下邮件面板、几何上是不是
 * **居中卡片而不是贴边的抽屉**。源码正则断言（smoke-client.mjs）只能证明代码
 * 写了什么，证明不了浏览器里发生了什么。
 *
 * 判据：
 *   A. 顶栏三件套顺序：Seeker 标签 → 大盘设置齿轮 → 邮箱按钮（用户点名的位置）；
 *   B. 邮箱按钮 hover 有视觉反馈（用户偏好动效，静态按钮不算做到位）；
 *   C. 真实鼠标点它 → 卡片 data-open=true、可见（visibility/opacity 到位）、
 *      宽 ≥ 900px、**四周都露着遮罩**（上下左右都能点到外面，点外面关闭这条
 *      通路还得留着）、左右留白大致相等（用户要的是居中卡片，不是贴边抽屉）；
 *   D. 卡片里真的渲染了邮件面板（文件夹导航 + 列表容器），不是空壳；
 *   E. 卡片内**没有任何写操作 UI**（写邮件入口 / 写信容器 / 危险按钮），
 *      本轮「邮箱只做查看」的判据本身；
 *   F. 三条关闭通路都通：再点按钮（DOM 通路，理由见下）、Esc、点遮罩；
 *   G. 截图存档，且截前在 DOM 层把真实邮箱地址与本地用户路径脱敏。
 *
 * 环境与凭据：带令牌的 DSH Web 地址从环境变量 `DSH_WEB_AUTH_URL` 读
 * （**不把 token 写进脚本**）；环境变量缺失时回退到 DSH_HOME 下的
 * web-auth-url.json（同样不含硬编码 token）。
 *
 * 用法：node scripts/test-mail-drawer.mjs
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
  console.log('SKIP  mail-drawer e2e — 未找到 Chrome（本机开发请装 Chrome，否则这条等于没测）')
  process.exit(0)
}

const OUT_DIR = 'D:/AI/Dsh/_tmp'
const SHOT = `${OUT_DIR}/mail-card-open.png`
const RESULT = `${OUT_DIR}/mail-card-e2e-result.txt`
/**
 * 每次跑都用独立端口 + 独立 user-data-dir。
 *
 * 不能借默认 profile：本机常年开着真 Chrome，第二个进程只是把 URL 转交给已在跑的
 * 实例、调试端口根本不会打开（表现为「等 60s 应用没就绪」），而且会污染用户的
 * 真实浏览器配置。端口按 pid 偏移，避免两次并发/上次残留的进程抢同一端口。
 */
const PORT = 9400 + (process.pid % 300)
const PROFILE = mkdtempSync(resolve(tmpdir(), 'dsh-mail-drawer-'))

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
  console.log('SKIP  mail-drawer e2e — 读不到 DSH Web 带令牌地址（设 DSH_WEB_AUTH_URL，或让 DSH 写出 web-auth-url.json）')
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

/** 邮箱卡片的当前状态快照（几何 + 可见性 + 内容）。 */
const DRAWER_STATE = `(function(){
  var d = document.querySelector('.kr-mail-drawer');
  var s = document.querySelector('.kr-mail-drawer__scrim');
  if (!d || !s) return { missing: true };
  var db = d.getBoundingClientRect(), cb = getComputedStyle(d);
  var navItems = d.querySelectorAll('.dsh-mail-nav-item').length;
  return {
    open: d.getAttribute('data-open'),
    // 关闭态**必须**没有 aria-modal="true"：官方快捷键服务用
    // querySelectorAll('[role="dialog"][aria-modal="true"], [role="menu"]') 判断
    // 「当前是否处于模态」，且不看可见性。常驻 DOM 的卡片写死 aria-modal="true"
    // 会把整个应用的官方快捷键全部吞掉（2026-10-16 实测根因）。
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
    navItems: navItems,
    listRows: d.querySelectorAll('.dsh-mail-row').length,
    listScroll: d.querySelectorAll('.dsh-mail-list-scroll').length,
    hasPanel: d.querySelectorAll('.dsh-mail-panel').length,
    bodyBlocks: d.querySelectorAll('.kr-mail-drawer__body').length,
    composeBlocks: d.querySelectorAll('.dsh-mail-composer, .dsh-mail-composer-row, .dsh-mail-composer-foot').length,
    dangerButtons: d.querySelectorAll('.dsh-mail-btn-danger').length,
    writeText: (function(){
      var t = d.textContent || '';
      var hits = 0;
      ['写邮件', '写信', '回复', '转发', '永久删除', '移入回收站'].forEach(function(k){ if (t.indexOf(k) >= 0) hits++; });
      return hits;
    })(),
  };
})()`

async function main() {
  const lines = []
  const log = (s) => { lines.push(s); console.log(s) }
  const ok = (s) => log('ok   ' + s)
  const fail = (s) => { lines.push('FAIL ' + s); console.log('FAIL ' + s); process.exitCode = 1 }

  // ── 起 Chrome、连 CDP ───────────────────────────────────────────────────
  let page = null
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) break
    } catch { /* 还没起来 */ }
    await sleep(500)
  }
  await sleep(1200)
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  page = targets.find((t) => t.type === 'page')
  if (page === undefined) throw new Error('没有可用的 page target')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Page.enable')
  await send('Runtime.enable')

  // ── 等应用就绪 ─────────────────────────────────────────────────────────
  // 分两轮：先等 client 模块表加载，再等会话壳渲染。任何一轮失败都**重试导航**
  // 一次 —— 带令牌地址首次进入要种 cookie，偶发竞态下白屏是真实存在的一档。
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

  // ── 进入一个**有轮次**的会话，并等右栏长出来 ────────────────────────────
  //
  // ⚠ 两个坑（2026-10-25 与 test-settings-card 同一轮踩到）：
  //  1. 不能按下标或标题挑会话：打开的往往是空白新会话，而 kr-chat-controller
  //     对空白新会话整块不渲染右栏（hasConversationContent() 不通过），齿轮/邮箱
  //     都是右栏卡头里渲染的，于是「顶栏找不到邮箱按钮」。按标题匹配也脆 ——
  //     会话标题是模型生成的一句话，改个说法就匹配不上。
  //  2. openSession 是异步生效的，不能 sleep 完就断言：右栏挂载依赖对话流里出现
  //     [data-chat-turn]，那是官方异步渲染的。必须轮询等。
  //
  // 判据用 host 侧事实（turnOutline / sessionStats.turns），不依赖 DOM。
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
  log('enterSession=' + entered)
  let panelOk = false
  for (let i = 0; i < 40; i += 1) {
    panelOk = await evaluate(`Boolean(document.querySelector('.kr-split__side') && document.getElementById('kr-mail-btn'))`).catch(() => false)
    if (panelOk) break
    await sleep(500)
  }
  log('panelReady=' + panelOk)
  if (!panelOk) {
    fail('打开了会话但右栏（含卡头邮箱按钮）始终没渲染出来 —— 会话可能仍是空白态')
  }
  await sleep(1200)

  // ── A. 顶栏三件套顺序 ──────────────────────────────────────────────────
  const order = await evaluate(`(function(){
    var mail = document.getElementById('kr-mail-btn');
    var gear = document.getElementById('kr-panel-settings-btn');
    var seeker = document.getElementById('kr-chat-tab-btn');
    if (!mail) return { missing: 'kr-mail-btn' };
    if (!gear) return { missing: 'kr-panel-settings-btn' };
    return {
      mailTag: mail.tagName,
      mailTitle: mail.title,
      mailAria: mail.getAttribute('aria-label'),
      mailHasSvg: mail.querySelectorAll('svg').length,
      mailClass: mail.className,
      // 搬家后的真实关系：同一个 .kr-plain-head__tools 里的兄弟，齿轮在前。
      gearInTools: gear.closest('.kr-plain-head__tools') !== null,
      mailInTools: mail.closest('.kr-plain-head__tools') !== null,
      gearInTablist: gear.closest('header [role="tablist"]') !== null,
      mailInTablist: mail.closest('header [role="tablist"]') !== null,
      mailPrevId: mail.previousElementSibling ? mail.previousElementSibling.id : null,
      seekerExists: Boolean(seeker),
      gearMarginLeft: getComputedStyle(gear).marginLeft,
      mailMarginLeft: getComputedStyle(mail).marginLeft,
      gearW: Math.round(gear.getBoundingClientRect().width),
      mailW: Math.round(mail.getBoundingClientRect().width),
      gearBg: getComputedStyle(gear).backgroundColor,
      mailBg: getComputedStyle(mail).backgroundColor,
      gearColor: getComputedStyle(gear).color,
      mailColor: getComputedStyle(mail).color,
      gap: Math.round(mail.getBoundingClientRect().left - gear.getBoundingClientRect().right),
    };
  })()`)
  log('ORDER=' + JSON.stringify(order))
  /*
   * 2026-10-25 判据整体换了：两枚按钮从**顶栏 tablist**（Seeker 标签右侧）搬进了
   * **操作面板卡头右上角**的 .kr-plain-head__tools 里。
   *
   * 旧断言（prevId === 'kr-panel-settings-btn' 且 prevPrevId === 'kr-chat-tab-btn'）
   * 在那次搬家之后就永久失效了 —— 它检查的是「顶栏里的兄弟顺序」，而按钮已经不在
   * 顶栏里。留着它只会让人以为搬家没做成功。
   *
   * 新判据钉的是搬家后的真实契约：
   *   · 两枚都在 .kr-plain-head__tools 之内（卡头右上角那一组）；
   *   · 顺序是 齿轮 → 邮箱（用 nextElementSibling，仍是同一个父节点下的兄弟关系）；
   *   · 都不在顶栏 tablist 里（搬干净了，没留残影）；
   *   · 同尺寸同配色（并排读成一对）；
   *   · 视觉间距够小（同组 flex gap 2px，实测 ~2px）。
   */
  if (order.missing !== undefined) {
    fail(`右栏卡头找不到按钮 #${order.missing}（右栏没渲染？看上面的 panelReady）`)
  } else if (!order.gearInTools || !order.mailInTools) {
    fail(`按钮不在 .kr-plain-head__tools 里（齿轮 ${order.gearInTools} / 邮箱 ${order.mailInTools}）—— 没搬进卡头右上角`)
  } else if (order.gearInTablist || order.mailInTablist) {
    fail(`按钮仍在顶栏 tablist 里（齿轮 ${order.gearInTablist} / 邮箱 ${order.mailInTablist}）—— 搬家没做干净，会与卡头那组重复 id`)
  } else if (order.mailPrevId !== 'kr-panel-settings-btn') {
    fail(`邮箱前面的兄弟是 ${order.mailPrevId}，应为 kr-panel-settings-btn（顺序必须是 齿轮 → 邮箱）`)
  } else if (order.mailHasSvg !== 1) {
    fail(`邮箱按钮的图标应为 1 个内联 SVG，实得 ${order.mailHasSvg}`)
  } else if (order.mailAria !== '邮箱') {
    fail(`邮箱按钮 aria-label 应为「邮箱」，实得 ${order.mailAria}`)
  } else if (order.gap === null || order.gap > 8) {
    fail(`齿轮与邮箱按钮的视觉间距 ${order.gap}px 太大（应并排读成一对）`)
  } else if (order.gearW !== order.mailW) {
    fail(`两枚按钮尺寸不一致（齿轮 ${order.gearW}px / 邮箱 ${order.mailW}px），并排看不出是一对`)
  } else if (order.gearBg !== order.mailBg || order.gearColor !== order.mailColor) {
    fail(`两枚按钮常态配色不一致（齿轮 ${order.gearBg}/${order.gearColor}，邮箱 ${order.mailBg}/${order.mailColor}）`)
  } else {
    ok(`卡头右上角：齿轮 → 邮箱 并排（间距 ${order.gap}px，同尺寸 ${order.gearW}px，同配色，都不在顶栏）`)
  }

  // ── B. hover 反馈（用户偏好的微交互）───────────────────────────────────
  const baseBg = await evaluate(`getComputedStyle(document.getElementById('kr-mail-btn')).backgroundColor`)
  const center = await buttonCenter('kr-mail-btn')
  if (center === null) {
    fail('拿不到邮箱按钮坐标（按钮不可见？）')
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y, buttons: 0 })
    await sleep(400)
    const hover = await evaluate(`(function(){
      var el = document.getElementById('kr-mail-btn');
      return { hovered: el.matches(':hover'), bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color };
    })()`)
    if (!hover.hovered) fail('mouseMoved 未让邮箱按钮进入 :hover（本断言前提失效）')
    else if (hover.bg === baseBg) fail(`悬停后按钮底色未变（${baseBg}），hover 反馈缺失（用户要求带动效/微交互）`)
    else ok(`邮箱按钮 hover 反馈在位：底色 ${baseBg} → ${hover.bg}`)
    // 移开，别让 hover 态干扰后续断言
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400, buttons: 0 })
    await sleep(250)
  }

  // ── C. 真实鼠标点按钮 → 打开卡片 ───────────────────────────────────────
  const before = await evaluate(DRAWER_STATE)
  if (before.missing !== true && before.open === 'true') fail('卡片初始就已打开（state 泄漏）')
  const clickPt = await buttonCenter('kr-mail-btn')
  if (clickPt !== null) await realClick(clickPt.x, clickPt.y)
  await sleep(2600)

  const opened = await evaluate(DRAWER_STATE)
  log('OPEN=' + JSON.stringify(opened))
  if (opened.missing === true) {
    fail('页面上没有 .kr-mail-drawer / .kr-mail-drawer__scrim（卡片没挂上 body）')
  } else {
    if (opened.open !== 'true') fail('点按钮后卡片 data-open 不是 true')
    else if (opened.visibility !== 'visible' || opened.opacity < 0.99) {
      fail(`卡片 data-open=true 但不可见（visibility=${opened.visibility} opacity=${opened.opacity}）——可见性依赖了动画末帧`)
    } else if (opened.pointerEvents !== 'auto') {
      fail(`卡片打开后 pointer-events=${opened.pointerEvents}，面板点不动`)
    } else {
      ok(`点按钮后卡片打开且可见（visibility=visible / opacity=${opened.opacity} / pointer-events=auto）`)
    }
    // 宽度 ≥ 900px：用户要的是「弹卡片」而不是「细长抽屉」，同时这也是邮件面板
    // 能排三栏（@container >620px）的前提 —— 卡在 420px 那档说明外壳又退回抽屉了。
    if (opened.width < 900) fail(`卡片宽度 ${opened.width}px < 900px（还是抽屉那套窄几何，邮件面板只能退化成单栏）`)
    else ok(`卡片宽度 ${opened.width}px × 高度 ${opened.height}px（视口 ${opened.viewportW}×${opened.viewportH}）`)
    // 居中：左右留白差 ≤ 4px（子像素取整允许 1px 抖动，4px 是「看起来就是居中」的余量）。
    const gapLeft = opened.left - opened.scrimLeft
    const gapRight = opened.viewportW - opened.right
    if (gapLeft <= 0 || gapRight <= 0) {
      fail(`卡片没有落在视口内：左留白 ${gapLeft}px / 右留白 ${gapRight}px（贴边就不是弹卡片了）`)
    } else if (Math.abs(gapLeft - gapRight) > 4) {
      fail(`卡片不居中：左留白 ${gapLeft}px vs 右留白 ${gapRight}px（差 ${Math.abs(gapLeft - gapRight)}px）`)
    } else {
      ok(`卡片水平居中：左右留白各约 ${gapLeft}px / ${gapRight}px`)
    }
    // 上下也必须露出遮罩：全高浮层是抽屉的形态，卡片要「浮在页面中间」。
    if (opened.top <= 0 || opened.bottom >= opened.viewportH) {
      fail(`卡片纵向贴边（top=${opened.top} bottom=${opened.bottom} 视口高=${opened.viewportH}）——这是抽屉的几何，不是卡片`)
    } else {
      ok(`卡片纵向浮起：上留白 ${opened.top}px / 下留白 ${opened.viewportH - opened.bottom}px（点外面关闭这条通路还在）`)
    }

    // ── D. 卡片里真的渲染了邮件面板 ─────────────────────────────────────
    if (opened.hasPanel !== 1) fail(`卡片内没有 .dsh-mail-panel（实得 ${opened.hasPanel}）`)
    else if (opened.navItems < 3) fail(`卡片内邮件文件夹导航只有 ${opened.navItems} 项（应有收件箱/已发送/回收站/垃圾邮件）`)
    else if (opened.listScroll < 1) fail('卡片内没有邮件列表容器（.dsh-mail-list-scroll）')
    else ok(`卡片内邮件面板已渲染：文件夹 ${opened.navItems} 项 + 列表容器 ${opened.listScroll} 个 + 列表行 ${opened.listRows} 条`)

    // ── D2. 宽卡片下邮件面板排三栏（卡片化换来的真收益，退化了要能发现）─────
    // 面板的 @container 阈值是 620px：宽度过了就三栏并排，没过就退化成移动端
    // 单栏（列表 ↔ 详情来回切）。卡片给到 1080px 就是为了过这条线。
    const threeCol = await evaluate(`(function(){
      var panel = document.querySelector('.kr-mail-drawer .dsh-mail-panel');
      if (!panel) return { missing: true };
      var body = panel.querySelector('.dsh-mail-body');
      var sidebar = panel.querySelector('.dsh-mail-sidebar');
      if (!body || !sidebar) return { missing: 'body/sidebar' };
      var bs = getComputedStyle(body), ss = getComputedStyle(sidebar);
      var sr = sidebar.getBoundingClientRect();
      var pr = panel.getBoundingClientRect();
      return {
        panelWidth: Math.round(pr.width),
        bodyDirection: bs.flexDirection,
        sidebarWidth: Math.round(sr.width),
        // 窄栏范式下文件夹会改成横向滚动的横条（宽度撑满、高度 40 上下）；
        // 三栏范式下它是固定宽度的竖列（~132px）。
        sidebarIsColumn: ss.flexDirection === 'column' && sr.width > 60 && sr.width < 220,
      };
    })()`)
    log('THREE_COL=' + JSON.stringify(threeCol))
    if (threeCol.missing !== undefined) {
      fail(`三栏断言取不到面板结构：${JSON.stringify(threeCol)}`)
    } else if (threeCol.bodyDirection !== 'row' || !threeCol.sidebarIsColumn) {
      fail(`卡片宽 ${threeCol.panelWidth}px 下邮件面板仍是窄栏范式（body=${threeCol.bodyDirection} 文件夹宽 ${threeCol.sidebarWidth}px）—— 卡片化没换来三栏`)
    } else {
      ok(`卡片宽 ${threeCol.panelWidth}px 下邮件面板排三栏（文件夹竖列 ${threeCol.sidebarWidth}px + 列表 + 正文）`)
    }

    // ── E. 没有写操作 UI ────────────────────────────────────────────────
    if (opened.composeBlocks !== 0) fail(`卡片内仍存在写信容器（.dsh-mail-composer* × ${opened.composeBlocks}）`)
    else if (opened.dangerButtons !== 0) fail(`卡片内仍存在危险操作按钮（.dsh-mail-btn-danger × ${opened.dangerButtons}）`)
    else if (opened.writeText !== 0) fail(`卡片内文案仍出现写操作字样（命中 ${opened.writeText} 类：写邮件/写信/回复/转发/永久删除/移入回收站）`)
    else ok('卡片内不存在任何写操作 UI（写信容器 0 / 危险按钮 0 / 写操作文案 0）')
  }

  // ── G. 截图（截前脱敏）──────────────────────────────────────────────
  // 脱敏范围 = 卡片 + 顶栏 chrome（邮箱地址、本机用户路径最可能出现的两处）。
  // 刻意不遍历对话正文：那里的文本归官方 React 管，改写它既越界也会被下一次
  // 渲染冲掉；两处 chrome 已覆盖本次截图里所有可信的敏感面。
  const scrubbed = await evaluate(`(function(){
    var EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g;
    var USERPATH = /[A-Za-z]:\\\\\\\\Users\\\\\\\\[^\\\\\\\\\\s]+/g;
    var roots = [document.querySelector('.kr-mail-drawer'), document.querySelector('header')].filter(Boolean);
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

  // ── F1. 再点按钮 → 关闭（DOM 通路）─────────────────────────────────────
  // 卡片打开时遮罩铺满视口，**真实坐标点击按钮位置命中的是遮罩**（结果同样是
  // 关闭，但走的是「点遮罩」那条通路）。要单独验证按钮自身的 toggle 通路，
  // 这里用 DOM click 直接派发到按钮上。
  await evaluate(`document.getElementById('kr-mail-btn').click(); 'clicked'`)
  await sleep(700)
  const afterBtn = await evaluate(DRAWER_STATE)
  const btnAttr = await evaluate(`(function(){
    var b = document.getElementById('kr-mail-btn');
    return { open: b.getAttribute('data-open'), expanded: b.getAttribute('aria-expanded') };
  })()`)
  log('CLOSE_BTN=' + JSON.stringify({ ...afterBtn, btn: btnAttr }))
  if (afterBtn.open !== 'false') fail('再点邮箱按钮后卡片没关（store 与按钮没接上）')
  else if (afterBtn.visibility !== 'hidden' || afterBtn.pointerEvents !== 'none') {
    fail(`卡片关闭后仍可见或仍拦点击（visibility=${afterBtn.visibility} pointer-events=${afterBtn.pointerEvents}）`)
  } else if (afterBtn.opacity > 0.02) fail(`卡片关闭后 opacity 仍有 ${afterBtn.opacity}（退场没走完 / 可见性依赖动画）`)
  /*
   * 按钮渲染成 `data-open={open || undefined}`，关闭时**属性整个不写**（getAttribute
   * 得到 null），不是字符串 "false"。旧断言要求 "false"，是把实现细节当契约
   * （2026-10-25 与 test-settings-card 同一处确认）。真正要钉的是「关掉之后按钮
   * 不再显示打开态」：aria-expanded 必须是 "false"，data-open 不能残留 "true"。
   */
  else if (btnAttr.expanded !== 'false') fail(`按钮 aria-expanded 未复位：${JSON.stringify(btnAttr)}`)
  else if (btnAttr.open === 'true') fail(`按钮 data-open 仍残留 "true"（关闭后图标一直亮着）：${JSON.stringify(btnAttr)}`)
  else ok(`再点按钮关闭成：卡片 hidden + pointer-events:none + opacity ${afterBtn.opacity}，按钮 aria-expanded=false / data-open=${JSON.stringify(btnAttr.open)}（属性移除，非 "false"）`)

  // ── F2. Esc → 关闭 ────────────────────────────────────────────────────
  await evaluate(`document.getElementById('kr-mail-btn').click(); 'open'`)
  await sleep(900)
  const reopened = await evaluate(DRAWER_STATE)
  if (reopened.open !== 'true') fail('第二次打开失败（Esc 通路无法验证）')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(700)
  const afterEsc = await evaluate(DRAWER_STATE)
  if (afterEsc.open !== 'false') fail('按 Esc 没关掉邮箱卡片')
  else ok('Esc 关闭通路可用')

  // ── F3. 点遮罩 → 关闭（真实鼠标）─────────────────────────────────────
  await evaluate(`document.getElementById('kr-mail-btn').click(); 'open'`)
  await sleep(900)
  const forScrim = await evaluate(DRAWER_STATE)
  if (forScrim.open !== 'true') fail('第三次打开失败（点遮罩通路无法验证）')
  // 点卡片左侧的留白区（居中卡片两侧都有遮罩，取左留白中点）。
  const scrimX = Math.max(8, Math.round((forScrim.scrimLeft + forScrim.left) / 2))
  await realClick(scrimX, Math.round(500))
  await sleep(700)
  const afterScrim = await evaluate(DRAWER_STATE)
  if (afterScrim.open !== 'false') fail(`点遮罩（x=${scrimX}）没关掉卡片`)
  else ok(`点遮罩关闭通路可用（点 x=${scrimX}，落在卡片左侧可点区）`)

  // ── 卡片关着时不该拦页面交互 ─────────────────────────────────────────
  const idle = await evaluate(DRAWER_STATE)
  if (idle.open === 'false' && (idle.scrimPE !== 'none' || idle.pointerEvents !== 'none')) {
    fail(`卡片关着时仍在拦指针（scrim=${idle.scrimPE} card=${idle.pointerEvents}）——页面上会点不动任何东西`)
  } else {
    ok('卡片关闭态不拦指针（scrim/card 都是 pointer-events:none）')
  }

  // ── 关闭态不得污染官方快捷键 ─────────────────────────────────────────
  // 官方快捷键服务的模态判定是纯 DOM 查询、不看可见性（见 DRAWER_STATE 的注释）。
  // 卡片 DOM 常驻，所以关闭时必须有**零个** aria-modal="true" 的元素是自己贡献的；
  // 打开时才允许出现（此时它确实是模态，吞掉快捷键是正确行为）。
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
        if (el.className && String(el.className).indexOf('kr-mail-drawer') >= 0) hit.push(String(el.className));
      }
      return hit;
    })()`)
    if (Array.isArray(modalCount) && modalCount.length > 0) {
      fail(`关闭态下选择器仍命中卡片：${JSON.stringify(modalCount)}`)
    } else {
      ok('关闭态下官方模态选择器命中卡片数 = 0')
    }
  }

  // ── I. 邮箱卡片与设置抽屉各自独立开合（「不复用设置那份 store」的判据本身）──
  // 只查**按钮上的属性**（由各自 store 驱动），不依赖设置抽屉本体是否挂载 ——
  // KrPanelSettings 由另一条链路装配，别把它的在途改动绑进这条断言。
  //
  // ⚠ 必须**一次点击一次读**，中间让出一拍（下面的 sleep 80）。
  //
  // 旧写法是在页面里一口气 click → 读 → click → 读，全在同一个 task 里跑完。
  // React 18 的自动批处理会把这些 setState 攒到 task 结束才渲染，于是每次
  // getAttribute 读到的都还是**上一帧**的值 —— 实测拿到 {"gear":null,"mail":null}，
  // 看起来像"两个 store 共用了"，实际上是读得太早。这不是产品 bug，是断言的坑。
  //
  // 读值也统一用 `=== 'true'`：关闭态属性不存在（null），见下面那段说明。
  const readBtnPair = () => evaluate(`(function(){
    var gear = document.getElementById('kr-panel-settings-btn');
    var mail = document.getElementById('kr-mail-btn');
    if (!gear || !mail) return { missing: true };
    return { gear: gear.getAttribute('data-open'), mail: mail.getAttribute('data-open') };
  })()`)
  const clickBtn = (id) => evaluate(`(function(){
    var b = document.getElementById('${id}');
    if (!b) return false;
    b.click();
    return true;
  })()`)
  const independence = {}
  // 先确保都关着（若开着就点一下关掉，然后等一拍）。
  {
    const now = await readBtnPair()
    if (now.missing !== true) {
      if (now.gear === 'true') { await clickBtn('kr-panel-settings-btn'); await sleep(80) }
      if (now.mail === 'true') { await clickBtn('kr-mail-btn'); await sleep(80) }
    }
  }
  independence.start = await readBtnPair()
  await clickBtn('kr-panel-settings-btn'); await sleep(80)
  independence.afterGear = await readBtnPair()
  await clickBtn('kr-mail-btn'); await sleep(80)
  independence.afterMail = await readBtnPair()
  await clickBtn('kr-mail-btn'); await sleep(80)
  independence.afterMailClose = await readBtnPair()
  await clickBtn('kr-panel-settings-btn'); await sleep(80)
  independence.afterGearClose = await readBtnPair()
  log('INDEPENDENCE=' + JSON.stringify(independence))
  /*
   * ⚠ 判据全用 `=== 'true'` / `!== 'true'`，**不能**拿 'false' 比。
   *
   * 两枚按钮都渲染成 `data-open={open || undefined}`：关闭时属性整个不存在
   * （getAttribute 返回 null），不是字符串 "false"。旧断言写 `!== 'false'`，
   * 在关闭态下必然为真，于是「打开大盘设置把邮箱也带开了」这条恒假失败 ——
   * 2026-10-25 确认是断言写错了，不是两个 store 真的共用。
   *
   * 要钉的事实不变：两个 store 各自独立，打开其中一个不动另一个。
   */
  if (independence.missing === true) {
    fail('拿不到两枚按钮（邮箱 / 大盘设置，独立开合断言无法进行）')
  } else if (independence.afterGear.mail === 'true') {
    fail('打开大盘设置把邮箱卡片也带开了（两个 store 被共用）')
  } else if (independence.afterMail.gear !== 'true' || independence.afterMail.mail !== 'true') {
    fail(`打开邮箱时两枚按钮状态不对：${JSON.stringify(independence.afterMail)}（应各自独立）`)
  } else if (independence.afterMailClose.gear !== 'true') {
    fail('关闭邮箱把大盘设置一起关了（两个 store 被共用）')
  } else if (independence.afterGearClose.gear === 'true') {
    fail('再点齿轮没关掉设置抽屉')
  } else {
    ok('邮箱卡片与设置抽屉各自独立开合：开邮箱不动设置、关邮箱不关设置、各自单点可关')
  }

  // ── H. prefers-reduced-motion：内容必须完整可见（任务硬要求）────────────
  // 用户偏好动效，但减弱动效下不能靠动画末帧把内容显出来。CDP 直接模拟该媒体特性，
  // 然后**刷新页面**重走一遍「打开」—— 只改媒体查询不重挂样式表的话，测的是上一份
  // 已经算好的 computed style。
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
    // 重载后同样要挑**有轮次**的会话（取 ids[0] 常命中空白新会话，右栏不渲染，
    // 邮箱按钮就不存在 —— 与 enterSession 同一个坑，见那里的注释）。
    await evaluate(`(function(){
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
    })()`)
    // 等右栏与卡头按钮出现，并拿到可点坐标（重载后首帧尺寸可能还是 0）。
    for (let i = 0; i < 40; i += 1) {
      if (await evaluate(`Boolean(document.getElementById('kr-mail-btn'))`).catch(() => false)) break
      await sleep(500)
    }
    await sleep(4000)
    const rmBtn = await buttonCenter('kr-mail-btn')
    if (rmBtn === null) {
      fail('减弱动效重载后顶栏找不到邮箱按钮')
    } else {
      await realClick(rmBtn.x, rmBtn.y)
      await sleep(900)
      const rm = await evaluate(DRAWER_STATE)
      log('REDUCED_MOTION=' + JSON.stringify(rm))
      const mediaMatches = await evaluate(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`)
      const animName = await evaluate(`(function(){
        var b = document.querySelector('.kr-mail-drawer__body');
        return b ? getComputedStyle(b).animationName : null;
      })()`)
      if (!mediaMatches) fail('CDP 没能模拟出 prefers-reduced-motion（本断言前提失效）')
      else if (rm.open !== 'true') fail('减弱动效下卡片打不开')
      else if (rm.visibility !== 'visible' || rm.opacity < 0.99) {
        fail(`减弱动效下卡片不可见（visibility=${rm.visibility} opacity=${rm.opacity}）——可见性依赖了动画末帧`)
      } else if (rm.pointerEvents !== 'auto') {
        fail(`减弱动效下卡片 pointer-events=${rm.pointerEvents}，内容看得见却点不动`)
      } else if (rm.hasPanel !== 1 || rm.navItems < 3 || rm.listScroll < 1) {
        fail(`减弱动效下面板内容不完整（panel=${rm.hasPanel} 文件夹=${rm.navItems} 列表容器=${rm.listScroll}）`)
      } else if (animName !== null && animName !== 'none') {
        fail(`减弱动效下卡片内容仍有动画（animation-name=${animName}）`)
      } else if (Math.abs((rm.left - rm.scrimLeft) - (rm.viewportW - rm.right)) > 4) {
        // 减弱动效下最容易踩的坑：把 transform 整体抹掉会连居中一起抹掉，
        // 卡片会贴到视口右下角去。这条断言就是钉住它。
        fail(`减弱动效下卡片没有居中（左留白 ${rm.left - rm.scrimLeft}px / 右留白 ${rm.viewportW - rm.right}px）——transform 被整体归零了`)
      } else {
        ok(`减弱动效下内容完整可见且居中：opacity=${rm.opacity} / pointer-events=auto / 面板与文件夹导航齐 / animation-name=${animName}`)
      }
      // 关掉，恢复现场。
      await evaluate(`document.getElementById('kr-mail-btn').click(); 'close'`)
      await sleep(300)
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] })

  const passed = process.exitCode !== 1
  console.log('\n=== ' + (passed ? 'MAIL CARD E2E PASSED' : 'MAIL CARD E2E FAILED') + ' ===')
  lines.push('', '=== ' + (passed ? 'MAIL CARD E2E PASSED' : 'MAIL CARD E2E FAILED') + ' ===')
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
