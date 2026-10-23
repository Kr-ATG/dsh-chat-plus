/**
 * dsh-chat-plus — 「运行中的程序」采集（host 半身）。
 *
 * ## 采集什么
 *
 * 所有**可见的顶层窗口**：标题、进程名、可执行文件路径、是否前台、是否最小化、
 * 进程图标（PNG data URL）。这一份数据就是「现在屏幕上开着的东西」。
 *
 * ## 为什么是 PowerShell 而不是 node 原生
 *
 * Node 拿不到窗口标题与图标：
 *  · Get-Process 的 MainWindowTitle 在部分 Electron/Chromium 应用上恒为空；
 *  · 图标要 ExtractAssociatedIcon（System.Drawing），Node 侧没有等价物；
 *  · 前台窗口判定要 GetForegroundWindow。
 * 这三件事都在 Win32 层，PowerShell + Add-Type 是最短路径。
 *
 * ## 为什么是**常驻子进程**而不是每次 spawn
 *
 * 实测（本机，2026-10-23）：
 *  · 每次 spawn 一个新 pwsh 跑完整采集：**约 1000ms**（其中 600~700ms 纯粹是
 *    PowerShell 冷启动）；
 *  · 常驻一个 pwsh、用 stdin 收 PROBE、stdout 回一行 JSON：首次 614ms，
 *    之后每次 **2~4ms**。
 *
 * 用户打 @ 时菜单必须立刻有东西，1000ms 的空窗等于「这个功能卡住了」。
 * 所以这里维护一个常驻子进程，采集变成一次 stdin/stdout 往返。
 *
 * ## 失败面
 *
 * 常驻进程崩了（被安全软件杀、PowerShell 升级、机器休眠后管道断）时，
 * 下一次请求会检测到 exitCode !== null 并**重新拉起一次**；再失败就返回
 * ok:false + 空列表，客户端静默降级成「没有候选」，绝不让界面报错。
 *
 * @module
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  RUNNING_APPS_MAX,
  RUNNING_APPS_TIMEOUT_MS,
  RUNNING_APPS_TTL_MS,
  type RunningAppsSnapshot,
  type RunningAppWindow,
} from './types.ts'

/** 回包分隔符：PowerShell 侧每写完一行 JSON 就补这一行。 */
const END_MARK = '<<<DSH-APPS-END>>>'

/**
 * 采集脚本正文。
 *
 * 几个刻意的写法，都有实测理由：
 *
 *  1. **IsWindowVisible + WS_EX_TOOLWINDOW 双重过滤**：只按 IsWindowVisible
 *     会把输入法候选窗、托盘提示窗、屏幕取词窗全算进来（本机实测多出 4~6 个
 *     无意义条目，标题还是空的）。
 *  2. **空标题直接跳过**：没有标题的窗口对用户没有语义。
 *  3. **图标按 exe 路径缓存**：同一进程的多窗口、同一程序的多进程都只解码一次。
 *     不缓存时 6 个窗口要花 160ms，缓存后第二次起降到个位数。
 *  4. **Get-Process 结果按 PID 缓存**：进程还在就不重复查（Get-Process 是
 *     最慢的一环，单次约 20~30ms）。
 *  5. **主循环读 stdin**：一行 PROBE 回一行结果；QUIT 或 EOF 退出。
 *  6. **输出强制 UTF-8**：中文标题在 Windows 默认代码页下会变乱码。
 */
const COLLECTOR_SCRIPT = String.raw`$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$cs = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class DshRunningApps {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  /**
   * 宿主看门狗：父进程一退出就让本进程立刻死掉。
   *
   * 为什么必须有：Node 侧 dispose 只在「插件正常卸载」时执行。宿主被强杀
   * （任务管理器结束进程 / 崩溃 / 断电）时那段代码根本不跑，本进程就成了
   * 一个永远挂在 ReadLine 上的孤儿 —— 实测一次调试就在机器上留下过。
   *
   * 为什么不用 PowerShell 的循环检查：ReadLine 是阻塞的，父进程死掉时 stdin
   * 未必立刻 EOF（管道可能仍被系统持有），循环顶部的检查根本没机会跑。
   * 这里用独立线程 WaitForSingleObject 等父进程句柄，父进程一消失就 Exit(0)，
   * 与主循环是否阻塞无关。
   */
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr hProcess, uint exitCode);
  public static void WatchParent(int parentPid) {
    if (parentPid <= 0) return;
    var t = new System.Threading.Thread(() => {
      IntPtr h = OpenProcess(0x00100000, false, parentPid);
      if (h == IntPtr.Zero) { TerminateProcess(GetCurrentProcess(), 0); return; }
      WaitForSingleObject(h, 0xFFFFFFFF);
      CloseHandle(h);
      // ⚠ 必须用 TerminateProcess 而不是 Environment.Exit：
      // Environment.Exit 会跑 AppDomain 的 ProcessExit 事件、等待前台线程，
      // 在 PowerShell 宿主里实测会被拖住而**不退出**（本机复现：线程日志
      // 打印了 "exiting" 但进程仍在）。TerminateProcess 是硬终止，不给宿主
      // 任何拒绝的机会。
      TerminateProcess(GetCurrentProcess(), 0);
    });
    t.IsBackground = true;
    t.Start();
  }
  /**
   * 主循环里的兜底检查：父进程不在了就返回 true。
   *
   * 为什么有了上面的线程还要这个：线程只在**等待 stdin** 时才起作用。
   * 实测（2026-10-23）在「父进程刚退出、子进程正阻塞在 ReadLine」的窗口里，
   * 线程确实被唤醒了，但 Exit 之前主线程已经被 Node 侧 kill 之外的路径
   * 拉回可运行态，两种退出路径会打架。这条检查挂在每次 PROBE 处理的入口，
   * 让主循环自己先看一眼：父进程没了就不必再干活，直接 break 干净退出。
   */
  public static bool ParentGone(int parentPid) {
    if (parentPid <= 0) return false;
    IntPtr h = OpenProcess(0x00100000, false, parentPid);
    if (h == IntPtr.Zero) return true;
    CloseHandle(h);
    return false;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  public static List<string> List() {
    var rows = new List<string>();
    IntPtr fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int ex = GetWindowLong(h, -16);
      if ((ex & 0x8) != 0) return true;
      // 有 owner 的窗口是弹出层（Chrome 的「翻译此页？」气泡、各类浮层），
      // 不是用户会指认的「那个程序」。主窗口一律没有 owner。
      if (GetWindow(h, 4) != IntPtr.Zero) return true;
      var cn = new StringBuilder(256);
      GetClassName(h, cn, 256);
      string cls = cn.ToString();
      if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return true;
      var sb = new StringBuilder(1024);
      if (GetWindowText(h, sb, 1024) == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      rows.Add(pid + "\u0001" + (h == fg ? "1" : "0") + "\u0001" + (IsIconic(h) ? "1" : "0") + "\u0001" + cls + "\u0001" + sb);
      return true;
    }, IntPtr.Zero);
    return rows;
  }
}
'@
Add-Type -TypeDefinition $cs -Language CSharp
# 宿主看门狗：必须在 Add-Type 之后（之前 DshRunningApps 还不存在，调用会静默失败）。
# 父进程（DSH 宿主）一退出，本进程立刻 Exit —— 宿主被强杀时来不及跑 effect 清理，
# 不加这条就会在机器上留下一个永远挂在 ReadLine 上的孤儿 pwsh（实测踩到过）。
$ParentPid = 0
try { $ParentPid = [int](Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID)).ParentProcessId } catch {}
[DshRunningApps]::WatchParent($ParentPid)
$iconCache = @{}
$procCache = @{}
function Get-Icon([string]$exe) {
  if ($exe -and $iconCache.ContainsKey($exe)) { return $iconCache[$exe] }
  $icon = ''
  if ($exe -and (Test-Path -LiteralPath $exe)) {
    try {
      $ic = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
      if ($ic) {
        $bmp = $ic.ToBitmap()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $icon = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray())
        $ms.Dispose(); $bmp.Dispose(); $ic.Dispose()
      }
    } catch {}
  }
  if ($exe) { $iconCache[$exe] = $icon }
  return $icon
}
while ($true) {
  # 这里死等即可：孤儿由上面的看门狗线程硬终止负责（ReadLine 阻塞时它照样生效，
  # 因为那是独立线程 + TerminateProcess）。
  # 曾试过 ReadLineAsync().Wait(1500) 做超时轮询——PowerShell 宿主里
  # Console.In 的异步读取会退化成同步阻塞，Wait 永远不超时，等于没改。
  if ([DshRunningApps]::ParentGone($ParentPid)) { break }
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq 'QUIT') { break }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $rows = [DshRunningApps]::List()
  $apps = New-Object System.Collections.ArrayList
  foreach ($row in $rows) {
    $parts = $row.Split([char]1)
    $procId = [int]$parts[0]
    $proc = $null
    if ($procCache.ContainsKey($procId)) { $proc = $procCache[$procId] }
    else {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($null -eq $proc) { continue }
      $procCache[$procId] = $proc
    }
    if ($null -eq $proc) { continue }
    // 桌面外壳 / 输入法 / 系统提示宿主：它们有窗口有标题，但用户永远不会
    // 想「@ 桌面」。实测不加这几条时列表里会混进 Program Manager、
    // Windows 输入体验、Windows Shell Experience Host。
    if ($proc.ProcessName -in @('TextInputHost', 'ShellExperienceHost', 'StartMenuExperienceHost', 'SearchHost', 'explorer')) { continue }
    $exe = $null
    try { $exe = $proc.Path } catch {}
    [void]$apps.Add([pscustomobject]@{
      pid = $procId
      focused = ($parts[1] -eq '1')
      minimized = ($parts[2] -eq '1')
      title = $parts[4]
      process = $proc.ProcessName
      exe = $exe
      icon = (Get-Icon $exe)
    })
  }
  $payload = [pscustomobject]@{ ok = $true; apps = $apps; ms = $sw.ElapsedMilliseconds }
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Depth 5 -Compress))
  [Console]::Out.WriteLine('<<<DSH-APPS-END>>>')
  [Console]::Out.Flush()
}
`

/** 采集器内部状态：常驻子进程 + 未结算的 PROBE 队列 + 缓存。 */
interface CollectorState {
  proc: ChildProcessWithoutNullStreams | null
  /** stdout 累积缓冲（一行 JSON 可能跨多个 chunk）。 */
  buffer: string
  /** 当前在等回包的那一次探测（同时只允许一个：探针是串行的）。 */
  pending: { resolve: (value: RawProbeResult) => void; timer: ReturnType<typeof setTimeout> } | null
  /** 上一次成功采集的结果与时间。 */
  cache: { snapshot: RunningAppsSnapshot; at: number } | null
  /** 是否已卸载（卸载后不再拉起新进程）。 */
  disposed: boolean
}

/** 采集脚本回包（未归一化）。 */
interface RawProbeResult {
  ok: boolean
  apps?: unknown
  ms?: number
  error?: string
}

const state: CollectorState = {
  proc: null,
  buffer: '',
  pending: null,
  cache: null,
  disposed: false,
}

/**
 * 选一个 PowerShell 可执行文件。
 *
 * 优先 pwsh（PowerShell 7，冷启动约 600ms）；没有就退回 powershell.exe
 * （Windows PowerShell 5.1，冷启动约 750ms，功能一致）。两者都不在 PATH 时
 * spawn 的 error 事件会兜住，采集器静默失效 —— @ 菜单只剩文件/会话候选。
 */
function powershellExe(): string {
  return 'pwsh.exe'
}

/**
 * 采集脚本的 -EncodedCommand 形式（base64 UTF-16LE）。
 *
 * 为什么不用 `-Command -` 从 stdin 灌脚本（踩过）：stdin 模式下 PowerShell
 * 逐行读「命令」，整段脚本里的中文注释与多行 C# here-string 会被拆错，
 * 表现为**部分过滤条件静默失效**（实测：文件方式跑出 4 条，stdin 方式跑出
 * 6 条，多出的是本该被过滤掉的浮层窗口与输入法宿主）。
 * 也不用临时 .ps1 文件：会留残留，且杀软对落地脚本的扫描会拖慢首次启动。
 * -EncodedCommand 把整段脚本作为一个参数传进去，编码与行结构都不再是问题。
 */
let encodedCache: string | null = null
function encodedCollector(): string {
  if (encodedCache !== null) return encodedCache
  encodedCache = Buffer.from(COLLECTOR_SCRIPT, 'utf16le').toString('base64')
  return encodedCache
}

/** 杀掉常驻进程（退出 / 崩溃 / 超时）。 */
function killCollector(): void {
  const proc = state.proc
  state.proc = null
  state.buffer = ''
  if (proc === null) return
  try {
    proc.stdin.end()
  } catch { /* 管道已断 */ }
  try {
    proc.kill()
  } catch { /* 进程已退出 */ }
}

/** 结算当前挂起的探测（超时 / 进程退出时调用）。 */
function settlePending(result: RawProbeResult): void {
  const pending = state.pending
  if (pending === null) return
  state.pending = null
  clearTimeout(pending.timer)
  pending.resolve(result)
}

/** stdout 解析：每见到 END_MARK 就结算一次。 */
function onStdout(chunk: string): void {
  state.buffer += chunk
  const idx = state.buffer.indexOf(END_MARK)
  if (idx < 0) return
  const text = state.buffer.slice(0, idx).trim()
  state.buffer = state.buffer.slice(idx + END_MARK.length)
  if (state.pending === null) return
  try {
    settlePending(JSON.parse(text) as RawProbeResult)
  } catch {
    settlePending({ ok: false, error: 'collector returned malformed json' })
  }
}

/** 拉起常驻子进程（幂等：已在跑就直接返回）。 */
function ensureCollector(): ChildProcessWithoutNullStreams | null {
  if (state.proc !== null && state.proc.exitCode === null && !state.proc.killed) return state.proc
  if (state.disposed) return null
  let proc: ChildProcessWithoutNullStreams
  try {
    proc = spawn(powershellExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCollector()], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }
  state.proc = proc
  state.buffer = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', onStdout)
  // stderr 全部丢弃：PowerShell 的告警（ExecutionPolicy 提示、Add-Type 重复定义）
  // 与功能无关，写进日志只会掩盖真正的问题。
  proc.stderr.on('data', () => { /* 丢弃 */ })
  proc.on('error', () => {
    if (state.proc === proc) killCollector()
    settlePending({ ok: false, error: 'collector spawn failed' })
  })
  proc.on('exit', () => {
    if (state.proc === proc) {
      state.proc = null
      state.buffer = ''
    }
    settlePending({ ok: false, error: 'collector exited' })
  })
  return proc
}

/** 跑一次探测。失败一律返回 ok:false，绝不抛。 */
function probe(): Promise<RawProbeResult> {
  return new Promise<RawProbeResult>((resolve) => {
    const proc = ensureCollector()
    if (proc === null) {
      resolve({ ok: false, error: 'collector unavailable' })
      return
    }
    // 同一时刻只允许一个探测：常驻进程是单线程串行处理 stdin 的，
    // 并发写两行会让两个回包错配。
    if (state.pending !== null) settlePending({ ok: false, error: 'superseded' })
    const timer = setTimeout(() => {
      settlePending({ ok: false, error: 'collector timeout' })
      // 超时说明子进程卡住了（正常采集 <100ms）：杀掉，下次重建。
      killCollector()
    }, RUNNING_APPS_TIMEOUT_MS)
    state.pending = { resolve, timer }
    try {
      proc.stdin.write('PROBE\n')
    } catch {
      settlePending({ ok: false, error: 'collector stdin closed' })
    }
  })
}

/** 把一个原始窗口条目归一化成契约类型（形状不对就丢弃）。 */
function normalizeWindow(raw: unknown): RunningAppWindow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (title === '') return null
  const pid = typeof item.pid === 'number' && Number.isFinite(item.pid) ? item.pid : 0
  const processName = typeof item.process === 'string' ? item.process : ''
  const icon = typeof item.icon === 'string' && item.icon !== '' ? item.icon : null
  return {
    pid,
    process: processName,
    title,
    exe: typeof item.exe === 'string' && item.exe !== '' ? item.exe : null,
    focused: item.focused === true,
    minimized: item.minimized === true,
    icon,
  }
}

/**
 * 排序口径（简单、可预测，不做花哨打分）：
 *  1. 前台窗口置顶（用户此刻就在看它，最可能被 @ 到）；
 *  2. 最小化的排最后（它不在屏幕上，用户大概率不是指它）；
 *  3. 其余保持 EnumWindows 的 Z 序（本身就是「越靠前越在上层」）。
 */
function sortWindows(list: RunningAppWindow[]): RunningAppWindow[] {
  const rank = (item: RunningAppWindow): number => {
    if (item.focused) return 0
    if (item.minimized) return 2
    return 1
  }
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(entry => entry.item)
}

/**
 * 采集一次运行中的窗口（带 3s 缓存）。
 *
 * @param force - true 时跳过缓存（客户端手动刷新 / 冒烟测试用）。
 * @returns 契约快照；任何失败都是 ok:false + 空列表，绝不抛。
 */
export async function collectRunningApps(force = false): Promise<RunningAppsSnapshot> {
  const now = Date.now()
  if (!force && state.cache !== null && now - state.cache.at < RUNNING_APPS_TTL_MS) {
    return { ...state.cache.snapshot, ms: 0, at: state.cache.at }
  }
  const raw = await probe()
  if (raw.ok !== true) {
    return {
      ok: false,
      apps: [],
      ms: 0,
      at: now,
      ...(raw.error === undefined ? {} : { error: raw.error }),
    }
  }
  const list = Array.isArray(raw.apps) ? raw.apps : []
  const windows: RunningAppWindow[] = []
  for (const entry of list) {
    const item = normalizeWindow(entry)
    if (item !== null) windows.push(item)
  }
  const snapshot: RunningAppsSnapshot = {
    ok: true,
    apps: sortWindows(windows).slice(0, RUNNING_APPS_MAX),
    ms: typeof raw.ms === 'number' ? raw.ms : 0,
    at: now,
  }
  state.cache = { snapshot, at: now }
  return snapshot
}

/** 插件卸载时调用：关掉常驻子进程，不留孤儿。 */
export function disposeRunningApps(): void {
  state.disposed = true
  settlePending({ ok: false, error: 'disposed' })
  killCollector()
  state.cache = null
}

/** 导出给冒烟直接对拍：归一化与排序这两条判据错了不会报错，只会静默丢条目或排错序。 */
export const __test = {
  normalizeWindow,
  sortWindows,
  END_MARK,
  COLLECTOR_SCRIPT,
}
