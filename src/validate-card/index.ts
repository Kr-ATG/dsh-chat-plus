/**
 * dsh-chat-plus — validate_html_card 工具（host 半身）。
 *
 * 模型把即将写进 html 围栏的正文传给这个工具，拿回一份结构化诊断：
 * 哪里有外链（CSP 会拦）、哪里写了 100vh（会出滚动条）、哪里铺了整页底色
 * （会变成色差板子）……全部在**发出去之前**告诉它。
 *
 * ## 为什么是工具而不是渲染期拦
 *
 * 渲染期只能「拦」或「不拦」，没法告诉模型为什么。模型写完一张被 CSP 拦掉
 * 外链的卡片，看到的现象是「卡片白屏」，它既不知道原因也不知道要改什么，
 * 下一次还会这么写。工具前置把这件事变成一次明确的往返：错了，说清哪里错，
 * 改完再发。
 *
 * ## 与 genui 同类实现的异同
 *
 * 相同的是**返回协议文本 + 给可执行修法 + 不让模型重写整段**（重写就是下一个
 * 错的来源）。不同的是**不做自动修复回传**：dsh-genui 会返回 repaired_json
 * 让模型直接发，那是因为它的 spec 是 JSON、标点级错误可以确定性修复；这里
 * 校验的是自由 HTML，任何「自动改」都在替模型做设计决定，风险大于收益。
 *
 * ## 零 @deepseek-ai 运行时导入
 *
 * 与 download 工具同一条纪律：host 半身自包含（build.mjs 的 assertHostExternals
 * 会拦）。工具定义是手写 ToolDefinition 字面量，参数由 execute 自行校验。
 */

import { checkHtmlCard, formatCardCheck } from '../shared/card-check.ts'

/** 工具名（wire name）。 */
export const VALIDATE_CARD_TOOL_NAME = 'validate_html_card'

/** 手写的 ToolDefinition 字面量（不引 @deepseek-ai/dsh-tools，保持自包含）。 */
export const validateHtmlCardTool = {
  name: VALIDATE_CARD_TOOL_NAME,
  description: [
    '在发 html 围栏**之前**校验正文，返回结构化诊断（外链会被 CSP 拦、100vh 会出滚动条、整页底色会变成色差板子等）。',
    '什么时候该用：正文超过约 40 行、或用到图片/音频/视频、或你不确定某条规则时。',
    '什么时候可以跳过：十来行的小卡片（一个计算器、一张表、一段内联 SVG），直接发即可。',
    '把**围栏正文**（不含围栏标记本身）作为 html 参数传入。',
    '返回 [card-check] 协议块：status=ok 可直接发；status=warn 能发但效果差；status=invalid 必须先改。每条问题都带 fix 说明该怎么改。',
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description: '围栏正文（不含围栏标记）。',
      },
    },
    required: ['html'],
    additionalProperties: false,
  },
  output: {
    schema: { type: 'string', description: '校验结论（[card-check] 协议文本）。' },
    render(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
      return [{ type: 'text', text: String(value) }]
    },
  },
  async execute(args: unknown): Promise<string> {
    const record = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
    if (typeof record.html !== 'string') {
      // 参数类型不对是调用方的问题，直接说清，不假装校验通过。
      return ['[card-check]', 'status=invalid', 'issues=1', 'error=missing_html',
        '  fix: html 参数必须是字符串（围栏正文，不含围栏标记）', 'next=fix_and_recheck'].join('\n')
    }
    return formatCardCheck(checkHtmlCard(record.html))
  },
}