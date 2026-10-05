/**
 * dsh-provider-hub — 新版 wire 面 → webui 旧 IApiClient 信封适配器。
 *
 * 移植的供应商页（store / Detail / ModelListEditor）按 webui 时代的 wire
 * 契约写成：`connection.api` +  responses 形如 `{result:{ok,value}}`。当前
 * DSH 里 `connection.api` 已不存在，正确姿势是官方模型页同款：
 * `ctx.remote.settings/credentials/llm`（直接返回 `{ok,value}`）+
 * `ctx.configForms.describe()` 共享镜像（兼容 `settingsScope` 与直连回退）。本文件把新面装进旧信封，
 * 移植代码一行不用改。
 */

type OldResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

function toOld<T>(promise: Promise<{ ok: boolean; value?: T; error?: any }>): Promise<{ result: OldResult<T> }> {
  return promise.then(
    (r) => r.ok
      ? { result: { ok: true as const, value: r.value as T } }
      : { result: { ok: false as const, error: { message: String(r.error?.message ?? r.error) } } },
    (e) => ({ result: { ok: false as const, error: { message: String(e?.message ?? e) } } }),
  )
}

export interface AdapterServices {
  remote: { settings: any; credentials: any; llm: any; $on?: (event: string, fn: () => void) => () => void }
  configForms?: {
    describe(): {
      ensure(): Promise<void>
      getSnapshot(): { view?: { writable: boolean; namespaces: any[] }; error?: string | null }
    }
  }
  settingsScope?: {
    describe(): {
      ensure(): Promise<void>
      getSnapshot(): { view?: { writable: boolean; namespaces: any[] }; error?: string | null }
    }
  }
}

/**
 * 构造移植页要的 api 对象（settings / credentials / llm 三域，旧信封）。
 */
export function createLegacyApi(services: AdapterServices): any {
  const remote = services.remote ?? ({} as AdapterServices['remote'])
  const mirrorSource = services.configForms ?? services.settingsScope
  return {
    settings: {
      describe: async (_args: any) => {
        try {
          if (mirrorSource?.describe) {
            const face = mirrorSource.describe()
            await face.ensure()
            const snap = face.getSnapshot()
            if (snap.view) {
              return {
                result: {
                  ok: true as const,
                  value: { writable: snap.view.writable, namespaces: [...snap.view.namespaces] },
                },
              }
            }
          }
          if (remote?.settings?.describe) {
            const r = await remote.settings.describe()
            if (r.ok) {
              return {
                result: {
                  ok: true as const,
                  value: { writable: r.value.writable, namespaces: [...r.value.namespaces] },
                },
              }
            }
            return { result: { ok: false as const, error: { message: r.error?.message ?? 'settings unavailable' } } }
          }
          return { result: { ok: false as const, error: { message: 'settings unavailable' } } }
        } catch (e: any) {
          return { result: { ok: false as const, error: { message: String(e?.message ?? e) } } }
        }
      },
      mutate: (args: any) => toOld(remote.settings.mutate(args.ns, args.ops, args.expectedRevision)),
    },
    credentials: {
      describe: (args: any) => toOld((async () => {
        const r = await remote.credentials.describe(args.refs)
        return r.ok ? { ok: true as const, value: { credentials: r.value } } : r
      })()),
      set: (args: any) => toOld((async () => {
        const r = await remote.credentials.set(args.ref, args.value)
        return r.ok ? { ok: true as const, value: {} } : r
      })()),
      unset: (args: any) => toOld((async () => {
        const r = await remote.credentials.unset(args.ref)
        return r.ok ? { ok: true as const, value: {} } : r
      })()),
    },
    llm: {
      providers: (_args: any) => toOld((async () => {
        const r = await remote.llm.listConfigurableProviders()
        return r.ok ? { ok: true as const, value: { providers: r.value } } : r
      })()),
      discoverModels: (args: any) => toOld((async () => {
        const { settingsNs, ...request } = args
        const r = await remote.llm.discoverModels(settingsNs, request)
        return r.ok ? { ok: true as const, value: { models: r.value } } : r
      })()),
    },
  }
}
