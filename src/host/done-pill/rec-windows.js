/**
 * dsh-chat-plus — 录屏窗口枚举（host 半身，done-pill 模块）。
 *
 * 为什么需要它：Electron 壳的 renderer 既没有屏幕/窗口选择器（getDisplayMedia
 * 直接 NotSupportedError），也**抓不到单个窗口**——实测 Electron 33 / Win11：
 * `getUserMedia({chromeMediaSource:'desktop', chromeMediaSourceId:'window:<hwnd>:0'})`
 * 与 `setDisplayMediaRequestHandler` + `desktopCapturer.getSources({types:['window']})`
 * 两条路对**任何**窗口源都回 `NotReadableError: Could not start video source`
 * （screen: 源正常，禁 WGC / 换 GDI / 关 GPU 都一样）。所以窗口录制不能靠
 * Chromium 的窗口捕获，改由本模块在 host 侧枚举窗口树、由 rec-capture.js 用
 * PrintWindow 直接抓窗口内容（免遮挡，见该文件）。
 *
 * 实现：win32 走一次 powershell（Add-Type 调 user32 的 EnumWindows /
 * EnumChildWindows / GetWindowRect）。五个实测坑（改前必读）：
 *  1. 回调必须是自定义 delegate——Func<,,> 泛型非 blittable，P/Invoke 抛
 *     marshalling 异常；
 *  2. C# 源码不能用 here-string 传（多行 -Command 链路会把终止符吃掉），
 *     也不能用 out var / 字符串插值（Add-Type 的编译器是 C#5）；
 *  3. 传参走 -EncodedCommand（UTF-16LE base64），引号地狱一次清零；
 *  4. **输出同样走 base64(UTF-8)**：powershell 的 stdout 走系统 OEM 码页
 *     （中文机是 GBK），直接读字符串中文标题必花成菱形问号；base64 是纯
 *     ASCII，码页怎么折腾都不受影响，Node 侧解回 UTF-8。
 *  5. **子窗口要靠 EnumChildWindows 显式枚举**：EnumWindows 只给顶层窗，
 *     而「窗口里的子窗口」正是用户要单独录制的对象（多文档界面、播放器画面
 *     区、编辑器视图……）。子窗口的顶层归属用 GetAncestor(GA_ROOT) 算，
 *     不能用 GetParent——它只走一级，多级嵌套会认错根。
 * POSIX 直接返回空列表（选择面板退化为只有「整屏」）。结果缓存 2s。
 *
 * 路由：GET /api/dsh-companion/rec-windows → { ok, windows: [{hwnd,pid,title,cls,
 *       x,y,w,h,parentHwnd,depth}] }
 */
import { execFile } from 'node:child_process'

const ROUTE = '/api/dsh-companion/rec-windows'
/** 枚举结果缓存 TTL（ms）。 */
const CACHE_MS = 2000
/** powershell 超时（ms）：枚举本身 ~300ms（带子窗口略多），超时按空列表降级。 */
const PS_TIMEOUT_MS = 5000

/** user32 枚举器脚本（win32 专用；单行 JSON 转义存储，运行时 base64 传参）。 */
const PS_SCRIPT = "$cs = \"using System;`nusing System.Collections.Generic;`nusing System.Runtime.InteropServices;`nusing System.Text;`npublic class WinLister {`n  public delegate bool EnumProc(IntPtr h, IntPtr lp);`n  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }`n  [DllImport(`\"user32.dll`\")] static extern bool EnumWindows(EnumProc cb, IntPtr lp);`n  [DllImport(`\"user32.dll`\")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lp);`n  [DllImport(`\"user32.dll`\")] static extern bool IsWindowVisible(IntPtr h);`n  [DllImport(`\"user32.dll`\")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);`n  [DllImport(`\"user32.dll`\")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);`n  [DllImport(`\"user32.dll`\")] static extern bool GetWindowRect(IntPtr h, out RECT r);`n  [DllImport(`\"user32.dll`\")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);`n  [DllImport(`\"user32.dll`\")] static extern bool IsIconic(IntPtr h);`n  [DllImport(`\"user32.dll`\")] static extern IntPtr GetAncestor(IntPtr h, uint flags);`n  static string Esc(string s) { return s.Replace(`\"\\\\`\", `\"\\\\\\\\`\").Replace(`\"\\`\"`\", `\"\\\\\\`\"`\"); }`n  static string Row(IntPtr h, IntPtr root, int depth) {`n    var sb = new StringBuilder(512);`n    GetWindowText(h, sb, 512);`n    var cls = new StringBuilder(256);`n    GetClassName(h, cls, 256);`n    RECT r; GetWindowRect(h, out r);`n    uint pid; GetWindowThreadProcessId(h, out pid);`n    int w = r.R - r.L; int hh = r.B - r.T;`n    return `\"{\\`\"hwnd\\`\":`\" + h.ToInt64() + `\",\\`\"pid\\`\":`\" + pid + `\",\\`\"title\\`\":\\`\"`\" + Esc(sb.ToString().Trim()) + `\"\\`\",\\`\"cls\\`\":\\`\"`\" + Esc(cls.ToString()) + `\"\\`\",\\`\"x\\`\":`\" + r.L + `\",\\`\"y\\`\":`\" + r.T + `\",\\`\"w\\`\":`\" + w + `\",\\`\"h\\`\":`\" + hh + `\",\\`\"parentHwnd\\`\":`\" + (depth == 0 ? 0 : root.ToInt64()) + `\",\\`\"depth\\`\":`\" + depth + `\"}`\" ;`n  }`n  public static List<string> Run() {`n    var outp = new List<string>();`n    EnumWindows((h, _) => {`n      if (!IsWindowVisible(h) || IsIconic(h)) return true;`n      var sb = new StringBuilder(256);`n      if (GetWindowText(h, sb, 256) == 0) return true;`n      if (sb.ToString().Trim().Length == 0) return true;`n      RECT r; GetWindowRect(h, out r);`n      int w = r.R - r.L; int hh = r.B - r.T;`n      if (w <= 0 || hh <= 0) return true;`n      outp.Add(Row(h, h, 0));`n      EnumChildWindows(h, (c, __) => {`n        if (!IsWindowVisible(c)) return true;`n        if (GetAncestor(c, 2) != h) return true;`n        RECT cr; GetWindowRect(c, out cr);`n        int cw = cr.R - cr.L; int ch = cr.B - cr.T;`n        if (cw < 16 || ch < 16) return true;`n        int area = cw * ch; int parentArea = w * hh;`n        if (area >= parentArea) return true;`n        outp.Add(Row(c, h, 1));`n        return true;`n      }, IntPtr.Zero);`n      return true;`n    }, IntPtr.Zero);`n    return outp;`n  }`n}\"\nAdd-Type -TypeDefinition $cs\n$json = '[' + ([WinLister]::Run() -join ',') + ']'\n[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))"

/**
 * 条目形状校验（host 侧任何异常都按空列表降级，不外抛）。
 *
 * 形状：{ hwnd, pid, title, cls, x, y, w, h, parentHwnd, depth }
 *  - hwnd：窗口句柄（抓帧与跟随都靠它，见 rec-capture.js）；
 *  - parentHwnd / depth：0/0 = 顶层窗，非 0/1 = 它的子窗口（面板里缩进一层）；
 *  - cls：窗口类名（面板显示用，也能帮用户分辨「Chrome Legacy Window」这类子窗）。
 */
function isRow(item) {
  return item !== null && typeof item === 'object'
    && typeof item.hwnd === 'number' && item.hwnd !== 0
    && typeof item.pid === 'number' && typeof item.title === 'string'
    && typeof item.cls === 'string'
    && typeof item.x === 'number' && typeof item.y === 'number'
    && typeof item.w === 'number' && typeof item.h === 'number'
    && typeof item.parentHwnd === 'number' && typeof item.depth === 'number'
}

let cacheAt = 0
let cacheList = []
let inflight = null

/** 枚举可见窗口树（win32 实跑，其余平台空列表；2s 缓存）。 */
function listWindows() {
  const now = Date.now()
  if (now - cacheAt < CACHE_MS) return Promise.resolve(cacheList)
  if (inflight !== null) return inflight
  if (process.platform !== 'win32') {
    cacheAt = now
    cacheList = []
    return Promise.resolve(cacheList)
  }
  inflight = new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')],
      { timeout: PS_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        inflight = null
        let list = []
        if (!error && typeof stdout === 'string') {
          try {
            // PS 侧输出 base64(UTF-8)，这里解回（见文件头坑 4）。
            const decoded = Buffer.from(stdout.trim(), 'base64').toString('utf8')
            const parsed = JSON.parse(decoded)
            if (Array.isArray(parsed)) list = parsed.filter(isRow)
          } catch { /* 解析失败按空列表降级 */ }
        }
        cacheAt = Date.now()
        cacheList = list
        resolve(list)
      },
    )
  })
  return inflight
}

/** 直接读枚举结果（rec-capture 校验 hwnd 用，绕开 2s 缓存）。 */
export function listWindowsFresh() {
  cacheAt = 0
  return listWindows()
}

function sendJson(res, code, body) {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/**
 * 注册窗口枚举路由（在已注入 webServer 的子上下文中调用）。
 *
 * 调用方（dsh-chat-plus 入口）保证 webCtx.webServer 已就绪：路由用 effect 包住，
 * 插件卸载/重载时自动回收。
 */
export function applyRecWindows(webCtx) {
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    // async：让 handler 返回 Promise（smoke 与 webServer 都能 await 到响应写完）。
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, message: 'method not allowed' })
        return
      }
      let windows = []
      try {
        windows = await listWindows()
      } catch { /* 枚举失败按空列表降级：面板退化为只有整屏 */ }
      sendJson(res, 200, { ok: true, windows })
    },
  }), 'dsh-chat-plus: done-pill rec-windows route')
}

export const REC_WINDOWS_ROUTE = ROUTE
