/**
 * dsh-chat-plus — 工作区 Git 状态共享类型。
 *
 * 从 SeekerGitStatus.tsx 抽出（2026-10-29）：
 *   · git-status-store 需要同一份数据结构，但组件会 import store；
 *     若 store 反过来 import 组件，就形成「store ↔ 组件」循环。
 *   · 类型单独住这里，store 与组件都只依赖本文件，运行时零循环。
 *
 * 字段口径与 host 半身 src/git-status/index.ts 的 GitStatusPayload 完全一致。
 *
 * @module
 */

/** 最近一次提交信息。 */
export interface GitCommitInfo {
  readonly timestamp: number
  readonly relative: string
  readonly subject: string
  readonly hash: string
  readonly dateIso: string
}

/** GET /api/chat-flow/git-status 的完整回包。 */
export interface GitStatusData {
  readonly ok: boolean
  readonly isGit: boolean
  readonly cwd?: string
  readonly branch?: string
  readonly lastCommit?: GitCommitInfo
  readonly pendingCount: number
  readonly stagedCount: number
  readonly unstagedCount: number
  readonly clean: boolean
  readonly pendingFiles?: readonly string[]
  readonly changes?: readonly {
    readonly path: string
    readonly status: 'M' | 'A' | 'D' | 'R' | '?' | 'U'
    readonly rawCode: string
  }[]
  readonly diffStat?: string
  readonly needsMerge?: boolean
  readonly mergeReason?: 'conflict' | 'behind' | 'merging'
  readonly aheadCount?: number
  readonly behindCount?: number
  readonly error?: string
}
