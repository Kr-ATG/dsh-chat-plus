/**
 * dsh-chat-plus — 「网络代理」区块（原 dsh-provider-hub 的通用设置卡片，
 * 2026-10-05 融合进 dsh-chat-plus，先做成独立工作台 Tab，同日改为**供应商页
 * 底部的两个区块**——用户反馈代理不是一个独立分类，跟供应商放一起更顺）。
 *
 * 三件事：
 *   1. 总开关（开启后 DSH 的 API 请求走本地代理）；
 *   2. 代理地址 + 连通性自检（真经代理发一次请求，区分「已挂载」与「真的通」）；
 *   3. 生效范围：全局 / 仅选中，选中态是逐供应商开关（写 host 侧
 *      `/api/dsh-proxy/member`，读-改-写，避免多开关互相覆盖）。
 *
 * 数据通道沿用旧插件：GET /api/dsh-proxy/state | providers | test、
 * POST /api/dsh-proxy/set | member，settings 命名空间 network-proxy 不变，
 * 升级零迁移。保存即运行时生效，无需重启。
 *
 * 版式：两张卡走 .phub-block（与辅助视觉 / 生图 / 生视频同一套卡片 token），
 * 根节点 .pp-panel 是普通列容器——滚动交给外层的 .phub-blocks。
 */
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { PROXY_CHANGED, loadProxySnapshot, saveProxy } from '../webui/chat/proxy.ts'
import type { ProxySnapshot } from '../webui/chat/proxy.ts'

// ── 样式（沿用官方控件规格：行卡片 12px 圆角、输入框 32px、胶囊按钮 28px）──

/* 卡片外观由 .phub-block 承担（同 token / 同圆角 / 同内距），这里只给列布局。 */
const sectionCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 0,
}

const headRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }
const copyCol: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }
const titleStyle: CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const descStyle: CSSProperties = { fontSize: 12, lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary)' }

const tagStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 4, padding: '1px 6px',
  fontSize: 11, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap', flex: 'none',
}

const switchStyle: CSSProperties = {
  position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
  flex: 'none', background: 'var(--dsw-alias-border-l2)', transition: 'background .18s', padding: 0,
}
// 开启态用品牌蓝（浅色 deepseek-500 / 深色 deepseek-400），knob 白底可见；
// 不能用 --dsw-alias-brand-primary——它在浅色下是黑、深色下是白（反色设计）。
const switchOnStyle: CSSProperties = { ...switchStyle, background: 'var(--dsw-alias-state-business-primary)' }
const knobStyle: CSSProperties = {
  position: 'absolute', top: 2, left: 2, width: 18, height: 18, borderRadius: '50%',
  background: 'var(--dsw-alias-label-tertiary)',
  transition: 'left .18s cubic-bezier(.2,.8,.2,1), background .18s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
}
const knobOnStyle: CSSProperties = { ...knobStyle, left: 20, background: '#fff' }

const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }
const fieldLabel: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
const fieldRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

const inputStyle: CSSProperties = {
  height: 32, padding: '0 10px', fontSize: 14, lineHeight: '22px', minWidth: 0, flex: 1,
  borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
}
const smallBtn: CSSProperties = {
  borderRadius: 14, height: 28, padding: '0 12px', fontSize: 12, cursor: 'pointer', flex: 'none',
  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
}
const smallBtnPrimary: CSSProperties = {
  ...smallBtn,
  border: '1px solid transparent',
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
}
const btnDisabled: CSSProperties = { opacity: 0.45, cursor: 'default' }

const noteStyle: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' }
const okNoteStyle: CSSProperties = { ...noteStyle, color: 'var(--dsw-alias-state-success-primary)' }
const errNoteStyle: CSSProperties = { ...noteStyle, color: 'var(--dsw-alias-state-error-primary)' }
const warnNoteStyle: CSSProperties = { ...noteStyle, color: 'var(--dsw-alias-state-warn-color, var(--dsw-alias-state-warn-label, #d4800a))' }
const cleanBtnStyle: CSSProperties = {
  marginLeft: 8, height: 24, padding: '0 10px', borderRadius: 12,
  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent',
  color: 'var(--dsw-alias-label-primary)', fontSize: 12, lineHeight: '18px',
  cursor: 'pointer', flex: 'none',
}

/** 分段控件右侧的小字说明（比字段标签更轻，跟在控件后面同一行）。 */
const segHintStyle: CSSProperties = {
  fontSize: 12, lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

/** 范围分段控件（官方 filterTabs 语言：无容器底色，选中只加中性灰底）。 */
const segStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4 }
function segBtn(active: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 28, padding: '0 14px', borderRadius: 8, border: 'none',
    background: active ? 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08))' : 'transparent',
    color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
    fontSize: 12.5, fontWeight: active ? 600 : 500, fontFamily: 'inherit',
    cursor: 'pointer', transition: 'background .16s, color .16s',
  }
}

type NoteKind = 'info' | 'ok' | 'error'
interface Note { kind: NoteKind; text: string }

function noteStyleOf(kind: NoteKind): CSSProperties {
  if (kind === 'ok') return okNoteStyle
  if (kind === 'error') return errNoteStyle
  return noteStyle
}

/** 「网络代理」工作台页面。 */
export function ProxyPanel(): JSX.Element {
  const [snapshot, setSnapshot] = useState<ProxySnapshot | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<Note | null>(null)

  const refresh = useCallback(() => {
    void loadProxySnapshot().then((next) => {
      if (next === null) return
      setSnapshot(next)
      // 用户正在改地址时不要覆盖他：草稿为空、或与已存值一致才回填，
      // 否则一次慢响应就把半途的输入静默回滚。
      setUrlInput(prev => (prev.trim() === '' || prev.trim() === next.url ? next.url : prev))
    })
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener(PROXY_CHANGED, refresh)
    return () => { window.removeEventListener(PROXY_CHANGED, refresh) }
  }, [refresh])

  const enabled = snapshot?.enabled === true
  const mode = snapshot?.mode ?? 'all'
  const busyAny = busy !== ''
  const dirty = urlInput.trim() !== (snapshot?.url ?? '')

  /** 统一提交：总开关 / 地址 / 范围都走这里，立即生效。 */
  const submit = useCallback(async (patch: { enabled?: boolean; url?: string; mode?: 'all' | 'selected' }, tag: string): Promise<void> => {
    setBusy(tag)
    setNote(null)
    try {
      const r = await saveProxy(patch)
      if (!r.ok) {
        setNote({ kind: 'error', text: r.message })
        return
      }
      setSnapshot(r.snapshot)
      setUrlInput(r.snapshot.url)
      if (!r.snapshot.enabled) setNote({ kind: 'info', text: '代理已关闭，全部请求直连' })
      else if (patch.url !== undefined) setNote({ kind: 'ok', text: '已生效：' + r.snapshot.url })
      else if (patch.mode !== undefined) setNote({ kind: 'info', text: patch.mode === 'all' ? '已切换为全局：全部请求走代理' : '已切换为仅选中：只有勾选的供应商走代理' })
      else setNote({ kind: 'ok', text: '代理已开启：' + r.snapshot.url })
    } catch {
      setNote({ kind: 'error', text: '请求失败，DSH 服务可能未就绪' })
    } finally {
      setBusy('')
    }
  }, [])

  /** 清理名单里已失效的 key（供应商被删 / 改名后留下的死条目）。 */
  const cleanStale = useCallback(async (): Promise<void> => {
    const dead = new Set(snapshot?.stale ?? [])
    if (dead.size === 0) return
    setBusy('clean')
    setNote(null)
    const kept = (snapshot?.providers ?? []).filter(k => !dead.has(k))
    const r = await saveProxy({ providers: kept })
    if (!r.ok) setNote({ kind: 'error', text: r.message })
    else {
      setSnapshot(r.snapshot)
      setNote({ kind: 'ok', text: '已清理 ' + dead.size + ' 个失效条目' })
    }
    setBusy('')
  }, [snapshot])

  /** 连通性自检：真实经代理请求一次，区分「已挂载」与「真的通」。 */
  const probe = useCallback(async (): Promise<void> => {
    setBusy('test')
    setNote(null)
    try {
      const r = await fetch('/api/dsh-proxy/test', { cache: 'no-store' }).then(res => res.json())
      if (r?.ok !== true) {
        setNote({ kind: 'error', text: String(r?.message ?? r?.error ?? '自检失败') })
      } else if (r.reachable === true) {
        setNote({ kind: 'ok', text: '代理连通（' + String(r.target) + ' → HTTP ' + String(r.status) + '，' + String(r.elapsedMs) + ' ms）' })
      } else {
        setNote({ kind: 'error', text: '代理不通：' + String(r.message ?? '未知错误') + '——检查本地代理是否在 ' + String(r.url) + ' 监听' })
      }
    } catch {
      setNote({ kind: 'error', text: '自检请求失败' })
    } finally {
      setBusy('')
    }
  }, [])

  /*
   * 「N 家走代理」按**真实生效**算：host 的 providers 名单里会残留已删除 /
   * 改名的 route key（host 侧叫 stale，解析不出域名、静默不代理）。
   * 直接数 providers.length 就会出现「只勾了两家却写 5 家」——用户 2026-10-05
   * 正是被这个数字问住的。这里排除 stale，并把死条目单独提示出来。
   */
  const stale = snapshot?.stale ?? []
  const liveCount = Math.max(0, (snapshot?.providers.length ?? 0) - stale.length)
  const statusTag = !enabled ? '已关闭' : mode === 'all' ? '全局' : liveCount + ' 家走代理'

  return (
    <div className="pp-panel">
      <section style={sectionCard} className="phub-block phub-block-in">
        <div style={headRow}>
          <div style={copyCol}>
            <span style={titleStyle}>网络代理</span>
            <span style={descStyle}>
              让 DSH 的 API 请求走本地代理（B.AI 等海外服务需要）；开启后按下面的「生效范围」决定哪些供应商走代理，保存即生效
            </span>
          </div>
          <span style={tagStyle}>{statusTag}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="网络代理开关"
            style={enabled ? switchOnStyle : switchStyle}
            onClick={() => { void submit({ enabled: !enabled }, 'toggle') }}
            disabled={busyAny}
          >
            <span style={enabled ? knobOnStyle : knobStyle} />
          </button>
        </div>

        <div style={fieldStyle}>
          <span style={fieldLabel}>生效范围</span>
          <div style={fieldRow}>
            <div style={segStyle} role="tablist" aria-label="代理生效范围">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'all'}
                style={segBtn(mode === 'all')}
                disabled={busyAny}
                onClick={() => { void submit({ mode: 'all' }, 'mode') }}
              >
                全局
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'selected'}
                style={segBtn(mode === 'selected')}
                disabled={busyAny}
                onClick={() => { void submit({ mode: 'selected' }, 'mode') }}
              >
                仅选中
              </button>
            </div>
            <span style={segHintStyle}>
              {mode === 'all'
                ? '所有请求都走代理'
                : '只有供应商卡片上开了「走代理」的那几家走，其余直连'}
            </span>
          </div>
        </div>

        <div style={fieldStyle}>
          <span style={fieldLabel}>代理地址</span>
          <div style={fieldRow}>
            <input
              type="text"
              style={inputStyle}
              placeholder="http://127.0.0.1:10808"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value) }}
            />
            <button
              type="button"
              style={busyAny || !dirty ? { ...smallBtnPrimary, ...btnDisabled } : smallBtnPrimary}
              disabled={busyAny || !dirty}
              onClick={() => { void submit({ url: urlInput.trim() }, 'save') }}
            >
              {busy === 'save' ? '应用中…' : '应用'}
            </button>
            <button
              type="button"
              style={busyAny ? { ...smallBtn, ...btnDisabled } : smallBtn}
              disabled={busyAny}
              onClick={() => { void probe() }}
            >
              {busy === 'test' ? '测试中…' : '连通性测试'}
            </button>
          </div>
        </div>

        {stale.length > 0
          ? (
              <p style={warnNoteStyle} role="status">
                名单里有 {stale.length} 个已失效的条目（{stale.join('、')}）——对应的供应商已被删除或改名，
                解析不出域名、不会走代理，也不计入「N 家走代理」。
                <button type="button" style={cleanBtnStyle} disabled={busyAny} onClick={() => { void cleanStale() }}>
                  {busy === 'clean' ? '清理中…' : '清理失效条目'}
                </button>
              </p>
            )
          : null}

        {note !== null
          ? <p style={noteStyleOf(note.kind)} role="status">{note.text}</p>
          : enabled && snapshot?.active === true
            ? (
                <p style={noteStyle}>
                  {mode === 'all'
                    ? '全部请求走 ' + (snapshot?.url ?? '')
                    : liveCount + ' 家供应商走代理（' + (snapshot?.hosts ?? []).join('、') + '），其余直连'}
                  ；「已挂载」不等于「代理可用」，可点连通性测试确认
                </p>
              )
            : null}
      </section>
    </div>
  )
}
