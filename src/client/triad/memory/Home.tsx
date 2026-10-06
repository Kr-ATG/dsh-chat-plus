/**
 * dsh-memory 首页仪表盘（复刻 Memory Manager 首页布局，浅色系）：
 * 顶栏搜索 / 问候 hero / 四快捷入口 / 记忆分类+类型分布+最近浏览 /
 * 右列记忆趋势+最近更新 / 底部最近记忆。
 * 数据全部来自既有 host 接口（list/tags/summary/changes），无伪造指标；
 * 新增/文件走 Panel 新增表单预填，链接/AI 直调 remember / consolidate。
 */
import { useMemo, useRef, useState } from 'react';
import type { ChangeView, MemoryApi, MemoryEntryView, MemoryKind, MemorySummaryResponse, ProjectView } from './api.js';
import { ensureHomeStyles, hm } from './home-styles.js';

export interface HomeNav {
  goAll: (opts?: { tag?: string; scope?: string; q?: string }) => void;
  goChanges: () => void;
  goSettings: () => void;
  goAdd: (prefill?: { content?: string; tags?: string }) => void;
  pickEntry: (id: string) => void;
}

export interface MemoryHomeProps {
  api: MemoryApi;
  entries: MemoryEntryView[];
  projects: ProjectView[];
  tags: Array<{ tag: string; count: number }>;
  summary: MemorySummaryResponse | null;
  changes: ChangeView[];
  nav: HomeNav;
  refresh: () => void;
}

type SortKey = 'updated' | 'created' | 'important';

/**
 * 种类 / 分类配色（2026-10 色彩收敛）：一律主文字色的不同透明度分层，
 * 不再一个种类一个色相——种类由文字标签与图形承担，颜色只负责层次。
 * ink(p) = 主文字色 p% 混透明，明暗主题自动跟随。
 */
const ink = (p: number): string => `color-mix(in srgb,var(--dsw-alias-label-primary) ${p}%,transparent)`;

const KIND_META: Record<MemoryKind, { label: string; color: string; soft: string }> = {
  identity: { label: '身份', color: ink(88), soft: ink(14) },
  preference: { label: '偏好', color: ink(72), soft: ink(12) },
  fact: { label: '事实', color: ink(56), soft: ink(10) },
  decision: { label: '决策', color: ink(80), soft: ink(13) },
  gotcha: { label: '踩坑', color: ink(64), soft: ink(11) },
  'session-summary': { label: '会话', color: ink(46), soft: ink(9) },
};

const CAT_COLORS = [ink(85), ink(70), ink(58), ink(46), ink(36), ink(28)] as const;
const CAT_SOFT = [ink(14), ink(12), ink(10), ink(9), ink(8), ink(7)] as const;

function entryTitle(content: string): string {
  const t = content.trim();
  const first = (t.split('\n', 1)[0] ?? '').replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s*/, '').trim();
  if (first !== '' && first.length <= 60) return first;
  return t.slice(0, 40);
}

function entrySnippet(content: string): string {
  const t = content.trim();
  const nl = t.indexOf('\n');
  const f = (t.split('\n', 1)[0] ?? '').trim();
  let rest = t;
  if (nl !== -1 && f.length <= 60) rest = t.slice(nl + 1).trim();
  const flat = rest.replace(/\s+/g, ' ').trim();
  return flat === '' ? t.replace(/\s+/g, ' ').slice(0, 64) : flat.slice(0, 64);
}

function relativeTime(iso: string, now: Date): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const diff = now.getTime() - time;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天';
  if (d < 30) return d + ' 天前';
  return new Date(time).toLocaleDateString();
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function dayKey(d: Date): string { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function dayLabel(d: Date): string { return (d.getMonth() + 1) + '-' + d.getDate(); }

function bucketTrend(changes: ChangeView[], days: number): { labels: string[]; values: number[] } {
  const labels: string[] = []; const values: number[] = [];
  const map = new Map<string, number>();
  for (const c of changes) { const t = Date.parse(c.at); if (Number.isNaN(t)) continue; const k = dayKey(new Date(t)); map.set(k, (map.get(k) ?? 0) + 1); }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) { const d = new Date(today.getTime() - i * 86400000); labels.push(dayLabel(d)); values.push(map.get(dayKey(d)) ?? 0); }
  return { labels, values };
}

function trendPath(values: number[], w: number, h: number, pad: number): { line: string; area: string } {
  const n = values.length; if (n === 0) return { line: '', area: '' };
  const max = Math.max(4, ...values);
  const xs = values.map((_, i) => pad + (n === 1 ? w / 2 : (i * (w - pad * 2)) / (n - 1)));
  const ys = values.map(v => pad + (h - pad * 2) * (1 - v / max));
  let line = 'M ' + xs[0].toFixed(1) + ' ' + ys[0].toFixed(1);
  for (let i = 1; i < n; i++) { const mx = ((xs[i - 1] + xs[i]) / 2).toFixed(1); line += ' C ' + mx + ' ' + ys[i-1].toFixed(1) + ', ' + mx + ' ' + ys[i].toFixed(1) + ', ' + xs[i].toFixed(1) + ' ' + ys[i].toFixed(1); }
  const area = line + ' L ' + xs[n-1].toFixed(1) + ' ' + (h - 2).toFixed(1) + ' L ' + xs[0].toFixed(1) + ' ' + (h - 2).toFixed(1) + ' Z';
  return { line, area };
}

function KindGlyph({ kind, size = 15 }: { kind: MemoryKind; size?: number }): JSX.Element {
  const meta = KIND_META[kind] ?? KIND_META.fact;
  return (<svg width={size} height={size} viewBox='0 0 16 16' fill='none' stroke={meta.color} strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M3.5 2.5h6l3 3v8h-9z' /><path d='M9.5 2.5v3h3' /><path d='M6 8.5h4M6 11h4' /></svg>);
}

function SearchGlyph(): JSX.Element {
  return (<svg width='15' height='15' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' aria-hidden='true'><circle cx='7' cy='7' r='4.5' /><path d='M10.5 10.5 14 14' /></svg>);
}

function PlusGlyph(): JSX.Element {
  return (<svg width='17' height='17' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' aria-hidden='true'><path d='M8 3v10M3 8h10' /></svg>);
}

function FileGlyph(): JSX.Element {
  return (<svg width='17' height='17' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M3.5 2.5h6l3 3v8h-9z' /><path d='M9.5 2.5v3h3' /></svg>);
}

function LinkGlyph(): JSX.Element {
  return (<svg width='17' height='17' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1' /><path d='M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1' /></svg>);
}

function SparkGlyph(): JSX.Element {
  return (<svg width='17' height='17' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M8 1.8 9.6 6l4.2 2-4.2 2L8 14.2 6.4 10 2.2 8l4.2-2z' /></svg>);
}

export function MemoryHome(props: MemoryHomeProps): JSX.Element {
  ensureHomeStyles();
  const { api, entries, projects, tags, summary, changes, nav, refresh } = props;
  const [q, setQ] = useState('');
  const [range, setRange] = useState<7 | 30>(7);
  const [activeTab, setActiveTab] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [busyAI, setBusyAI] = useState(false);
  const [notice, setNotice] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkNote, setLinkNote] = useState('');
  const [clearArmed, setClearArmed] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const now = useMemo(() => new Date(), []);
  const total = summary?.entryCount ?? entries.length;
  const todayCount = summary?.todayChanges ?? 0;
  const projectCount = summary?.projectCount ?? projects.length;
  const topTags = useMemo(() => tags.slice(0, 5), [tags]);
  const catTiles = useMemo(() => [{ tag: '', name: '全部', count: total }].concat(topTags.map(t => ({ tag: t.tag, name: t.tag, count: t.count }))), [topTags, total]);
  const kindDist = useMemo(() => {
    const keys: MemoryKind[] = ['identity', 'preference', 'fact', 'decision', 'gotcha', 'session-summary'];
    const counts = new Map<MemoryKind, number>();
    for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    return keys.map(k => ({ kind: k, count: counts.get(k) ?? 0 })).filter(r => r.count > 0);
  }, [entries]);
  const kindTotal = kindDist.reduce((a, b) => a + b.count, 0);
  const recent = useMemo(() => [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5), [entries]);
  const recentChanges = useMemo(() => [...changes].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5), [changes]);
  const trend = useMemo(() => bucketTrend(changes, range), [changes, range]);
  const tp = useMemo(() => trendPath(trend.values, 268, 118, 10), [trend]);
  const trendMax = Math.max(4, ...trend.values);
  const lastVal = trend.values.length > 0 ? trend.values[trend.values.length - 1] : 0;
  const lastX = 268 - 10;
  const lastY = 10 + (118 - 20) * (1 - lastVal / trendMax);
  const tabEntries = useMemo(() => {
    const list = activeTab === '' ? entries : entries.filter(e => e.tags.includes(activeTab));
    const sorted = [...list];
    if (sort === 'created') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === 'important') sorted.sort((a, b) => b.importance - a.importance);
    else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sorted.slice(0, 8);
  }, [entries, activeTab, sort]);
  const submitSearch = (): void => { nav.goAll({ q: q.trim() === '' ? undefined : q.trim() }); };
  const onPickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try { const text = (await file.text()).slice(0, 20000); nav.goAdd({ content: text, tags: file.name }); }
    catch { setNotice('文件读取失败'); window.setTimeout(() => { setNotice(''); }, 2400); }
  };
  const submitLink = async (): Promise<void> => {
    const url = linkUrl.trim(); if (url === '') return;
    try {
      await api.remember({ content: linkNote.trim() === '' ? url : linkNote.trim() + '\n' + url, tags: ['链接'], scope: 'global' });
      setLinkOpen(false); setLinkUrl(''); setLinkNote(''); refresh();
      setNotice('链接已导入'); window.setTimeout(() => { setNotice(''); }, 2400);
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); window.setTimeout(() => { setNotice(''); }, 2400); }
  };
  const todayIds = useMemo(() => {
    const k = dayKey(new Date());
    return entries.filter(e => { const t = Date.parse(e.createdAt); return !Number.isNaN(t) && dayKey(new Date(t)) === k; }).map(e => e.id);
  }, [entries]);
  const runClearToday = async (): Promise<void> => {
    if (!clearArmed) { setClearArmed(true); window.setTimeout(() => { setClearArmed(false); }, 5000); return; }
    setClearArmed(false);
    if (todayIds.length === 0) return;
    try {
      const r = await api.deleteBatch(todayIds);
      refresh();
      setNotice('已删除今日记忆' + (r.deleted ?? todayIds.length) + '条');
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
    window.setTimeout(() => { setNotice(''); }, 2400);
  };
  const runAI = async (): Promise<void> => {
    if (busyAI) return; setBusyAI(true);
    try { const r = await api.consolidate('all'); refresh(); const rows = r.results ?? []; const s = rows.reduce((a, x) => ({ m: a.m + (x.merged ?? 0), w: a.w + (x.rewritten ?? 0), d: a.d + (x.dropped ?? 0) }), { m: 0, w: 0, d: 0 }); const fail = rows.map(x => x.failed).find(f => f !== undefined && f !== ''); setNotice(fail !== undefined ? 'AI 整理未完成：' + fail : 'AI 整理完成：合并' + s.m + ' · 改写' + s.w + ' · 清理' + s.d); }
    catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
    finally { setBusyAI(false); window.setTimeout(() => { setNotice(''); }, 2400); }
  };
  const R = 46; const C = 2 * Math.PI * R;
  let acc = 0;
  const segs = kindDist.map(row => { const frac = kindTotal === 0 ? 0 : row.count / kindTotal; const s = { kind: row.kind, count: row.count, dash: (frac * C).toFixed(1), off: (-acc * C).toFixed(1) }; acc += frac; return s; });
  return (
    <div className="dsh-memory-home">
      <div className={hm.top}>
        <label className={hm.search}>
          <span className={hm.searchIcon}><SearchGlyph /></span>
          <input className={hm.searchInput} value={q} placeholder='搜索记忆内容、项目、标签...' aria-label='搜索记忆' onChange={e => { setQ(e.currentTarget.value); }} onKeyDown={e => { if (e.key === 'Enter') submitSearch(); if (e.key === 'Escape' && q !== '') setQ(''); }} />
          <span className={hm.searchKbd}>Ctrl + K</span>
        </label>
        <div className={hm.topIcons}>
          <button type='button' className={hm.topIconBtn} title='刷新' onClick={() => { refresh(); }}><svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' aria-hidden='true'><path d='M13.5 8a5.5 5.5 0 1 1-1.6-3.9' /><path d='M13.5 1.8v2.6h-2.6' /></svg></button>
          <button type='button' className={hm.topIconBtn} title='设置' onClick={() => { nav.goSettings(); }}><svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' aria-hidden='true'><circle cx='8' cy='8' r='2.2' /><path d='M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2 3.6 12.4' /></svg></button>
        </div>
      </div>
      <div className={hm.grid}>
        <div className={hm.main}>
          <section className={hm.hero}>
            <h2 className={hm.heroTitle}>{greeting()}</h2>
            <p className={hm.heroSub}>让每一份重要的信息，都成为你记忆的一部分。</p>
            <div className={hm.heroStats}>
              <span className={hm.heroStat}><span className={hm.heroStatIcon} style={{ color: 'var(--dsw-alias-label-primary)' }}><FileGlyph /></span><span><span className={hm.heroStatNum}>{total}</span><br /><span className={hm.heroStatLabel}>总记忆数</span></span></span>
              <span className={hm.heroStat}><span className={hm.heroStatIcon} style={{ color: 'var(--dsw-alias-label-secondary)' }}><LinkGlyph /></span><span><span className={hm.heroStatNum}>{todayCount}</span><br /><span className={hm.heroStatLabel}>今日更新</span></span></span>
              <span className={hm.heroStat}><span className={hm.heroStatIcon} style={{ color: 'var(--dsw-alias-label-secondary)' }}><PlusGlyph /></span><span><span className={hm.heroStatNum}>{projectCount}</span><br /><span className={hm.heroStatLabel}>覆盖项目</span></span></span>
              <span className={hm.heroOk}><span className={hm.heroOkDot} />运行正常</span>
            </div>
          </section>
          <section className={hm.quicks}>
            <button type='button' className={hm.quick} onClick={() => { nav.goAdd(); }}><span className={hm.quickIcon} style={{ background: ink(12), color: ink(82) }}><FileGlyph /></span><span className={hm.quickTitle}>新增记忆</span><span className={hm.quickDesc}>记录重要信息，永久保存</span><span className={hm.quickArrow}>→</span></button>
            <button type='button' className={hm.quick} onClick={() => { fileRef.current?.click(); }}><span className={hm.quickIcon} style={{ background: ink(10), color: ink(68) }}><LinkGlyph /></span><span className={hm.quickTitle}>添加文件</span><span className={hm.quickDesc}>上传文档/图片，快速解析</span><span className={hm.quickArrow}>→</span></button>
            <button type='button' className={hm.quick} onClick={() => { setLinkOpen(v => !v); }}><span className={hm.quickIcon} style={{ background: ink(9), color: ink(56) }}><LinkGlyph /></span><span className={hm.quickTitle}>导入链接</span><span className={hm.quickDesc}>从 URL 获取内容</span><span className={hm.quickArrow}>→</span></button>
            <button type='button' className={hm.quick} disabled={busyAI} onClick={() => { void runAI(); }}><span className={hm.quickIcon} style={{ background: ink(8), color: ink(46) }}><SparkGlyph /></span><span className={hm.quickTitle}>{busyAI ? '整理中...' : 'AI 生成'}</span><span className={hm.quickDesc}>AI 整理去重，合并相似记忆</span><span className={hm.quickArrow}>→</span></button>
          </section>
          <input ref={fileRef} type='file' style={{ display: 'none' }} onChange={e => { void onPickFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
          {linkOpen && (
            <section className={hm.card}>
              <div className={hm.cardHead}><span className={hm.cardTitle}>导入链接</span><button type='button' className={hm.cardLink} onClick={() => { setLinkOpen(false); }}>收起</button></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input className={hm.searchInput} style={{ border: '1px solid var(--hm-border)', borderRadius: 8, padding: '8px 10px' }} value={linkUrl} placeholder='粘贴 URL（https://...）' onChange={e => { setLinkUrl(e.currentTarget.value); }} />
                <input className={hm.searchInput} style={{ border: '1px solid var(--hm-border)', borderRadius: 8, padding: '8px 10px' }} value={linkNote} placeholder='备注（可选）' onChange={e => { setLinkNote(e.currentTarget.value); }} onKeyDown={e => { if (e.key === 'Enter') void submitLink(); }} />
                <div><button type='button' className={hm.tab + ' ' + hm.tabActive} onClick={() => { void submitLink(); }}>导入</button></div>
              </div>
            </section>
          )}
          {notice !== '' && (<section className={hm.card}><span style={{ fontSize: 12 }}>{notice}</span></section>)}
          <div className={hm.split3}>
            <section className={hm.card}>
              <div className={hm.cardHead}><span className={hm.cardTitle}>记忆分类</span><button type='button' className={hm.cardLink} onClick={() => { nav.goSettings(); }}>管理分类</button></div>
              <div className={hm.catGrid}>
                {catTiles.slice(0, 6).map((c, i) => (
                  <button key={c.tag === '' ? '__all' : c.tag} type='button' className={hm.catTile} onClick={() => { nav.goAll(c.tag === '' ? {} : { tag: c.tag }); }}>
                    <span className={hm.catIcon} style={{ background: CAT_SOFT[i % CAT_SOFT.length], color: CAT_COLORS[i % CAT_COLORS.length] }}><FileGlyph /></span>
                    <span className={hm.catName}>{c.name}</span>
                    <span className={hm.catCount}>{c.count}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className={hm.card}>
              <div className={hm.cardHead}><span className={hm.cardTitle}>记忆类型分布</span></div>
              {kindTotal === 0 ? (<div className={hm.empty}>暂无记忆</div>) : (
              <div className={hm.donutWrap}>
                <svg className={hm.donutSvg} width='112' height='112' viewBox='0 0 112 112'>
                  <circle className='hm-track' cx='56' cy='56' r={R} fill='none' stroke='var(--dsw-alias-bg-module-platform,#EEF1F7)' strokeWidth='13' />
                  {segs.map(s => (<circle key={s.kind} className='hm-seg' cx='56' cy='56' r={R} fill='none' stroke={(KIND_META[s.kind] ?? KIND_META.fact).color} strokeWidth='13' strokeLinecap='butt' strokeDasharray={s.dash + ' ' + (C - Number(s.dash)).toFixed(1)} strokeDashoffset={s.off} transform='rotate(-90 56 56)' />))}
                  <text x='56' y='54' textAnchor='middle' className={hm.donutNum}>{kindTotal}</text>
                  <text x='56' y='70' textAnchor='middle' className={hm.donutLabel}>总记忆数</text>
                </svg>
                <div className={hm.legend}>
                  {segs.map(s => (<div key={s.kind} className={hm.legendRow}><span className={hm.legendDot} style={{ background: (KIND_META[s.kind] ?? KIND_META.fact).color }} /><span className={hm.legendName}>{(KIND_META[s.kind] ?? KIND_META.fact).label}</span><span className={hm.legendCount}>{s.count}</span><span className={hm.legendPct}>{kindTotal === 0 ? '0%' : Math.round((s.count / kindTotal) * 1000) / 10 + '%'}</span></div>))}
                </div>
              </div>)}
            </section>
            <section className={hm.card}>
              <div className={hm.cardHead}><span className={hm.cardTitle}>最近浏览</span><button type='button' className={hm.cardLink} onClick={() => { nav.goAll({}); }}>查看更多 ›</button></div>
              <div className={hm.rows}>
                {recent.length === 0 ? (<div className={hm.empty}>暂无记忆</div>) : recent.map(e => { const meta = KIND_META[e.kind] ?? KIND_META.fact; return (
                  <button key={e.id} type='button' className={hm.rowItem} onClick={() => { nav.pickEntry(e.id); }}>
                    <span className={hm.rowIcon} style={{ background: meta.soft, color: meta.color }}><KindGlyph kind={e.kind} /></span>
                    <span className={hm.rowBody}><span className={hm.rowTitle}>{entryTitle(e.content)}</span></span>
                    <span className={hm.rowTime}>{relativeTime(e.updatedAt, now)}</span>
                  </button>); })}
              </div>
            </section>
          </div>
          <section className={hm.bottom + ' ' + hm.card}>
            <div className={hm.cardHead}><span className={hm.cardTitle}>最近记忆</span>
              <span><select className={hm.sortSel} value={sort} aria-label='排序' onChange={e => { setSort(e.currentTarget.value as SortKey); }}><option value='updated'>按更新时间</option><option value='created'>按创建时间</option><option value='important'>按重要度</option></select></span>
            </div>
            <div className={hm.tabs}>
              <button type='button' className={activeTab === '' ? hm.tab + ' ' + hm.tabActive : hm.tab} onClick={() => { setActiveTab(''); }}>全部（{total}）</button>
              {topTags.map(t => (<button key={t.tag} type='button' className={activeTab === t.tag ? hm.tab + ' ' + hm.tabActive : hm.tab} onClick={() => { setActiveTab(cur => (cur === t.tag ? '' : t.tag)); }}>{t.tag}（{t.count}）</button>))}
            </div>
            {tabEntries.length === 0 ? (<div className={hm.empty}>该分类暂无记忆</div>) : (
            <div className={hm.memGrid}>
              {tabEntries.map((e, i) => { const meta2 = KIND_META[e.kind] ?? KIND_META.fact; return (
                <button key={e.id} type='button' className={hm.memCard} style={{ animationDelay: (i * 0.05).toFixed(2) + 's' }} onClick={() => { nav.pickEntry(e.id); }}>
                  <span className={hm.memHead}><span className={hm.memIcon} style={{ background: meta2.soft, color: meta2.color }}><KindGlyph kind={e.kind} size={14} /></span><span className={hm.memTitle}>{entryTitle(e.content)}</span><span className={hm.memDots}>···</span></span>
                  <span className={hm.memDesc}>{entrySnippet(e.content)}</span>
                  <span className={hm.memTags}>{e.tags.slice(0, 2).map(t => (<span key={t} className={hm.memTag}>{t}</span>))}</span>
                  <span className={hm.memFoot}><span className={hm.memTime}>{relativeTime(e.updatedAt, now)}</span></span>
                </button>); })}
            </div>)}
          </section>
        </div>
        <div className={hm.side}>
          <section className={hm.card}>
            <div className={hm.trendHead}><span className={hm.cardTitle}>记忆趋势</span>
              <select className={hm.trendRange} value={String(range)} aria-label='趋势范围' onChange={e => { setRange(Number(e.currentTarget.value) === 30 ? 30 : 7); }}><option value='7'>近7天</option><option value='30'>近30天</option></select>
            </div>
            <svg className={hm.trendSvg} viewBox='0 0 268 118' role='img' aria-label='记忆趋势图'>
              <defs><linearGradient id='hm-area-grad' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stopColor='var(--dsw-alias-state-business-primary)' stopOpacity='0.28' /><stop offset='1' stopColor='var(--dsw-alias-state-business-primary)' stopOpacity='0.03' /></linearGradient></defs>
              {[0.25, 0.5, 0.75].map(f => (<line key={f} className='hm-grid-line' x1='6' x2='262' y1={10 + (118 - 20) * f} y2={10 + (118 - 20) * f} />))}
              {tp.area !== '' && (<path className='hm-area' d={tp.area} />)}
              {tp.line !== '' && (<path className='hm-line' d={tp.line} />)}
              <circle className='hm-dot' cx={lastX} cy={lastY} r='4' />
            </svg>
            <div className={hm.trendAxis}>{(range === 7 ? trend.labels : trend.labels.filter((_, i) => i % 5 === 0 || i === trend.labels.length - 1)).map(l => (<span key={l}>{l}</span>))}</div>
          </section>
          <section className={hm.card}>
            <div className={hm.cardHead}><span className={hm.cardTitle}>最近更新</span><span>{todayIds.length > 0 && (<button type='button' className={hm.cardLink} style={clearArmed ? { color: 'var(--dsw-alias-state-error-primary)', fontWeight: 700 } : undefined} title='删除今天创建的全部记忆' onClick={() => { void runClearToday(); }}>{clearArmed ? '确认删除' + todayIds.length + '条？' : '清空今日'}</button>)}<button type='button' className={hm.cardLink} onClick={() => { nav.goChanges(); }}>查看更多 ›</button></span></div>
            <div className={hm.rows}>
              {recentChanges.length === 0 && recent.length === 0 ? (<div className={hm.empty}>暂无更新</div>) : null}
              {(recentChanges.length > 0 ? recentChanges : recent.map(e => ({ id: e.id, summary: entryTitle(e.content), at: e.updatedAt, entryId: e.id } as unknown as ChangeView))).slice(0, 5).map(c => {
                const target = entries.find(e => e.id === (c as ChangeView).entryId);
                const kind: MemoryKind = target?.kind ?? 'fact'; const meta3 = KIND_META[kind] ?? KIND_META.fact;
                return (
                <button key={c.id} type='button' className={hm.rowItem} onClick={() => { if ((c as ChangeView).entryId) nav.pickEntry((c as ChangeView).entryId); else nav.goChanges(); }}>
                  <span className={hm.rowIcon} style={{ background: meta3.soft, color: meta3.color }}><KindGlyph kind={kind} /></span>
                  <span className={hm.rowBody}><span className={hm.rowTitle}>{target ? entryTitle(target.content) : c.summary}</span><span className={hm.rowDesc}>{target ? entrySnippet(target.content) : ''}</span></span>
                  <span className={hm.rowTime}>{relativeTime(c.at, now)}</span>
                </button>); })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default MemoryHome;

