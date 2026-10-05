---
name: motion-primitives
description: 用 Motion Primitives（33 个 MIT 免费 React 动效组件）给界面加动效的实操手册。当用户要新建或修改 UI 并涉及动效时使用——文字揭示/滚动/变形/乱码/流光、数字滚动与翻牌、滚动入场、磁吸、3D 倾斜、聚光灯、发光边框、Dock、轮播、无限跑马灯、图片对比、变形弹窗与浮层、渐进模糊、可展开工具栏、滚动进度条；也用于用户说「加个动画/动效/过渡」「这个按钮没反馈」「滚动时出现」「数字跳动」「做个高级点的效果」「交互太生硬」时。含 33 组件选型决策表、安装与前置条件、props 速查、后台系统与 Electron/Tauri 桌面壳的适配要点，以及该库未内置 prefers-reduced-motion 的全局兜底写法。
---

# Motion Primitives — 动效组件实操手册

**核心纪律：UI 改动一旦涉及动效，先来第三节的选型表里挑，不要手写 `transition-all` 或裸 `@keyframes`。** 这些组件是「复制进项目、归你所有」的源码，改起来和手写没区别，但起点高得多。

作者 ibelick，MIT，33 个组件全部免费、无 Pro 分层。**目前仍是 beta**，作者明说会有破坏性更新——所以按 vendored 源码用，不要当 npm 依赖锁版本。

---

## 一、它是什么

| 项 | 值 |
|---|---|
| 文档 | https://motion-primitives.com/docs |
| 仓库 | https://github.com/ibelick/motion-primitives |
| 许可 | MIT（仓库 `LICENCE.md`） |
| 组件数 | 33，全部 `registry:ui`，无付费层 |
| npm 依赖 | `motion`（原 Framer Motion）；`react-use-measure` 仅 infinite-slider / sliding-number / toolbar-expandable 需要 |
| 样式依赖 | Tailwind CSS + `cn`（clsx + tailwind-merge） |
| 图标 | 部分 demo 用 `lucide-react`，非必需 |
| 单组件体积 | 0.8K–20K 字符，均值约 3.9K |
| 技术约束 | 33 个全部带 `'use client'`，全部从 `motion/react` 导入 |

**分发方式是 shadcn 风格 registry，不是 npm 包。** 源码落进你的仓库。

---

## 二、安装

### 前置（首次必做）

```bash
npm install motion
npm install clsx tailwind-merge   # 需要 cn 时
npm install lucide-react          # 部分组件 demo 用到
```
`lib/utils.ts`：

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```
项目需已装 Tailwind，且 `@/*` 别名指向项目根（组件内部引用 `@/lib/utils` 与 `@/hooks/useClickOutside`）。

### 装组件

官方 CLI：

```bash
npx motion-primitives@latest add text-effect
```
或走 shadcn CLI 直接吃 registry JSON（无需配置 components.json）：

```bash
npx shadcn@latest add https://motion-primitives.com/c/text-effect.json
```
组件装到 `components/core/`。

### 离线 / CLI 失效兜底

全量索引：`https://motion-primitives.com/c/registry.json`（含每个组件的 `dependencies` 与完整源码）。

站点不可达时直接从 GitHub 取：

```bash
curl -o components/core/text-effect.tsx \
  https://raw.githubusercontent.com/ibelick/motion-primitives/main/components/core/text-effect.tsx
```
`components/core/<name>.tsx` 与 registry 里的 name 一一对应。带 hook 的组件需补 `hooks/` 文件，见第四节。

---

## 三、选型决策表（核心）

**按用户说的话找，不要按组件名找。**

### 文字

| 用户说 | 用 | 关键 props |
|---|---|---|
| 标题一个字一个字出来 | `text-effect` | `preset`：`'blur' \| 'fade-in-blur' \| 'scale' \| 'fade' \| 'slide'`；`per` 默认 `'word'`，可改字符/行 |
| 这几句话轮流显示 | `text-loop` | `interval` 默认 2 秒；`trigger` 可暂停 |
| 文字变了要平滑过渡 | `text-morph` | 状态标签、标题变更首选 |
| 文字滚进来 | `text-roll` | `duration` 默认 0.5，逐字延迟可函数化 |
| 黑客解密乱码 | `text-scramble` | `characterSet` 可自定义字符集 |
| 加载中流光文字 | `text-shimmer` | 单行流光 |
| 3D 波浪流光 | `text-shimmer-wave` | 多 z/x/y/scale/rotateY 位移 |

### 数字

| 用户说 | 用 | 关键 props |
|---|---|---|
| 数字弹一下 | `animated-number` | `value` + `springOptions`；最轻（828 字符） |
| 机械翻牌滚数字 | `sliding-number` | 逐位滚动，仪表盘首选；需 `react-use-measure` |

### 结构 / 入场

| 用户说 | 用 | 关键 props |
|---|---|---|
| 滚动到才出现 | `in-view` | `once` 控制只播一次；`viewOptions` 传 IntersectionObserver 配置 |
| 一组元素错峰出现 | `animated-group` | `preset`：fade / slide / scale / blur / blur-slide / zoom / flip / bounce / rotate / swing |
| 展开收起 | `disclosure` | 单个折叠，比 accordion 轻 |
| 手风琴 | `accordion` | 多项互斥展开 |
| 切换面板要过渡 | `transition-panel` | `activeIndex` 驱动，多步表单/Tab 内容 |
| 能拖的轮播 | `carousel` | `disableDrag` / `initialIndex` / `onIndexChange` |

### 交互反馈

| 用户说 | 用 | 关键 props |
|---|---|---|
| 鼠标靠近被吸过去 | `magnetic` | `intensity` / `range` / `actionArea`: self \| parent \| global |
| 卡片跟着鼠标 3D 倾斜 | `tilt` | `rotationFactor` / `isRevese`（注意官方就是这个拼写） |
| 鼠标处一团光 | `spotlight` | `size` / `springOptions` |
| 边框流动发光 | `glow-effect` | `colors` 数组；`blur`: softest \| soft \| medium \| strong \| stronger \| strongest \| none；`mode` 默认 `'rotate'` |
| 边框上光点在跑 | `border-trail` | `size`；比 glow-effect 克制，适合卡片 loading |
| 自定义光标 | `cursor` | `attachToParent` 控制作用域 |
| 滚动进度条 | `scroll-progress` | `containerRef` 指定滚动容器（桌面壳必需） |
| 环形旋转文字 | `spinning-text` | `radius` / `fontSize` / `reverse` |

### 浮层

| 用户说 | 用 | 关键 props |
|---|---|---|
| 从按钮里长出一个弹窗 | `morphing-dialog` | 触发元素变形放大，质感最好 |
| 点开浮层从按钮展开 | `morphing-popover` | 变形展开的 popover |
| 普通弹窗带动画 | `dialog` | 基础动画弹窗 |
| 浮层下方渐隐模糊 | `progressive-blur` | `direction` / `blurLayers` 默认 8 / `blurIntensity` |

### 布局 / 容器

| 用户说 | 用 | 关键 props |
|---|---|---|
| Tab 切换背景块滑过去 | `animated-background` | 子元素需 `data-id`；`defaultValue` / `enableHover` |
| logo 无限跑马灯 | `infinite-slider` | `speed` / `speedOnHover` / `direction` / `reverse`；需 `react-use-measure` |
| 图片前后对比滑块 | `image-comparison` | `enableHover` 或拖拽 |
| macOS 那种放大 Dock | `dock` | `magnification` / `distance` / `panelHeight` / `spring` |
| 可展开工具栏 | `toolbar-expandable` | ⚠️ 见下方警告 |

> **⚠️ `toolbar-expandable` 与 `toolbar-dynamic` 是 demo，不是可复用组件。** 两者都是 `export default`，内部硬编码 ITEMS 假数据与配色（toolbar-expandable 有 26 处 `zinc-*`，toolbar-dynamic 有 7 处）。用它们必须整段重写业务数据与配色。真正的价值是**演示 width 动画 + `useMeasure` + `useClickOutside` 三件套怎么写**——当参考实现读。

---

## 四、带额外文件的组件

装这些别漏依赖：

| 组件 | 额外文件 |
|---|---|
| `dialog` | `hooks/usePreventScroll.tsx` |
| `morphing-dialog` | `hooks/useClickOutside.tsx` |
| `morphing-popover` | `hooks/useClickOutside.tsx` |
| `toolbar-dynamic` | `hooks/useClickOutside.tsx` |
| `toolbar-expandable` | `hooks/useClickOutside.tsx` |

---

## 五、场景配方

### 后台系统（中后台 / Admin）

```tsx
// KPI 卡片：翻牌数字 + 滚动入场
<InView once>
  <AnimatedGroup preset="blur-slide">
    <MetricCard><SlidingNumber value={revenue} /></MetricCard>
  </AnimatedGroup>
</InView>

// 表格状态标签变化：用 text-morph，不要整行重挂载
<TextMorph>{status === 'ok' ? '运行中' : '已停止'}</TextMorph>

// 分段控件切换：背景块滑动
<AnimatedBackground defaultValue="7d" onValueChange={setRange}>
  <button data-id="7d">7 天</button>
  <button data-id="30d">30 天</button>
</AnimatedBackground>

// 详情浮层：从行内按钮变形展开
<MorphingPopover>
  <MorphingPopoverTrigger>查看详情</MorphingPopoverTrigger>
  ...
</MorphingPopover>

// 多步表单
<TransitionPanel activeIndex={step}>
  {steps.map((s) => <Step key={s.id} />)}
</TransitionPanel>

// 长页面滚动进度
<ScrollProgress className="fixed top-0 left-0 h-0.5 bg-blue-500" />
```
**后台禁用清单**（理由见第七节）：`magnetic`、`tilt`、`spotlight`、`cursor`、`glow-effect` 不要用在数据密集区。

### Electron / Tauri 桌面壳

- **`scroll-progress` 必须传 `containerRef`**——桌面壳滚动的通常是内层容器而不是 `document`，不传就永远不动。
- **`cursor` 慎用**：无边框窗口拖拽区（`-webkit-app-region: drag`）上叠加自定义光标会与系统光标打架。
- **`dock` / `tilt` 不要贴窗口边缘**：鼠标离开窗口时坐标丢失，动画会卡在最后一帧。
- **命令面板**：`dialog`（`usePreventScroll` 在壳里比浏览器更重要，防背景滚）+ `animated-group` 列表入场。
- **侧边栏折叠**：`disclosure` 或直接给宽度加 spring，不要用 `infinite-slider`。
- **通知气泡**：`morphing-popover` + 下方 `progressive-blur`，比半透明遮罩高级。

### 营销页 / 落地页

`text-effect` 标题揭示 → `in-view` + `animated-group` 分区入场 → `infinite-slider` 客户 logo → `sliding-number` 数据 → `image-comparison` 前后对比 → `spotlight` / `glow-effect` 收尾强调。

---

## 六、动效纪律

1. **动效必须解释因果。** 点击 → 元素从点击处长出来（`morphing-dialog`）；数据变化 → 数字滚过去（`sliding-number`）。无因果的循环动画只允许出现在营销页。
2. **一屏最多一个主角动效。** `spotlight` + `glow-effect` + `magnetic` 同屏会变成噪音。
3. **节奏**：按压 0.1–0.2s，面板展开 0.25–0.4s，入场 0.4–0.6s。
4. **spring 优于 duration**：该库大量用 `{ type: 'spring', bounce: 0.1, duration: 0.3 }`，手感最好，直接复用。
5. **暗色主题**：组件通过 `cn()` 接受 `className`，颜色靠外部传。但部分组件内置硬编码 `zinc-*`：toolbar-expandable 26 处、carousel 12 处、dock 7 处、toolbar-dynamic 7 处、spotlight 6 处、morphing-popover 5 处、dialog 4 处、border-trail 1 处，暗色下要逐个替换成语义色 token。

---

## 七、`prefers-reduced-motion` 兜底（必读）

**实测：33 个组件源码里 0 个引用 `useReducedMotion` 或任何 reduced-motion 判断。这个库没做无障碍降级。**

不要逐个改组件，在应用根节点包一层——Motion 会自动把 transform/layout 动画降级为透明度过渡：

```tsx
import { MotionConfig } from 'motion/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
```
`reducedMotion="user"` 表示跟随系统设置。这是唯一需要改的地方，别去动 `components/core/` 里的源码。

**性能红线**（按源码的监听器与常驻动画数量推断）：

- `magnetic` / `tilt` / `spotlight` / `cursor` 每个实例都挂鼠标监听或 MotionValue 变换。列表里超过约 20 个实例就会掉帧，只用在单个主按钮或首屏卡片。
- `infinite-slider` / `spinning-text` / `sliding-number` 是常驻动画，同屏超过 3–5 个就该考虑静态替代。
- 长列表入场用 `in-view` 包整块，不要给每一行套 `animated-group`——后者会一次性创建 N 个 motion 组件。
- 表格行、树节点、日志流：**不动画**。这是纪律不是建议。

---

## 八、快速自检

- [ ] 这个动效解释了哪个因果（点击 / 状态变化 / 进入视口）？
- [ ] 根节点有没有 `<MotionConfig reducedMotion="user">`？
- [ ] 数据密集区有没有误用 `magnetic` / `tilt` / `spotlight`？
- [ ] 桌面壳里 `scroll-progress` 传 `containerRef` 了吗？
- [ ] 暗色主题下有没有漏掉组件内置的 `zinc-*` 硬编码？
- [ ] 装组件时带 `hooks/` 依赖了吗？

---

## 九、参考文件

- `references/components.md` — 33 个组件的完整 props 签名（从 registry 源码程序化提取）、依赖、文件清单、导出名
- `references/adaptation.md` — 主题适配、SSR / portal 行为、性能实测数据、registry 元数据格式

官网每页文档有对应的 markdown 内容；全量索引 `https://motion-primitives.com/c/registry.json` 含每个组件的 `dependencies` / `files` / 完整源码。
