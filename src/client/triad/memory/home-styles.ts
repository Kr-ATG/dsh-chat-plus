/**
 * dsh-memory 首页仪表盘样式（参考 Memory Manager 首页布局复刻，浅色系）：
 * 顶栏搜索 / 问候 hero / 四快捷入口 / 分类+类型 donut+最近浏览 /
 * 右列趋势+最近更新 / 底部最近记忆卡片。
 * 类名前缀 hm-（本文件作用域 .dsh-memory-home），运行时注入 <style>。
 * 动效：入场 stagger 上浮、卡片 hover 上浮、快捷箭头滑动、图表描线、donut 展开；
 * prefers-reduced-motion 下只保留透明度变化。
 */

export const hm = {
  top: 'hm-top',
  search: 'hm-search',
  searchIcon: 'hm-search-icon',
  searchInput: 'hm-search-input',
  searchKbd: 'hm-search-kbd',
  topIcons: 'hm-top-icons',
  topIconBtn: 'hm-top-icon-btn',
  grid: 'hm-grid',
  main: 'hm-main',
  side: 'hm-side',
  hero: 'hm-hero',
  heroTitle: 'hm-hero-title',
  heroSub: 'hm-hero-sub',
  heroStats: 'hm-hero-stats',
  heroStat: 'hm-hero-stat',
  heroStatIcon: 'hm-hero-stat-icon',
  heroStatNum: 'hm-hero-stat-num',
  heroStatLabel: 'hm-hero-stat-label',
  heroOk: 'hm-hero-ok',
  heroOkDot: 'hm-hero-ok-dot',
  quicks: 'hm-quicks',
  quick: 'hm-quick',
  quickIcon: 'hm-quick-icon',
  quickTitle: 'hm-quick-title',
  quickDesc: 'hm-quick-desc',
  quickArrow: 'hm-quick-arrow',
  card: 'hm-card',
  cardHead: 'hm-card-head',
  cardTitle: 'hm-card-title',
  cardLink: 'hm-card-link',
  catGrid: 'hm-cat-grid',
  catTile: 'hm-cat-tile',
  catIcon: 'hm-cat-icon',
  catName: 'hm-cat-name',
  catCount: 'hm-cat-count',
  split3: 'hm-split3',
  donutWrap: 'hm-donut-wrap',
  donutSvg: 'hm-donut-svg',
  donutCenter: 'hm-donut-center',
  donutNum: 'hm-donut-num',
  donutLabel: 'hm-donut-label',
  legend: 'hm-legend',
  legendRow: 'hm-legend-row',
  legendDot: 'hm-legend-dot',
  legendName: 'hm-legend-name',
  legendCount: 'hm-legend-count',
  legendPct: 'hm-legend-pct',
  rows: 'hm-rows',
  rowItem: 'hm-row-item',
  rowIcon: 'hm-row-icon',
  rowBody: 'hm-row-body',
  rowTitle: 'hm-row-title',
  rowDesc: 'hm-row-desc',
  rowTime: 'hm-row-time',
  trendHead: 'hm-trend-head',
  trendRange: 'hm-trend-range',
  trendSvg: 'hm-trend-svg',
  trendAxis: 'hm-trend-axis',
  bottom: 'hm-bottom',
  tabs: 'hm-tabs',
  tab: 'hm-tab',
  tabActive: 'hm-tab-active',
  sortSel: 'hm-sort-sel',
  memGrid: 'hm-mem-grid',
  memCard: 'hm-mem-card',
  memHead: 'hm-mem-head',
  memIcon: 'hm-mem-icon',
  memTitle: 'hm-mem-title',
  memDots: 'hm-mem-dots',
  memDesc: 'hm-mem-desc',
  memTags: 'hm-mem-tags',
  memTag: 'hm-mem-tag',
  memFoot: 'hm-mem-foot',
  memTime: 'hm-mem-time',
  empty: 'hm-empty',
} as const;

const STYLE_ID = 'dsh-memory-home-styles';

const SHEET = `
.dsh-memory-home{
  /* 表面与文字全部继承官方主题 token（亮/暗两套由官方 body[data-ds-dark-theme]
     提供），不再自建 light-dark 色板——否则本页在暗色下与官方皮肤脱节。 */
  --hm-bg:var(--dsw-alias-bg-base); --hm-card:var(--dsw-alias-bg-layer-1); --hm-border:var(--dsw-alias-border-l1); --hm-ink:var(--dsw-alias-label-primary);
  --hm-sub:var(--dsw-alias-label-secondary); --hm-faint:var(--dsw-alias-label-tertiary); --hm-blue:var(--dsw-alias-state-business-primary);
  --hm-green:var(--dsw-alias-state-success-primary);
  /* hero 装饰渐变的第二色。官方 alias 层没有紫色 token（state-* 只有
     business/success/warn/error/idle），所以这里保留一个显式的装饰色常量：
     它属于插画层、不属于主题色板，故意不随主题变——但命名上与本页的
     --hm-* 主题变量区分开，避免被当成"又一个该跟随主题的色"。 */
  --hm-deco-violet:#7C5CFC;
  position:relative; display:flex; flex-direction:column; gap:14px;
  min-height:100%; background:var(--hm-bg); border-radius:0 12px 12px 0;
  padding:18px 20px 96px; box-sizing:border-box; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain;
  color:var(--hm-ink); font-size:13px; line-height:1.5;
}
/* 顶栏 */
.hm-top{ display:flex; align-items:center; gap:10px; animation:hm-rise .45s cubic-bezier(.22,.8,.32,1) both; }
.hm-search{
  flex:1 1 auto; display:flex; align-items:center; gap:8px; height:38px; padding:0 12px;
  background:var(--hm-card); border:1px solid var(--hm-border); border-radius:19px;
  box-shadow:var(--dsw-shadow-lv1,0 1px 2px rgba(27,36,54,.05)); transition:border-color .18s ease, box-shadow .18s ease;
}
.hm-search:focus-within{ border-color:var(--hm-blue); box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent); }
.hm-search-icon{ display:inline-flex; color:var(--hm-faint); }
.hm-search-input{ flex:1 1 auto; min-width:0; border:0; outline:0; background:transparent; font-size:13px; color:var(--hm-ink); }
.hm-search-input::placeholder{ color:var(--hm-faint); }
.hm-search-kbd{
  flex:none; font-size:11px; color:var(--hm-faint); background:color-mix(in srgb,var(--hm-ink) 7%,transparent); border:1px solid var(--hm-border);
  border-radius:6px; padding:2px 7px; white-space:nowrap;
}
.hm-top-icons{ display:flex; align-items:center; gap:4px; }
.hm-top-icon-btn{
  display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px;
  border:0; border-radius:50%; background:transparent; color:var(--hm-sub); cursor:pointer;
  transition:background .16s ease, color .16s ease, transform .16s ease;
}
.hm-top-icon-btn:hover{ background:color-mix(in srgb,var(--hm-ink) 8%,transparent); color:var(--hm-ink); transform:translateY(-1px); }
/* 主网格：左主列 + 右 300 列 */
.hm-grid{ display:grid; grid-template-columns:minmax(0,1fr) 302px; gap:14px; align-items:start; }
.hm-main{ display:flex; flex-direction:column; gap:14px; min-width:0; }
.hm-side{ display:flex; flex-direction:column; gap:14px; min-width:0; }
/* Hero */
.hm-hero{
  position:relative; overflow:hidden; border-radius:16px; padding:22px 24px 18px;
  background:linear-gradient(115deg,color-mix(in srgb,var(--hm-blue) 13%,transparent) 0%,color-mix(in srgb,var(--hm-deco-violet) 12%,transparent) 100%);
  border:1px solid var(--hm-border);
  animation:hm-rise .5s cubic-bezier(.22,.8,.32,1) both; animation-delay:.04s;
}
.hm-hero::before,.hm-hero::after{ content:""; position:absolute; border-radius:50%; filter:blur(2px); pointer-events:none; }
.hm-hero::before{
  right:-70px; top:-110px; width:340px; height:340px;
  background:radial-gradient(closest-side,color-mix(in srgb,var(--hm-deco-violet) 34%,transparent),transparent 70%);
  animation:hm-drift 9s ease-in-out infinite alternate;
}
.hm-hero::after{
  right:120px; top:-60px; width:260px; height:260px;
  background:radial-gradient(closest-side,color-mix(in srgb,var(--dsw-alias-state-business-primary) 26%,transparent),color-mix(in srgb,var(--dsw-alias-state-business-primary) 0%,transparent) 70%);
  animation:hm-drift 11s ease-in-out infinite alternate-reverse;
}
.hm-hero-title{ position:relative; z-index:1; margin:0 0 4px; font-size:21px; font-weight:700; letter-spacing:.2px; }
.hm-hero-sub{ position:relative; z-index:1; margin:0 0 14px; font-size:12.5px; color:var(--hm-sub); }
.hm-hero-stats{ position:relative; z-index:1; display:flex; align-items:center; gap:26px; flex-wrap:wrap; }
.hm-hero-stat{ display:flex; align-items:center; gap:9px; }
.hm-hero-stat-icon{
  display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px;
  border-radius:9px; background:color-mix(in srgb,var(--hm-card) 72%,transparent); border:1px solid var(--hm-border);
  box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);
}
.hm-hero-stat-num{ font-size:17px; font-weight:750; line-height:1.1; }
.hm-hero-stat-label{ font-size:11.5px; color:var(--hm-sub); }
.hm-hero-ok{
  display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--hm-sub);
  background:color-mix(in srgb,var(--hm-card) 68%,transparent); border:1px solid var(--hm-border); border-radius:999px; padding:5px 12px;
}
.hm-hero-ok-dot{ width:7px; height:7px; border-radius:50%; background:var(--hm-green); box-shadow:0 0 0 3px color-mix(in srgb,var(--hm-green) 18%,transparent); animation:hm-pulse 2.2s ease-in-out infinite; }
/* 快捷入口 */
.hm-quicks{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.hm-quick{
  position:relative; text-align:left; cursor:pointer; border-radius:14px; padding:14px 14px 12px;
  background:var(--hm-card); border:1px solid var(--hm-border);
  box-shadow:var(--dsw-shadow-lv1,0 1px 2px rgba(27,36,54,.05));
  transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease;
  animation:hm-rise .5s cubic-bezier(.22,.8,.32,1) both;
}
.hm-quick:nth-child(1){ animation-delay:.08s; } .hm-quick:nth-child(2){ animation-delay:.12s; }
.hm-quick:nth-child(3){ animation-delay:.16s; } .hm-quick:nth-child(4){ animation-delay:.2s; }
.hm-quick:hover{ transform:translateY(-3px); box-shadow:0 10px 22px -10px color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent); border-color:color-mix(in srgb,var(--hm-blue) 45%,transparent); }
.hm-quick:active{ transform:translateY(-1px) scale(.99); }
.hm-quick-icon{ display:flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:10px; margin-bottom:10px; }
.hm-quick-title{ display:block; font-size:13.5px; font-weight:700; margin-bottom:2px; }
.hm-quick-desc{ display:block; font-size:11.5px; color:var(--hm-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hm-quick-arrow{ position:absolute; right:12px; bottom:10px; color:var(--dsw-alias-label-caption); transition:transform .18s ease, color .18s ease; }
.hm-quick:hover .hm-quick-arrow{ transform:translateX(4px); color:var(--hm-blue); }
/* 通用卡片 */
.hm-card{
  min-width:0;
  background:var(--hm-card); border:1px solid var(--hm-border); border-radius:14px; padding:14px 16px;
  box-shadow:var(--dsw-shadow-lv1,0 1px 2px rgba(27,36,54,.04));
  animation:hm-rise .5s cubic-bezier(.22,.8,.32,1) both; animation-delay:.14s;
}
.hm-card-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; }
.hm-card-title{ font-size:14px; font-weight:700; }
.hm-card-link{
  border:0; background:none; padding:2px 4px; font-size:11.5px; color:var(--hm-faint); cursor:pointer;
  transition:color .15s ease;
}
.hm-card-link:hover{ color:var(--hm-blue); }
/* 分类 */
.hm-cat-grid{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.hm-cat-tile{
  display:flex; flex-direction:column; align-items:center; text-align:center; gap:2px; padding:11px 12px; cursor:pointer;
  background:var(--dsw-alias-bg-module-platform); border:1px solid var(--hm-border); border-radius:11px;
  transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease, background .16s ease;
}
.hm-cat-tile:hover{ transform:translateY(-2px); background:var(--hm-card); border-color:color-mix(in srgb,var(--hm-blue) 40%,transparent); box-shadow:0 8px 16px -10px color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent); }
.hm-cat-icon{ display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:8px; margin-bottom:6px; }
.hm-cat-name{ font-size:12.5px; font-weight:600; }
.hm-cat-count{ font-size:11px; color:var(--hm-faint); }
/* 三分栏：分类 / 类型 / 浏览 */
.hm-split3{ display:grid; grid-template-columns:minmax(0,1.05fr) minmax(0,1.15fr) minmax(0,1fr); gap:12px; }
/* Donut */
.hm-donut-wrap{ display:flex; align-items:center; gap:12px; }
.hm-donut-svg{ flex:none; }
.hm-donut-svg circle.hm-seg{ transition:stroke-width .18s ease; transform-origin:center; }
.hm-donut-center{ text-anchor:middle; }
.hm-donut-num{ font-size:20px; font-weight:800; fill:var(--hm-ink); }
.hm-donut-label{ font-size:10.5px; fill:var(--hm-faint); }
.hm-legend{ flex:1 1 auto; display:flex; flex-direction:column; gap:7px; min-width:0; }
.hm-legend-row{ display:flex; align-items:center; gap:7px; font-size:12px; }
.hm-legend-dot{ flex:none; width:8px; height:8px; border-radius:50%; }
.hm-legend-name{ color:var(--hm-sub); }
.hm-legend-count{ margin-left:auto; font-weight:700; }
.hm-legend-pct{ width:44px; text-align:right; color:var(--hm-faint); font-size:11px; }
/* 行列表 */
.hm-rows{ display:flex; flex-direction:column; min-width:0; }
.hm-row-item{
  display:flex; align-items:center; gap:10px; width:100%; box-sizing:border-box; text-align:left; cursor:pointer;
  background:none; border:0; border-radius:10px; padding:8px 6px;
  transition:background .14s ease, transform .14s ease;
}
.hm-row-item:hover{ background:color-mix(in srgb,var(--hm-ink) 6%,transparent); transform:translateX(2px); }
.hm-row-icon{ flex:none; display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:9px; }
.hm-row-body{ flex:1 1 auto; min-width:0; }
.hm-row-title{ font-size:12.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hm-row-desc{ font-size:11px; color:var(--hm-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hm-row-time{ flex:none; font-size:11px; color:var(--hm-faint); }
/* 趋势 */
.hm-trend-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.hm-trend-range{
  border:1px solid var(--hm-border); background:var(--hm-card); border-radius:8px; font-size:11.5px; color:var(--hm-sub);
  padding:4px 8px; cursor:pointer; outline:none;
}
.hm-trend-svg{ display:block; width:100%; height:auto; }
.hm-trend-svg .hm-line{ fill:none; stroke:var(--hm-blue); stroke-width:2; stroke-linecap:round; stroke-linejoin:round;
  stroke-dasharray:600; stroke-dashoffset:600; animation:hm-draw 1.1s ease forwards .25s; }
.hm-trend-svg .hm-area{ fill:url(#hm-area-grad); opacity:0; animation:hm-fade 0.8s ease forwards .8s; }
.hm-trend-svg .hm-dot{ fill:var(--hm-blue); stroke:var(--hm-card); stroke-width:2; opacity:0; animation:hm-fade .4s ease forwards 1s; }
.hm-trend-svg .hm-grid-line{ stroke:var(--hm-border); stroke-width:1; }
.hm-donut-svg .hm-track{ stroke:var(--hm-border); }
.hm-trend-axis{ display:flex; justify-content:space-between; font-size:10px; color:var(--hm-faint); padding:2px 4px 0; }
/* 底部 */
.hm-bottom{ display:flex; flex-direction:column; gap:12px; }
.hm-tabs{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.hm-tab{
  border:1px solid transparent; background:transparent; border-radius:999px; padding:6px 13px;
  font-size:12px; color:var(--hm-sub); cursor:pointer; white-space:nowrap;
  transition:all .16s ease;
}
.hm-tab:hover{ background:color-mix(in srgb,var(--hm-ink) 8%,transparent); color:var(--hm-ink); }
.hm-tab-active{ background:var(--hm-blue); color:#fff; font-weight:600; box-shadow:0 4px 10px -4px color-mix(in srgb,var(--dsw-alias-state-business-primary) 60%,transparent); }
.hm-sort-sel{
  margin-left:auto; border:1px solid var(--hm-border); background:var(--hm-card); border-radius:8px;
  font-size:11.5px; color:var(--hm-sub); padding:5px 8px; cursor:pointer; outline:none;
}
.hm-mem-grid{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.hm-mem-card{
  display:flex; flex-direction:column; align-items:stretch; gap:8px; min-width:0; text-align:left; cursor:pointer;
  background:var(--hm-card); border:1px solid var(--hm-border); border-radius:13px; padding:13px 14px 11px;
  box-shadow:var(--dsw-shadow-lv1,0 1px 2px rgba(27,36,54,.05));
  transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease;
  animation:hm-rise .5s cubic-bezier(.22,.8,.32,1) both;
}
.hm-mem-card:hover{ transform:translateY(-3px); box-shadow:0 12px 24px -12px color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent); border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent); }
.hm-mem-head{ display:flex; align-items:center; gap:8px; width:100%; box-sizing:border-box; min-width:0; }
.hm-mem-icon{ flex:none; display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:9px; }
.hm-mem-title{ flex:1 1 auto; min-width:0; font-size:12.5px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hm-mem-dots{ flex:none; border:0; background:none; color:var(--dsw-alias-label-caption); font-size:14px; letter-spacing:1px; cursor:pointer; padding:0 2px; border-radius:6px; }
.hm-mem-dots:hover{ color:var(--hm-ink); background:color-mix(in srgb,var(--hm-ink) 8%,transparent); }
.hm-mem-desc{ font-size:11.5px; color:var(--hm-sub); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:32px; }
.hm-mem-tags{ display:flex; gap:6px; flex-wrap:wrap; }
.hm-mem-tag{ font-size:10.5px; border-radius:6px; padding:2px 8px; background:color-mix(in srgb,var(--hm-ink) 7%,transparent); color:var(--hm-sub); }
.hm-mem-foot{ display:flex; align-items:center; justify-content:space-between; margin-top:auto; padding-top:2px; }
.hm-mem-time{ font-size:11px; color:var(--hm-faint); }
.hm-empty{ padding:26px 10px; text-align:center; color:var(--hm-faint); font-size:12px; }
.hm-row-title,.hm-row-desc,.hm-mem-title,.hm-quick-desc{display:block;max-width:100%}
.hm-mem-head,.hm-mem-card{min-width:0}
@keyframes hm-rise{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:none; } }
@keyframes hm-draw{ to{ stroke-dashoffset:0; } }
@keyframes hm-fade{ to{ opacity:1; } }
@keyframes hm-drift{ from{ transform:translate(0,0) scale(1); } to{ transform:translate(-24px,18px) scale(1.08); } }
@keyframes hm-pulse{ 0%,100%{ box-shadow:0 0 0 3px color-mix(in srgb,var(--hm-green) 18%,transparent); } 50%{ box-shadow:0 0 0 6px color-mix(in srgb,var(--hm-green) 8%,transparent); } }
@media (max-width:1180px){
  .hm-grid{ grid-template-columns:minmax(0,1fr); }
  .hm-side{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); align-items:start; }
  .hm-split3{ grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
  .hm-mem-grid{ grid-template-columns:repeat(2,minmax(0,1fr)); }
  .hm-quicks{ grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media (prefers-reduced-motion:reduce){
  .hm-top,.hm-hero,.hm-quick,.hm-card,.hm-mem-card{ animation:hm-fade .2s ease both; }
  .hm-hero::before,.hm-hero::after{ animation:none; }
  .hm-hero-ok-dot{ animation:none; }
  .hm-trend-svg .hm-line{ animation:hm-fade .2s ease forwards; stroke-dasharray:none; }
  .hm-quick,.hm-cat-tile,.hm-mem-card,.hm-row-item{ transition:none; }
}
`;

export function ensureHomeStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = SHEET;
  document.head.appendChild(tag);
}
