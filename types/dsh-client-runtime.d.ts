/**
 * 类型垫片：`@deepseek-ai/dsh-client-runtime` 在当前 DSH 0.1.2 源码树中已不再
 * 以独立包存在（client 运行时类型并入 @deepseek-ai/dsh-client-* 各客户端包），
 * 但为了与 webui/done-pill 的既有 import 写法保持一致（全部是 type-only，
 * esbuild 会整句擦除，不影响产物），这里把它映射到真实存在的类型源。
 */

export type {
  AssistantBlock,
  AssistantMessageNode,
  RunningToolCall,
  ToolCallBlock,
  ToolResultNode,
  TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

export type {
  AssistantChatData,
  ChatNode,
  ChatNodeKind,
  ChatNodeViewProps,
  ChatViewSlotProps,
  FinalAssistantChatData,
  TurnTailOwnerProps,
} from '@deepseek-ai/dsh-client-ui-chat/client'

export type { Context } from '@deepseek-ai/cordis'

/**
 * `ClientContext` / `SessionId` 别名。
 *
 * 插件里一直按旧名 import（`import type { ClientContext, SessionId } from
 * '@deepseek-ai/dsh-client-runtime/client'`），但当前 DSH 的类型源里这两个名字
 * 已经不在 client-runtime 面上了：根上下文就是 cordis 的 `Context`，会话 id 是
 * ui-session 的品牌类型。这里做等价别名，让既有 import 全部类型正确——否则
 * 每个用到它们的文件都会报 TS2305（而且签名一错，后面全是隐式 any）。
 *
 * 纯 type-only：esbuild 整句擦除，产物零影响。
 */
export type ClientContext = import('@deepseek-ai/cordis').Context
export type SessionId = import('@deepseek-ai/dsh-client-ui-session/client').SessionId
