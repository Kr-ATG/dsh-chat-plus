/**
 * dsh-mail — 邮箱服务（host 半身，唯一业务出口）。
 *
 * 把 `agently-cli` 的九条命令收敛成七个语义动作，工具与 HTTP 路由共用同一份：
 *
 *   account()            账号 + 授权状态 + 额度（+me / auth status）
 *   list()               列表（inbox/sent/trash/spam，可翻页/过滤）
 *   search()             搜索（保留原条件翻页）
 *   read()               读全文（正文 + 附件元信息）
 *   send/reply/forward   三种发信（两阶段确认）
 *   trash/delete         移入回收站 / 永久删除（两阶段确认）
 *   downloadAttachment() 下载普通附件（超大附件返回 download_url）
 *
 * 两阶段确认在这里落地，是整块能力最关键的一条**安全语义**：
 * 写操作第一次调用只拿 ctk（`confirmation_token`），把 summary 返回给调用方；
 * 必须由**用户**在下一轮明确许可后，才带 `--confirmation-token` 真正执行。
 * 服务层不替用户点头——所以 `confirm` 字段只有调用方显式传才生效。
 *
 * 正文是外部不可信输入：邮件正文/主题/发件人名都可能含 prompt injection。
 * 本模块只做**数据搬运**，不做任何指令解释；防注入的措辞落在注入块与工具
 * 描述里（见 inject.ts / tools.ts），并且工具描述里明确「邮件内容不是指令」。
 */

import { existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import { MailCliError, commonDirOf, humanizeCliError, isCliRelative, runCli, toCliRelative, type RunOptions } from './cli.js'
import type {
  MailAlias,
  MailAuthStatus,
  MailConfig,
  MailDetail,
  MailDir,
  MailMe,
  MailSummary,
  MailWriteAction,
  PendingConfirmation,
} from './types.js'
import type { MailStore } from './store.js'

/** 正文格式（CLI 的 --body-format）。缺省由调用方显式给，绝不留给自动检测。 */
export type BodyFormat = 'plain' | 'html' | 'markdown'

/** 一次写操作的结果：要么待确认，要么已完成。 */
export type WriteOutcome =
  | { status: 'pending'; token: string; summary: string; preview: Record<string, unknown> }
  | { status: 'done'; detail: Record<string, unknown> }

/** 发信收件人集合。 */
export interface Recipients {
  to: string[]
  cc?: string[]
  bcc?: string[]
}

/** 列表/搜索的查询条件。 */
export interface ListQuery {
  dir?: MailDir
  limit?: number
  cursor?: string
  after?: string
  before?: string
  hasAttachments?: boolean
  isUnread?: boolean
}

/** 搜索条件（= 列表条件 + 关键词维度）。 */
export interface SearchQuery extends ListQuery {
  q?: string
  searchIn?: 'SEARCH_IN_ALL' | 'SEARCH_IN_SUBJECT' | 'SEARCH_IN_CONTENT'
  from?: string
  to?: string
}

/** 一页列表结果。 */
export interface MailPage {
  messages: MailSummary[]
  hasMore: boolean
  nextCursor: string
  /** 命中缓存的时刻（毫秒）；实时结果为 Date.now()。 */
  at: number
  /** 是否来自本地缓存（面板用来决定要不要转圈）。 */
  cached: boolean
}

/**
 * 缓存「秒开」的最长可接受年龄。
 *
 * 缓存的意义只是**面板打开瞬间别白屏**，不是替代实时结果。超过这个年龄的
 * 快照宁可让面板转一下圈：拿一份隔夜列表当现状，用户看到的就是「已经不在了
 * 的邮件还在，点删除还报错」。
 */
const CACHE_MAX_AGE_MS = 2 * 60_000

/** 附件下载结果。 */
export interface AttachmentResult {
  /** 落盘路径（普通附件下载成功时）。 */
  savedTo?: string
  /** 超大附件：直接给用户/模型这个链接，不要走 CLI 下载。 */
  downloadUrl?: string
  filename?: string
  size?: number
}

/** 邮箱服务。 */
export class MailService {
  private readonly store: MailStore
  private config: MailConfig
  private readonly overrides: Partial<MailConfig> | undefined

  constructor(store: MailStore, config: MailConfig, overrides?: Partial<MailConfig>) {
    this.store = store
    this.config = config
    this.overrides = overrides
  }

  /** 当前生效配置。 */
  getConfig(): MailConfig {
    return this.config
  }

  /**
   * 运行时改配置（面板设置区）。
   *
   * `downloadDir` 的特殊语义：传**空串** = 清除覆盖、回到工厂默认目录。
   * 不能只靠 `applyMailConfigOverrides`（它对空串是「忽略」，正是为了不让
   * 半截输入把已有设置冲掉），所以这里显式删键 —— 否则设置页的「恢复默认」
   * 会写下一个空串覆盖层，重启后又变成「有覆盖但值为空」，`defaultDownloadDir`
   * 每轮都要多判一次空。
   */
  async updateConfig(patch: Partial<MailConfig>): Promise<MailConfig> {
    const { applyMailConfigOverrides } = await import('./types.js')
    const next: MailConfig = { ...this.config }
    applyMailConfigOverrides(next, patch)
    const merged: Partial<MailConfig> = { ...await this.store.readConfig(), ...patch }
    if (patch.downloadDir !== undefined && patch.downloadDir.trim() === '') {
      delete merged.downloadDir
      next.downloadDir = undefined
    }
    await this.store.writeConfig(merged)
    this.config = next
    return next
  }

  /** CLI 调用参数（超时 + 附件目录由调用方给 cwd）。 */
  private runOptions(extra: RunOptions = {}): RunOptions {
    return { timeoutMs: this.config.timeoutMs, ...extra }
  }

  /* ── 账号 ─────────────────────────────────────────────────────────── */

  /** 账号信息 + 授权状态（未授权时 me 为空）。 */
  async account(): Promise<{
    auth: MailAuthStatus
    me: MailMe | null
    primary: MailAlias | null
    error: string | null
  }> {
    const statusResult = await runCli(['auth', 'status'], this.runOptions())
    const auth = (statusResult.data ?? { logged_in: false, status: 'unknown' }) as MailAuthStatus
    if (auth.logged_in !== true) {
      // 这条 error 会直接显示在面板上，同样要过人话化（见 cliError 的注释）。
      const raw = statusResult.error?.message
      return { auth, me: null, primary: null, error: statusResult.ok || raw === undefined ? null : humanizeCliError(raw) }
    }
    const meResult = await runCli(['+me'], this.runOptions())
    if (!meResult.ok) {
      const raw = meResult.error?.message
      return { auth, me: null, primary: null, error: raw === undefined ? 'agently-cli +me 失败' : humanizeCliError(raw) }
    }
    const me = meResult.data as MailMe
    const primary = (me.aliases ?? []).find(alias => alias.is_primary) ?? (me.aliases ?? [])[0] ?? null
    return { auth, me, primary, error: null }
  }

  /* ── 读 ───────────────────────────────────────────────────────────── */

  /** 列表：实时拉取并写缓存；`preferCache` 为真时先给缓存（面板秒开）。 */
  async list(query: ListQuery, options: { preferCache?: boolean } = {}): Promise<MailPage> {
    const dir = query.dir ?? 'inbox'
    if (options.preferCache === true) {
      const cache = await this.store.readCache()
      // 缓存必须**同文件夹且够新**才拿来秒开；陈旧快照一律落回实时请求，
      // 否则「刚删掉的邮件还留在列表里」会被缓存一直钉住（见 invalidateCache）。
      if (cache !== null && cache.dir === dir && Date.now() - cache.at <= CACHE_MAX_AGE_MS) {
        return { messages: cache.messages, hasMore: false, nextCursor: '', at: cache.at, cached: true }
      }
    }
    const args = ['message', '+list', '--dir', dir, '--limit', String(clampLimit(query.limit))]
    if (query.cursor !== undefined && query.cursor !== '') args.push('--cursor', query.cursor)
    if (query.after !== undefined && query.after !== '') args.push('--after', query.after)
    if (query.before !== undefined && query.before !== '') args.push('--before', query.before)
    if (query.hasAttachments === true) args.push('--has-attachments')
    if (query.isUnread === true) args.push('--is-unread')
    const data = await runCli(args, this.runOptions())
    if (!data.ok) {
      // 失败回退缓存：网络抖动时面板仍能显示上一次的内容，比空白页有用。
      const cache = await this.store.readCache()
      if (cache !== null && cache.dir === dir) {
        return { messages: cache.messages, hasMore: false, nextCursor: '', at: cache.at, cached: true }
      }
      throw cliError(data)
    }
    const payload = data.data as { data?: MailSummary[]; pagination?: { has_more?: boolean; next_cursor?: string } }
    const messages = Array.isArray(payload.data) ? payload.data : []
    // 只在首页写缓存（翻页结果会覆盖掉首屏内容，反而更差）。
    if (query.cursor === undefined || query.cursor === '') this.store.writeCache(dir, messages)
    return {
      messages,
      hasMore: payload.pagination?.has_more === true,
      nextCursor: typeof payload.pagination?.next_cursor === 'string' ? payload.pagination.next_cursor : '',
      at: Date.now(),
      cached: false,
    }
  }

  /** 搜索：翻页必须带上原条件（CLI 明确要求），故这里原样回传全部维度。 */
  async search(query: SearchQuery): Promise<MailPage> {
    const args = ['message', '+search', '--limit', String(clampLimit(query.limit))]
    if (query.q !== undefined && query.q !== '') args.push('--q', query.q)
    if (query.searchIn !== undefined) args.push('--search-in', query.searchIn)
    if (query.from !== undefined && query.from !== '') args.push('--from', query.from)
    if (query.to !== undefined && query.to !== '') args.push('--to', query.to)
    if (query.dir !== undefined) args.push('--dir', query.dir)
    if (query.after !== undefined && query.after !== '') args.push('--after', query.after)
    if (query.before !== undefined && query.before !== '') args.push('--before', query.before)
    if (query.hasAttachments === true) args.push('--has-attachments')
    if (query.isUnread === true) args.push('--is-unread')
    if (query.cursor !== undefined && query.cursor !== '') args.push('--cursor', query.cursor)
    const result = await runCli(args, this.runOptions())
    if (!result.ok) throw cliError(result)
    const payload = result.data as { data?: MailSummary[]; pagination?: { has_more?: boolean; next_cursor?: string } }
    return {
      messages: Array.isArray(payload.data) ? payload.data : [],
      hasMore: payload.pagination?.has_more === true,
      nextCursor: typeof payload.pagination?.next_cursor === 'string' ? payload.pagination.next_cursor : '',
      at: Date.now(),
      cached: false,
    }
  }

  /** 读全文。 */
  async read(id: string): Promise<MailDetail> {
    if (id.trim() === '') throw new Error('read: message_id 不能为空')
    const result = await runCli(['message', '+read', '--id', id.trim()], this.runOptions())
    if (!result.ok) throw cliError(result)
    return result.data as MailDetail
  }

  /* ── 写（两阶段确认） ─────────────────────────────────────────────── */

  /**
   * 发信。`confirmationToken` 为空 → 只拿 ctk 并停下（返回 pending）；
   * 带 token（且与 CLI 返回的一致）→ 真正发出。
   * `userAuthorized` 只在用户**明确**说了「发吧」时传 true，映射 `--confirmed`。
   */
  async send(input: {
    recipients: Recipients
    subject: string
    body: string
    /** 正文文件（绝对路径；内部换算成相对 CLI cwd 的形式）。 */
    bodyFile?: string
    format?: BodyFormat
    attachments?: string[]
    confirmationToken?: string
    userAuthorized?: boolean
  }): Promise<WriteOutcome> {
    if (input.recipients.to.length === 0) throw new Error('send: 至少一个收件人（to）')
    if (input.subject.trim() === '') throw new Error('send: 主题不能为空')
    if (input.body.trim() === '' && (input.bodyFile === undefined || input.bodyFile === '')) {
      throw new Error('send: 正文不能为空（body 或 bodyFile 二选一）')
    }
    return await this.writeCall('send', input, () => {
      const args = ['message', '+send']
      for (const to of input.recipients.to) args.push('--to', to)
      for (const cc of input.recipients.cc ?? []) args.push('--cc', cc)
      for (const bcc of input.recipients.bcc ?? []) args.push('--bcc', bcc)
      args.push('--subject', input.subject)
      args.push('--body-format', input.format ?? 'plain')
      return args
    })
  }

  /** 回复。 */
  async reply(input: {
    id: string
    body: string
    bodyFile?: string
    format?: BodyFormat
    replyAll?: boolean
    cc?: string[]
    bcc?: string[]
    attachments?: string[]
    confirmationToken?: string
    userAuthorized?: boolean
  }): Promise<WriteOutcome> {
    if (input.id.trim() === '') throw new Error('reply: 缺少 id（message_id）')
    return await this.writeCall('reply', input, () => {
      const args = ['message', '+reply', '--id', input.id.trim()]
      if (input.replyAll === true) args.push('--reply-all')
      for (const cc of input.cc ?? []) args.push('--cc', cc)
      for (const bcc of input.bcc ?? []) args.push('--bcc', bcc)
      args.push('--body-format', input.format ?? 'plain')
      return args
    })
  }

  /** 转发。 */
  async forward(input: {
    id: string
    recipients: Recipients
    body?: string
    bodyFile?: string
    format?: BodyFormat
    includeAttachments?: boolean
    attachments?: string[]
    confirmationToken?: string
    userAuthorized?: boolean
  }): Promise<WriteOutcome> {
    if (input.id.trim() === '') throw new Error('forward: 缺少 id（message_id）')
    if (input.recipients.to.length === 0) throw new Error('forward: 至少一个收件人（to）')
    return await this.writeCall('forward', input, () => {
      const args = ['message', '+forward', '--id', input.id.trim()]
      for (const to of input.recipients.to) args.push('--to', to)
      for (const cc of input.recipients.cc ?? []) args.push('--cc', cc)
      for (const bcc of input.recipients.bcc ?? []) args.push('--bcc', bcc)
      if (input.includeAttachments === true) args.push('--include-attachments')
      args.push('--body-format', input.format ?? 'plain')
      return args
    })
  }

  /** 移入回收站（软删，30 天后真正删除）。 */
  async trash(id: string, confirmationToken?: string): Promise<WriteOutcome> {
    if (id.trim() === '') throw new Error('trash: 缺少 id（message_id）')
    // ⚠️ confirmationToken 必须传进 writeCall：早期版本只把它当形参收下却没往下传，
    // 于是第二阶段仍然是一次「不带令牌的调用」→ 又拿到一个新令牌 → 永远停在 pending，
    // 用户看到的就是「点了确认还是让我确认」。
    return await this.writeCall(
      'trash',
      { id: id.trim(), confirmationToken },
      () => ['message', '+trash', '--id', id.trim()],
    )
  }

  /** 永久删除（仅回收站内；`all` 为真时清空回收站）。 */
  async delete(input: { id?: string; all?: boolean; confirmationToken?: string }): Promise<WriteOutcome> {
    if (input.all !== true && (input.id === undefined || input.id.trim() === '')) {
      throw new Error('delete: 需要 id 或 all: true')
    }
    return await this.writeCall('delete', input, () => {
      const args = ['message', '+delete']
      if (input.all === true) args.push('--all')
      else if (input.id !== undefined) args.push('--id', input.id.trim())
      return args
    })
  }

  /**
   * 写操作的公共骨架：拼参数 → 补正文/附件路径 → 跑 → 解释结果。
   *
   * 结果解释只有两种合法形态（对齐 CLI）：
   *  - data.confirmation_required === true → pending，把 ctk 与 summary 落盘；
   *  - 其它 ok:true → done（真发出去了）。
   * 绝不允许「非 0 退出却报成功」——那会把「已发送」说成结论而实际没发。
   */
  private async writeCall(
    action: MailWriteAction,
    input: {
      body?: string
      bodyFile?: string
      attachments?: string[]
      confirmationToken?: string
      userAuthorized?: boolean
      /** 其余业务字段（id / all 等）只用于参数拼装，不参与路径规划。 */
      [key: string]: unknown
    },
    baseArgs: () => string[],
  ): Promise<WriteOutcome> {
    const args = baseArgs()
    const paths: string[] = []
    if (input.bodyFile !== undefined && input.bodyFile !== '') paths.push(resolve(input.bodyFile))
    for (const attachment of input.attachments ?? []) paths.push(resolve(attachment))

    // 路径规划：CLI 只收相对路径（且相对子进程 cwd）。全部同盘 → cwd 定在公共
    // 父目录、参数用相对路径；跨盘/取不到公共父目录 → 显式报错，不猜。
    let cwd: string | undefined
    let relativePaths: string[] = []
    if (paths.length > 0) {
      for (const path of paths) {
        if (!existsSync(path)) throw new Error(`文件不存在：${path}`)
      }
      const base = commonDirOf(paths)
      if (base === null) throw new Error('附件/正文文件跨盘符，无法换算成 agently-cli 要求的相对路径')
      cwd = base
      relativePaths = paths.map(path => toCliRelative(base, path))
    }
    let pathIndex = 0
    if (input.bodyFile !== undefined && input.bodyFile !== '') {
      args.push('--body-file', relativePaths[pathIndex] ?? input.bodyFile)
      pathIndex += 1
    } else if (input.body !== undefined && input.body !== '') {
      args.push('--body', input.body)
    }
    for (const rel of relativePaths.slice(pathIndex)) args.push('--attachment', rel)

    const hasToken = input.confirmationToken !== undefined && input.confirmationToken !== ''
    if (hasToken) {
      args.push('--confirmation-token', input.confirmationToken as string)
    } else if (input.userAuthorized === true && action !== 'trash' && action !== 'delete') {
      // trash/delete 没有 --confirmed（CLI 只给了 send/reply/forward）。
      args.push('--confirmed')
    }

    const result = await runCli(args, this.runOptions(cwd === undefined ? {} : { cwd }))
    if (!result.ok) throw cliError(result)
    const data = (result.data ?? {}) as Record<string, unknown>
    if (data['confirmation_required'] === true) {
      const token = typeof data['confirmation_token'] === 'string' ? data['confirmation_token'] : ''
      const summary = typeof data['summary'] === 'object' && data['summary'] !== null
        ? (data['summary'] as Record<string, unknown>)
        : {}
      if (token === '') throw new Error(`${action}: 服务端要求确认但没给 confirmation_token`)
      const text = describeSummary(action, summary)
      await this.store.putPending({
        token,
        action,
        summary: text,
        createdAt: Date.now(),
        preview: summary,
        // 原样存下这次的完整参数：第二阶段必须用同样的参数重放。
        // 不靠 summary 反推 —— 它里面没有正文、没有附件路径、字段名也不一样
        // （id 在 summary 里叫 message_id），早期版本就是这么踩出 `id required` 的。
        replay: { action, ...input } as PendingConfirmation['replay'],
      })
      return { status: 'pending', token, summary: text, preview: summary }
    }
    // 真正执行成功：清掉对应待确认记录（若这次是带 token 执行的）。
    if (hasToken) {
      await this.store.dropPending(input.confirmationToken as string)
    }
    // 写操作改变了服务端状态 → 本地列表缓存立刻作废。
    // 不作废的话，面板紧接着的刷新会命中「操作前」的快照，邮件看起来没删掉，
    // 用户就会再点一次，撞上服务端的目录约束。
    await this.store.invalidateCache()
    return { status: 'done', detail: data }
  }

  /* ── 附件 ─────────────────────────────────────────────────────────── */

  /**
   * 下载普通附件。超大附件（只有 download_url、没有 attachment_id）不下载，
   * 直接把链接返回给调用方——CLI 明确不支持这类，硬试只会报错。
   */
  async downloadAttachment(input: { msg: string; att?: string; downloadUrl?: string; outputDir?: string }): Promise<AttachmentResult> {
    if (input.att === undefined || input.att === '') {
      if (input.downloadUrl !== undefined && input.downloadUrl !== '') {
        return { downloadUrl: input.downloadUrl }
      }
      throw new Error('downloadAttachment: 缺少附件 id（att_ 前缀）')
    }
    const outputDir = resolve(input.outputDir ?? this.defaultDownloadDir())
    await mkdir(outputDir, { recursive: true })
    // CLI 的 --output 也必须是相对路径：cwd 定在输出目录本身，参数用 '.'。
    const args = ['attachment', '+download', '--msg', input.msg, '--att', input.att, '--output', '.']
    const result = await runCli(args, this.runOptions({ cwd: outputDir }))
    if (!result.ok) throw cliError(result)
    const data = (result.data ?? {}) as Record<string, unknown>
    const savedTo = typeof data['saved_to'] === 'string' ? data['saved_to'] : ''
    const absolute = savedTo === ''
      ? undefined
      : (isCliRelative(savedTo) ? resolve(outputDir, savedTo) : resolve(savedTo))
    return {
      ...(absolute !== undefined ? { savedTo: absolute } : {}),
      ...(typeof data['filename'] === 'string' ? { filename: data['filename'] } : {}),
      ...(typeof data['size'] === 'number' ? { size: data['size'] } : {}),
    }
  }

  /** 附件默认下载目录。 */
  defaultDownloadDir(): string {
    if (this.config.downloadDir !== undefined && this.config.downloadDir !== '') return this.config.downloadDir
    const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
    return join(home, 'storages', 'dsh-chat-flow-mail-attachments')
  }

  /**
   * 工厂默认目录（`~/.dsh/storages/...`），与用户自选的 `config.downloadDir` 无关。
   * 设置页「恢复默认」要回到这里，不能读 defaultDownloadDir（那已经含用户覆盖）。
   */
  builtinDownloadDir(): string {
    const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
    return join(home, 'storages', 'dsh-chat-flow-mail-attachments')
  }

  /**
   * 校验一个目录能否作为附件保存位置。
   *
   * 判据是**真的试着写一下**，而不是只看 existsSync：路径存在但只读（受保护目录、
   * 别的用户建的目录、网络盘掉线）时，只查存在会给出「可以用」的假结论，用户一路
   * 下载到那一步才失败，而且失败发生在 CLI 子进程里、错误信息是英文的
   * `--output must be a relative path` 之类，完全对不上真实原因。
   *
   * 校验用 `.dsh-mail-write-probe` 探针文件，写完立刻删；不落任何残留。
   */
  async verifyDirectory(input: string): Promise<{ ok: boolean; path: string; error?: string }> {
    const raw = input.trim()
    if (raw === '') return { ok: false, path: '', error: '目录不能为空' }
    if (!isAbsolute(raw)) return { ok: false, path: raw, error: '请填绝对路径（如 D:\\Mail 或 /home/me/mail）' }
    const path = resolve(raw)
    try {
      await mkdir(path, { recursive: true })
    } catch (error) {
      return { ok: false, path, error: `无法创建目录：${error instanceof Error ? error.message : String(error)}` }
    }
    const probe = join(path, '.dsh-mail-write-probe')
    try {
      await writeFile(probe, 'probe', 'utf8')
      await rm(probe, { force: true })
      return { ok: true, path }
    } catch (error) {
      return { ok: false, path, error: `目录不可写：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /** 待确认操作列表。 */
  async pending(): Promise<PendingConfirmation[]> {
    return await this.store.listPending()
  }

  /**
   * 执行一条待确认操作（第二阶段的**唯一正确入口**）。
   *
   * 从落盘的 `replay` 里原样重放参数，而不是让调用方（面板 / 模型）自己拼 ——
   * 面板拼过一次就出过 `id required`（它从 summary 里读 `id`，而 CLI 给的是
   * `message_id`），而且正文/附件路径根本不在 summary 里，拼不出来。
   *
   * 令牌与参数同源（都来自第一阶段那次调用），所以这里不需要调用方再传业务参数。
   */
  async confirmPending(token: string): Promise<WriteOutcome> {
    const record = await this.store.getPending(token)
    if (record === undefined) throw new Error('这条待确认操作已过期或已被撤销（确认令牌有效期 5 分钟）。请重新发起。')
    const replay = record.replay
    // 逐字段映射而不是 `{...replay}` 展开：展开会把 `action` 这个多余字段一并
    // 塞进方法入参，也会把「到底重放了什么」这件事藏起来。
    //
    // 读 `recipients` 时带一层兜底：早期版本把 replay 里的收件人写成平铺的
    // `to`，那些旧记录还在盘上（5 分钟内）。宁可多认一种形状，也不要让用户
    // 点了确认却撞一个 TypeError。
    const recipientsOf = (r: Record<string, unknown>): { to: string[]; cc?: string[]; bcc?: string[] } => {
      const nested = r['recipients']
      if (typeof nested === 'object' && nested !== null) return nested as { to: string[]; cc?: string[]; bcc?: string[] }
      const to = Array.isArray(r['to']) ? r['to'] as string[] : []
      const cc = Array.isArray(r['cc']) ? r['cc'] as string[] : undefined
      const bcc = Array.isArray(r['bcc']) ? r['bcc'] as string[] : undefined
      return { to, cc, bcc }
    }
    switch (replay.action) {
      case 'send':
        return await this.send({
          recipients: recipientsOf(replay as unknown as Record<string, unknown>),
          subject: replay.subject,
          body: replay.body,
          bodyFile: replay.bodyFile,
          format: replay.format as BodyFormat | undefined,
          attachments: replay.attachments,
          confirmationToken: token,
        })
      case 'reply':
        return await this.reply({
          id: replay.id,
          body: replay.body,
          bodyFile: replay.bodyFile,
          format: replay.format as BodyFormat | undefined,
          replyAll: replay.replyAll,
          cc: replay.cc,
          bcc: replay.bcc,
          attachments: replay.attachments,
          confirmationToken: token,
        })
      case 'forward':
        return await this.forward({
          id: replay.id,
          recipients: recipientsOf(replay as unknown as Record<string, unknown>),
          body: replay.body,
          bodyFile: replay.bodyFile,
          format: replay.format as BodyFormat | undefined,
          includeAttachments: replay.includeAttachments,
          attachments: replay.attachments,
          confirmationToken: token,
        })
      case 'trash':
        return await this.trash(replay.id, token)
      case 'delete':
        return await this.delete({ id: replay.id, all: replay.all, confirmationToken: token })
      default:
        throw new Error(`未知的待确认操作类型：${String((replay as { action?: unknown }).action)}`)
    }
  }

  /** 撤销一条待确认操作。 */
  async cancelPending(token: string): Promise<boolean> {
    return await this.store.dropPending(token)
  }

  /**
   * 「点一下就直接执行」的写操作（面板按钮用）。
   *
   * 与 `trash` / `delete` 的区别只在**谁来点头**：CLI 的两阶段确认是给「Agent
   * 自主决定要不要发/删」准备的安全阀；而用户在面板上亲手点那一下，本身就是
   * 明确许可 —— 再弹一层「确定吗？」只是把同一件事问两遍。
   *
   * 实现上仍是老老实实走完两阶段（第一阶段拿令牌 → 立刻用令牌续第二阶段），
   * 不绕过服务端确认：令牌是 CLI 的硬要求，绕不过也不该绕。
   */
  private async writeNow(run: () => Promise<WriteOutcome>): Promise<WriteOutcome> {
    const first = await run()
    if (first.status === 'done') return first
    // 拿到令牌 → 立刻续第二阶段（令牌与参数同源，由 confirmPending 原样重放）。
    try {
      return await this.confirmPending(first.token)
    } catch (error) {
      // 第二阶段失败时，这条待确认记录必须清掉：面板的待确认条会一直亮着
      // 「移入回收站」，用户点「确认执行」只会反复撞同一个错（典型的
      // `Cannot delete message from this directory`）—— 一条注定失败的记录
      // 留在盘上，就是把用户往重复失败上引。
      await this.store.dropPending(first.token).catch(() => undefined)
      throw error
    }
  }

  /** 移入回收站（点一下就执行；面板按钮用）。 */
  async trashNow(id: string): Promise<WriteOutcome> {
    return await this.writeNow(() => this.trash(id))
  }

  /** 永久删除（点一下就执行；面板按钮用，仅回收站内邮件）。 */
  async deleteNow(input: { id?: string; all?: boolean }): Promise<WriteOutcome> {
    return await this.writeNow(() => this.delete(input))
  }

  /* ── 诊断 ─────────────────────────────────────────────────────────── */

  /** 附件文件体检（发送前确认路径可用，给出大小与文件名）。 */
  async inspectAttachments(paths: readonly string[]): Promise<Array<{ path: string; ok: boolean; name: string; size: number; error?: string }>> {
    const out: Array<{ path: string; ok: boolean; name: string; size: number; error?: string }> = []
    for (const path of paths) {
      const abs = resolve(path)
      try {
        const info = await stat(abs)
        if (!info.isFile()) {
          out.push({ path: abs, ok: false, name: basename(abs), size: 0, error: '不是文件' })
          continue
        }
        out.push({ path: abs, ok: true, name: basename(abs), size: info.size })
      } catch {
        out.push({ path: abs, ok: false, name: basename(abs), size: 0, error: '文件不存在' })
      }
    }
    return out
  }
}

/** 限幅每页条数（CLI 上限 50）。 */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 20
  return Math.max(1, Math.min(50, Math.round(limit)))
}

/**
 * CliResult → MailCliError（保留退出码语义，上层可按 needsAuth 分支）。
 *
 * ⚠️ 必须过一遍 `humanizeCliError`：早期这里直接把服务端英文原文塞进
 * `message`，而 humanize 只挂在 cli.ts 的 toError() 上 —— 于是**走 service
 * 的这条路径（工具、HTTP 路由、面板全都是它）永远拿到英文**。用户看到的就是
 * 截图里那句 `Cannot delete message from this directory`，翻译规则写了也白写。
 * 两条路径必须共用同一个翻译入口。
 */
function cliError(result: { code: number; error?: { type?: string; message?: string; request_id?: string } }): Error {
  const raw = result.error?.message
  return new MailCliError(
    result.code,
    result.error?.type ?? 'unknown',
    typeof raw === 'string' && raw !== '' ? humanizeCliError(raw) : `agently-cli 退出码 ${result.code}`,
    result.error?.request_id,
  )
}

/** 把 CLI 的 summary 渲染成给用户看的一段话。 */
export function describeSummary(action: MailWriteAction, summary: Record<string, unknown>): string {
  const str = (value: unknown): string => (typeof value === 'string' ? value : '')
  const arr = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
  const head = ((): string => {
    switch (action) {
      case 'send': return '发送邮件'
      case 'reply': return '回复邮件'
      case 'forward': return '转发邮件'
      case 'trash': return '移入回收站'
      case 'delete': return '永久删除'
      default: return '邮件操作'
    }
  })()
  const lines = [`${head}：`]
  const to = arr(summary['to'])
  if (to.length > 0) lines.push(`  收件人：${to.join('、')}`)
  const cc = arr(summary['cc'])
  if (cc.length > 0) lines.push(`  抄送：${cc.join('、')}`)
  const subject = str(summary['subject'])
  if (subject !== '') lines.push(`  主题：${subject}`)
  const from = str(summary['from'])
  if (from !== '') lines.push(`  发件人：${from}`)
  const ids = arr(summary['message_ids'])
  if (ids.length > 0) lines.push(`  邮件：${ids.join('、')}`)
  const count = summary['count']
  if (typeof count === 'number') lines.push(`  数量：${count}`)
  const attachments = summary['attachment_count']
  if (typeof attachments === 'number' && attachments > 0) lines.push(`  附件：${attachments} 个`)
  return lines.join('\n')
}

/** 从路径推导 MIME 类型（面板展示用，不参与上传）。 */
export function contentTypeOf(path: string): string {
  const ext = extname(path).toLowerCase()
  const table: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return table[ext] ?? 'application/octet-stream'
}
