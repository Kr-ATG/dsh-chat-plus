/**
 * dsh-chat-plus — 「本轮用户输入里有没有图」判据的单元测试（纯判据，不需要浏览器）。
 *
 * 为什么要单独测：这条判据错了**不会报错**，界面上只有两种表现 ——
 *  1. 判漏 → 用户发了图，卡头却直接演「在思考中」（用户 2026-10-26 报的就是这个）；
 *  2. 判多 → 用户只发了文字，卡头却演「查看照片中」。
 * 两者都没有任何日志，只能靠断言守住。
 *
 * 尤其钉住三件事：
 *  · 官方 chatNode 把 content 挂在 `data` 上（历史投影才是 `payload`）—— 只认一处会静默失效；
 *  · 纯文字 / 缺 attachment 的 image 块**不能**算；
 *  · 「最新用户消息」兜底只在看最新一轮时启用，翻历史时不许串到别的轮次。
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const toUrl = (rel) => new URL(rel, 'file:///' + ROOT.replace(/\\/g, '/') + '/').href
const { turnInputImageCount, shouldPlayPhotoStage } = await import(toUrl('src/client/kr-chat/turn-input-images.ts'))

let failures = 0
function check(label, condition, detail) {
  if (condition) { console.log('  ok   ' + label); return }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

/** 造一个最小快照：order + nodes.get + nodes.values 三路都通。 */
function snapshot(nodes) {
  return {
    order: nodes.map((node) => node.key),
    nodes: {
      get: (key) => nodes.find((node) => node.key === key),
      values: () => nodes.slice(),
    },
  }
}

const text = { type: 'text', text: '这张图上写了什么' }
const image = { type: 'image', attachment: { attachmentId: 'att_1' } }

console.log('[turn-input-images] 从哪取 content')
{
  // 官方形状：chatNode({ data: { seq, content } }) —— 见 dsh-client-ui-chat messageDefinition。
  const official = snapshot([{
    key: 'u1', kind: 'user', anchorSeq: 7,
    location: { kind: 'step', step: { step: 1 }, turn: { turn: 3 } },
    data: { seq: 7, content: [text, image] },
  }])
  check('官方 data.content 图+文 = 1', turnInputImageCount(official, 3) === 1, String(turnInputImageCount(official, 3)))
  const viaPayload = snapshot([{ key: 'u2', kind: 'user', payload: { content: [image, image] } }])
  check('历史投影 payload.content 两张 = 2', turnInputImageCount(viaPayload, 5) === 2)
  const flat = snapshot([{ key: 'u3', kind: 'user', content: [image] }])
  check('节点自带 content = 1', turnInputImageCount(flat, 2) === 1)
  const steer = snapshot([{ key: 's1', kind: 'steering', data: { content: [image] } }])
  check('steering 带图 = 1', turnInputImageCount(steer, 5) === 1)
}

console.log('[turn-input-images] 不该算的情况')
{
  const onlyText = snapshot([{ key: 'u4', kind: 'user', data: { content: [text] } }])
  check('纯文字 = 0', turnInputImageCount(onlyText, 5) === 0)
  const noAttachment = snapshot([{ key: 'u5', kind: 'user', data: { content: [{ type: 'image' }] } }])
  check('缺 attachment 的 image 块 = 0', turnInputImageCount(noAttachment, 5) === 0)
  const fileBlock = snapshot([{ key: 'u6', kind: 'user', data: { content: [{ type: 'file', attachment: { attachmentId: 'f' } }] } }])
  check('file 块不算图 = 0', turnInputImageCount(fileBlock, 5) === 0)
  check('null 快照 = 0', turnInputImageCount(null, 1) === 0)
  check('空对象快照 = 0', turnInputImageCount({}, 1) === 0)
  check('undefined 快照 = 0', turnInputImageCount(undefined, 1) === 0)
}

console.log('[turn-input-images] 轮次边界与兜底')
{
  const other = snapshot([{
    key: 'u7', kind: 'user', anchorSeq: 40,
    location: { kind: 'turn', turn: { turn: 9 } },
    data: { content: [image] },
  }])
  check('翻到第 4 轮时不算他轮的图', turnInputImageCount(other, 4) === 0)
  check('看最新一轮时 latest 兜底命中', turnInputImageCount(other, 4, { latest: true }) === 1)
  check('轮次号滞后也能兜底（问第 8 轮，图在第 9 轮）', turnInputImageCount(other, 8, { latest: true }) === 1)
  check('不带 latest 时不兜底', turnInputImageCount(other, 8) === 0)
  // 两条用户消息：最新那条是纯文字，兜底不能把上一轮的图算进来。
  const twoMessages = snapshot([
    { key: 'a', kind: 'user', anchorSeq: 10, location: { kind: 'turn', turn: { turn: 9 } }, data: { content: [image] } },
    { key: 'b', kind: 'user', anchorSeq: 30, location: { kind: 'turn', turn: { turn: 12 } }, data: { content: [text] } },
  ])
  check('最新消息是纯文字则兜底 = 0', turnInputImageCount(twoMessages, 12, { latest: true }) === 0)
  // 中途追发的 steering 也承载用户输入，兜底要认。
  const steerLatest = snapshot([{ key: 's2', kind: 'steering', anchorSeq: 60, data: { content: [image] } }])
  check('最新一条是 steering 带图', turnInputImageCount(steerLatest, 7, { latest: true }) === 1)
}

console.log('[turn-input-images] shouldPlayPhotoStage')
{
  const withImage = snapshot([{ key: 'x1', kind: 'user', data: { content: [image] } }])
  const noImage = snapshot([{ key: 'x2', kind: 'user', data: { content: [text] } }])
  check('有图 → true', shouldPlayPhotoStage({ snapshot: withImage, turn: 3, toolNames: [] }) === true)
  check('无图无工具 → false', shouldPlayPhotoStage({ snapshot: noImage, turn: 5, toolNames: [] }) === false)
  check('事后 read_image → true', shouldPlayPhotoStage({ snapshot: noImage, turn: 5, toolNames: ['read_image'] }) === true)
  check('事后 vision_describe → true', shouldPlayPhotoStage({ snapshot: noImage, turn: 5, toolNames: ['vision_describe'] }) === true)
  check('无关工具 → false', shouldPlayPhotoStage({ snapshot: noImage, turn: 5, toolNames: ['pwsh'] }) === false)
}

if (failures === 0) {
  console.log('TEST PASSED — turn-input-images（' + String(failures) + ' 个失败）')
} else {
  console.log('TEST FAILED — turn-input-images：' + String(failures) + ' 条断言未通过')
  process.exitCode = 1
}
