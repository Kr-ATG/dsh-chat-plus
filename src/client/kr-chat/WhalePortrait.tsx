/**
 * dsh-chat-plus — 鲸鱼娘立绘（右栏「操作面板」卡的头像位）。
 *
 * ⚠ 2026-10-26 起**已停用**：卡头换成 SeekerStage.tsx 的 9 段任务动画，本文件
 * 与 whale-portrait-assets.ts 不再被任何模块 import。**刻意保留**而不是删除 ——
 * 已装好的旧 client 产物里还带着这个模块的引用，删文件只会让排错变难；确认没有
 * 在跑的长会话之后，这对文件（含 base64 素材）可以整对删掉。
 *
 * 读者是**不会编程的普通用户**。这里只做一件事：把用户提供的立绘变成一张
 * **会呼吸、尾巴会摇**的头像，让右栏里那个「正在干活的东西」看起来像活的。
 *
 * 为什么是位图分层，而不是矢量重画：
 *  · 立绘是用户指定的形象（1280×1881），矢量重画会丢掉画风；
 *  · 能切的只有「尾巴」——它是画面里唯一与身体不重叠、且天然该动的大部件；
 *  · 其余部分（头发、裙摆）与身体互相穿插，切开必然露缝，所以整张留在一起。
 *
 * 两条动效纪律（与大盘其它卡片同族）：
 *  1. **只动 transform / opacity**，不触发布局；卡片每 250ms 重渲染，动 layout 会掉帧。
 *  2. **prefers-reduced-motion 全关**，与全站约定一致。
 *
 * 2026-10-24 按用户要求「去掉眼部动态」：眼睛不再单独分层，整张立绘只保留
 * 呼吸 + 尾巴摇 + 头顶冒泡三组动效。眼睛相关的层、高光、眨眼线全部删除。
 */

import { memo } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import {
  PORTRAIT_H,
  PORTRAIT_SRC,
  PORTRAIT_W,
  TAIL_BOX,
  TAIL_SRC,
} from './whale-portrait-assets.ts'

export interface WhalePortraitProps {
  /**
   * 渲染宽度（px）。高度按立绘原始比例自动算。
   *
   * 卡片头用 96，大盘空态用 140 —— 同一份素材两处尺寸，不额外导出图片。
   */
  readonly size?: number
  /**
   * 关掉动效。默认跟随 prefers-reduced-motion，调用方也可以硬关
   * （例如截图、导出时想拿一张静态图）。
   */
  readonly motion?: boolean
  /** 额外类名，给调用方覆盖 margin 之类。 */
  readonly className?: string
}

/**
 * 鲸鱼娘立绘。
 *
 * 结构：一个按 size 定宽的容器 → 里面是一个固定 PORTRAIT_W × PORTRAIT_H
 * 坐标系的舞台 → 舞台用 transform: scale() 缩到目标尺寸。
 *
 * 为什么要缩放整个坐标系而不是给每层算百分比：
 * 尾鳍层是按像素定位在主图上的（见 TAIL_BOX），用 transform 缩放能保证两层
 * **永远严格对位**；写百分比在窄栏下会因为亚像素取整错开半像素，尾鳍根部
 * 会露出一条头发丝宽的缝。
 */
export const WhalePortrait = memo(function WhalePortrait({
  size = 96,
  motion = true,
  className,
}: WhalePortraitProps): ReactElement {
  const scale = size / PORTRAIT_W
  const height = Math.round(PORTRAIT_H * scale)
  const rootClass = className === undefined ? 'kr-whale' : 'kr-whale ' + className

  return (
    <div
      className={rootClass}
      style={{ width: size, height }}
      data-motion={motion ? undefined : 'off'}
      aria-hidden
    >
      <div
        className="kr-whale__stage"
        style={{
          width: PORTRAIT_W,
          height: PORTRAIT_H,
          transform: 'scale(' + scale + ')',
        } as CSSProperties}
      >
        {/* 整身：呼吸 + 极轻的左右摇摆（摆动幅度必须小于 1°，否则整张图会「飘」） */}
        <div className="kr-whale__sway">
          <img className="kr-whale__body" src={PORTRAIT_SRC} alt="" draggable={false} />
          {/*
           * 尾鳍：叠在身体层之上。主图里尾鳍位置已经挖空，所以这一层转动时
           * 不会与底下的尾巴像素打架 —— 只有它露出来的部分才是可见的。
           */}
          <img
            className="kr-whale__tail"
            src={TAIL_SRC}
            alt=""
            draggable={false}
            style={{
              left: TAIL_BOX.left,
              top: TAIL_BOX.top,
              width: TAIL_BOX.width,
              height: TAIL_BOX.height,
            } as CSSProperties}
          />
        </div>
      </div>

      {/*
       * 头顶冒泡：纯 CSS 圆点，不占素材体积。
       * 位置用百分比锚在容器上（不在舞台坐标系里），跟随 size 自动落到鲸鱼头顶。
       */}
      {motion && (
        <div className="kr-whale__bubbles" aria-hidden>
          <i style={{ left: '34%', top: '2%', width: 3, height: 3, animationDelay: '0s' }} />
          <i style={{ left: '46%', top: '-1%', width: 4, height: 4, animationDelay: '.9s' }} />
          <i style={{ left: '56%', top: '3%', width: 2.5, height: 2.5, animationDelay: '1.7s' }} />
        </div>
      )}
    </div>
  )
})
