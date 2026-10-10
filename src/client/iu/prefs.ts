/**
 * dsh-chat-plus — iu 卡片的全屏与缩放偏好（纯客户端，走 localStorage）。
 *
 * ## 为什么是 localStorage 而不是 host settings
 *
 * 这两项都是**纯呈现偏好**：全屏开没开、内容放大到几档，跟 host 无关、跟会话
 * 无关，刷新页面就该记住。按项目既有先例（`dsh.kr_chat.panel_width`），这类
 * 偏好一律走 localStorage —— 改完刷新即生效，不需要重启 DSH、也不需要动 host。
 *
 * ## 缩放的实现方式
 *
 * 不逐个元素改字号，而是把系数乘进 `--iu-text-scale`（卡片所有字号都基于它，
 * 见 iu/styles.ts 的字号轴）。这样加一档缩放 = 改一个变量，全部 kind 自动跟随，
 * 不需要在每个 kind 里写特例。
 */

/** 缩放档位（1 = 原始大小）。上限 1.8：再大中文就开始「大字报」了。 */
export const IU_ZOOM_STEPS = [1, 1.15, 1.3, 1.5, 1.8] as const

export type IuZoom = (typeof IU_ZOOM_STEPS)[number]

/** 默认缩放（原始大小）。 */
export const IU_ZOOM_DEFAULT: IuZoom = 1

/** 缩放档位的持久化键。 */
const ZOOM_KEY = 'dsh.chat_plus.iu_zoom'

/*
 * ⚠ 全屏状态**刻意不持久化**（这里曾经有过 FS_KEY，已删除）。
 *
 * 全屏态会给 body 挂 `overflow:hidden`。一旦把它存进 localStorage，刷新后
 * 自动恢复全屏就等于「整页滚不动」——用户根本不知道是自己上次开了全屏，
 * 只会觉得对话流坏了。全屏是「当下这一眼」的临时状态，每次进页面从关闭开始。
 * 缩放不同：它只改字号，不锁滚动，持久化是纯收益。
 */

/**
 * localStorage 的防御式读写。
 *
 * 无痕模式 / 存储被禁用时访问会抛（Safari 与部分企业策略），一律吞掉并回默认值：
 * 偏好读不出来只是「不记住」，绝不该让卡片渲染失败。
 */
function readRaw(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  } catch {
    // 写不进去就算了（配额满 / 无痕模式），不影响本次交互。
  }
}

/**
 * 读缩放档位。
 *
 * 脏数据（手改过 / 旧版本写的值 / 不在档位表里）一律回默认：缩放系数直接乘进
 * 字号，一个离谱的值（比如 100）会把卡片撑成一屏一个字，必须钳住。
 */
export function readIuZoom(): IuZoom {
  const raw = readRaw(ZOOM_KEY)
  if (raw === null) return IU_ZOOM_DEFAULT
  const value = Number(raw)
  return (IU_ZOOM_STEPS as readonly number[]).includes(value) ? value as IuZoom : IU_ZOOM_DEFAULT
}

/** 写缩放档位。 */
export function writeIuZoom(zoom: IuZoom): void {
  writeRaw(ZOOM_KEY, String(zoom))
}

/**
 * 档位表里的下一档（循环）。
 *
 * 用「循环」而不是「到顶就停」：只有一个按钮时，循环点比来回找方向更省事，
 * 且从最大档再点一下回到原始大小，用户永远能一步回到常态。
 */
export function nextIuZoom(current: IuZoom): IuZoom {
  const index = (IU_ZOOM_STEPS as readonly number[]).indexOf(current)
  const next = (index + 1) % IU_ZOOM_STEPS.length
  return IU_ZOOM_STEPS[next] as IuZoom
}

/* ── html 卡片的内容缩放 ──────────────────────────────────────────────────
 *
 * 与 iu 的缩放分开存：两者作用于不同的卡片体系（iu 乘字号轴，html 走 iframe
 * 内的 CSS zoom），用户对「原生卡片」和「沙箱页面」的期望大小也常常不同。
 *
 * html 卡片的缩放**必须作用在 iframe 内部**而不是外层容器：外层 transform/zoom
 * 会连高度一起缩放，与高度桥上报的 px 值对不上（上报的是 iframe 内部的内容高，
 * 外层再放大就会溢出或留白）。所以这里只存档位，实际应用由 bridge 注入的
 * CSS 变量完成（见 html-embed/bridge.ts 的 ZOOM 处理）。
 */

/** html 卡片缩放档位（与 iu 同档，保持手感一致）。 */
export const HE_ZOOM_STEPS = [1, 1.15, 1.3, 1.5, 1.8] as const

export type HeZoom = (typeof HE_ZOOM_STEPS)[number]

/** html 卡片默认缩放。 */
export const HE_ZOOM_DEFAULT: HeZoom = 1

const HE_ZOOM_KEY = 'dsh.chat_plus.html_zoom'

/** 读 html 卡片缩放档位（脏数据回默认，理由同 readIuZoom）。 */
export function readHeZoom(): HeZoom {
  const raw = readRaw(HE_ZOOM_KEY)
  if (raw === null) return HE_ZOOM_DEFAULT
  const value = Number(raw)
  return (HE_ZOOM_STEPS as readonly number[]).includes(value) ? value as HeZoom : HE_ZOOM_DEFAULT
}

/** 写 html 卡片缩放档位。 */
export function writeHeZoom(zoom: HeZoom): void {
  writeRaw(HE_ZOOM_KEY, String(zoom))
}

/** html 卡片缩放的下一档（循环）。 */
export function nextHeZoom(current: HeZoom): HeZoom {
  const index = (HE_ZOOM_STEPS as readonly number[]).indexOf(current)
  const next = (index + 1) % HE_ZOOM_STEPS.length
  return HE_ZOOM_STEPS[next] as HeZoom
}
