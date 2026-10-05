# vendor/ — 内联的 DSH 叶子模块

## 为什么需要这个目录

一句话：**装进 DSH 的插件，不能在运行时 `import '@deepseek-ai/dsh-llm'` 这类包。**

DSH 的 `@deepseek-ai/*` 包是**只发源码**的。以 `dsh-llm` 为例，安装到
`~/.dsh/profiles/<p>/node_modules/@deepseek-ai/dsh-llm` 之后，`lib/` 里只有
`.d.ts`、`tsbuildinfo` 和几个手工入口（`typert.host.js` 等），**没有
`lib/index.js`**——尽管它的 `package.json` 明写着 `"main": "lib/index.js"`。

DSH 自己为什么没事？因为它跑在 **tsx** 下，靠 `tsconfig.base.json` 的 `paths`
把包名映射回源码目录：

```json
"@deepseek-ai/dsh-llm": ["./packages/llm/llm/src"]
```

而 tsx 的 `resolveTsPaths` **只对不在 `node_modules` 里的 importer 应用 `paths`**。
实测（在 DSH checkout 下跑 `node --import tsx/esm`）：

| importer 位置 | `@deepseek-ai/dsh-llm` | `@deepseek-ai/dsh-tools` | `@deepseek-ai/cordis` | `@deepseek-ai/schemastery` |
| --- | --- | --- | --- | --- |
| checkout 内 | ✅ 45 个导出 | ✅ | ✅ | ✅ |
| profile 的 node_modules 内 | ❌ ERR_MODULE_NOT_FOUND | ❌ ERR_MODULE_NOT_FOUND | ✅ | ✅ |

所以规则很直接：**宿主产物里能留给运行时解析的 `@deepseek-ai/*` 名字，必须
逐个验证过「确实有运行时产物」。** 目前验证通过的只有：

- `@deepseek-ai/cordis`（`lib/index.js` 存在，且必须与宿主共享同一实例）
- `@deepseek-ai/dsh-util-crypto`（`lib/index.js` 存在，且自身零导入）

其余需要的 DSH 能力，把**叶子模块**复制进来。

## 什么是「叶子模块」

满足以下三条，就可以安全内联：

1. **不 import `@deepseek-ai/cordis`**——否则会拿到第二份 cordis，服务名解析
   和 `instanceof` 全部对不上宿主。
2. **不注册 cordis 服务**、不持有跨模块可变状态——纯函数或纯类。
3. 它自己的运行时依赖要么也在 vendor 里，要么在白名单里。

## 当前内联了什么

| 目录 | 来源 | 提供 |
| --- | --- | --- |
| `dsh-llm/` | `packages/llm/llm/src/` | `BlockAssembler`、`createUserMessage`、`createMessage`、`createAssistantMessage`、`MessageId`、`ToolCallId`、`deepFreeze`、`assertNever`、`HarnessError` |
| `dsh-tools/` | `packages/core/tools/src/` | `defineTool`、`InferArgs`、`ParameterSchemaSpec` 及 JSON Schema 编译/校验 |
| `dsh-session/json.ts` | `packages/core/session/src/json.ts` | `isJsonValue` |

`dsh-llm/index.ts` 是这组模块的唯一对外入口；triad 源码只从它导入。

不内联的反例：`packages/core/tools/src/index.ts`（1945 行）会拉进 cordis、
schemastery、dsh-scope、ptc.ts、ts-types.ts……一旦内联就必然重复 cordis。
好在我们只需要它的**类型**，而类型导入会被 esbuild 完全擦除，所以
`schema.ts` 里的 `import type { ToolDefinition } from '@deepseek-ai/dsh-tools'`
保持原样指向 DSH 包即可。

## 维护规则

- **逐字复制，不改动逻辑。** 唯一允许的编辑是改写 import 说明符：
  - 值导入（`import { X }`）→ 指向 vendor 内的本地文件；
  - 类型导入（`import type { X }`）→ 保留指向 `@deepseek-ai/*`，反正构建时会擦除。
- 修改后跑 `node build.mjs`：构建脚本末尾的 `assertHostExternals()` 会扫描
  `lib/index.js` 里所有留给运行时的裸导入，命中白名单之外的名字就**直接让构建失败**。
- 升级 DSH 后，用 `diff` 对比 vendor 文件与源码，确认上游没有行为变更。


## 2026-10-05 新增：schemastery / cosmokit

融合 dsh-provider-hub 后新增两个内联包（都在 `src/vendor/` 下、都以**原包产物**形式随包内联）：

| 目录 | 来源 | 为什么必须内联 |
| --- | --- | --- |
| `schemastery/index.mjs` | `@deepseek-ai/schemastery` 的 `lib/index.mjs`（3.18.4） | 工作台「供应商」页要 `rehydrateSchema` 反序列化 settings schema（`webui/schema-path.ts`）。它**不在浏览器模块表**里，运行时 `require` 会抛；host 侧同理（装进 profile 后裸 node 解析不到）。 |
| `cosmokit/index.js` | `@deepseek-ai/cosmokit` 的 `lib/index.js`（1.8.5） | schemastery 的唯一运行时依赖；schemastery 里的 `from "@deepseek-ai/cosmokit"` 已改指向 `../cosmokit/index.js`。 |

两者都是**零 cordis 依赖的纯工具库**（符合上面的「叶子模块」三条），不会与宿主产生
第二份实例问题——schemastery 的 `Schema` 只做结构校验与序列化，不与宿主共享状态。

构建脚本用 `alias` 把这两个包名映射到本地副本（client 与 host 两半身各一份配置），
host 侧的白名单因此只需放行 `undici`（代理加载器按 `process.versions.undici` 挑同大版本
实例，内联会锁死版本并与 Node 内置 fetch 的 dispatcher 协议对不上）。

## 客户端半身不适用

`lib/client.js` 走的是浏览器模块表，包名由 `package.json` 的
`dsh.client.inject` 声明、由宿主在运行时注入，不存在 node 解析问题。
