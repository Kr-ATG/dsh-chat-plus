/**
 * dsh-chat-plus — 工作区 Git 状态与一键提交服务（host 半身）。
 *
 * 核心能力：
 *  1. GET  /api/chat-flow/git-status         —— 状态只读：分支、最后提交、改动列表、是否需要合并（needsMerge）；
 *  2. POST /api/chat-flow/git-commit-message —— AI 生成提交备注：依据真实工作区的所有 diff 综合生成规范 commit message；
 *  3. POST /api/chat-flow/git-commit         —— 脚本化提交与推送：执行 add, commit, push 并返回详细结果。
 *
 * 容错与安全：
 *  - 严格走 execFile，参数定长，不经过 shell，天然防命令注入；
 *  - 请求过 rejectCrossSite 闸门；
 *  - 任何分支判断与 Git 异常均平稳兜底，绝不 500。
 *
 * @module
 */

import { execFile } from 'node:child_process'
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { rejectCrossSite } from '../shared/csrf.ts'
import { BlockAssembler, createUserMessage } from '../vendor/dsh-llm/index.ts'

const execFileAsync = promisify(execFile)

/** 路由路径。 */
export const GIT_STATUS_ROUTE = '/api/chat-flow/git-status'
export const GIT_COMMIT_MESSAGE_ROUTE = '/api/chat-flow/git-commit-message'
export const GIT_COMMIT_ROUTE = '/api/chat-flow/git-commit'

/** 单次 git 查询超时（毫秒）。 */
const GIT_TIMEOUT_MS = 3000
/** git commit/push 超时（毫秒）。 */
const GIT_PUSH_TIMEOUT_MS = 20000

/** 相对时间格式化。 */
export function formatRelativeTime(timestampSec: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(timestampSec) || timestampSec <= 0) return '未知时间'
  const diffSec = Math.max(0, Math.floor((nowMs - timestampSec * 1000) / 1000))
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) {
    const d = new Date(timestampSec * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  if (diffDays < 30) return `${diffDays}天前`
  const d = new Date(timestampSec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface GitCommitInfo {
  readonly timestamp: number
  readonly relative: string
  readonly subject: string
  readonly hash: string
  readonly dateIso: string
}

export interface GitFileChange {
  readonly path: string
  readonly status: 'M' | 'A' | 'D' | 'R' | '?' | 'U'
  readonly rawCode: string
}

export interface GitStatusPayload {
  readonly ok: boolean
  readonly isGit: boolean
  readonly cwd?: string
  readonly branch?: string
  readonly lastCommit?: GitCommitInfo
  readonly pendingCount: number
  readonly stagedCount: number
  readonly unstagedCount: number
  readonly clean: boolean
  readonly pendingFiles: readonly string[]
  readonly changes?: readonly GitFileChange[]
  readonly diffStat?: string
  readonly needsMerge: boolean
  readonly mergeReason?: 'conflict' | 'behind' | 'merging'
  readonly aheadCount: number
  readonly behindCount: number
  readonly error?: string
}

/** 异步执行 git 命令。 */
async function runGit(args: string[], cwd: string, timeoutMs: number = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout.trim()
}

/** 冲突状态码合集。 */
const CONFLICT_CODES = new Set(['UU', 'AA', 'UD', 'DU', 'UA', 'AU', 'DD'])

/**
 * 采集某个目录的 Git 状态。
 */
export async function collectGitStatus(targetPath?: string): Promise<GitStatusPayload> {
  const fallbackCwd = process.cwd()
  let cwd = typeof targetPath === 'string' && targetPath.trim() !== '' ? resolve(targetPath) : fallbackCwd

  try {
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      cwd = fallbackCwd
    }
  } catch {
    cwd = fallbackCwd
  }

  // 1. 判断是否在 git 仓库内
  try {
    const isInside = await runGit(['rev-parse', '--is-inside-work-tree'], cwd)
    if (isInside !== 'true') {
      return {
        ok: true,
        isGit: false,
        cwd,
        pendingCount: 0,
        stagedCount: 0,
        unstagedCount: 0,
        clean: true,
        pendingFiles: [],
        needsMerge: false,
        aheadCount: 0,
        behindCount: 0,
      }
    }
  } catch {
    return {
      ok: true,
      isGit: false,
      cwd,
      pendingCount: 0,
      stagedCount: 0,
      unstagedCount: 0,
      clean: true,
      pendingFiles: [],
      needsMerge: false,
      aheadCount: 0,
      behindCount: 0,
    }
  }

  // 2. 取当前分支名
  let branch = ''
  try {
    branch = await runGit(['branch', '--show-current'], cwd)
    if (branch === '') {
      branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    }
  } catch {
    branch = 'HEAD'
  }

  // 3. 检查是否有合并中文件（MERGE_HEAD / REBASE_HEAD 等）
  let needsMerge = false
  let mergeReason: 'conflict' | 'behind' | 'merging' | undefined

  try {
    const gitDir = await runGit(['rev-parse', '--git-dir'], cwd)
    const resolvedGitDir = resolve(cwd, gitDir)
    if (
      existsSync(join(resolvedGitDir, 'MERGE_HEAD')) ||
      existsSync(join(resolvedGitDir, 'REBASE_HEAD')) ||
      existsSync(join(resolvedGitDir, 'CHERRY_PICK_HEAD'))
    ) {
      needsMerge = true
      mergeReason = 'merging'
    }
  } catch {
    /* 忽略检查失败 */
  }

  // 4. 取最近一次提交信息
  let lastCommit: GitCommitInfo | undefined
  try {
    const logRaw = await runGit(['log', '-1', '--format=%ct%x00%s%x00%h%x00%cd', '--date=iso'], cwd)
    if (logRaw !== '') {
      const parts = logRaw.split('\0')
      const timestamp = Number.parseInt(parts[0] ?? '0', 10)
      const subject = parts[1] ?? ''
      const hash = parts[2] ?? ''
      const dateIso = parts[3] ?? ''
      lastCommit = {
        timestamp,
        relative: formatRelativeTime(timestamp),
        subject,
        hash,
        dateIso,
      }
    }
  } catch {
    // 仓库为空库
  }

  // 5. 检查与远程跟踪分支的落后与领先情况（ahead / behind）
  let aheadCount = 0
  let behindCount = 0
  try {
    const upstream = await runGit(['rev-parse', '--abbrev-ref', '@{u}'], cwd).catch(() => '')
    if (upstream !== '') {
      const behindRaw = await runGit(['rev-list', '--count', 'HEAD..@{u}'], cwd).catch(() => '0')
      behindCount = Number.parseInt(behindRaw, 10) || 0
      const aheadRaw = await runGit(['rev-list', '--count', '@{u}..HEAD'], cwd).catch(() => '0')
      aheadCount = Number.parseInt(aheadRaw, 10) || 0

      if (behindCount > 0 && !needsMerge) {
        needsMerge = true
        mergeReason = 'behind'
      }
    }
  } catch {
    /* 无跟踪分支 */
  }

  // 6. 取待提交文件状态
  let pendingCount = 0
  let stagedCount = 0
  let unstagedCount = 0
  const pendingFiles: string[] = []
  const changes: GitFileChange[] = []

  try {
    const statusRaw = await runGit(['status', '--porcelain=v1'], cwd)
    if (statusRaw !== '') {
      const lines = statusRaw.split('\n').filter((l) => l.trim().length > 0)
      pendingCount = lines.length

      for (const line of lines) {
        const match = line.match(/^\s*([MADRCU?!]{1,2})\s+(.+)$/)
        const code = match ? match[1].trim() : line.slice(0, 2).trim()
        const filePath = match ? match[2].trim() : line.slice(3).trim()

        if (CONFLICT_CODES.has(code) && !needsMerge) {
          needsMerge = true
          mergeReason = 'conflict'
        }

        const x = code[0] ?? ' '
        const y = code[1] ?? ' '
        if (x !== ' ' && x !== '?') stagedCount++
        if (y !== ' ' || x === '?') unstagedCount++

        if (pendingFiles.length < 20 && filePath !== '') {
          pendingFiles.push(filePath)
        }

        let changeStatus: GitFileChange['status'] = 'M'
        if (code.includes('?')) changeStatus = '?'
        else if (code.includes('A')) changeStatus = 'A'
        else if (code.includes('D')) changeStatus = 'D'
        else if (code.includes('R')) changeStatus = 'R'
        else if (code.includes('U')) changeStatus = 'U'

        changes.push({
          path: filePath,
          status: changeStatus,
          rawCode: code,
        })
      }
    }
  } catch (err) {
    return {
      ok: false,
      isGit: true,
      cwd,
      branch,
      lastCommit,
      pendingCount: 0,
      stagedCount: 0,
      unstagedCount: 0,
      clean: true,
      pendingFiles: [],
      needsMerge: false,
      aheadCount: 0,
      behindCount: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  // 7. 取 diff stat 简述
  let diffStat = ''
  try {
    diffStat = await runGit(['diff', 'HEAD', '--stat'], cwd).catch(() => '')
    if (diffStat === '' && pendingCount > 0) {
      diffStat = `共 ${pendingCount} 个待提交变更`
    }
  } catch {
    /* 忽略 */
  }

  return {
    ok: true,
    isGit: true,
    cwd,
    branch,
    lastCommit,
    pendingCount,
    stagedCount,
    unstagedCount,
    clean: pendingCount === 0,
    pendingFiles,
    changes,
    diffStat,
    needsMerge,
    mergeReason,
    aheadCount,
    behindCount,
  }
}

/**
 * 用模型基于实际的工作区改动生成结构化提交备注。
 */
export async function generateCommitMessage(
  rootCtx: any,
  cwd: string,
  modelSelection?: { provider?: string; model?: string },
): Promise<string> {
  // 1. 采集实际的所有文件改动和 diff
  let diffContent = ''
  try {
    diffContent = await runGit(['diff', 'HEAD', '--no-ext-diff'], cwd)
  } catch {
    /* 忽略 */
  }

  let statusSummary = ''
  try {
    statusSummary = await runGit(['status', '--short'], cwd)
  } catch {
    /* 忽略 */
  }

  if (diffContent === '' && statusSummary === '') {
    return 'chore: 工作区微调'
  }

  // 截断 diff 防止过长（最多 6000 字符）
  const truncatedDiff = diffContent.length > 6000 ? diffContent.slice(0, 6000) + '\n...(更多改动省略)' : diffContent

  // 2. 解析使用的模型
  const llm = rootCtx?.get?.('llm')
  let provider = modelSelection?.provider
  let model = modelSelection?.model

  if (!provider || !model) {
    try {
      const defaultModel = rootCtx?.get?.('agentDefaultModel')
      const sel = defaultModel?.currentSelection?.()
      if (sel?.provider && sel?.model) {
        provider = sel.provider
        model = sel.model
      }
    } catch {
      /* 忽略 */
    }
  }

  // 3. 如果有可用 LLM，则调用模型生成
  if (llm && typeof llm.stream === 'function' && provider && model) {
    try {
      const prompt = [
        '请根据当前 Git 工作区的实际所有改动（包含未暂存与新增文件），撰写一条规范、准确、精炼的 Git 提交消息（Conventional Commits 规范）。',
        '',
        '【工作区文件变动清单】：',
        statusSummary,
        '',
        '【关键 Diff 内容】：',
        truncatedDiff,
        '',
        '【输出硬性要求】：',
        '1. 第一行为核心摘要，格式为: <type>(<scope>): <简明总结>（不超过 60 字，例如 feat(ui): ... 或 fix(git): ...）；',
        '2. 如果包含多个关键改动，在空一行后用 2-4 条短横线列出核心要点；',
        '3. 必须如实反映给出的真实文件改动，绝不可瞎编不存在的功能；',
        '4. 纯文本输出，严禁输出任何 markdown 围栏（如 ```）或多余解释客套话。',
      ].join('\n')

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)
      const options = {
        provider,
        model,
        messages: [
          createUserMessage({
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'plugin:dsh-git-status', plugin: 'dsh-git-status' },
          }),
        ],
        signal: controller.signal,
        maxTokens: 500,
      }

      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream(options)) {
        assembler.push(chunk)
      }
      clearTimeout(timer)

      const resultText = assembler.blocks()
        .filter(b => b.type === 'text')
        .map(b => (b as { text?: string }).text ?? '')
        .join('')
        .trim()
        .replace(/^\`\`\`[a-zA-Z]*\n?/g, '')
        .replace(/\`\`\`$/g, '')
        .trim()

      if (resultText !== '') {
        return resultText
      }
    } catch (llmErr) {
      console.warn('[git-commit-message] LLM 生成出错，使用内置高质量规则生成:', llmErr)
    }
  }

  // 4. 兜底高质量规则生成
  const lines = statusSummary.split('\n').filter(l => l.trim().length > 0)
  const firstMatch = lines[0]?.match(/^\s*[MADRCU?!]{1,2}\s+(.+)$/)
  const firstPath = firstMatch ? firstMatch[1].trim() : lines[0]?.slice(3).trim() ?? ''
  let type = 'feat'
  if (lines.some(l => l.includes('test') || l.includes('smoke'))) type = 'test'
  else if (lines.some(l => l.includes('fix') || l.includes('bug'))) type = 'fix'
  else if (lines.every(l => l.includes('.md') || l.includes('doc'))) type = 'docs'

  const rawScope = firstPath.split(/[/\\]/)[0] ?? 'workspace'
  const scope = rawScope.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '') || 'workspace'
  return `${type}(${scope}): 优化与更新 ${lines.length} 个文件变更`
}

/**
 * 执行脚本化 Git 提交并推送。
 */
export async function executeGitCommit(
  cwd: string,
  message: string,
  push: boolean = true,
): Promise<{ ok: boolean; hash?: string; pushed?: boolean; output?: string; error?: string }> {
  const commitMsg = message.trim() || 'chore: 工作区提交'

  try {
    // 1. git add -A
    await runGit(['add', '-A'], cwd)

    // 2. git commit -m
    const commitOut = await runGit(['commit', '-m', commitMsg], cwd)
    const hashMatch = commitOut.match(/\[[^\]]+\s+([a-f0-9]{7,8})\]/)
    const hash = hashMatch ? hashMatch[1] : ''

    // 3. git push (可选)
    let pushed = false
    let pushOut = ''
    if (push) {
      try {
        pushOut = await runGit(['push'], cwd, GIT_PUSH_TIMEOUT_MS)
        pushed = true
      } catch (pushErr: any) {
        // 如果远端不存在跟踪分支，尝试 push -u origin <currentBranch>
        try {
          const curBranch = await runGit(['branch', '--show-current'], cwd)
          if (curBranch) {
            pushOut = await runGit(['push', '-u', 'origin', curBranch], cwd, GIT_PUSH_TIMEOUT_MS)
            pushed = true
          }
        } catch {
          console.warn('[git-commit] push failed:', pushErr)
          // 提交本身已成功，标记 pushed 为 false
          return {
            ok: true,
            hash,
            pushed: false,
            output: `提交成功 (${hash})，但推送到远程失败: ${pushErr?.message || String(pushErr)}`,
          }
        }
      }
    }

    return {
      ok: true,
      hash,
      pushed,
      output: `提交成功 ${hash ? `[${hash}] ` : ''}${pushed ? '并已推送到远程' : ''}`.trim(),
    }
  } catch (err: any) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 路由 Handler。 */
export function handleGitStatusRoute(req: unknown, res: unknown): void {
  const respond = (status: number, payload: Record<string, unknown>): void => {
    try {
      const target = res as {
        writeHead?: (status: number, headers: Record<string, string>) => void
        end?: (body: string) => void
      }
      target.writeHead?.(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      target.end?.(JSON.stringify(payload))
    } catch {}
  }

  if (rejectCrossSite((req as { headers?: Record<string, unknown> })?.headers, (status, payload) => respond(status, payload))) {
    return
  }

  try {
    const rawReq = req as { url?: string }
    const url = new URL(rawReq.url ?? '/', 'http://127.0.0.1')
    const cwdParam = url.searchParams.get('cwd') ?? undefined

    void collectGitStatus(cwdParam)
      .then((data) => respond(200, data as unknown as Record<string, unknown>))
      .catch((err: unknown) => {
        respond(200, {
          ok: false,
          isGit: false,
          pendingCount: 0,
          stagedCount: 0,
          unstagedCount: 0,
          clean: true,
          pendingFiles: [],
          needsMerge: false,
          aheadCount: 0,
          behindCount: 0,
          error: err instanceof Error ? err.message : String(err),
        })
      })
  } catch (err: unknown) {
    respond(200, {
      ok: false,
      isGit: false,
      pendingCount: 0,
      stagedCount: 0,
      unstagedCount: 0,
      clean: true,
      pendingFiles: [],
      needsMerge: false,
      aheadCount: 0,
      behindCount: 0,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** 读 JSON 请求体。 */
function readJsonBody(req: unknown, maxBytes: number = 32 * 1024): Promise<Record<string, unknown>> {
  return new Promise((res, rej) => {
    const r = req as any
    const chunks: Buffer[] = []
    let total = 0
    r.on('data', (c: any) => {
      chunks.push(c)
      total += c.length
      if (total > maxBytes) rej(new Error('body too large'))
    })
    r.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        res(text ? JSON.parse(text) : {})
      } catch (e) {
        rej(e)
      }
    })
    r.on('error', rej)
  })
}


export const GIT_ROSTER_ROUTE = '/api/chat-flow/git-roster'

export interface GitRosterItem {
  readonly name: string
  readonly path: string
  readonly category: 'workspace' | 'plugin'
  readonly isGit: boolean
  readonly branch?: string
  readonly lastCommit?: GitCommitInfo
  readonly pendingCount: number
  readonly conflictCount: number
  readonly clean: boolean
  readonly needsMerge: boolean
  readonly mergeReason?: 'conflict' | 'behind' | 'merging'
  readonly aheadCount: number
  readonly behindCount: number
  readonly error?: string
}

export interface GitRosterPayload {
  readonly ok: boolean
  readonly workspaces: readonly GitRosterItem[]
  readonly plugins: readonly GitRosterItem[]
}
/**
 * 采集全局所有工作区与自制插件的 Git 状态汇总。
 */
export async function collectGitRoster(extraWorkspacePaths?: string[]): Promise<GitRosterPayload> {
  const currentCwd = process.cwd()
  let repoRoot = currentCwd
  if (existsSync(join(currentCwd, 'dsh-chat-plus'))) {
    repoRoot = currentCwd
  } else if (existsSync(join(resolve(currentCwd, '..'), 'dsh-chat-plus'))) {
    repoRoot = resolve(currentCwd, '..')
  }

  // 1. 发现所有自制插件目录（以 Dsh 根目录下各独立 Git 插件为主）
  const pluginMap = new Map<string, string>() // name -> path
  try {
    const entries = readdirSync(repoRoot, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.isDirectory() && ent.name !== 'node_modules' && ent.name !== '_tmp' && ent.name !== 'dsh-runtime') {
        const full = join(repoRoot, ent.name)
        if (existsSync(join(full, '.git')) && existsSync(join(full, 'package.json'))) {
          pluginMap.set(ent.name, full)
        }
      }
    }
  } catch {}

  // 2. 汇总所有真实工作区目录（精准对齐侧边栏 workspace.json 活跃列表）
  const workspaceMap = new Map<string, string>() // path -> name
  const home = homedir()

  // 渠道 A: ~/.dsh/storages/workspace.json 活跃工作区列表
  const wpJsonPath = join(home, '.dsh', 'storages', 'workspace.json')
  if (existsSync(wpJsonPath)) {
    try {
      const data = JSON.parse(readFileSync(wpJsonPath, 'utf8'))
      const activeIds: string[] = Array.isArray(data.global?.workspaceIds) ? data.global.workspaceIds : []
      const ws = data.tables?.workspaces || {}
      if (activeIds.length > 0) {
        for (const id of activeIds) {
          const item = ws[id]
          if (item?.path && existsSync(item.path)) {
            const norm = resolve(item.path)
            workspaceMap.set(norm, item.title || basename(norm))
          }
        }
      } else {
        for (const [id, item] of Object.entries(ws as Record<string, { path?: string; title?: string }>)) {
          if (item?.path && existsSync(item.path)) {
            const norm = resolve(item.path)
            workspaceMap.set(norm, item.title || basename(norm))
          }
        }
      }
    } catch {}
  }

  // 渠道 B: 客户端活跃工作区服务传参
  if (Array.isArray(extraWorkspacePaths)) {
    for (const wp of extraWorkspacePaths) {
      if (typeof wp === 'string' && wp.trim() !== '' && existsSync(wp)) {
        const norm = resolve(wp)
        if (!workspaceMap.has(norm)) {
          workspaceMap.set(norm, basename(norm))
        }
      }
    }
  }

  // 渠道 C: 当前工作区根目录兜底（若以上都没有）
  if (workspaceMap.size === 0) {
    const normRoot = resolve(repoRoot)
    workspaceMap.set(normRoot, basename(normRoot) || 'Dsh')
  }
  // 从工作区中过滤掉已经在自制插件列表里的目录，保持分类纯净
  const pluginPaths = new Set(Array.from(pluginMap.values()).map(p => resolve(p)))
  for (const wp of Array.from(workspaceMap.keys())) {
    if (pluginPaths.has(wp)) {
      workspaceMap.delete(wp)
    }
  }

  // 3. 并发采集状态
  const [workspaceResults, pluginResults] = await Promise.all([
    Promise.all(
      Array.from(workspaceMap.entries()).map(async ([p, name]): Promise<GitRosterItem> => {
        const st = await collectGitStatus(p)
        const conflictCount = st.changes?.filter(c => c.status === 'U').length || (st.mergeReason === 'conflict' ? 1 : 0)
        return {
          name,
          path: p,
          category: 'workspace',
          isGit: st.isGit,
          branch: st.branch,
          lastCommit: st.lastCommit,
          pendingCount: st.pendingCount,
          conflictCount,
          clean: st.clean,
          needsMerge: st.needsMerge,
          mergeReason: st.mergeReason,
          aheadCount: st.aheadCount,
          behindCount: st.behindCount,
          error: st.error,
        }
      })
    ),
    Promise.all(
      Array.from(pluginMap.entries()).map(async ([name, p]): Promise<GitRosterItem> => {
        const st = await collectGitStatus(p)
        const conflictCount = st.changes?.filter(c => c.status === 'U').length || (st.mergeReason === 'conflict' ? 1 : 0)
        return {
          name,
          path: p,
          category: 'plugin',
          isGit: st.isGit,
          branch: st.branch,
          lastCommit: st.lastCommit,
          pendingCount: st.pendingCount,
          conflictCount,
          clean: st.clean,
          needsMerge: st.needsMerge,
          mergeReason: st.mergeReason,
          aheadCount: st.aheadCount,
          behindCount: st.behindCount,
          error: st.error,
        }
      })
    ),
  ])

  // 排序：有冲突或待提交的优先靠前展示，其余按字母排序
  const sorter = (a: GitRosterItem, b: GitRosterItem): number => {
    if (a.conflictCount !== b.conflictCount) return b.conflictCount - a.conflictCount
    if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount
    return a.name.localeCompare(b.name)
  }

  return {
    ok: true,
    workspaces: workspaceResults.sort(sorter),
    plugins: pluginResults.sort(sorter),
  }
}

/** 注册全部 Git 相关路由。 */
export function applyGitStatusRoutes(webCtx: any, rootCtx?: any): void {
  if (webCtx?.webServer?.register === undefined) return

  // 1. GET 状态
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'exact',
    path: GIT_STATUS_ROUTE,
    handler: (req: unknown, res: unknown) => handleGitStatusRoute(req, res),
  }), 'dsh-chat-plus: git-status route')

  // 1.1 GET 全局工作区与自制插件大盘
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'exact',
    path: GIT_ROSTER_ROUTE,
    handler: async (req: any, res: any) => {
      const send = (code: number, data: any) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(data))
      }
      if (rejectCrossSite(req.headers, (status, payload) => send(status, payload))) return
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const extraRaw = url.searchParams.get('workspaces') ?? ''
        const extras = extraRaw ? extraRaw.split(',').map(s => s.trim()).filter(Boolean) : []
        const roster = await collectGitRoster(extras)
        send(200, roster)
      } catch (err: any) {
        send(200, { ok: false, workspaces: [], plugins: [], error: err?.message || String(err) })
      }
    },
  }), 'dsh-chat-plus: git-roster route')

  // 2. POST AI 提交备注生成
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'exact',
    path: GIT_COMMIT_MESSAGE_ROUTE,
    handler: async (req: any, res: any) => {
      const send = (code: number, data: any) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(data))
      }
      if (rejectCrossSite(req.headers, (status, payload) => send(status, payload))) return
      try {
        const body = await readJsonBody(req)
        const cwd = typeof body.cwd === 'string' ? body.cwd : process.cwd()
        const modelSelection = body.modelSelection as { provider?: string; model?: string } | undefined
        const message = await generateCommitMessage(rootCtx ?? webCtx, cwd, modelSelection)
        send(200, { ok: true, message })
      } catch (err: any) {
        send(200, { ok: false, error: err?.message || String(err) })
      }
    },
  }), 'dsh-chat-plus: git-commit-message route')

  // 3. POST 脚本提交执行
  webCtx.effect(() => webCtx.webServer.register({
    kind: 'exact',
    path: GIT_COMMIT_ROUTE,
    handler: async (req: any, res: any) => {
      const send = (code: number, data: any) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(data))
      }
      if (rejectCrossSite(req.headers, (status, payload) => send(status, payload))) return
      try {
        const body = await readJsonBody(req)
        const cwd = typeof body.cwd === 'string' ? body.cwd : process.cwd()
        const message = typeof body.message === 'string' ? body.message : ''
        const push = body.push !== false
        const result = await executeGitCommit(cwd, message, push)
        send(200, result)
      } catch (err: any) {
        send(200, { ok: false, error: err?.message || String(err) })
      }
    },
  }), 'dsh-chat-plus: git-commit route')
}
