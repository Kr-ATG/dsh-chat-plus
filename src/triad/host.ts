/**
 * dsh-chat-plus — dsh-triad host half (fusion后由主插件在 apply 内调用).
 *
 * 原 dsh-triad 的 host 半身整体平移到 `src/triad/` 下；`vendor/` 平移到
 * `src/vendor/`，因此本文件相对它的位置与 dsh-triad 的 `src/host.ts`
 * 相对 `<repo>/vendor/` 的位置同构，所有相对 import 保持原样可解析：
 *
 *   src/triad/host.ts                    → ../vendor/usage-skill/index.js
 *   src/triad/memory/engine/*.ts         → ../../../vendor/dsh-llm/index.js
 *   src/triad/memory/tools.ts            → ../../vendor/dsh-tools/schema.js
 *
 * 三个模块，各自独立 try/catch——一个挂载失败只 warn，绝不影响其他模块：
 *
 *  - memory     → 本地记忆引擎（LLM 抽取、embedding 检索、
 *                 `agent/pre-step` 注入、工具、`/api/dsh-memory/*`）
 *  - usage+skills → 用量统计 + 供应商余额（`/api/usage-stats/*`）与技能包
 *                 管理（`/api/skill-manager/*`），即 vendor 化的
 *                 dsh-usage-skill host
 *  - skill-toggles / skill-health / mcp-recommended / mcp-status
 *               → `/api/skill-toggles/*`、`/api/skill-health`、
 *                 `/api/mcp-recommended`、`/api/triad/mcp-status`
 *
 * 定时自动化（原 automation 模块、`/api/triad-automation/*`）已于 2026-09-28
 * 整块删除：官方 `@deepseek-ai/dsh-experimental-schedule-bundle` 接管了同一件事。
 *
 * 不导出 `name` / `inject` / `apply`：这三个名字由主插件
 * （`src/host.ts`）独占，避免与 dsh-chat-plus 主插件契约冲突。主插件只需
 * 在 apply 里 `await applyTriadHost(ctx, config)`，并把需要的 service 合进
 * 自己的 inject（见下方 REQUIRED_SERVICES 注释）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { applyMemory } from './memory/index.js'
// @ts-expect-error — vendored JS half (no type declarations shipped)
import { apply as applyUsageHost } from '../vendor/usage-skill/index.js'
import { apply as applySkillToggles } from './skill-toggles.js'
import { applySkillHealth } from './skill-health.js'
import { applyMcpRecommended } from './mcp-recommended.js'
import { applyMcpStatus } from './mcp-status.js'
import { applyGallery } from './gallery/index.ts'
import { installBundledSkills } from './bundled-skills.js'
import type { MemoryConfig } from './memory/types.js'

/**
 * Host services the three modules touch. 本文件不导出 `inject`——合并后的
 * 数组由主插件在 `src/host.ts` 统一声明（并集）：
 *
 *  - dsh-chat-plus 现有：webServer, tools
 *  - 其余模块：
 *      memory     → webServer, tools
 *      usage      → webServer, credentials, sessions, sessionPersistence,
 *                   settings, llm
 *      skills     → webServer
 *
 * 并集：webServer, tools, credentials, sessions, sessionPersistence,
 *       settings, llm（7 个，与 dsh-triad 原 inject 完全一致）。
 */

/** Runtime config shape（通过主插件的 cordis.patch.yml 传入）。 */
export interface TriadConfig {
  /** Memory engine overrides；未给的键回落到 DEFAULT_CONFIG。 */
  memory?: Partial<MemoryConfig>
  /** Usage/account overrides，转发给 vendor 的 usage host。 */
  usage?: Record<string, unknown>
}

/**
 * memory config 覆盖层的解析：客端只给想改的键，剩下的交给
 * `memory/types.ts` 的 applyConfigOverrides。这里只做形状归一化，
 * 与 dsh-triad 原行为逐字一致。
 */
export function resolveConfig(config: TriadConfig = {}): {
  memory: Partial<MemoryConfig> | undefined
  usage: Record<string, unknown>
} {
  return {
    memory: config.memory,
    usage: config.usage ?? {},
  }
}

/**
 * 装配 triad 的三个模块。任何单个模块抛错都只记录 warn 后继续。
 *
 * @param ctx    主插件的 Cordis Context（已合并 inject）。
 * @param config 可选配置；memory 覆盖层走 resolveConfig。
 */
export async function applyTriadHost(ctx: Context, config: TriadConfig = {}): Promise<void> {
  const resolved = resolveConfig(config)

  // ── 内置技能物化（最先行） ──────────────────────────────────────────
  // 必须早于下面所有模块：技能要被装进 `~/.dsh/skills` 才会被 DSH 的
  // skill-filesystem provider 扫到，而技能面板列的就是这个目录。放在
  // 面板/开关之后装，面板会先渲染出一个"技能不存在"的空态再刷新。
  // 纯文件操作、不依赖任何 ctx service，失败只 warn（内置技能装不上不该
  // 拖垮记忆引擎与用量面板）。
  try {
    await installBundledSkills(ctx.logger)
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] bundled skills install failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // ── 记忆引擎 ────────────────────────────────────────────────────────
  try {
    applyMemory(ctx, resolved.memory)
    ctx.logger?.info?.('[dsh-chat-plus] triad memory engine mounted')
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] triad memory engine failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }

  // ── 用量 + 技能 ─────────────────────────────────────────────────────
  try {
    await applyUsageHost(ctx, resolved.usage)
    ctx.logger?.info?.('[dsh-chat-plus] triad usage + skills host mounted')
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] triad usage host failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }

  // ── 技能开关 + 技能健康 + MCP 推荐/状态 ────────────────────────────
  // 四个小模块各自一个独立 try/catch（与 dsh-triad 原粒度一致）：任一
  // 失败只 warn，其余三个照样挂载。
  try {
    await applySkillToggles(ctx)
    ctx.logger?.info?.('[dsh-chat-plus] triad skill toggles mounted')
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] triad skill toggles failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
  try {
    applySkillHealth(ctx)
    ctx.logger?.info?.('[dsh-chat-plus] triad skill health mounted')
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] triad skill health failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
  try {
    applyMcpRecommended(ctx)
    ctx.logger?.info?.('[dsh-chat-plus] triad mcp recommended mounted')
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] triad mcp recommended failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
  try {
    applyMcpStatus(ctx)
    ctx.logger?.info?.('[dsh-chat-plus] triad mcp status mounted')
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] triad mcp status failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }

  // ── 多媒体画廊（跨会话产出物索引，/api/triad/gallery/*）──────────────
  // 折叠 live + 持久化会话的 tool/call↔tool/result 事件对，提取图片 / html /
  // PPT / Word / PDF / 表格 / 音视频成品；增量折叠 + 磁盘缓存（与 usage-skill
  // 同骨架）。失败只 warn，不影响其他工作台。
  try {
    applyGallery(ctx)
    ctx.logger?.info?.('[dsh-chat-plus] triad media gallery mounted')
  } catch (error) {
    ctx.logger?.warn?.(
      `[dsh-chat-plus] triad media gallery failed to mount: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    )
  }
}
