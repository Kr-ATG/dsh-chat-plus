/**
 * VideoModelBlock — 生视频模型区块。
 *
 * 交互：两级下拉——先选供应商，再选该供应商下的模型；选中即保存。
 * 版式走 {@link ../blocks/shared.tsx} 的统一外壳：标题行带当前生效胶囊、
 * 说明默认折叠，两个下拉并排在同一填充面里各带小标签。
 *
 * 数据通道：`GET /api/model-capabilities/snapshot` + `POST
 * /api/model-capabilities/active`——settings 命名空间 `model-capabilities`，
 * 也就是 `generate_video` 工具真正读的那一份。旧实现写工作区
 * model-router.json 的 `videoActive`，工具读不到，选了下拉也照样报
 * 「尚未选择视频模型」。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BlockShell, FILL_PANEL, SelectField, StateHint } from '../blocks/shared.tsx'

interface ModelInfo { id: string; name: string; video?: boolean }
interface ProviderInfo { provider: string; displayName: string; models: ModelInfo[] }

const BASE = '/api/model-capabilities'

const DESCRIPTION = 'generate_video 使用的模型（提示词 → 视频生成，异步任务自动轮询）。标注「生视频」的模型声明了视频生成能力，可在供应商的模型设置中开启「生视频」。'

/** 该模型是否声明了生视频能力。 */
function isCapable(m: ModelInfo): boolean {
  return m.video === true
}

export function VideoModelBlock(): ReactNode {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [active, setActive] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`${BASE}/snapshot`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: any) => {
        if (!alive) return
        if (d && d.ok !== false) {
          setProviders(Array.isArray(d.providers)
            ? d.providers
              .map((p: any) => ({
                provider: typeof p?.provider === 'string' ? p.provider : '',
                displayName: typeof p?.displayName === 'string' && p.displayName !== '' ? p.displayName : String(p?.provider ?? ''),
                models: Array.isArray(p?.models) ? p.models.filter((m: any) => m && typeof m.id === 'string') : [],
              }))
              .filter((p: ProviderInfo) => p.provider !== '')
            : [])
          setActive(typeof d.videoActive === 'string' ? d.videoActive : '')
        } else {
          setError((d && d.error) || '加载失败')
        }
      })
      .catch(() => { if (alive) setError('接口不可用') })
    return () => { alive = false }
  }, [])

  const slash = active.indexOf('/')
  const activeProvider = slash > 0 ? active.slice(0, slash) : ''
  const activeModel = slash > 0 ? active.slice(slash + 1) : ''

  const currentProvider = selectedProvider || activeProvider || providers[0]?.provider || ''
  const currentModels = providers.find(p => p.provider === currentProvider)?.models ?? []
  const modelValue = currentProvider === activeProvider ? activeModel : ''

  const pick = (key: string): void => {
    if (saving) return
    setSaving(true)
    setError(null)
    fetch(`${BASE}/active`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'video', key }),
    })
      .then((r) => r.json())
      .then((d: any) => {
        // 失败必须说话：静默忽略会让下拉停在旧值，用户以为已切换。
        if (d && d.ok) setActive(key)
        else setError((d && (d.error ?? d.message)) || '保存失败')
      })
      .catch(() => setError('保存请求失败'))
      .finally(() => setSaving(false))
  }

  return (
    <BlockShell title="生视频模型" activeText={active} description={DESCRIPTION}>
      {error !== null ? <StateHint text={error} tone="error" /> : null}
      {providers.length === 0 && error === null
        ? <StateHint text="加载中…" />
        : (
          <div style={FILL_PANEL}>
            <SelectField label="供应商" value={currentProvider} onChange={setSelectedProvider}>
              {providers.map(p => <option key={p.provider} value={p.provider}>{p.displayName || p.provider}</option>)}
            </SelectField>
            <SelectField
              label="模型"
              value={modelValue}
              width={240}
              disabled={saving || currentModels.length === 0}
              onChange={(v) => { if (v !== '') pick(`${currentProvider}/${v}`) }}
            >
              <option value="">{currentModels.length === 0 ? '无可用模型' : '选择模型'}</option>
              {currentModels.map(m => (
                <option key={m.id} value={m.id}>{m.name || m.id}{isCapable(m) ? '（生视频）' : ''}</option>
              ))}
            </SelectField>
          </div>
        )}
    </BlockShell>
  )
}
