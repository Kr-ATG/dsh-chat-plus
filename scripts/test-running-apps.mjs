/**
 * dsh-chat-plus — 「@ 运行中的程序」冒烟（纯判据，不起浏览器）。
 *
 * 钉住四类判据，它们判错了都**不会抛错**：
 *  1. 回包解析（形状不对该丢条目而不是整份坏掉）；
 *  2. 匹配打分与排序（歪了用户只是找不到东西，没有报错）；
 *  3. 副标题 / 引用编解码（歪了草稿里显示错的东西）；
 *  4. 序列化（歪了模型收到一堆看不懂的 id）。
 *
 * 另加两条 host 侧判据：采集脚本必须包含窗口过滤条件、必须用 -EncodedCommand
 * 传递（stdin 模式实测会让过滤条件静默失效）。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/*
 * 直接从源码 import（Node 24 的 type stripping 能直接跑 .ts）：
 * 客户端产物 lib/client.js 是 __ModuleLoader__ 工厂形态，只能在浏览器沙箱里
 * 求值（见 smoke-client.mjs）；而这里的判据全是纯函数，不需要 DOM。
 * host 产物则是普通 ESM，可以直接 import。
 */
const toUrl = (rel) => new URL(rel, 'file:///' + ROOT.replace(/\\/g, '/') + '/').href
const client = await import(toUrl('src/client/running-apps/data.ts'))
const host = await import(toUrl('lib/index.js'))
const styles = await import(toUrl('src/client/running-apps/styles.ts'))

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  ok   ' + label)
    return
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

const win = (over) => ({
  pid: 100,
  process: 'chrome',
  title: 'Example Domain - Google Chrome',
  exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  focused: false,
  minimized: false,
  icon: null,
  ...over,
})

console.log('[running-apps] 回包解析')
{
  const parsed = client.parseRunningApps({
    ok: true,
    apps: [
      { pid: 1, process: 'a', title: '  Alpha  ', focused: true },
      { pid: 2, process: 'b', title: '   ' },
      { pid: 3, process: 'c' },
      null,
      'nope',
    ],
  })
  check('只留下有标题的条目', parsed !== null && parsed.length === 1, JSON.stringify(parsed))
  check('标题已 trim', parsed?.[0]?.title === 'Alpha', parsed?.[0]?.title)
  check('缺 icon 归一成 null', parsed?.[0]?.icon === null)
  check('ok:false 返回 null', client.parseRunningApps({ ok: false, apps: [] }) === null)
  check('非对象返回 null', client.parseRunningApps('x') === null)
  check('apps 非数组返回 null', client.parseRunningApps({ ok: true, apps: {} }) === null)
}

console.log('[running-apps] 匹配打分')
{
  const a = win({ title: 'ChatGPT', process: 'chrome' })
  const b = win({ title: 'Chrome 帮助', process: 'chrome' })
  check('空查询恒命中', client.scoreApp('', a) === 0)
  check('标题前缀 > 标题子串', client.scoreApp('chat', a) > client.scoreApp('chat', win({ title: 'x ChatGPT' })))
  check('标题命中 > 仅进程名命中', client.scoreApp('chrome', b) > client.scoreApp('chrome', win({ title: 'QQ', process: 'chrome' })))
  check('不命中返回 -1', client.scoreApp('zzz', a) === -1)
  check('前台窗口有加成', client.scoreApp('chat', win({ title: 'ChatGPT', focused: true })) > client.scoreApp('chat', a))
  check('中文子串命中', client.scoreApp('哔哩', win({ title: '哔哩哔哩', process: 'bilibili' })) > 0)
  check('大小写不敏感', client.scoreApp('CHAT', a) === client.scoreApp('chat', a))
}

console.log('[running-apps] 排序与截断')
{
  const list = [
    win({ title: '哔哩哔哩', process: 'bilibili' }),
    win({ title: 'ChatGPT', process: 'chrome', focused: true }),
    win({ title: '记事本', process: 'notepad' }),
  ]
  const ranked = client.rankApps(list, '')
  check('空查询按原序返回全部', ranked.length === 3 && ranked[0].title === '哔哩哔哩')
  const chat = client.rankApps(list, 'chat')
  check('查询只留命中项', chat.length === 1 && chat[0].title === 'ChatGPT')
  check('limit 生效', client.rankApps(list, '', 2).length === 2)
  check('前台优先于同分项', client.rankApps([
    win({ title: 'Aaa', focused: false }),
    win({ title: 'Aab', focused: true }),
  ], 'a')[0].focused === true)
}

console.log('[running-apps] 标题清洗与副标题')
{
  const chrome = client.cleanWindowTitle('Example Domain - Google Chrome')
  check('剥掉 Chrome 后缀', chrome.title === 'Example Domain' && chrome.browser === 'Chrome', JSON.stringify(chrome))
  const edge = client.cleanWindowTitle('首页-个性推荐-哔哩哔哩 - Microsoft Edge')
  check('剥掉 Edge 后缀', edge.title === '首页-个性推荐-哔哩哔哩' && edge.browser === 'Edge', JSON.stringify(edge))
  const firefox = client.cleanWindowTitle('MDN — Mozilla Firefox')
  check('剥掉 Firefox 后缀', firefox.title === 'MDN' && firefox.browser === 'Firefox', JSON.stringify(firefox))
  const plain = client.cleanWindowTitle('记事本')
  check('无后缀原样返回', plain.title === '记事本' && plain.browser === '')
  const onlyBrowser = client.cleanWindowTitle('Google Chrome')
  check('剥完为空则不剥', onlyBrowser.title === 'Google Chrome')
  check('appLabel 用清洗后的标题', client.appLabel(win({ title: 'Example Domain - Google Chrome' })) === 'Example Domain')
  check('浏览器窗口副标题是浏览器名', client.appSubtitle(win({ title: 'Example Domain - Google Chrome', process: 'chrome' })) === 'Chrome')
  check('进程名重复时退回可执行文件名', client.appSubtitle(win({ title: 'DeepSeek Harness', process: 'DeepSeek Harness', exe: 'D:\\DeepSeek Harness\\DeepSeek Harness.exe' })) === 'DeepSeek Harness.exe')
  check('进程名不重复时显示进程名', client.appSubtitle(win({ title: '哔哩哔哩', process: 'bilibili' })) === 'bilibili')
  check('无进程名退回可执行文件名', client.appSubtitle(win({ process: '', title: 'x', exe: 'C:\\a.exe' })) === 'a.exe')
  check('什么都没有返回空串', client.appSubtitle(win({ process: '', title: 'x', exe: null })) === '')
  const long = win({ title: 'x'.repeat(120) })
  check('超长标题截断', client.appLabel(long).length <= 60 && client.appLabel(long).endsWith('…'))
  check('短标题原样', client.appLabel(win({ title: 'abc' })) === 'abc')
}

console.log('[running-apps] 引用编解码')
{
  const app = win({ pid: 4242, title: 'ChatGPT - Google Chrome' })
  const ref = client.appRef(app)
  check('ref 形如 pid:title', ref === '4242:ChatGPT - Google Chrome', ref)
  const back = client.parseAppRef(ref)
  check('ref 可反解', back !== null && back.pid === 4242 && back.title === 'ChatGPT - Google Chrome')
  check('坏 ref 返回 null', client.parseAppRef('nope') === null)
  check('空标题 ref 返回 null', client.parseAppRef('1:') === null)
  check('非数字 pid 返回 null', client.parseAppRef('x:y') === null)
  check('标题里含冒号也能反解', client.parseAppRef('7:a:b:c')?.title === 'a:b:c')
}

console.log('[running-apps] 序列化（模型看到什么）')
{
  const app = win({ pid: 4242, title: 'ChatGPT - Google Chrome', focused: true })
  const text = client.serializeAppRef(client.appRef(app), [app])
  check('带程序名', text.includes('程序：chrome'), text)
  check('带窗口标题', text.includes('窗口标题：ChatGPT - Google Chrome'), text)
  check('带路径', text.includes('路径：'), text)
  check('带前台状态', text.includes('当前前台窗口'), text)
  const minimized = client.serializeAppRef(client.appRef(win({ pid: 1, title: 'T', minimized: true })), [win({ pid: 1, title: 'T', minimized: true })])
  check('带最小化状态', minimized.includes('已最小化'), minimized)
  const missing = client.serializeAppRef('9:不存在', [])
  check('找不到时退化成可读文本', missing.includes('不存在') && missing.includes('pid 9'), missing)
  check('坏 ref 原样返回', client.serializeAppRef('bad', []) === 'bad')
}

console.log('[running-apps] host 采集脚本判据')
{
  const script = host.runningAppsTest.COLLECTOR_SCRIPT
  check('含窗口可见性过滤', script.includes('IsWindowVisible'))
  check('含 toolwindow 过滤', script.includes('GetWindowLong(h, -16)'))
  check('含 owner 窗口过滤（浮层）', script.includes('GetWindow(h, 4)'))
  check('含桌面外壳类名过滤', script.includes('Progman') && script.includes('Shell_TrayWnd'))
  check('含进程级噪声过滤', script.includes('TextInputHost'))
  check('输出 UTF-8', script.includes('[Console]::OutputEncoding'))
  check('主循环读 stdin', script.includes('[Console]::In.ReadLine()'))
  check('图标走 ExtractAssociatedIcon', script.includes('ExtractAssociatedIcon'))
  check('回包分隔符存在', typeof host.runningAppsTest.END_MARK === 'string' && host.runningAppsTest.END_MARK.length > 0)
  check('含父进程看门狗（宿主被强杀不留孤儿 pwsh）', script.includes('WatchParent') && script.includes('WaitForSingleObject'))
  // 性能：枚举与进程查询必须在 C# 里（PowerShell 逐句循环实测 500ms）
  check('枚举与进程查询写在 C# 里（性能）', script.includes('public static string Collect()') && script.includes('Process.GetProcessById'))
  // ⚠ 这条是踩过的坑：传 -ReferencedAssemblies 会让 Add-Type 静默失败
  check('Add-Type 不传 ReferencedAssemblies（传了会静默编译失败）', !script.includes('-ReferencedAssemblies'))
  check('System.Drawing 用 -AssemblyName 单独加载', script.includes('Add-Type -AssemblyName System.Drawing'))
  const source = readFileSync(resolve(ROOT, 'src/running-apps/collect.ts'), 'utf8')
  check('用 -EncodedCommand 传脚本（stdin 模式会让过滤失效）', source.includes("'-EncodedCommand'"))
  check('不再从 stdin 灌脚本', !source.includes('proc.stdin.write(COLLECTOR_SCRIPT)'))
}

console.log('[running-apps] host 归一化与排序')
{
  const norm = host.runningAppsTest.normalizeWindow
  check('空标题丢弃', norm({ title: '  ' }) === null)
  check('非对象丢弃', norm(null) === null)
  const ok = norm({ title: ' x ', pid: 9, process: 'p', focused: true })
  check('正常条目归一', ok !== null && ok.title === 'x' && ok.pid === 9 && ok.focused === true)
  check('缺字段补默认值', ok !== null && ok.icon === null && ok.exe === null && ok.minimized === false)
  const sorted = host.runningAppsTest.sortWindows([
    win({ title: 'min', minimized: true }),
    win({ title: 'bg' }),
    win({ title: 'fg', focused: true }),
  ])
  check('前台第一、最小化最后', sorted[0].title === 'fg' && sorted[2].title === 'min')
}

console.log('[running-apps] 实时性（不得有任何缓存层）')
{
  const hostSrc = readFileSync(resolve(ROOT, 'src/running-apps/collect.ts'), 'utf8')
  const hostTypes = readFileSync(resolve(ROOT, 'src/running-apps/types.ts'), 'utf8')
  const clientSrc = readFileSync(resolve(ROOT, 'src/client/running-apps/index.tsx'), 'utf8')
  const routeSrc = readFileSync(resolve(ROOT, 'src/running-apps/index.ts'), 'utf8')
  // 这三条是「@ 不是实时」那个 bug 的根因，钉死不许回来。
  check('host 侧无 TTL 常量', !hostTypes.includes('RUNNING_APPS_TTL_MS') && !hostSrc.includes('RUNNING_APPS_TTL_MS'))
  check('host 侧无结果缓存写入', !hostSrc.includes('state.cache'))
  check('client 侧无 CACHE_MS 缓存窗口', !clientSrc.includes('CACHE_MS'))
  check('client 侧保留并发去重（inFlight）', clientSrc.includes('inFlight'))
  check('client 侧保留失败兜底（lastKnown）', clientSrc.includes('lastKnown'))
  check('路由不再读 force 参数', !routeSrc.includes('searchParams.get(\'force\')'))
}

console.log('[running-apps] 路由契约')
{
  check('客户端与 host 路由逐字一致', client.RUNNING_APPS_ROUTE === host.RUNNING_APPS_ROUTE)
  check('路由形状正确', /^\/api\/[a-z-]+\/[a-z-]+$/.test(client.RUNNING_APPS_ROUTE), client.RUNNING_APPS_ROUTE)
  check('source 名与引用前缀都存在', client.RUNNING_APPS_SOURCE === 'running-apps' && client.RUNNING_APPS_MENTION_PREFIX === '@app:')
  check('样式注入函数已导出', typeof styles.injectRunningAppsStyles === 'function')
  check('样式表含图标座位', styles.RUNNING_APPS_CSS.includes('data-dsh-ra-icon'))
  check('样式表遵守 reduced-motion', styles.RUNNING_APPS_CSS.includes('prefers-reduced-motion'))
}

if (failures > 0) {
  console.error('\n[running-apps] ' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n[running-apps] 全部通过')
