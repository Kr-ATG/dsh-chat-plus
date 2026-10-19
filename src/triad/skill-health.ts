/**
 * skill-health — 技能目录健康检查（host 半身）。
 *
 * 同步状态卡片的数据源。不修改 vendored skills-host.js：独立的只读检查器，
 * 扫描与 skill-manager 相同的两个技能根目录 + bundle 账本：
 *
 *   1. missing-skill-md   —— 目录缺少 SKILL.md（`/api/skill-manager/list`
 *      会静默忽略这类目录，面板里根本看不到，属于「隐形坏目录」）
 *   2. bad-frontmatter    —— SKILL.md 无有效 name 字段
 *   3. name-mismatch      —— 目录名与 frontmatter name 不一致（文件查看器
 *      按 name 找目录，不一致会导致打开文件 404）
 *   4. dangling-bundle    —— .bundles.json 引用了不存在的技能目录
 *
 * 只读：不做任何修复/写入；issue 分 error / warn 两级。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

const SKILL_FILE = 'SKILL.md'
const BUNDLES_FILE = '.bundles.json'
const ROUTE_PATH = '/api/skill-health'

/** skill-manager 同款根目录定义。 */
function managedRoot(): string {
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')
  return join(agentsHome, 'skills')
}

function dshRoot(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'skills')
}

/** skill-manager 同款 frontmatter 解析（naive line parser）。 */
function parseFrontmatter(raw: string): Record<string, string | boolean> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  const block = match?.[1]
  if (block === undefined) return {}
  const fields: Record<string, string | boolean> = {}
  for (const line of block.split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    const key = pair?.[1]
    const valueText = pair?.[2]
    if (key === undefined || valueText === undefined) continue
    const value = valueText.trim()
    if (value === 'true') fields[key] = true
    else if (value === 'false') fields[key] = false
    else fields[key] = value
  }
  return fields
}

/** skill-manager 同款 bundle 账本读取。 */
interface BundleRecord { id: string; name: string; skills: string[] }

async function readBundles(root: string): Promise<{ version: number; bundles: BundleRecord[] }> {
  try {
    const parsed = JSON.parse(await readFile(join(root, BUNDLES_FILE), 'utf8')) as unknown
    if (typeof parsed === 'object' && parsed !== null && (parsed as { version?: unknown }).version === 1 && Array.isArray((parsed as { bundles?: unknown }).bundles)) {
      return parsed as { version: number; bundles: BundleRecord[] }
    }
  } catch {
    /* fall through to empty ledger */
  }
  return { version: 1, bundles: [] }
}

/** 一条健康问题。 */
export interface HealthIssue {
  level: 'error' | 'warn'
  code: 'missing-skill-md' | 'bad-frontmatter' | 'name-mismatch' | 'dangling-bundle'
  skill?: string
  bundle?: string
  message: string
}

/** 健康报告：ok = 无 error 级问题。 */
export interface HealthReport {
  ok: boolean
  healthy: number
  issues: HealthIssue[]
}

interface DirentLike { name: string }

/**
 * 技能根下的目录条目，符号链接/junction 也算。
 *
 * 安装器（ego lite 的 `~/.agents/skills/ego-browser` 就是一例）常把技能以
 * junction 挂进技能根；Node 的 readdir 对 junction 给 isDirectory()=false +
 * isSymbolicLink()=true，只按 isDirectory() 过滤会把整片技能当不存在。
 */
async function listRootDirEntries(root: string): Promise<DirentLike[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const out: DirentLike[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      out.push({ name: entry.name })
      continue
    }
    if (!entry.isSymbolicLink()) continue
    try {
      if ((await stat(join(root, entry.name))).isDirectory()) out.push({ name: entry.name })
    } catch {
      // 断链：跳过
    }
  }
  return out
}

/** 扫描一个根目录；返回健康技能数，顺带把目录名/有效名写回 nameSet。 */
async function scanRoot(root: string, nameSet: Set<string>): Promise<{ healthy: number; issues: HealthIssue[] }> {
  const issues: HealthIssue[] = []
  let entries: DirentLike[] = []
  try {
    entries = await listRootDirEntries(root)
  } catch {
    return { healthy: 0, issues }
  }
  let healthy = 0
  for (const entry of entries) {
    nameSet.add(entry.name)
    let raw: string
    try {
      raw = await readFile(join(root, entry.name, SKILL_FILE), 'utf8')
    } catch {
      issues.push({
        level: 'error',
        code: 'missing-skill-md',
        skill: entry.name,
        message: `目录「${entry.name}」缺少 ${SKILL_FILE}，技能面板不会显示它`,
      })
      continue
    }
    const fields = parseFrontmatter(raw)
    const fmName = typeof fields.name === 'string' && fields.name !== '' ? fields.name : null
    if (fmName === null || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(fmName)) {
      issues.push({
        level: 'error',
        code: 'bad-frontmatter',
        skill: entry.name,
        message: `「${entry.name}」的 ${SKILL_FILE} 缺少有效的 name 字段`,
      })
      continue
    }
    nameSet.add(fmName)
    if (fmName !== entry.name) {
      issues.push({
        level: 'warn',
        code: 'name-mismatch',
        skill: entry.name,
        message: `目录「${entry.name}」与 frontmatter name「${fmName}」不一致，打开技能文件可能 404`,
      })
    }
    healthy += 1
  }
  return { healthy, issues }
}

/** 执行完整健康检查（只读）。 */
export async function healthCheck(): Promise<HealthReport> {
  const issues: HealthIssue[] = []
  const nameSet = new Set<string>()
  const a = await scanRoot(managedRoot(), nameSet)
  const b = await scanRoot(dshRoot(), nameSet)
  const healthy = a.healthy + b.healthy
  issues.push(...a.issues, ...b.issues)

  // bundle 账本悬挂引用：引用了两个根目录里都不存在的技能。
  const ledger = await readBundles(managedRoot())
  for (const record of ledger.bundles) {
    for (const skillName of record.skills) {
      if (!nameSet.has(skillName)) {
        issues.push({
          level: 'error',
          code: 'dangling-bundle',
          skill: skillName,
          bundle: record.name,
          message: `Bundle「${record.name}」引用了不存在的技能「${skillName}」`,
        })
      }
    }
  }

  return { ok: issues.every((issue) => issue.level !== 'error'), healthy, issues }
}

/* ── HTTP 路由（与 skill-manager 同款 loopback 校验） ────────────────── */

function isLoopbackAddress(address: string | undefined): boolean {
  if (typeof address !== 'string') return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const ipv4 = a.startsWith('::ffff:') ? a.slice(7) : a
  const octets = ipv4.split('.')
  return octets.length === 4 && octets[0] === '127' && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function hostNameOf(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close <= 1) return null
    const suffix = host.slice(close + 1)
    if (suffix !== '' && !/^:\d+$/.test(suffix)) return null
    return host.slice(1, close)
  }
  const firstColon = host.indexOf(':')
  const lastColon = host.lastIndexOf(':')
  if (firstColon !== lastColon) return null
  return firstColon === -1 ? host : host.slice(0, firstColon)
}

function loopbackAllowed(req: { socket: { remoteAddress?: string }; headers: { host?: string } }): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = hostNameOf(req.headers.host)
  if (host === null) return false
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function json(res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(body)
}

/** 注册 GET /api/skill-health。 */
export function applySkillHealth(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PATH,
    handler: (req: { socket: { remoteAddress?: string }; headers: { host?: string } }, res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }) => {
      void (async () => {
        if (!loopbackAllowed(req)) {
          json(res, 403, { error: 'loopback-only' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname === ROUTE_PATH || url.pathname === `${ROUTE_PATH}/`) {
          json(res, 200, await healthCheck())
          return
        }
        json(res, 404, { error: `no route for ${req.method ?? 'GET'} ${url.pathname}` })
      })()
    },
  }), 'dsh-skill-health: routes')
}
