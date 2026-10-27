/**
 * 工作台资产云端双向同步模块入口。
 */

import type { Context } from '@deepseek-ai/cordis'
import { VaultCipher } from '../vault/crypto.js'
import { VaultStore } from '../vault/store.js'
import { mountWorkbenchSyncRoutes } from './api.js'
import { WorkbenchSyncEngine } from './engine.js'

export async function applyWorkbenchSync(ctx: Context): Promise<void> {
  const probe = new VaultStore(null)
  const cipher = await VaultCipher.load(probe.keyFile)
  const vaultStore = new VaultStore(cipher)

  const engine = new WorkbenchSyncEngine(vaultStore, cipher, ctx.logger ?? {})
  engine.start()
  ctx.effect(() => () => { engine.stop() }, 'workbench-sync: timer')

  const disposeRoutes = mountWorkbenchSyncRoutes(ctx, engine)
  ctx.effect(() => disposeRoutes, 'workbench-sync: routes')
}
