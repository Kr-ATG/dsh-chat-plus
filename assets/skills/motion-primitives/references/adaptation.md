# Motion Primitives — 适配与实现细节

数据来源：`https://motion-primitives.com/c/registry.json` 全量 33 个组件的源码扫描（2026-10-05 实拉）。

---

## 一、主题适配：内置硬编码色值

组件用 `cn()` 接受外部 `className`，颜色基本靠外部传入。但以下组件**内置了硬编码的 Tailwind 灰阶**（`zinc/neutral/gray/slate/stone-*`），暗色主题或换品牌色时必须逐个替换：

| 组件 | 硬编码灰阶数 | 备注 |
|---|---|---|
| `toolbar-expandable` | 26 | **必须重写**，是 demo 组件 |
| `carousel` | 12 | **必须重写**，是 demo 组件 |
| `dock` | 7 | 改动量大 |
| `toolbar-dynamic` | 7 | 改动量大 |
| `spotlight` | 6 | 改动量大 |
| `morphing-popover` | 5 | 少量替换 |
| `dialog` | 4 | 少量替换 |
| `border-trail` | 1 | 少量替换 |

**其余 25 个组件零硬编码色值**，完全靠 `className` 与 CSS 变量控制，暗色适配零成本。

替换建议：把 `zinc-100` → `bg-muted`、`text-zinc-500` → `text-muted-foreground` 之类的语义 token，一次替换全局生效。

---

## 二、SSR / Portal 行为

带 `createPortal` 的组件（2 个）：`dialog`、`morphing-dialog`。

**影响：**

- Next.js App Router / RSC 下这些组件必须放在 Client Component 里（它们本身带 `'use client'`，但父级若是 Server Component 需注意边界）。
- 弹窗类默认挂到 `document.body`。若在 **Electron/Tauri 无边框窗口**里遇到 z-index 或拖拽区冲突，用 `DialogPortal` / `MorphingDialogContainer` 的 `container` prop 指定挂载点。
- 33 个组件全部带 `'use client'`，**没有任何一个是纯 Server Component**。

带 `lucide-react` 的组件（5 个）：`carousel`、`dialog`、`morphing-dialog`、`toolbar-dynamic`、`toolbar-expandable`。不装 lucide 就要把这些图标 import 换掉。

---

## 三、多文件组件（别漏装）

- dialog → dialog.tsx, hooks/usePreventScroll.tsx
- morphing-dialog → morphing-dialog.tsx, hooks/useClickOutside.tsx
- morphing-popover → morphing-popover.tsx, hooks/useClickOutside.tsx
- toolbar-dynamic → toolbar-dynamic.tsx, hooks/useClickOutside.tsx
- toolbar-expandable → toolbar-expandable.tsx, hooks/useClickOutside.tsx

`useClickOutside` 与 `usePreventScroll` 都是很小的 hook，直接从仓库 `hooks/` 目录取。

---

## 四、Demo 组件识别

以下组件是 `export default` 且内嵌示例数据，**不能当组件直接用**：

| 组件 | 问题 |
|---|---|
| `toolbar-expandable` | `export default function`，硬编码 ITEMS（User/Messages/WalletCards 假数据）+ 26 处灰阶 |
| `toolbar-dynamic` | `export default function`，硬编码宽度切换逻辑与 7 处灰阶 |

其余 31 个都是具名导出 + 可复用 props 接口。判定方法：源码里出现 `export default function` 且顶部有 const ITEMS/数组常量，就是 demo。

---

## 五、依赖分布

| 依赖 | 需要的组件 |
|---|---|
| `motion` | 全部 33 个 |
| `react-use-measure` | `infinite-slider`、`toolbar-expandable`、`sliding-number` |
| `lucide-react` | 见第二节 |
| `clsx` + `tailwind-merge` | 通过 `cn`，几乎全部 |

`registryDependencies` 全为空数组——组件之间**不互相依赖**，装哪个是哪个，不会产生隐式拉取。

---

## 六、单组件体积

最小 / 最大 / 均值：

```text
   828  animated-number
   900  scroll-progress
  1015  transition-panel
   ...
 20526  dialog
 10614  morphing-dialog
  8269  carousel
      
  3913  均值
```
总计约 126 KB 源码（全部 33 个）。实际项目按需装，单个组件通常几 KB，对包体影响可忽略。

---

## 七、性能考量（源码依据）

| 组件 | 常驻开销 | 依据 |
|---|---|---|
| `magnetic` / `tilt` / `spotlight` / `cursor` | 每个实例挂鼠标事件 + MotionValue | 源码中 `useMotionValue` + 事件监听 |
| `infinite-slider` | `requestAnimationFrame` 常驻循环 | 源码用 rAF 驱动位移 |
| `spinning-text` | 无限循环动画 | `repeat: Infinity` |
| `sliding-number` | 每位数字一个 spring | 源码按位渲染，位数 × spring 实例 |
| `progressive-blur` | 8 层 `backdrop-filter` 叠加 | `blurLayers` 默认 8，每层一个 DOM |
| `glow-effect` / `border-trail` | 持续动画 | 无限 transition |

**结论**：`progressive-blur` 的 backdrop-filter 是 GPU 密集操作，一屏别超过 2–3 个；`sliding-number` 位数多时（如 8 位金额）spring 实例会翻倍。

---

## 八、registry JSON 结构（自己写工具时用）

```json
{
  "name": "text-effect",
  "type": "registry:ui",
  "registryDependencies": [],
  "dependencies": ["motion"],
  "devDependencies": [],
  "tailwind": {...},
  "cssVars": {...},
  "files": [
    { "path": "text-effect.tsx", "content": "...完整源码...", "type": "registry:component" }
  ]
}
```
- 全量索引：`/c/registry.json`（含 `items[]`，33 个）
- 单个组件：`/c/<name>.json`
- 注意路径是 `/c/` 不是 `/r/`——`/r/` 返回 404。
- 该库**没有** `llms.txt`、没有 MCP、没有 `/docs/ai`。要喂给 AI 只能自己抓 `/c/registry.json`。

---

## 九、更新检查

组件是 vendored 源码，不会自动更新。要同步上游改动：

```bash
# 对比本地与上游
curl -s https://raw.githubusercontent.com/ibelick/motion-primitives/main/components/core/text-effect.tsx > /tmp/upstream.tsx
diff /tmp/upstream.tsx components/core/text-effect.tsx
```
上游仓库活跃（最近推送 2026-09-28），但仍在 beta 期，同步前先看 `git log` 有没有破坏性变更。
