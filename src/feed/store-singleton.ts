/**
 * 动态（Feed）模块的「当前活跃 store」槽位。
 *
 * 为什么需要它：工作台云同步（triad/workbench-sync）从云端恢复动态设置后，
 * 必须让**本进程里真正在服务的那份内存态**重新读盘 —— 否则用户点完
 * 「一键同步下来」，动态页仍显示旧设置，直到重启 DSH 才生效。
 *
 * FeedStore / EntityStore 都是 applyFeedHost 内部 new 的实例，没有别的途径
 * 拿到它们；也不能挂到 ctx 上（cordis 对未 declare/provide 的属性赋值会抛）。
 * 所以照 memory-store-singleton 的手法做一个模块级槽位：装配时登记，
 * 恢复时取用，卸载时清空。
 */

export interface ReloadableStore {
  /** 重新从磁盘读取（实现方负责排空进行中的写）。 */
  reload?: () => void | Promise<void>
}

let feedStoreSingleton: ReloadableStore | undefined
let entityStoreSingleton: ReloadableStore | undefined

/** 登记当前活跃的 Feed / Entity store（仅 applyFeedHost 装配时调用）。 */
export function setActiveFeedStores(stores: { feed?: ReloadableStore; entities?: ReloadableStore }): void {
  if (stores.feed !== undefined) feedStoreSingleton = stores.feed
  if (stores.entities !== undefined) entityStoreSingleton = stores.entities
}

/** 清空槽位（插件卸载时调用；同一实例才清，避免误伤后来者）。 */
export function clearActiveFeedStores(stores: { feed?: ReloadableStore; entities?: ReloadableStore }): void {
  if (stores.feed !== undefined && feedStoreSingleton === stores.feed) feedStoreSingleton = undefined
  if (stores.entities !== undefined && entityStoreSingleton === stores.entities) entityStoreSingleton = undefined
}

export function getActiveFeedStore(): ReloadableStore | undefined {
  return feedStoreSingleton
}

export function getActiveEntityStore(): ReloadableStore | undefined {
  return entityStoreSingleton
}
