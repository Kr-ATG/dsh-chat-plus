/**
 * 随机 v4 UUID —— 逐字内联自 `@deepseek-ai/dsh-util-crypto` 的 `randomUUID`。
 *
 * WHY NOT IMPORTED: 装在 profile `node_modules` 里的插件解析不到 DSH 源码包，
 * 多留一个运行时外部名就多一条「装到用户机上才炸」的解析风险。本包只需要
 * `randomUUID` 这一个纯函数（构造 LLM 消息 id 用），所以照 hub 的既有做法把
 * 叶子内联进来，`build.mjs` 的 host 运行时外部白名单维持原样
 * （cordis / schemastery / dsh-tools / undici）。
 *
 * 与官方实现同源的理由：`crypto.randomUUID` 是 secure-context Web API（局域网
 * 明文 HTTP 的页面/worker 上没有），`crypto.getRandomValues` 处处可用；Node ≥ 19
 * 也在 `globalThis.crypto` 上提供它。
 */

/**
 * Random v4 UUID, minted from `crypto.getRandomValues`.
 * @returns the UUID string.
 */
export function randomUUID(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (byte, index) => {
    return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, '0')
  }).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
