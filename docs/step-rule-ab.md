# step 纪律通道 · A/B 实测记录

> 2026-10-24 实测。目的是回答两个问题：这段注入文本到底有没有用？对非 PTC（native）模式有没有用？
>
> 实验设计：同一任务、同一模型、只切换注入开关（全局单值 `stepInjectEnabled`，或探针插件的环境变量），
> 从**持久会话日志**取 step / 工具调用计数，不看客户端投影。

## 结论先给

| 模式 | step 变化 | 墙钟变化 | 判断 |
|---|---:|---:|---|
| **PTC**（`run_code`） | **−39.5%**（19.0 → 11.5） | **−58.7%**（179s → 74s） | 有效，保持开启 |
| **native**（直接工具调用） | −25.4%（12.6 → 9.4） | **−3.9%**（56s → 54s） | 行为变了，时间没省下来 |

native 模式的收益衰减有明确机制原因，见最后一节。

---

## 一、PTC 模式：4 个子代理交叉对照

任务：审计 `dsh-chat-plus/src` 的代码规模，产出 markdown 报告（五项指标）。

为避免顺序干扰，分两轮、开关顺序反转。

| 组 | step 纪律 | step 数 | PTC 派发 | 打包率 | 墙钟 | 输出 token |
|---|---|---:|---:|---:|---:|---:|
| A | **关** | 24 | 14 | 0.58 | 142s | 24,123 |
| B | 开 | 10 | 14 | 1.40 | 69s | 12,415 |
| C | 开 | 13 | 10 | 0.77 | 79s | 13,922 |
| D | **关** | 14 | 20 | 1.43 | 216s | 17,668 |
| 均值 | 关 19.0 / 开 11.5 | | | | 关 179s / 开 74s | 关 41,791 / 开 26,337 |

"打包率" = PTC 派发数 ÷ step 数，衡量每个 step 里塞了几个动作。

**关键观察**：step 中位数耗时没有下降（3.7–6.0s 区间波动），降的是**次数**。
说明省下来的确实是模型往返，不是工具跑得更快——与注入文本自己的论断一致。

**质量核对**：四份报告独立收敛到相同数字（324 文件 / 111,299 行 / `client/kr-chat/styles.ts` 最大 6,381 行 /
TODO 合计 2 处 / 正确识别 `call-config.ts` 双份副本）。被审计仓库 `git status` 始终干净。

## 二、native 模式：10 轮交替

`headless` profile + `DSH_TOOLS_MODE=native`。注入用临时探针插件
（`dsh-memory` 硬依赖 `webServer`，headless 挂不上），文本从正式插件原样搬。

任务比 PTC 轮更重：三个插件 × 六项指标。

| 轮次 | step 纪律 | step | 工具调用 | 墙钟 |
|---|---|---:|---:|---:|
| n1 | 关 | 6 | 9 | 31s |
| n1 | 开 | 6 | 5 | 31s |
| n2 | 关 | 22 | 21 | 89s |
| n2 | 开 | 9 | 8 | 37s |
| n3 | 关 | 11 | 10 | 43s |
| n3 | 开 | 10 | 11 | 85s |
| n4 | 开 | 11 | 10 | 59s |
| n4 | 关 | 17 | 20 | 80s |
| n5 | 开 | 11 | 10 | 56s |
| n5 | 关 | 7 | 8 | 36s |
| **均值** | 开 9.4 / 关 12.6 | 开 8.8 / 关 13.6 | 开 54s / 关 56s |

- step 降 25.4%，工具调用降 35%，**墙钟只降 3.9%**
- 墙钟**中位数**上反而是关组更快（43s vs 56s）
- step 中位数：开 10 / 关 11，差距很小

结论：native 下这段纪律仍在改变行为（少了一部分"再确认一次"的回合），但换算不成时间。

## 三、为什么 native 不划算：`isConcurrencySafe` 缺省

native 模式对抗往返成本的手段是**并行分发**——一条 assistant 消息里发多个 tool_use，
框架并行执行，往返算一次。但这只对声明了并发安全的工具生效：

```js
// packages/core/tools/src/pipeline.ts
executionMode(exec) {
  const tool = this.resolveExecution(...)
  if (!tool?.isConcurrencySafe) return { kind: 'exclusive' }   // 未声明 = 串行
  ...
}
```

判据是 fail-closed。全量扫描 `@deepseek-ai` 各工具包，只有 4 个声明了
`isConcurrencySafe`：`dsh-tool-fs`、`dsh-tool-web`、`dsh-tool-subagent`、`dsh-tool-session-query`。

**`dsh-tool-pwsh` 全包零命中。** 而 `glob`/`grep` 所在的 `dsh-tool-fs-search` 同样未声明。

于是：任何要 shell 的任务（Windows 上的 coding 任务基本都是），模型即使在一条消息里发多个
`pwsh` 调用，也会被逐个串行执行，往返省不下来。这解释了 native 组"step 减少但墙钟不动"。

反过来，这段纪律在 native 下真正起作用的是另一半指令——**把多条只读命令塞进同一个
`pwsh` 调用、用 `=== 小节 ===` 分隔**。工具调用数 13.6 → 8.8 就是这条在生效。

## 四、复现方式

- 指标提取：会话持久化在 `$DSH_HOME/sessions/<workspace>/<id>/session.v4.jsonl.zstd`，
  按 zstd 帧逐帧解压后折叠 `step/start`、`tool/call`、`tool/ptc-dispatch`。
- PTC 侧对照：直接改 `$DSH_HOME/memories/dsh-memory/store/state.json` 的 `stepInjectEnabled`，
  或走 `POST /api/dsh-memory/step-inject-state`。注意它是**全局单值**，不存在按会话切换。
- native 侧对照：`DSH_TOOLS_MODE=native` + 探针插件 + 开关环境变量。

## 五、样本量的诚实说明

PTC 4 组、native 10 组，够看方向，不够给紧的置信区间——PTC 的关组单次就横跨 14–24 step。
native 的墙钟中位数反转是真实存在的反证，不是噪声，所以本文不把它解释掉。

## 六、实现细节（踩坑记录）

1. **注入消息必须带 `source.kind`**，否则下游（投影 / 展示 / 压缩）会抛
   `Cannot read properties of undefined (reading 'kind')`。手工构造 user message 的插件都会撞。
2. **`agent/pre-step` 的 payload 不保证有 `agent` 字段**。`dsh-memory` 里
   `payload.agent.session.id` 是拿 `never` 断言兜住的，照抄会在 headless 下崩。
3. **pre-step 是瀑布**，必须 `await next()` 拿下游决策再追加，不能直接返回自己的 messages。
4. **首步注入一次即可**，之后靠 cacheRead 反复带入历史——所以文本长度本身是成本，
   删掉后做法不变的话就是水分。
