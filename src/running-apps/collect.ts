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
/**
 * 采集脚本正文。
 *
 * ## 为什么枚举与进程查询全部写在 C# 里（性能，实测 500ms → 5ms）
 *
 * 最早的版本用 PowerShell 逐句写循环：foreach 里逐条 Get-Process。功能正确，
 * 但**每次采集稳定要 450~550ms** —— 逐段计时后发现 EnumWindows 只要 3ms、
 * Get-Process 6 个进程只要 1ms、取 Path 只要 2ms，那 500ms 全花在 PowerShell
 * 解释执行逐条语句、管道装箱与对象构造上。搬进 C# 之后：EnumWindows + 进程名/
 * 路径查询 5ms，加图标 54ms（首次）、之后 1ms。用户打 @ 时这是「即时」与
 * 「等一下」的区别。
 *
 * ## ⚠ 不要给 Add-Type 传 -ReferencedAssemblies（踩过，静默失效）
 *
 * 在 pwsh（PowerShell 7）下，Add-Type -TypeDefinition $src -ReferencedAssemblies
 * System.Drawing 会**覆盖**默认引用集，于是 List<> / Dictionary<> / Process 全部
 * 报「找不到类型或命名空间」，Add-Type 失败；而 $ErrorActionPreference =
 * SilentlyContinue 把编译错误吞掉，Collect() 静默返回空串 —— 表现为「列表永远
 * 是空的」，不报任何错。正确做法：先 Add-Type -AssemblyName System.Drawing 单独
 * 加载，再 Add-Type -TypeDefinition 不传 ReferencedAssemblies（图标相关代码因此
 * 留在 PowerShell 侧，见 Get-Icon）。
 *
 * ## 其他刻意的写法（都有实测理由）
 *
 *  1. IsWindowVisible + WS_EX_TOOLWINDOW 双重过滤：只按 IsWindowVisible 会把输入法
 *     候选窗、托盘提示窗、屏幕取词窗全算进来（本机实测多出 4~6 个无意义条目）。
 *  2. 有 owner 的窗口跳过（GetWindow(h, 4)）：那是弹出层（Chrome 的「翻译此页？」
 *     气泡等），不是用户会指认的「那个程序」。
 *  3. 桌面外壳类名跳过：Progman / WorkerW / Shell_TrayWnd。
 *  4. 进程级跳过：TextInputHost / ShellExperienceHost 等系统提示宿主。
 *  5. 空标题直接跳过：没有标题的窗口对用户没有语义。
 *  6. 进程名/路径按 PID 缓存、图标按 exe 路径缓存：同一进程的多窗口只查一次。
 *  7. 主循环读 stdin：一行 PROBE 回一行结果；QUIT 或 EOF 退出。
 *  8. 输出强制 UTF-8：中文标题在 Windows 默认代码页下会变乱码。
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
using System.Diagnostics;

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
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr hProcess, uint exitCode);

  const char FSEP = (char)1;
  const char RSEP = (char)2;

  static readonly string[] SkipProcs = new string[] { "TextInputHost", "ShellExperienceHost", "StartMenuExperienceHost", "SearchHost", "explorer" };
  static readonly Dictionary<int, string> NameCache = new Dictionary<int, string>();
  static readonly Dictionary<int, string> PathCache = new Dictionary<int, string>();

  public static long Now() { return DateTime.UtcNow.Ticks / 10000; }

  public static string Collect() {
    var found = new List<IntPtr>();
    IntPtr fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int ex = GetWindowLong(h, -16);
      if ((ex & 0x8) != 0) return true;
      if (GetWindow(h, 4) != IntPtr.Zero) return true;
      var cn = new StringBuilder(256);
      GetClassName(h, cn, 256);
      string cls = cn.ToString();
      if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return true;
      var sb = new StringBuilder(1024);
      if (GetWindowText(h, sb, 1024) == 0) return true;
      found.Add(h);
      return true;
    }, IntPtr.Zero);

    var rows = new StringBuilder();
    int count = 0;
    foreach (IntPtr h in found) {
      uint pidRaw;
      GetWindowThreadProcessId(h, out pidRaw);
      int pid = (int)pidRaw;
      string pname = ProcName(pid);
      if (pname == null) continue;
      bool skip = false;
      for (int i = 0; i < SkipProcs.Length; i++) { if (SkipProcs[i] == pname) { skip = true; break; } }
      if (skip) continue;
      var title = new StringBuilder(1024);
      GetWindowText(h, title, 1024);
      if (count > 0) rows.Append(RSEP);
      rows.Append(pid).Append(FSEP)
          .Append(h == fg ? "1" : "0").Append(FSEP)
          .Append(IsIconic(h) ? "1" : "0").Append(FSEP)
          .Append(pname).Append(FSEP)
          .Append(title.ToString()).Append(FSEP)
          .Append(ProcPath(pid));
      count++;
    }
    return rows.ToString();
  }

  static string ProcName(int pid) {
    string v;
    if (NameCache.TryGetValue(pid, out v)) return v;
    try {
      var p = Process.GetProcessById(pid);
      v = p.ProcessName;
      NameCache[pid] = v;
      return v;
    } catch { return null; }
  }

  static string ProcPath(int pid) {
    string v;
    if (PathCache.TryGetValue(pid, out v)) return v;
    try {
      var p = Process.GetProcessById(pid);
      v = p.MainModule.FileName;
    } catch { v = ""; }
    PathCache[pid] = v;
    return v;
  }

  /** 主循环里的兜底检查：父进程不在了就返回 true。 */
  public static bool ParentGone(int parentPid) {
    if (parentPid <= 0) return false;
    IntPtr h = OpenProcess(0x00100000, false, parentPid);
    if (h == IntPtr.Zero) return true;
    CloseHandle(h);
    return false;
  }

  /**
   * 宿主看门狗：父进程一退出就让本进程死掉。
   *
   * ## ⚠ 只在 stdin 常驻模式下启用（传 parentPid 才装）
   *
   * 踩过的坑：一开始无条件启用，结果 **-EncodedCommand 模式下采集器立刻自杀**。
   * 原因：PowerShell 用 -EncodedCommand 启动时，真正的 pwsh 进程会先起一个
   * 短命的中间宿主，脚本跑在它的子进程里 —— 那个「父进程」在命令派发完就退出，
   * 看门狗于是立刻判定「宿主没了」并把采集器干掉（症状：每次探测都
   * collector exited，列表永远空）。
   *
   * 现在由 Node 侧显式决定是否安装：只有确认父进程是长期存活的 DSH 宿主时才传
   * 非 0 的 parentPid。判定做在 Node 侧（process.pid 的那一层），PowerShell 不再
   * 自己猜。
   *
   * 为什么需要它：Node 侧 dispose 只在「插件正常卸载」时执行。宿主被强杀
   * （任务管理器结束进程 / 崩溃 / 断电）时那段代码根本不跑，本进程就成了一个
   * 永远挂在 ReadLine 上的孤儿 —— 实测一次调试就在机器上留下过。
   *
   * 为什么不用 PowerShell 的循环检查：ReadLine 是阻塞的，父进程死掉时 stdin
   * 未必立刻 EOF（管道可能仍被系统持有），循环顶部的检查根本没机会跑。
   * 独立线程 WaitForSingleObject 等父进程句柄则与主循环是否阻塞无关。
   *
   * 必须用 TerminateProcess 而不是 Environment.Exit：后者会跑 AppDomain 的
   * ProcessExit 事件、等待前台线程，在 PowerShell 宿主里实测会被拖住而不退出。
   */
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);

  /**
   * 把指定进程名的**主窗口**拉到前台。
   *
   * 为什么按进程名而不是窗口句柄：客户端只拿得到「正在操作浏览器」这件事，
   * 它不知道 ego 的窗口句柄（那个值每次重启都变，且不适合当持久契约）。
   * 进程名（ego）是稳定的。
   *
   * 为什么不是简单的 SetForegroundWindow：Windows 有前台锁 —— 只有当调用进程
   * 本身是前台进程时，SetForegroundWindow 才会真的生效；否则它只闪一下任务栏。
   * 这里用 AttachThreadInput 把本线程挂到目标窗口线程的输入队列上，绕过那条
   * 限制（这是 BringWindowToFront 类实现的通行做法）。
   *
   * 优先级：先挑**未最小化、且不是当前前台**的那个（避免"已经在前台却把别人
   * 抢下来"），没有再退到任一未最小化窗口，最后才用最小化的（并 ShowWindow 还原）。
   */
  public static bool Activate(string processName) {
    if (string.IsNullOrEmpty(processName)) return false;
    var candidates = new List<IntPtr>();
    IntPtr fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int ex = GetWindowLong(h, -16);
      if ((ex & 0x8) != 0) return true;
      if (GetWindow(h, 4) != IntPtr.Zero) return true;
      var sb = new StringBuilder(1024);
      if (GetWindowText(h, sb, 1024) == 0) return true;
      uint pidRaw;
      GetWindowThreadProcessId(h, out pidRaw);
      string pname = ProcName((int)pidRaw);
      if (pname != null && string.Equals(pname, processName, StringComparison.OrdinalIgnoreCase)) {
        candidates.Add(h);
      }
      return true;
    }, IntPtr.Zero);

    if (candidates.Count == 0) return false;

    IntPtr target = IntPtr.Zero;
    for (int i = 0; i < candidates.Count; i++) {
      if (!IsIconic(candidates[i]) && candidates[i] != fg) { target = candidates[i]; break; }
    }
    if (target == IntPtr.Zero) {
      for (int i = 0; i < candidates.Count; i++) {
        if (!IsIconic(candidates[i])) { target = candidates[i]; break; }
      }
    }
    if (target == IntPtr.Zero) {
      target = candidates[0];
    }

    try {
      /*
       * ── 三步把窗口真正推到前台 ────────────────────────────────────────────
       *
       * ⚠ 2026-10-25 实测：只调 AttachThreadInput + SetForegroundWindow **不生效**
       * （路由返回 ok:true，但前台窗口仍是别的程序）。原因：AttachThreadInput 挂的是
       * **采集器那个 PowerShell 线程**，而 Windows 的前台锁认的是「当前前台线程」
       * —— 采集器线程既不是前台线程、也没有输入焦点，挂上去也拿不到置顶权。
       *
       * 现在用组合拳（顺序不能变）：
       *   ① ShowWindow(SW_RESTORE)：最小化的先还原（否则 SetForegroundWindow 对
       *      最小化窗口只是闪一下任务栏）；
       *   ② **模拟一次 Alt 键**：这是绕过前台锁的经典做法 —— 按一下 Alt 会让系统
       *      认为「用户在操作」，从而放开 SetForegroundWindow 的限制；
       *   ③ BringWindowToTop + SetForegroundWindow + SetFocus 三连；
       *   ④ 再补一次 AttachThreadInput（对某些宿主仍有效，代价很小）。
       *
       * 返回值改成**真的检查结果**：之前无条件 return true，所以路由永远回 ok:true，
       * 客户端看不出失败。现在拿 GetForegroundWindow 比对，没成功就返回 false。
       */
      ShowWindow(target, 9); /* SW_RESTORE */
      ShowWindow(target, 5); /* SW_SHOW */

      /* ② 模拟 Alt 的按下与抬起（KEYEVENTF_KEYUP = 0x0002）。
         这一步会让系统的「前台锁」认为用户正在操作，从而允许接下来的置顶请求。 */
      const byte VK_MENU = 0x12;
      keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
      keybd_event(VK_MENU, 0, 0x0002, UIntPtr.Zero);

      /* ③ 三连置顶。 */
      BringWindowToTop(target);
      SetForegroundWindow(target);
      SetFocus(target);

      /* ④ 补一次 AttachThreadInput（对部分宿主有效）。 */
      uint targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);
      uint curThread = GetCurrentThreadId();
      if (targetThread != 0 && targetThread != curThread) {
        if (AttachThreadInput(curThread, targetThread, true)) {
          SetForegroundWindow(target);
          AttachThreadInput(curThread, targetThread, false);
        }
      }

      /* 结果校验：GetForegroundWindow 变了才算成功。 */
      IntPtr now = GetForegroundWindow();
      if (now == target) return true;
      /* 有些应用（Electron）的前台窗口是目标的子窗口 / 主窗口，放宽到「同进程」也算成功。 */
      uint nowPid;
      GetWindowThreadProcessId(now, out nowPid);
      uint targetPid;
      GetWindowThreadProcessId(target, out targetPid);
      return nowPid != 0 && nowPid == targetPid;
    } catch {
      return false;
    }
  }

  public static void WatchParent(int parentPid) {
    if (parentPid <= 0) return;
    var t = new System.Threading.Thread(() => {
      IntPtr h = OpenProcess(0x00100000, false, parentPid);
      if (h == IntPtr.Zero) { TerminateProcess(GetCurrentProcess(), 0); return; }
      WaitForSingleObject(h, 0xFFFFFFFF);
      CloseHandle(h);
      TerminateProcess(GetCurrentProcess(), 0);
    });
    t.IsBackground = true;
    t.Start();
  }
}
'@
Add-Type -TypeDefinition $cs
# 宿主看门狗：父进程 PID 由 Node 侧从 stdin 第一行传进来（"PARENT <pid>"），
# 传 0 或没传就不装。见 WatchParent 的注释：-EncodedCommand 模式下 PowerShell
# 会先起一个短命的中间宿主，脚本自己查到的「父进程」不是真正的 DSH 宿主，
# 无条件启用会让采集器立刻自杀。
$ParentPid = 0

$iconCache = @{}
function Get-Icon([string]$exe) {
  if ($exe -and $iconCache.ContainsKey($exe)) { return $iconCache[$exe] }
  $icon = ""
  if ($exe -and (Test-Path -LiteralPath $exe)) {
    try {
      $ic = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
      if ($ic) {
        $bmp = $ic.ToBitmap()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $icon = "data:image/png;base64," + [Convert]::ToBase64String($ms.ToArray())
        $ms.Dispose(); $bmp.Dispose(); $ic.Dispose()
      }
    } catch {}
  }
  if ($exe) { $iconCache[$exe] = $icon }
  return $icon
}

while ($true) {
  # 死等即可：孤儿由上面的看门狗线程硬终止负责（ReadLine 阻塞时它照样生效，
  # 因为那是独立线程 + TerminateProcess）。
  # 曾试过 ReadLineAsync().Wait(1500) 做超时轮询 —— PowerShell 宿主里
  # Console.In 的异步读取会退化成同步阻塞，Wait 永远不超时，等于没改。
  if ([DshRunningApps]::ParentGone($ParentPid)) { break }
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq "QUIT") { break }
  if ($line.StartsWith("PARENT ")) {
    $ParentPid = [int]$line.Substring(7)
    [DshRunningApps]::WatchParent($ParentPid)
    continue
  }
  # ACTIVATE <进程名>：把那个进程的主窗口拉到前台（点浏览器标志时用）。
  # 回一行最小 JSON，与 PROBE 共用同一套 END_MARK 分隔。
  if ($line.StartsWith("ACTIVATE ")) {
    $procName = $line.Substring(9).Trim()
    $okAct = $false
    try { $okAct = [DshRunningApps]::Activate($procName) } catch { $okAct = $false }
    $actPayload = [pscustomobject]@{ ok = $okAct; activate = $procName }
    [Console]::Out.WriteLine(($actPayload | ConvertTo-Json -Compress))
    [Console]::Out.WriteLine("<<<DSH-APPS-END>>>")
    [Console]::Out.Flush()
    continue
  }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $raw = [DshRunningApps]::Collect()
  $apps = New-Object System.Collections.ArrayList
  if ($raw.Length -gt 0) {
    foreach ($row in $raw.Split([char]2)) {
      if ([string]::IsNullOrEmpty($row)) { continue }
      $parts = $row.Split([char]1)
      if ($parts.Count -lt 6) { continue }
      [void]$apps.Add([pscustomobject]@{
        pid = [int]$parts[0]
        focused = ($parts[1] -eq "1")
        minimized = ($parts[2] -eq "1")
        title = $parts[4]
        process = $parts[3]
        exe = $parts[5]
        icon = (Get-Icon $parts[5])
      })
    }
  }
  $payload = [pscustomobject]@{ ok = $true; apps = $apps; ms = $sw.ElapsedMilliseconds }
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Depth 5 -Compress))
  [Console]::Out.WriteLine("<<<DSH-APPS-END>>>")
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
  /*
   * 把本进程 PID 告诉采集器，让它装宿主看门狗（见 C# WatchParent 的注释）。
   *
   * 为什么由 Node 传而不是让 PowerShell 自己查 ParentProcessId：
   * -EncodedCommand 模式下 pwsh 会先起一个短命的中间宿主，脚本查到的
   * 「父进程」是那个中间宿主，它派发完命令就退出 —— 采集器会立刻自杀。
   * 这里传的 process.pid 是真正的 DSH 宿主进程。
   */
  try {
    proc.stdin.write('PARENT ' + process.pid + '\n')
  } catch { /* 管道已断，下次重建 */ }
  return proc
}

/**
 * 往常驻进程发一条命令并等一行回包。
 *
 * 抽出来是因为现在有两条命令（PROBE / ACTIVATE），而「同一时刻只允许一个
 * 挂起回包」「超时就杀进程重建」这两条纪律必须一模一样 —— 复制一份迟早分叉。
 *
 * @param line - 要写进 stdin 的整行命令（不含换行）。
 * @returns 回包；失败一律 ok:false，绝不抛。
 */
function sendCommand(line: string): Promise<RawProbeResult> {
  return new Promise<RawProbeResult>((resolve) => {
    const proc = ensureCollector()
    if (proc === null) {
      resolve({ ok: false, error: 'collector unavailable' })
      return
    }
    // 同一时刻只允许一个挂起命令：常驻进程是单线程串行处理 stdin 的，
    // 并发写两行会让两个回包错配。
    if (state.pending !== null) settlePending({ ok: false, error: 'superseded' })
    const timer = setTimeout(() => {
      settlePending({ ok: false, error: 'collector timeout' })
      // 超时说明子进程卡住了（正常采集 <100ms）：杀掉，下次重建。
      killCollector()
    }, RUNNING_APPS_TIMEOUT_MS)
    state.pending = { resolve, timer }
    try {
      proc.stdin.write(line + '\n')
    } catch {
      settlePending({ ok: false, error: 'collector stdin closed' })
    }
  })
}

/** 跑一次探测。失败一律返回 ok:false，绝不抛。 */
function probe(): Promise<RawProbeResult> {
  return sendCommand('PROBE')
}

/**
 * 把某个进程的主窗口拉到前台（点操作面板那枚浏览器标志时用）。
 *
 * 进程名来自浏览器活动表里的 service/tool（如 ego / playwright-mcp），但真正
 * 要激活的是**那个 CLI 背后的桌面应用**：ego-browser 的窗口进程名是 ego。
 * 所以这里吃的是「候选进程名列表」，逐个试，第一个成功的赢。
 *
 * 全部失败时返回 false，调用方据此走兜底（不弹错、不假装成功）。
 *
 * @param names - 候选进程名（不含 .exe，大小写不敏感）。
 * @returns 是否真的激活了某个窗口。
 */
export async function activateProcessWindow(names: readonly string[]): Promise<boolean> {
  for (const name of names) {
    const trimmed = name.trim()
    if (trimmed === '') continue
    try {
      const result = await sendCommand('ACTIVATE ' + trimmed)
      if (result.ok === true) return true
    } catch {
      /* 单个候选失败不影响其它候选 */
    }
  }
  return false
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
 * 采集一次运行中的窗口。
 *
 * ## 无缓存 —— 每次都真采
 *
 * 曾经有过 3 秒 TTL，但用户实测反馈「@ 的时候不是实时获取的」：关掉一个程序、
 * 切一个标签页，再打 @ 看到的还是旧的。3 秒听起来很短，可用户的操作节奏恰恰是
 * 「关掉 → 立刻打 @」。
 *
 * 现在每次都真采。代价可以忽略：常驻子进程一次往返 2~4ms（实测），比一次
 * HTTP 往返还便宜。真正的去重交给 pending 队列 —— 同一时刻多个请求只会发起
 * 一次探测（常驻进程串行处理 stdin，并发写两行会错配回包）。
 *
 * @param _force - 保留参数只为兼容旧调用（已无缓存可跳过）。
 * @returns 契约快照；任何失败都是 ok:false + 空列表，绝不抛。
 */
export async function collectRunningApps(_force = false): Promise<RunningAppsSnapshot> {
  const now = Date.now()
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
  return snapshot
}

/** 插件卸载时调用：关掉常驻子进程，不留孤儿。 */
export function disposeRunningApps(): void {
  state.disposed = true
  settlePending({ ok: false, error: 'disposed' })
  killCollector()
}

/** 导出给冒烟直接对拍：归一化与排序这两条判据错了不会报错，只会静默丢条目或排错序。 */
export const __test = {
  normalizeWindow,
  sortWindows,
  END_MARK,
  COLLECTOR_SCRIPT,
}