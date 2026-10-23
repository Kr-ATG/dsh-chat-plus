/**
 * SkillsPanel — 技能管理面板（自旧 client.js 的 dsh-skill-manager 区域原样提取）。
 *
 * UI 与逻辑保持与旧 bundle 完全一致：技能列表、bundle 管理（新建/重命名/删除/归入）、
 * zip/文件夹上传安装、删除技能、文件查看器。数据全部走 /api/skill-manager/*。
 * 旧代码的 React.createElement 树在此转写为 JSX，样式沿用旧 .skm-* 类名与 token。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Button,
  IconArchiveOutlineRegular as IconArchiveOutline20,
  IconCheckOutlineRegular as IconCheckOutline16,
  IconChevronDownOutlineRegular as IconChevronDownOutline14,
  IconCloseOutlineRegular as IconCloseOutline16,
  IconCodeOutlineRegular as IconCodeOutline16,
  IconEditOutlineRegular as IconEditOutline16,
  IconEllipsisOutlineRegular as IconEllipsisOutline16,
  IconFolderOpenOutlineRegular as IconFolderOpenOutline16,
  IconPlusOutlineRegular as IconPlusOutline16,
  IconRefreshOutlineRegular as IconRefreshOutline14,
  IconSearchOutlineRegular as IconSearchOutline16,
  IconTrashOutlineRegular as IconTrashOutline16,
  Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  dirNameOf,
  formatBytes,
  mediaKindOf,
  renderSkillMarkdown,
  skillRawUrl,
} from './skill-preview.ts'
import { modalStaggerClass } from '../../triad-modal-animation'
import { ConfirmDialog } from '../../memory/ConfirmDialog'
import { PshBody, PopoverShell } from '../../popover-shell'

/** ---------------------------------------------------------------- 数据模型 */

interface SkillInfo {
  name: string
  description?: string
  files?: string[]
  fileCount?: number
  compatibility?: string
  /** 技能目录名：与 name 可以不一致（手工拷目录、改名导入），删除/查看走它。 */
  dir?: string
  /**
   * 是否为 dsh-chat-plus 随包分发的内置技能（host 靠目录里的 stamp 判定）。
   * 内置技能标「内置」且禁用删除——它由插件版本决定，删了启动时会原样装回。
   */
  builtin?: boolean
}

interface BundleInfo {
  id: string
  name: string
  skillCount: number
  skills: SkillInfo[]
  /** 账本里指向已消失技能的条目（面板给「清理失效引用」入口）。 */
  missingSkills?: string[]
  /** 技能包分类（一个包可挂多个）；老账本没有该字段时按未分类处理。 */
  categories?: string[]
}

interface SkillSnapshot {
  bundles: BundleInfo[]
  loose: SkillInfo[]
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; snapshot: SkillSnapshot }

/** ---------------------------------------------------------------- 文案与参数 */

const SKILL_ZH: Record<string, string> = {
  panelTitle: 'SKILL', close: '关闭', loading: '正在读取技能…',
  error: '暂时无法读取技能。', retry: '重试',
  uploadMeta: '{n} 个文件 · {folder}',
  fileCount: '{n} 文件', expandSkillFiles: '展开技能文件', previewLoading: '正在加载内容…', viewerNav: '技能文件', viewerFont: '字号', viewerFull: '全屏查看', viewerExitFull: '退出全屏', viewerFilesCount: '{n} 个文件', assignToBundle: '归入 Bundle', assignTitle: '将「{name}」归入', assignEmpty: '还没有技能包,先点「新建 Bundle」创建一个。', deleteSkillBtn: '删除技能',
  builtinTag: '内置', builtinNotDeletable: '内置技能，随 dsh-chat-plus 分发，不可删除',
  installName: '技能名称', installNamePlaceholder: '例如 my-skill', installDescription: '描述（可选）',
  installNameFromArchive: '技能名取自压缩包内的 SKILL.md',
  installNameInvalid: '技能名只能包含小写字母、数字和连字符（a-z 0-9 -）',
  installBundle: '归入 Bundle', installLoose: '不归组（散装）', installConfirm: '安装', installCancel: '取消',
  // 技能包分类
  bundleCatTitle: '分类', bundleCatAll: '全部分类', bundleCatAllShort: '全部', bundleCatNone: '未分类', bundleCatFilterAria: '按分类筛选技能包',
  bundleCatEdit: '设置分类', bundleCatEditTitle: '「{name}」的分类', bundleCatPlaceholder: '自定义分类，回车添加',
  bundleCatSaved: '已更新「{name}」的分类', bundleCatTip: '只看「{name}」分类 · 再点一次取消筛选',
  bundleCatLimit: '一个技能包最多 {n} 个分类', bundleCatDone: '保存', bundleCatAddPreset: '加入「{name}」',
  bundleCatEmptyHint: '还没分类。点下面的建议分类，或自己写一个 —— 分类只影响这里的查找，不改变技能本身。',
  bundleCatRemove: '移除分类「{name}」', bundleCatCustom: '自定义分类',
  newBundle: '新建技能包', newBundlePlaceholder: '技能包名称', create: '创建', cancel: '取消',
  renameBundlePlaceholder: '新的 Bundle 名称', rename: '重命名', delete: '删除',
  skillsCount: '{n} 个技能', removeSkill: '移出',
  looseTitle: '散装技能',
  deleteBundleConfirm: '删除 Bundle「{name}」？其中的技能将变为散装。',
  deleteSkillConfirm: '删除技能「{name}」？此操作会删除它的文件。',
  enableSkill: '启用', disableSkill: '禁用',
  enableBundle: '启用全部', disableBundle: '禁用全部',
  toggleFailed: '切换失败：{message}',
  // 卡片（Skills Hub 风格）文案
  copySkillName: '复制技能名', copiedSkillName: '已复制', scopeAll: '全局', tagLoose: '散装',
  // Skills Hub 页面文案
  bannerTitle: '添加技能', bannerSub: '拖入技能文件夹安装，或点击浏览选择',
  noMatch: '没有符合筛选条件的技能',
  // 左栏：Agent 预设分类 / 快捷筛选 / 添加技能卡
  statusAll: '全部', statusAllShort: '全部状态', statusOn: '已启用', statusOff: '已停用',
  expandBundle: '展开技能列表', collapseBundle: '收起技能列表',
  enabledShort: '已启用', allDisabled: '全部停用',
  noDescription: '暂无描述', moreSkills: '还有 {n} 个',
  expandAll: '全部展开', collapseAll: '全部收起', expandAllShort: '展开', collapseAllShort: '收起',
  // 概览 / 工具条
  statBundles: '技能包', statSkills: '技能总数', statEnabled: '已启用', statCategories: '分类',
  searchPlaceholder: '搜索技能包 / 技能名 / 分类…', searchClear: '清空搜索', searchResult: '命中 {n} 个技能', refresh: '刷新',
  enabledRatio: '{on}/{total} 已启用',
  addSkillsTitle: '添加技能',
  dropHere: '拖拽文件到此处', dropFormat: '支持 .zip .skill 等格式', browseImport: '浏览并导入',
  // 快速上手指南卡
  // SKILL / MCP 顶层 tab
  // MCP 视图
  // MCP Server 页（图一头部 + 统计卡）
  // 推荐 Skill
  // MCP Server 列表（图二）
  // 工具列表页
  // 推荐页联网搜索
  // 连接日志页
  // 配置模板页
  // 真实注册状态（mcp-client 桥接）
  // 右侧信息栏（图三）
  // 分组行 / 更多菜单 / 分页
  moreActions: '更多操作',
  // 空技能包 / 失效引用 / 操作反馈
  bundleEmptyTitle: '这个技能包还是空的',
  bundleEmptyHint: '上传技能时在这里选它归组，或从散装技能卡片点「+」归入。',
  bundleUploadHere: '上传技能到此包',
  bundleMissingN: '账本里有 {n} 个技能已不存在',
  bundlePrune: '清理失效引用',
  pruned: '已清理失效引用',
  installedOk: '已安装技能「{name}」',
  deletedOk: '已删除技能「{name}」',
  removedOk: '已从技能包移出「{name}」',
  assignOk: '已把「{name}」归入技能包',
  bundleCreated: '已创建技能包「{name}」，上传技能时可直接归入它',
  bundleDeleted: '已删除技能包「{name}」，其中的技能变为散装',
  opFailed: '操作失败：{label} — {message}',
  installNameRewrite: 'SKILL.md 里写的是「{meta}」，安装时会统一改成「{name}」（目录名与技能名保持一致）。',
  deleteSkillDirNote: '（技能目录「{dir}」与技能名不同，会一并删除）',
  skillOffTag: '已停用',
  // 二进制文件查看器（图片 / 音视频 / PDF）
  previewNotText: '这个文件不是纯文本，无法按文本预览。',
  previewOpenTab: '在新标签打开',
  previewImageAlt: '技能文件预览：{name}',
  previewLoadFailed: '预览没加载出来。原始字节接口是在 DSH 启动时注册的，重启一次 DSH Web 服务后再打开即可。',
}

function skillT(key: string, params?: Record<string, string | number>): string {
  let text = SKILL_ZH[key] ?? key
  if (params) {
    for (const k of Object.keys(params)) text = text.split(`{${k}}`).join(String(params[k]))
  }
  return text
}

/** ---------------------------------------------------------------- 技能包分类 */

/** 建议分类：点一下就挂上；也允许自己写，账本里存的就是字符串本身。 */
const PRESET_BUNDLE_CATEGORIES = ['开发', '设计', '办公协同', '文档知识', '数据', '自动化', '运维', '其他']

/** 分类筛选里代表「没挂任何分类的包」的哨兵值（不会是合法分类名）。 */
const UNCATEGORIZED = '\u0000none'

/** 一个技能包最多挂几个分类（与 host 的 CATEGORY_MAX_PER_BUNDLE 对齐）。 */
const MAX_BUNDLE_CATEGORIES = 8

/** 分类不做逐类配色：一个面板只有主题蓝一把刷子（彩虹色板实测太吵，已否）。 */

/** 分类名单排序：按挂载的包数从多到少，同数按名字。 */
function sortCategories(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map((entry) => entry[0])
}

/** 分组行蓝色文件夹（实心）。 */
function FolderBlueIcon({ size = 17 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M3.5 7.2a2.2 2.2 0 0 1 2.2-2.2h4l2 2.1h6.6a2.2 2.2 0 0 1 2.2 2.2v7.5a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2Z" fill="var(--dsw-alias-state-business-primary,#3d6be5)" />
      <path d="M3.5 9.5h17v1.6a2.2 2.2 0 0 0-2.2-2.2H5.7a2.2 2.2 0 0 0-2.2 2Z" fill="#FFFFFF" opacity=".25" />
    </svg>
  )
}

/** 拖放云图标（添加技能入口与空技能包引导按钮共用）。 */
function CloudUpIcon({ size = 18 }: { size?: number }): JSX.Element {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...stroke}>
      <path d="M17.7 9.5A5.2 5.2 0 0 0 7.6 8.2 4 4 0 0 0 6.5 16h10.9a3.8 3.8 0 0 0 .5-7.6Z" />
      <path d="M12 17.5v-5M9.6 14.6 12 12.2l2.4 2.4" />
    </svg>
  )
}

/** ---------------------------------------------------------------- API */

const SKILL_API_BASE = '/api/skill-manager'

async function skillRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(SKILL_API_BASE + path, options)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'request failed (' + String(response.status) + ')')
  return body
}

type InstallInput =
  | { archive: string; description: string; bundleId?: string }
  | { skillName: string; description: string; bundleId?: string; files: Array<{ path: string; data: string }> }

/** 技能开关状态(/api/skill-toggles/status 响应)。 */
interface ToggleStatus {
  skills: Record<string, boolean>
  bundles: Record<string, boolean>
}

const skillApi = {
  list: (): Promise<SkillSnapshot> => skillRequest<SkillSnapshot>('/list', { headers: { accept: 'application/json' } }),
  toggleStatus: (): Promise<ToggleStatus> =>
    fetch('/api/skill-toggles/status', { headers: { accept: 'application/json' } })
      .then((response) => response.json() as Promise<ToggleStatus & { error?: string }>)
      .then((body) => {
        if (typeof body !== 'object' || body === null || body.skills === undefined) {
          throw new Error('toggle status unavailable')
        }
        return body as ToggleStatus
      }),
  setSkillEnabled: (name: string, enabled: boolean): Promise<{ ok: boolean }> =>
    fetch(`/api/skill-toggles/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).then((response) => response.json() as Promise<{ ok: boolean; error?: string }>)
      .then((body) => {
        if (!body.ok) throw new Error(body.error || 'toggle failed')
        return body
      }),
  setBundleEnabled: (bundleId: string, enabled: boolean): Promise<{ ok: boolean; handled?: number }> =>
    fetch(`/api/skill-toggles/bundles/${encodeURIComponent(bundleId)}`, {
      method: 'PUT',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).then((response) => response.json() as Promise<{ ok: boolean; error?: string; handled?: number }>)
      .then((body) => {
        if (!body.ok) throw new Error(body.error || 'toggle failed')
        return body
      }),
  createBundle: (name: string, categories: string[] = []): Promise<Record<string, never>> =>
    skillRequest('/bundles', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ name, categories }) }),
  renameBundle: (bundleId: string, name: string): Promise<Record<string, never>> =>
    skillRequest(`/bundles/${encodeURIComponent(bundleId)}`, { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ name }) }),
  /** 只改分类的 PATCH：host 侧 name 缺省即保持原值，不必回传包名。 */
  setBundleCategories: (bundleId: string, categories: string[]): Promise<Record<string, never>> =>
    skillRequest(`/bundles/${encodeURIComponent(bundleId)}`, { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ categories }) }),
  deleteBundle: (bundleId: string): Promise<Record<string, never>> =>
    skillRequest(`/bundles/${encodeURIComponent(bundleId)}`, { method: 'DELETE', headers: { accept: 'application/json' } }),
  setBundleSkills: (bundleId: string, skillNames: string[]): Promise<Record<string, never>> =>
    skillRequest(`/bundles/${encodeURIComponent(bundleId)}/skills`, { method: 'PUT', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ skillNames }) }),
  deleteSkill: (name: string): Promise<Record<string, never>> =>
    skillRequest(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { accept: 'application/json' } }),
  installSkill: (input: InstallInput): Promise<{ name?: string; dir?: string; renamed?: boolean }> =>
    skillRequest('/skills', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(input) }),
  /** 技能目录健康检查：只读扫描（缺 SKILL.md / frontmatter 无效 / 名称不一致 / 账本悬挂引用）。 */
}

/** ---------------------------------------------------------------- 样式 */

const css = {
  // SKILL / MCP 顶层 tab + MCP 占位
  modalBody: 'skm-modal-body',
  hiddenInput: 'skm-hidden-input',
  installForm: 'skm-install-form',
  installRow: 'skm-install-row',
  inlineForm: 'skm-inline-form',
  // 技能包分类：顶栏胶囊行 / 包名旁标签 / 分类编辑器
  stackForm: 'skm-stack-form',
  bundleCats: 'skm-bundle-cats',
  bundleCatTag: 'skm-bundle-cat-tag',
  catEditor: 'skm-cat-editor',
  catEmpty: 'skm-cat-empty',
  catSelected: 'skm-cat-selected',
  catSelectedTag: 'skm-cat-selected-tag',
  catSelectedName: 'skm-cat-selected-name',
  catRemove: 'skm-cat-remove',
  catSuggest: 'skm-cat-suggest',
  catPreset: 'skm-cat-preset',
  catPresetPlus: 'skm-cat-preset-plus',
  catInput: 'skm-cat-input',
  catLimit: 'skm-cat-limit',
  // 块级变体：改名输入行独占一整行（整行内容保留，表单追加在其下方）。
  inlineFormBlock: 'skm-inline-form-block',
  inlineInput: 'skm-inline-input',
  bundleSelect: 'skm-bundle-select',
  installMeta: 'skm-install-meta',
  installActions: 'skm-install-actions',
  status: 'skm-status',
  failure: 'skm-failure',
  error: 'skm-error',
  bundleRow: 'skm-bundle-row',
  bundleName: 'skm-bundle-name',
  bundleLeft: 'skm-bundle-left',
  bundleRight: 'skm-bundle-right',
  bundleMeta: 'skm-bundle-meta',
  bundleSep: 'skm-bundle-sep',
  toggleDot: 'skm-toggle-dot',  // 收起态的「还有 N 个」尾巴：仍留在技能列表里，占满一整行。
  // 旧的 bundlePreview / bundlePreviewChip / Name / Desc / Files 五个类名
  // 已随「收起态改用同一套技能行」而删除，别再往映射里加回来。
  bundlePreviewMore: 'skm-bundle-preview-more',
  skillMoreRow: 'skm-skill-more-row',  // 技能卡片（Skills Hub 风格）
  skillGrid: 'skm-skill-grid',
  skillCard: 'skm-skill-card',
  skillCardHead: 'skm-skill-card-head',
  skillBadge: 'skm-skill-badge',
  skillTitle: 'skm-skill-title',
  skillCardToggle: 'skm-skill-card-toggle',
  skillDesc: 'skm-skill-card-desc',
  skillTags: 'skm-skill-tags',
  tag: 'skm-tag',
  tagSource: 'skm-tag-source',
  tagScope: 'skm-tag-scope',
  skillMeta: 'skm-skill-meta',
  skillCardFoot: 'skm-skill-card-foot',
  skillFootIcon: 'skm-skill-foot-icon',
  skillFootIconDanger: 'skm-skill-foot-icon-danger',
  skillCardActions: 'skm-skill-card-actions',
  // Skills Hub 页面结构
  hub: 'skm-hub',
  // 刊头 / 工具条 / 搜索（2026-10-22 方向一重做）
  mast: 'skm-mast',
  mastWord: 'skm-mast-word',
  mastZh: 'skm-mast-zh',
  mastGrow: 'skm-mast-grow',
  mastStats: 'skm-mast-stats',
  mastStat: 'skm-mast-stat',
  bar: 'skm-bar',
  barCats: 'skm-bar-cats',
  barGrow: 'skm-bar-grow',
  barBtn: 'skm-bar-btn',
  barAdd: 'skm-bar-add',
  barDivider: 'skm-bar-divider',
  filterCount: 'skm-filter-count',
  search: 'skm-search',
  searchInput: 'skm-search-input',
  searchClear: 'skm-search-clear',
  // 筛选行：分类 / 启用状态（与官方「自动化任务」页同一套 filter tab）  filterTabs: 'skm-filter-tabs',
  filterTabsRight: 'skm-filter-tabs-right',
  filterTab: 'skm-filter-tab',  addCard: 'skm-add-card',
  addCardActive: 'skm-add-card-active',
  addCardHead: 'skm-add-card-head',
  addCardIcon: 'skm-add-card-icon',
  addCardTitle: 'skm-add-card-title',
  addCardSub: 'skm-add-card-sub',
  addDrop: 'skm-add-drop',
  addDropText: 'skm-add-drop-text',
  addDropHint: 'skm-add-drop-hint',
  addBtn: 'skm-add-btn',
  // 快速上手指南卡
  // 右侧指南栏
  hubMain: 'skm-hub-main',
  // 分组行
  bundleRowOuter: 'skm-bundle-row-outer',  bundleMore: 'skm-bundle-more',
  bundleMoreBtn: 'skm-bundle-more-btn',
  // 分页
  mainScroll: 'skm-main-scroll',
  hubSection: 'skm-hub-section',
  noResult: 'skm-no-result',
  // 归入技能包弹窗（卡片化）
  assignModal: 'skm-assign-modal',
  assignModalBody: 'skm-assign-modal-body',
  assignList: 'skm-assign-list',
  assignCard: 'skm-assign-card',
  assignCardIcon: 'skm-assign-card-icon',
  assignCardBody: 'skm-assign-card-body',
  assignCardName: 'skm-assign-card-name',
  assignCardDesc: 'skm-assign-card-desc',
  assignGo: 'skm-assign-go',
  skillFiles: 'skm-skill-files',
  skillFile: 'skm-skill-file',
  viewerModal: 'skm-viewer-modal',
  viewerBody: 'skm-viewer-body',
  viewerLayout: 'skm-viewer-layout',
  viewerNav: 'skm-viewer-nav',
  viewerNavItem: 'skm-viewer-nav-item',
  viewerNavDir: 'skm-viewer-nav-dir',
  viewerContent: 'skm-viewer-content',
  viewerModalFull: 'skm-viewer-modal-full',
  viewerToolbar: 'skm-viewer-toolbar',
  viewerPath: 'skm-viewer-path',
  viewerToolGroup: 'skm-viewer-tool-group',
  viewerToolBtn: 'skm-viewer-tool-btn',
  viewerToolBtnA1: 'skm-viewer-tool-btn-a1',
  viewerToolBtnA3: 'skm-viewer-tool-btn-a3',
  viewerToolBtnFrame: 'skm-viewer-tool-btn-frame',
  viewerMedia: 'skm-viewer-media',
  viewerMediaNote: 'skm-viewer-media-note',
  viewerMediaOpen: 'skm-viewer-media-open',
  looseEmpty: 'skm-loose-empty',
  visuallyHidden: 'skm-visually-hidden',
  // 技能/技能包开关
  toggle: 'skm-toggle',
  toggleOn: 'skm-toggle-on',
  toggleOff: 'skm-toggle-off',
  toggleKnob: 'skm-toggle-knob',
  bundleToggle: 'skm-bundle-toggle',
  // 空技能包 / 失效引用 / 面板级提示条
  toastStack: 'skm-toast-stack',
  toast: 'skm-toast',
  toastOk: 'skm-toast-ok',
  toastErr: 'skm-toast-err',
  toastDot: 'skm-toast-dot',
  bundleEmpty: 'skm-bundle-empty',
  bundleEmptyTitle: 'skm-bundle-empty-title',
  bundleEmptyHint: 'skm-bundle-empty-hint',
  bundleEmptyBtn: 'skm-bundle-empty-btn',
  bundleMissing: 'skm-bundle-missing',
  bundleMissingBtn: 'skm-bundle-missing-btn',
  installHint: 'skm-install-hint',
  tagStatus: 'skm-tag-status',
  tagBuiltin: 'skm-tag-builtin',
}

const STYLE_ID = 'dsh-skill-manager-styles'
const SHEET = `.skm-modal-body{overflow:hidden;display:flex;flex-direction:column}
.skm-hidden-input{display:none}
.skm-install-form{flex:none;display:flex;flex-direction:column;gap:8px;padding:10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#1c1f26)}
.skm-install-row{display:flex;flex-direction:column;gap:6px}
.skm-inline-form{flex:none;display:flex;align-items:center;gap:6px}
/* 块级变体：改名输入行独占一整行（整行内容保留，表单追加在其下方）。 */
.skm-inline-form-block{width:100%;box-sizing:border-box;padding:0 8px 8px;animation:skm-form-in 160ms ease-out}
@keyframes skm-form-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.skm-inline-input{flex:1;min-width:0;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;padding:0 10px;font-size:13px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-base,#0e1116)}
.skm-inline-input::placeholder{color:var(--dsw-alias-label-tertiary,#888)}
.skm-bundle-select{display:flex;align-items:center}
.skm-bundle-select select{flex:1;height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:8px;padding:0 8px;font-size:13px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-base,#0e1116)}
.skm-install-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.skm-install-actions{display:flex;align-items:center;gap:6px}
.skm-status{margin:2px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#888)}
.skm-failure{display:flex;align-items:center;gap:8px}
.skm-failure p{margin:2px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary,#e0434b)}
.skm-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e0434b)}
/* ── 目录式技能包行（方向一 · 2026-10-22 定稿）──
   整个 section 是两栏：左栏包名/分类/启用数，右栏技能目录。
   没有卡片、圆角、阴影：靠一条发丝分隔线和两栏版心表达结构。 */
/* 两栏：左 262px **整列独占给技能包信息**（包名 / 分类 / 计数 / 更多动作），
   右栏才是技能目录。align-items:start 让左栏不被右栏的长列表拉伸——
   拉伸后包名会垂直居中、跟右侧第一行技能错位，读起来像两个不相干的东西。
   2026-10-23 用户要求「左侧的空间全部留给技能包」：此前技能列表被挪到 header
   外面横跨整行，包名下方那一整块被技能行占着，左栏只剩三行字贴着顶边。 */
.skm-bundle-row-outer{position:relative;flex:none;display:grid;grid-template-columns:262px minmax(0,1fr);gap:0;
  align-items:start;box-sizing:border-box;padding:26px 0 24px;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.09));
  transition:background 200ms ease}
@media (max-width:1180px){.skm-bundle-row-outer{grid-template-columns:200px minmax(0,1fr)}}
.skm-bundle-row-outer:hover{background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 3%,transparent),transparent 38%)}
/* 2026-10-23：包行左侧主色竖线整条删除（用户要求「左侧这条线去掉」）。
   面板表原先在这里画一条 left:-20px 的，换肤层又在 left:0 画一条 2px 的，
   两条叠在一起，hover 时从行首直贯到行尾，比 25px 的包名还抢眼。
   hover 反馈不靠线：包名转主色（.skm-bundle-row:hover）+ 行内极淡的横向渐变底
   （见 .skm-bundle-row-outer:hover）已经够用，也不会在左侧留一条常驻的边。 */
/* 变成单栏时（窄屏）撤掉左栏版心 */
@media (max-width:900px){.skm-bundle-row-outer{grid-template-columns:minmax(0,1fr)}}

/* 左栏：262px 整列归技能包所有。
   sticky 让包名在滚动长列表时**钉在顶部**——一个 25 个技能的包能撑出两屏，
   滚到第二屏时左边如果跟着滚走，就只剩一列光秃秃的技能名，看不出这是哪个包。
   self-start 配合上的 align-items:start，避免把它拉成整列高。 */
.skm-bundle-left{min-width:0;padding-right:34px;position:sticky;top:0;align-self:start}
.skm-bundle-row{display:block;width:100%;text-align:left;appearance:none;border:0;background:none;padding:0;
  font-family:inherit;cursor:pointer;color:var(--dsw-alias-label-primary,#14171b);transition:color .18s ease}
.skm-bundle-row:hover{color:var(--dsw-alias-state-business-primary,#3d6be5)}
.skm-bundle-name{display:block;min-width:0;overflow-wrap:anywhere;font-weight:700;font-size:25px;line-height:1.18;
  letter-spacing:-.026em;margin:0 0 9px;transition:color .18s ease}
.skm-bundle-meta{display:flex;align-items:center;flex-wrap:wrap;gap:0 7px;font-size:12px;line-height:1.85;
  color:var(--dsw-alias-label-tertiary,#7b818a)}
.skm-bundle-meta .skm-bundle-sep{width:2px;height:2px;border-radius:50%;background:var(--dsw-alias-border-l3,rgba(0,0,0,.22));flex:none}
.skm-bundle-left .skm-bundle-cats{display:inline-flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0}
/* 包名旁的分类：目录式下划线，不是胶囊。**照 design-demos/dir-1.html 的 .pm .cat 原样**——
   那里就只有「12px / ink2 文字 + 1px 下划线」，hover 时文字与下划线一起转主色。
   2026-10-23 用户反馈「分类标签包裹很丑」：根因是同文件后面还压着一段旧的
   胶囊定义（border-radius:999px + 底色 + 边框），同优先级后者胜，下划线版
   从未生效；那段已整块删除。另外 hub/styles.ts 也曾用 !important 给它补底补边，
   一并撤掉——形状只在这一处定义，别再往回加底加框。 */
.skm-bundle-cat-tag{display:inline-flex;align-items:center;border:0;background:none;padding:0 0 1px;border-radius:0;
  font-family:inherit;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#4c5158);
  cursor:pointer;white-space:nowrap;
  border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));
  transition:color .16s ease,border-color .16s ease}
.skm-bundle-cat-tag:hover{color:var(--dsw-alias-state-business-primary,#3d6be5);border-bottom-color:var(--dsw-alias-state-business-primary,#3d6be5)}
/* 选中筛选：文字转主色 + 加粗，下划线跟着主色（与工具条的分类 tab 同一套语言） */
.skm-bundle-cat-tag[data-active]{color:var(--dsw-alias-state-business-primary,#3d6be5);font-weight:600;
  border-bottom-color:var(--dsw-alias-state-business-primary,#3d6be5)}
/* 启用状态：圆点 + 计数，点一下切整包 */
.skm-bundle-toggle{display:inline-flex;align-items:center;gap:7px;margin-top:11px;padding:0;border:0;background:none;
  font-family:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary,#7b818a);letter-spacing:.01em;cursor:pointer;
  transition:color .16s ease}
.skm-bundle-toggle .skm-toggle-dot{width:5px;height:5px;border-radius:50%;flex:none;
  background:var(--dsw-alias-border-l3,rgba(0,0,0,.22));transition:background .24s ease,box-shadow .24s ease}
.skm-bundle-toggle[data-on]{color:var(--dsw-alias-label-secondary,#4c5158)}
.skm-bundle-toggle[data-on] .skm-toggle-dot{background:var(--dsw-alias-state-business-primary,#3d6be5);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 14%,transparent)}
/* 包级开关的圆点与技能级开关（.skm-toggle-knob）同规格：5px 在包名下方够用，
   技能行更密，7px 才剩得住同样的视觉重量。两处共用「开=实心+光晕」这条规则。 */
.skm-bundle-toggle:hover{color:var(--dsw-alias-label-primary,#14171b)}
.skm-bundle-toggle b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#7b818a)}
.skm-bundle-toggle[data-on] b{color:var(--dsw-alias-state-business-primary,#3d6be5)}
/* 旧开关/进度条/文件夹图标：目录式下不再出现，样式保留空壳以防引用 */

/* 右栏：技能目录。左侧发丝竖线把两栏分开——左栏因此是**一个完整的信息块**，
   而不是散落在技能行旁边的一行标题。 */
.skm-bundle-right{min-width:0;border-left:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.09));padding-left:30px}
.skm-bundle-more{position:absolute;top:20px;right:0;display:flex;align-items:center}
.skm-bundle-more-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:5px;
  padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary,#a3a7ad);transition:background .14s ease,color .14s ease,transform .14s ease}
.skm-bundle-more-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#14171b) 7%,transparent);color:var(--dsw-alias-label-primary,#14171b)}
.skm-bundle-more-btn:active{transform:scale(.9)}

/* ── 收起态的「还有 N 个」：它只是把同一批行的尾巴显示出来，不是另一套版式 ──
   2026-10-23 合并。原先这里还躺着一整套 .skm-bundle-preview-chip（名称 + 描述 +
   文件数的独立 DOM），与展开态的 .skm-skill-card 是两套实现——两边外观永远对不齐，
   改一边另一边就掉队，用户看到的「展开会不会变样」根子就在这。现在收起态也用
   .skm-skill-card，仅多渲染这个尾巴。
   它占满一整行（grid-column:1/-1），并与上一行的技能项左边缘对齐。 */
/* 「还有 N 个」：占满整行、与技能行左边缘对齐（.skm-skill-card 有 7px 内距，
   这里补同样的缩进，否则它会比上面的技能名靠左 ~7px，看着像掉出栅格）。 */
.skm-skill-more-row{grid-column:1/-1;list-style:none;display:flex;justify-content:flex-start;padding-left:0}
.skm-bundle-preview-more{display:inline-flex;align-items:center;gap:6px;margin-top:2px;padding:4px 0;
  border:0;border-bottom:1px solid transparent;background:none;font-family:inherit;font-size:12px;
  color:var(--dsw-alias-label-tertiary,#7b818a);cursor:pointer;letter-spacing:.03em;
  transition:color .16s ease,border-color .16s ease}
.skm-bundle-preview-more svg{transition:transform .24s cubic-bezier(.22,.72,.24,1)}
.skm-bundle-preview-more:hover{color:var(--dsw-alias-state-business-primary,#3d6be5);
  border-bottom-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 40%,transparent)}
.skm-bundle-preview-more:hover svg{transform:translateY(1px)}
@keyframes skm-preview-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
/* ── 技能包分类：顶栏胶囊筛选 / 包名旁标签 / 分类编辑器 ─────────────────────── */
/* 配色只走主题蓝一把刷子（与 .skm-tag 同语言）；分类名不参与配色——
   彩虹色板实测视觉太吵，与面板其余部分打架，已否。 */
.skm-stack-form{display:flex;flex-direction:column;gap:10px}
/* 包名旁标签：整颗可点（点在标题行里，由 JS 分流成筛选而非展开）。
   外观在「目录式技能包行」那一节（下划线版），此处不再重复定义——
   2026-10-23 删掉的正是这里的第二份胶囊定义：同优先级后者胜，
   它把下划线版整段盖掉了，用户看到的就是包着灰底的胶囊。 */
.skm-bundle-cats{flex:none;display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;min-width:0}
/* 分类编辑器 */
.skm-cat-editor{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;width:100%}
.skm-cat-empty{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}
.skm-cat-selected{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:5px}
.skm-cat-selected-tag{display:inline-flex;align-items:center;gap:5px;height:24px;box-sizing:border-box;padding:0 4px 0 9px;border-radius:999px;font-size:12px;line-height:20px;color:var(--dsw-alias-state-business-primary,#3d6be5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 26%,transparent);animation:skm-cat-tag-in 200ms cubic-bezier(.2,.9,.3,1.1) both}
.skm-cat-selected-name{white-space:nowrap}
.skm-cat-remove{flex:none;display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;padding:0;border:none;border-radius:50%;background:transparent;color:inherit;cursor:pointer;opacity:.6;transition:opacity 140ms ease,background 140ms ease,transform 140ms ease}
.skm-cat-remove:hover{opacity:1;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 22%,transparent)}
.skm-cat-remove:active{transform:scale(.9)}
.skm-cat-suggest{display:flex;flex-wrap:wrap;gap:4px}
.skm-cat-preset{display:inline-flex;align-items:center;gap:3px;height:23px;box-sizing:border-box;padding:0 8px;border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.16));border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);font-family:inherit;font-size:11.5px;line-height:19px;cursor:pointer;transition:color 140ms ease,border-color 140ms ease,background 140ms ease,transform 120ms ease}
.skm-cat-preset:hover:not(:disabled){color:var(--dsw-alias-state-business-primary,#3d6be5);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 55%,transparent);border-style:solid;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 9%,transparent);transform:translateY(-1px)}
.skm-cat-preset:active:not(:disabled){transform:translateY(0) scale(.96)}
.skm-cat-preset:disabled{opacity:.4;cursor:default}
.skm-cat-preset-plus{font-size:13px;line-height:16px;opacity:.7}
.skm-cat-input{box-sizing:border-box;width:100%;height:32px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:9px;padding:0 10px;font-family:inherit;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-primary,#1f2430);background:var(--dsw-alias-bg-base,#fff);transition:border-color 150ms ease,box-shadow 150ms ease}
.skm-cat-input:focus,.skm-cat-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#3d6be5);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}
.skm-cat-limit{margin:0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#81858c)}

.skm-bundle-more{flex:none;display:flex;align-items:center}
.skm-bundle-more-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-caption,#adb2b8);transition:background 140ms ease,color 140ms ease,transform 140ms ease}
.skm-bundle-more-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1f2430)}
.skm-bundle-more-btn:active{transform:scale(.9)}

/* ── 展开态技能目录：**直接照 design-demos/dir-1.html 的 .sk 规格** ─────────
   2026-10-23 用户反馈「展开为什么变成老样式了」。设计稿里这件事的答案很干脆：
   收起态和展开态根本是**同一个 .sk 行**，只差渲染数量——
       const shown = open ? list : list.slice(0, 6)
   压根没有第二套「卡片」样式。插件这边却把它实现成了两套 DOM/两套 CSS
   （收起 = 目录行，展开 = Skills Hub 圆角卡片），一展开自然跳回旧设计。
   这里把展开态的行压回设计稿的那一套 grid 规格：
       grid-template-columns:1fr auto；名称与描述在第 1 列、文件数在第 2 列；
       ::before 竖线藏在外侧 -10px，hover 从中间长出来。
   外壳（border/圆角/背景/阴影/底栏）一律没有 —— 那是卡片语言，不是目录语言。 */
.skm-skill-grid{list-style:none;margin:2px 0 0;padding:0;width:100%;display:grid;gap:0 28px;box-sizing:border-box;
  /* 列数由技能数现算，见 JSX 的 data-cols（1 / 2 / 3），不再写死 2 列 */
  grid-template-columns:repeat(var(--skm-cols,2),minmax(0,1fr))}
@media (max-width:900px){.skm-skill-grid{grid-template-columns:minmax(0,1fr)}}
.skm-skill-grid > .skm-status{grid-column:1/-1;padding-top:4px}
/* 行本体：设计稿 .sk —— 两列两行（名称/描述 在左列，文件数 在右列），右留 10px 给竖线。
   2026-10-23 收紧密度：用户要求「别占这么多空间」，参照图里一行只有
   名称(13px) + 描述(12px) 两行、行间几乎贴在一起。这里把上下内距从 7px 压到 4px、
   行间距从 2px 压到 0（靠内距撑开），整行从 62px → 约 48px。 */
.skm-skill-card{position:relative;min-width:0;display:grid;grid-template-columns:minmax(0,1fr) auto;
  grid-template-rows:auto auto;align-content:center;align-items:baseline;gap:0 12px;box-sizing:border-box;
  border:0;border-radius:0;background:none;box-shadow:none;padding:3px 10px 3px 0;min-height:38px;
  opacity:0;animation:skm-card-in 260ms cubic-bezier(.2,.7,.3,1.06) forwards;
  animation-delay:calc(var(--skm-i,0)*40ms);transition:background .16s ease}
/* 设计稿 .sk::before：竖线在行外 -10px，hover / 聚焦时从中间展开 */
.skm-skill-card::before{content:"";position:absolute;left:-10px;top:5px;bottom:5px;width:1.5px;
  background:var(--dsw-alias-state-business-primary,#3d6be5);transform:scaleY(0);transform-origin:center;
  transition:transform .22s cubic-bezier(.22,.72,.24,1)}
.skm-skill-card:hover::before,.skm-skill-card:focus-within::before{transform:scaleY(1)}
.skm-skill-card:hover,.skm-skill-card:focus-within{background:linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 4.5%,transparent),transparent 78%)}
@keyframes skm-card-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
/* head 用 display:contents：让徽章 / 标题 / 开关直接参与外层 grid 的行列分配，
   各自落到指定格子（标题与开关在第 1 行，描述在第 2 行），外壳本身不产生盒子。 */
.skm-skill-card-head{display:contents}
/* 设计稿没有「skill」徽章 —— 一列目录里每行都挂一个同样的词纯属噪音，隐藏（保留节点给读屏） */
.skm-skill-badge{display:none}
/* 设计稿 .sn：等宽、13.5px、600、单行省略 */
.skm-skill-title{grid-column:1;grid-row:1;appearance:none;border:none;background:transparent;padding:0;
  text-align:left;font-family:ui-monospace,"Cascadia Mono","SF Mono",Consolas,monospace;
  font-size:13px;font-weight:600;line-height:1.45;letter-spacing:-.01em;color:var(--dsw-alias-label-primary,#14171b);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;border-radius:0;
  transition:color .16s ease}
.skm-skill-title:hover{color:var(--dsw-alias-state-business-primary,#3d6be5)}
/* 键盘聚焦环：紧贴文字（offset 1px），不向外扩到整行——
   原来 offset:3px 在目录行里会顶到上一行，看着像给整格套了个蓝框。 */
.skm-skill-title:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px;border-radius:2px}
/* 开关：已并入操作组（见 JSX），随 hover / 键盘聚焦一起浮出。
   这一格现在空着 —— 保留类名不做布局，避免老的引用报错。 */
.skm-skill-card-toggle{display:contents}
/* 设计稿 .sd：12.5px、单行省略、max-width 430px。
   2026-10-23 修：原来写的是 min(430px, calc(100% - 130px))，本意是给 hover 浮出的
   操作组让位；但 3 列布局下每列只有 ~240px，减 130 只剩 110px，描述被压成「飞书…」。
   操作组在第二行右列、本来就只覆盖很短一段，且 hover 时才出现——不需要预留这么宽。
   改成直接吃满左列，只在需要时由省略号收尾。 */
.skm-skill-card-desc{grid-column:1;grid-row:2;margin:1px 0 0;appearance:none;border:none;background:transparent;padding:0;
  text-align:left;font-family:inherit;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#7b818a);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:430px;min-width:0;
  cursor:pointer;transition:color .16s ease}
.skm-skill-card-desc:hover{color:var(--dsw-alias-label-secondary,#4c5158)}
/* 标记行：设计稿里**没有这一行**，这里整块隐掉。
   「全局」对每个技能都一样（SKILL.md frontmatter 恒为全局层），零信息；
   「内置」在展开态一眼看不出区别也没关系——真要区分，看操作组的删除键是否置灰；
   「已关闭」已经改成名字删除线（设计稿 .sk[data-off] 的做法），不必再加一枚标签。
   这三枚标签正是之前「到处是胶囊」观感的主要来源。 */
.skm-skill-tags{display:none}
/* 标记（全局 / 内置 / 已关闭）：小圆点 + 文字，没有底、没有框 ——
   彩色胶囊在这套目录语言里会读成按钮（这正是「包裹很丑」的来源）。 */
.skm-tag{flex:none;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;line-height:1.6;
  color:var(--dsw-alias-label-tertiary,#7b818a);white-space:nowrap;background:none;border:0;padding:0;
  transition:color .16s ease}
.skm-tag::before{content:"";flex:none;width:4px;height:4px;border-radius:50%;background:currentColor;
  opacity:.5;transition:opacity .16s ease,background .16s ease}
.skm-tag-scope{color:var(--dsw-alias-label-secondary,#4c5158)}
.skm-tag-scope[data-off='true']{color:var(--dsw-alias-label-tertiary,#7b818a)}
.skm-tag-scope[data-off='true']::before{opacity:.3}
/* 关掉的技能：设计稿用删除线（.sk[data-off] .sn{text-decoration:line-through}），
   比再加一枚「已关闭」标签干净——状态写在名字本身上。 */
.skm-tag-status{display:none}
.skm-skill-card[data-off='true'] .skm-skill-title{color:var(--dsw-alias-label-tertiary,#7b818a);
  text-decoration:line-through;text-decoration-thickness:1px;text-underline-offset:3px}
.skm-skill-card[data-off='true'] .skm-skill-card-desc{color:var(--dsw-alias-label-quaternary,#a3a7ad)}
.skm-skill-card[data-off='true'] .skm-skill-title{transition:color .22s ease}
/* 内置：圆点吃主色，一眼区别于用户自己装的技能 */
.skm-tag-builtin{color:var(--dsw-alias-state-business-primary,#3d6be5)}
.skm-tag-builtin::before{background:var(--dsw-alias-state-business-primary,#3d6be5);opacity:1}
/* 文件数：设计稿 .sf —— 第 2 列、**跨两行居中**（名称与描述之间的那条竖线上）。
   2026-10-23：它原先挂在 .skm-skill-tags 里，被 display:none 一起藏掉，右列变成空白。
   现在与标记行平级，独立占第 2 列。 */
.skm-skill-meta{grid-column:2;grid-row:1 / span 2;justify-self:end;align-self:center;
  font-family:ui-monospace,Consolas,monospace;font-size:10.5px;line-height:1.6;
  color:var(--dsw-alias-label-caption,#a3a7ad);font-variant-numeric:tabular-nums;
  opacity:.62;white-space:nowrap;transition:opacity .16s ease}
/* 文件数在 hover 时让位给操作组（操作组绝对定位在同一处）：
   两者交接，不留空档。用 opacity 而非 display，避免行宽跳动。 */
.skm-skill-files{grid-column:1/-1;grid-row:3}
/* 操作组：绝对定位浮在行右端，**不参与网格、不占位**。
   2026-10-23：原先它挂在 grid 第 2 行，那 26px 的按钮把整行从 43px 撑到 51px ——
   「占用空间」的第二个来源（第一个是常驻的开关，已并入这里）。
   改成绝对定位后行高只由「名称 + 描述」决定，hover 时才浮出图层。 */
.skm-skill-card-foot{position:absolute;top:50%;right:0;transform:translateY(-50%);
  display:flex;align-items:center;gap:2px;margin:0;padding:0 2px;border:0;
  background:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 92%,transparent);border-radius:8px;
  /* 隐藏用 visibility 而不是只靠 opacity：visibility 是离散属性，没有过渡插值，
     读出来就是 hidden/visible 两态，不会出现「规则命中了但 opacity 还停在 0」
     那种过渡卡住的状态。visibility 隐藏时元素也不接收指针事件，正好两件事一起管。 */
  visibility:hidden;opacity:0;
  transition:opacity .18s ease,visibility 0s linear .18s}
.skm-skill-card:hover .skm-skill-card-foot,.skm-skill-card:focus-within .skm-skill-card-foot{
  visibility:visible;opacity:1;transition:opacity .18s ease,visibility 0s linear 0s}
/* 操作组落在第二行右列，与文件数同一格交接（文件数淡出、按钮淡入）。
   开关在第一行，两者互不遮挡，也不再靠「藏起开关」腾地方。 */
.skm-skill-card-foot .skm-skill-foot-icon{opacity:1;transition:opacity 200ms ease,background 140ms ease,color 140ms ease,transform 140ms ease}
.skm-skill-foot-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:8px;padding:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#61666b);transition:background 140ms ease,color 140ms ease,transform 140ms ease}
.skm-skill-foot-icon:hover{background:var(--dsw-alias-interactive-bg-hover-solid,#f1f3f5);color:var(--dsw-alias-label-primary,#0f1115);transform:scale(1.05)}
.skm-skill-foot-icon:active{transform:scale(.92)}
.skm-skill-foot-icon:disabled{opacity:.38;cursor:default}
.skm-skill-foot-icon:disabled:hover{background:transparent;color:var(--dsw-alias-label-secondary,#61666b);transform:none}
/* 内置技能的删除按钮：置灰 + 禁指针。hover 的红底一并压掉，否则鼠标停在
   一个点不动的按钮上还会亮危险色，比不禁用更误导。 */
.skm-skill-foot-icon:disabled{cursor:not-allowed;opacity:.32;transform:none}
.skm-skill-foot-icon:disabled:hover{background:transparent;color:var(--dsw-alias-label-secondary,#61666b)}
.skm-skill-card-actions{margin-left:auto;display:flex;align-items:center;gap:4px}

/* ── Skills Hub 页面骨架：概览 / 工具条 / 筛选 / 分组 / 卡片 ── */
.skm-hub{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;min-width:0;background:var(--dsw-alias-bg-base,#fff)}

/* ── 刊头（嵌入工作台）：大标题 + 右侧三格统计。独立座位仍走 psh-head，不重复画。 ── */
.skm-mast{flex:none;display:flex;align-items:flex-start;gap:14px;padding:26px 60px 16px}
.skm-mast-word{font-size:44px;font-weight:700;letter-spacing:-.045em;line-height:.96;color:var(--dsw-alias-label-primary,#14171b)}
.skm-mast-zh{font-size:12px;color:var(--dsw-alias-label-tertiary,#7b818a);letter-spacing:.44em;padding-top:20px}
.skm-mast-grow{flex:1}
.skm-mast-stats{display:flex;padding-top:4px}
.skm-mast-stat{padding:0 22px;border-right:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));text-align:left}
.skm-mast-stat:first-child{padding-left:0}
.skm-mast-stat:last-child{border-right:0;padding-right:0}
.skm-mast-stat b{display:block;font-size:27px;font-weight:700;letter-spacing:-.03em;line-height:1.1;color:var(--dsw-alias-label-primary,#14171b);font-variant-numeric:tabular-nums}
.skm-mast-stat span{display:block;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#7b818a);letter-spacing:.1em;margin-top:3px;white-space:nowrap}
@media (max-width:900px){.skm-mast{padding:18px 22px 12px;flex-wrap:wrap}.skm-mast-word{font-size:34px}.skm-mast-stats{margin-left:auto}}

/* ── 工具条：搜索 + 分类 + 全部展开，一条通栏，上下各一条实线 ── */
.skm-bar{flex:none;display:flex;align-items:center;gap:12px;padding:0 60px;height:52px;box-sizing:border-box;overflow:hidden;
  border-top:2px solid var(--dsw-alias-label-primary,#14171b);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.09))}
@media (max-width:900px){.skm-bar{padding:0 22px}}
.skm-search{flex:0 1 230px;display:flex;align-items:center;gap:7px;height:52px;min-width:140px}
.skm-search svg{flex:none;color:var(--dsw-alias-label-tertiary,#7b818a);transition:color .2s ease}
.skm-search:focus-within svg{color:var(--dsw-alias-state-business-primary,#3d6be5)}
.skm-search-input{flex:1;min-width:0;height:100%;border:0;background:none;padding:0;outline:none;font-family:inherit;font-size:13.5px;color:var(--dsw-alias-label-primary,#14171b)}
.skm-search-input::placeholder{color:var(--dsw-alias-label-tertiary,#7b818a)}
.skm-search-input::-webkit-search-cancel-button,.skm-search-input::-webkit-search-decoration{-webkit-appearance:none;appearance:none}
.skm-search-clear{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-label-primary,#14171b) 8%,transparent);color:var(--dsw-alias-label-secondary,#4c5158);cursor:pointer;transition:background .14s ease,transform .14s ease}
.skm-search-clear:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#14171b) 16%,transparent);transform:scale(1.06)}
.skm-bar-cats{flex:0 1 auto;display:flex;align-items:center;gap:0;flex-wrap:nowrap;min-width:0;overflow-x:auto;scrollbar-width:none}
.skm-bar-cats::-webkit-scrollbar{display:none}
.skm-bar-divider{flex:none;width:1px;height:14px;background:var(--dsw-alias-border-l2,rgba(0,0,0,.16));margin:0 2px}
.skm-filter-count{font-style:normal;font-size:10px;color:var(--dsw-alias-label-tertiary,#a3a7ad);margin-left:4px;font-variant-numeric:tabular-nums;letter-spacing:0}
.skm-bar-grow{flex:1}
.skm-bar-btn{flex:none;border:0;background:none;padding:5px 6px;font-family:inherit;font-size:12.5px;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#7b818a);cursor:pointer;letter-spacing:.03em;transition:color .16s ease}
.skm-bar-btn:hover{color:var(--dsw-alias-state-business-primary,#3d6be5)}
.skm-bar-btn[data-spin] svg{animation:skm-spin 720ms linear infinite}
.skm-bar-add{flex:none;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;white-space:nowrap;border:1px solid var(--dsw-alias-state-business-primary,#3d6be5);
  border-radius:4px;background:transparent;color:var(--dsw-alias-state-business-primary,#3d6be5);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;
  transition:background .16s ease,color .16s ease,transform .12s ease}
.skm-bar-add:hover{background:var(--dsw-alias-state-business-primary,#3d6be5);color:#fff}
.skm-bar-add:active{transform:scale(.97)}
@keyframes skm-spin{to{transform:rotate(360deg)}}
/* 状态筛选已并入工具条（分类右侧一条细分隔后），不再单独占一行 */
.skm-filter-tabs{flex-wrap:wrap;align-items:center;gap:8px 12px;display:flex}
.skm-filter-tabs-right{flex:none;flex-wrap:nowrap;align-items:center;gap:0;display:flex}
/* 纯文字 tab：选中用下划线，不用胶囊底（目录式排版里底块会读成按钮） */
.skm-filter-tab{position:relative;flex:none;display:inline-flex;align-items:center;height:26px;box-sizing:border-box;border:0;border-radius:2px;
  background:transparent;padding:0 8px;font-family:inherit;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-tertiary,#7b818a);
  white-space:nowrap;cursor:pointer;letter-spacing:.02em;transition:color 160ms ease,background 160ms ease}
.skm-filter-tab:hover{color:var(--dsw-alias-label-primary,#14171b);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 4%,transparent)}
.skm-filter-tab[data-active]{color:var(--dsw-alias-label-primary,#14171b);font-weight:600}
.skm-filter-tab[data-active]::after{content:"";position:absolute;left:10px;right:10px;bottom:1px;height:1.5px;background:var(--dsw-alias-label-primary,#14171b)}
.skm-filter-count{font-style:normal;font-size:10px;color:var(--dsw-alias-label-tertiary,#a3a7ad);margin-left:4px;font-variant-numeric:tabular-nums;letter-spacing:0}
.skm-filter-tab[data-active] .skm-filter-count{color:var(--dsw-alias-state-business-primary,#3d6be5)}
/* 添加技能卡 */
.skm-add-card{flex:none;display:flex;flex-direction:column;gap:8px;margin-top:18px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));border-radius:14px;background:var(--dsw-alias-bg-base,#fff);padding:12px;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.04);transition:border-color 140ms ease,box-shadow 140ms ease,transform 140ms ease}
.skm-add-card:hover{border-color:var(--dsw-alias-border-l3,rgba(0,0,0,.14));box-shadow:0 4px 14px rgba(16,24,40,.08)}
.skm-add-card-head{display:flex;align-items:center;gap:8px}
.skm-add-card-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;color:var(--dsw-alias-state-business-primary,#3d6be5);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#3d6be5) 12%,transparent)}
.skm-add-card-title{font-size:13px;font-weight:700;line-height:18px;color:var(--dsw-alias-label-primary,#1f2430)}
.skm-add-card-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#81858c)}
.skm-add-drop{flex:none;display:flex;flex-direction:column;align-items:center;gap:2px;border:1px dashed var(--dsw-alias-border-l3,rgba(0,0,0,.18));border-radius:10px;padding:12px 8px;color:var(--dsw-alias-label-tertiary,#81858c);background:var(--dsw-alias-bg-module-platform,#fafbfc);transition:border-color 140ms ease,background 140ms ease}
.skm-add-card:hover .skm-add-drop{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);background:#f5f8ff}
.skm-add-drop-text{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#61666b)}
.skm-add-drop-hint{font-size:10px;line-height:14px;color:var(--dsw-alias-label-caption,#adb2b8)}
.skm-add-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;height:32px;box-sizing:border-box;border:none;border-radius:9px;background:var(--dsw-alias-state-business-primary,#3d6be5);color:#fff;font-size:13px;font-weight:600;line-height:18px;font-family:inherit;padding:0 12px;cursor:pointer;box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent);transition:background 140ms ease,transform 140ms ease,box-shadow 140ms ease}
.skm-add-btn:hover{background:var(--dsw-alias-state-business-primary);box-shadow:0 2px 8px color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);transform:translateY(-1px)}
.skm-add-btn:active{transform:translateY(0) scale(.98)}
.skm-hub-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
/* 主区：单列整宽列表（与官方「自动化任务」页同构）。
   旧版是两列网格 —— 宽屏下每个技能包只占半屏，右侧留一大片空白，用户要求铺满。 */
.skm-main-scroll{flex:1;min-height:0;overflow-y:auto;padding:0 60px 40px;display:flex;flex-direction:column}
@media (max-width:900px){.skm-main-scroll{padding:0 22px 32px}}
.skm-hub-section{min-width:0}
.skm-main-scroll>.skm-status{flex:none}
.skm-hub-section{display:flex;flex-direction:column;min-width:0}
.skm-no-result{padding:18px 4px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#81858c)}

/* ── 归入技能包弹窗（卡片化，与技能卡片同语言） ─────────────── */
.skm-assign-modal{width:min(560px,calc(100vw - 48px))}
.skm-assign-modal-body{overflow:hidden;display:flex;flex-direction:column;max-height:min(560px,calc(100vh - 180px))}
.skm-assign-list{list-style:none;margin:0;padding:4px 2px 2px;display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.skm-assign-card{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:12px;background:var(--dsw-alias-bg-base,#fff);padding:10px 12px;cursor:pointer;font-family:inherit;text-align:left;opacity:0;animation:skm-card-in 240ms cubic-bezier(.2,.7,.3,1.06) forwards;animation-delay:calc(var(--skm-i,0)*45ms);transition:border-color 140ms ease,box-shadow 140ms ease,transform 140ms ease}
.skm-assign-card:hover{border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 2px 8px rgba(16,24,40,.07);transform:translateY(-1px)}
.skm-assign-card:active{transform:translateY(0) scale(.99)}
.skm-assign-card-icon{flex:none;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));border-radius:10px;background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b);transition:color 140ms ease,border-color 140ms ease}
.skm-assign-card:hover .skm-assign-card-icon{color:var(--dsw-alias-label-primary,#0f1115);border-color:var(--dsw-alias-border-l3,rgba(0,0,0,.14))}
.skm-assign-card-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.skm-assign-card-name{font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,#0f1115);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.skm-assign-card-desc{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#81858c)}
.skm-assign-go{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;color:var(--dsw-alias-label-caption,#adb2b8);transform:rotate(-90deg);transition:transform 160ms ease,background 140ms ease,color 140ms ease}
.skm-assign-card:hover .skm-assign-go{transform:rotate(-90deg) translateX(2px);color:var(--dsw-alias-state-business-primary,#4176e6);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.03))}
.skm-skill-files{list-style:none;margin:0 0 2px 10px;padding:2px 0 2px 10px;border-left:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));display:flex;flex-direction:column;gap:0}
.skm-skill-file{display:flex;align-items:center;gap:6px;padding:2px 6px;border-radius:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#bbb);font-family:ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skm-skill-file:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.skm-skill-file[data-main='true']{color:var(--dsw-alias-label-primary,#eee);font-weight:500}
/* 查看器默认就是大画幅（1280×880 上限，随视口收缩），可一键全屏；宽/高带缓动过渡。 */
.skm-viewer-modal{width:min(1280px,calc(100vw - 64px));animation:skm-viewer-in 260ms cubic-bezier(.2,.7,.3,1.06);transition:width 320ms cubic-bezier(.22,.72,.24,1)}
.skm-viewer-modal-full{width:calc(100vw - 48px)}
@keyframes skm-viewer-in{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
.skm-viewer-body{overflow:hidden;display:flex;flex-direction:column;height:min(880px,calc(100vh - 96px));transition:height 320ms cubic-bezier(.22,.72,.24,1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
/* 官方 Modal 的 root 自带 24px 内边距、dialog 自带 24px 下内边距：
   全屏档按这两处留白收，免得被 flex-shrink 截断或上下溢出。 */
.skm-viewer-modal-full .skm-viewer-body{height:calc(100vh - 76px)}
/* 弹窗头部（官方 Modal 的 header 是本容器第一个 div）：随大画幅放大一档。 */
.skm-viewer-body > div:first-child{padding:20px 18px 0 26px}
.skm-viewer-body > div:first-child h2{font-size:17px;line-height:26px;font-weight:600}
.skm-viewer-body > div:nth-of-type(2){flex:1;min-height:0;display:flex;flex-direction:column;margin-top:2px;padding:0 20px 20px}
.skm-viewer-toolbar{flex:none;display:flex;align-items:center;gap:10px;padding:0 2px 12px}
.skm-viewer-path{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font-size:12.5px;line-height:18px;font-family:ui-monospace,monospace;color:var(--dsw-alias-label-tertiary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skm-viewer-path b{font-weight:600;color:var(--dsw-alias-label-secondary,#61666b)}
.skm-viewer-tool-group{flex:none;display:inline-flex;align-items:center;gap:2px;padding:2px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));border-radius:10px;background:var(--dsw-alias-bg-module-platform,#f5f6f7)}
.skm-viewer-tool-btn{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:26px;padding:0 7px;box-sizing:border-box;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);font-family:inherit;font-weight:600;line-height:16px;cursor:pointer;transition:background 140ms ease,color 140ms ease,box-shadow 140ms ease,transform 140ms ease}
.skm-viewer-tool-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#1f2430)}
.skm-viewer-tool-btn:active{transform:scale(.93)}
.skm-viewer-tool-btn[data-active='true']{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 1px 3px rgba(16,24,40,.12)}
.skm-viewer-tool-btn-a1{font-size:11px}
.skm-viewer-tool-btn-a3{font-size:15px}
.skm-viewer-tool-btn-frame{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));border-radius:10px;background:var(--dsw-alias-bg-base,#fff)}
.skm-viewer-tool-btn-frame[data-active='true']{border-color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 10%,transparent);color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:none}
.skm-viewer-layout{flex:1;min-height:0;display:flex;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:14px;overflow:hidden}
.skm-viewer-nav{flex:none;width:252px;border-right:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));overflow-y:auto;padding:8px;box-sizing:border-box;background:var(--dsw-alias-bg-module-platform,#f5f6f7)}
.skm-viewer-nav-item{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:8px;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-secondary,#bbb);font-family:ui-monospace,monospace;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background 140ms ease,color 140ms ease,box-shadow 160ms ease}
.skm-viewer-nav-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.skm-viewer-nav-item[data-active='true']{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4a9eff) 14%,transparent);color:var(--dsw-alias-label-primary,#eee);box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary,#4a9eff)}
.skm-viewer-nav-dir{cursor:default;color:var(--dsw-alias-label-tertiary,#888)}
/* 正文全部走 em：--skm-vfs 一个变量驱动字号三档，切换时只过渡 font-size。 */
.skm-viewer-content{flex:1;min-width:0;overflow:auto;padding:26px 34px 48px;box-sizing:border-box;font-size:var(--skm-vfs,15px);line-height:1.75;color:var(--dsw-alias-label-primary,#eee);transition:font-size 180ms ease}
.skm-viewer-content > :first-child{margin-top:0}
.skm-viewer-content h1,.skm-viewer-content h2,.skm-viewer-content h3,.skm-viewer-content h4,.skm-viewer-content h5{margin:1.15em 0 .5em;line-height:1.35;font-weight:600;color:var(--dsw-alias-label-primary,#eee);max-width:84ch}
.skm-viewer-content h1{font-size:1.72em;letter-spacing:-.012em}
.skm-viewer-content h2{font-size:1.38em}
.skm-viewer-content h3{font-size:1.16em}
.skm-viewer-content h4,.skm-viewer-content h5{font-size:1.04em}
.skm-viewer-content p{margin:.62em 0;max-width:92ch}
.skm-viewer-content pre{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));border-radius:10px;padding:14px 16px;overflow:auto;font-family:ui-monospace,monospace;font-size:.86em;line-height:1.7;color:var(--dsw-alias-label-secondary,#bbb)}
.skm-viewer-content code{background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));border-radius:5px;padding:1px 5px;font-family:ui-monospace,monospace;font-size:.86em}
.skm-viewer-content pre code{background:transparent;padding:0}
.skm-viewer-content a{color:var(--dsw-alias-state-business-primary,#4a9eff)}
.skm-viewer-content ul,.skm-viewer-content ol{margin:.62em 0;padding-left:1.6em}
.skm-viewer-content li{margin:.32em 0;max-width:92ch}
.skm-viewer-content blockquote{margin:.9em 0;padding:.25em 1em;border-left:3px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));color:var(--dsw-alias-label-secondary,#bbb);max-width:82ch}
.skm-viewer-content hr{border:none;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));margin:1.5em 0}
/* ── 二进制文件预览（图片 / 音视频 / PDF）──
   内容区原来是纯文本流，塞 <img> 会被 markdown 样式挤成行内元素；
   这里单独一块棋盘底 + 居中弹性布局，大图自带缩放提示。 */
.skm-viewer-media{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-height:100%;padding:8px 0}
.skm-viewer-media img{max-width:100%;max-height:calc(88vh - 210px);height:auto;border-radius:10px;box-shadow:0 6px 28px rgba(0,0,0,.16);background:
  repeating-conic-gradient(var(--dsw-alias-bg-module-platform,rgba(0,0,0,.04)) 0% 25%,transparent 0% 50%) 50%/18px 18px;
  animation:skm-media-in 220ms cubic-bezier(.2,.7,.3,1)}
@keyframes skm-media-in{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}
.skm-viewer-media video,.skm-viewer-media audio{max-width:100%;border-radius:10px;outline:none}
.skm-viewer-media video{max-height:calc(88vh - 210px);background:#000}
.skm-viewer-media iframe{width:100%;height:calc(88vh - 210px);min-height:420px;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:12px;background:#fff}
/* markdown 正文里的插图（SKILL.md 用 ![](assets/x.png) 引用的相对图片） */
.skm-viewer-content img{max-width:100%;height:auto;border-radius:8px;margin:.7em 0;vertical-align:middle}
.skm-viewer-media-note{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.skm-viewer-media-open{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;box-sizing:border-box;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));background:transparent;color:var(--dsw-alias-label-secondary,#bbb);
  font-size:12px;cursor:pointer;text-decoration:none;transition:background 140ms ease,color 140ms ease,transform 140ms ease}
.skm-viewer-media-open:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#eee)}
.skm-viewer-media-open:active{transform:scale(.96)}
.skm-loose-empty{margin:2px;padding:4px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#888)}
.skm-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ── 技能开关：由 iOS 拨杆改为「圆点」状态标记 ────────────────────────
   2026-10-23 改。理由是同一条视觉纪律：目录式版面里没有任何胶囊控件，
   一排 iOS 拨杆是整页唯一的「现代控件」，与发丝线＋小圆点的语言打架，
   而且它在展开态一行一个、视觉重量远超条目本身。
   现在与包级开关（.skm-toggle-dot / 设计稿 .tog .dt）共用同一种表达：
     关 = 空心圆环；开 = 实心主色圆点 + 一圈 14% 的光晕。
   仍是真 <button role="switch">，键盘可达、aria-checked 不变。 */
.skm-toggle{flex:none;position:relative;display:inline-flex;align-items:center;justify-content:center;
  width:22px;height:22px;box-sizing:border-box;padding:0;appearance:none;border:0;background:none;cursor:pointer;
  border-radius:50%;transition:background 160ms ease}
.skm-toggle:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#14171b) 6%,transparent)}
.skm-toggle:active .skm-toggle-knob{transform:scale(.85)}
.skm-toggle:disabled{opacity:.4;cursor:not-allowed;background:none}
.skm-toggle:disabled:active .skm-toggle-knob{transform:none}
.skm-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}
/* 圆点本体：关=空心环，开=实心+光晕；transition 让切换有「点亮」的手感 */
.skm-toggle-knob{display:block;width:7px;height:7px;box-sizing:border-box;border-radius:50%;
  background:transparent;box-shadow:inset 0 0 0 1.5px var(--dsw-alias-border-l3,rgba(0,0,0,.26));
  transition:background .22s ease,box-shadow .26s ease,transform .18s cubic-bezier(.3,1.4,.5,1)}
.skm-toggle-on .skm-toggle-knob{background:var(--dsw-alias-state-business-primary,#4176e6);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent)}
.skm-toggle-off .skm-toggle-knob{background:transparent;
  box-shadow:inset 0 0 0 1.5px var(--dsw-alias-border-l3,rgba(0,0,0,.26))}
.skm-bundle-toggle{flex:none;display:inline-flex;align-items:center;gap:4px;margin-left:0}

/* ── 面板级提示条：删除/归组/改名/安装的成败都要让用户看见 ── */
.skm-toast-stack{position:absolute;right:18px;bottom:18px;z-index:6;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none}
.skm-toast{display:inline-flex;align-items:center;gap:8px;max-width:min(460px,72vw);box-sizing:border-box;padding:8px 14px;border-radius:10px;font-size:12.5px;line-height:18px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-static-neutral-bluish-00,#fff);color:var(--dsw-alias-label-primary,#222);box-shadow:var(--dsw-shadow-lv2,0 6px 22px rgba(0,0,0,.16));animation:skm-toast-in 260ms cubic-bezier(.2,.9,.25,1) both}
.skm-toast-ok{border-color:rgba(35,160,90,.38);color:#1c7a45}
.skm-toast-err{border-color:rgba(226,80,64,.42);color:#b3271c}
.skm-toast-dot{flex:none;width:6px;height:6px;border-radius:50%;background:currentColor;animation:skm-toast-ping 1.7s ease-out infinite}
@keyframes skm-toast-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
@keyframes skm-toast-ping{0%{box-shadow:0 0 0 0 currentColor;opacity:.9}70%{box-shadow:0 0 0 7px rgba(0,0,0,0);opacity:.35}100%{box-shadow:0 0 0 0 rgba(0,0,0,0);opacity:1}}
body[data-ds-dark-theme] .skm-toast{background:var(--dsw-static-neutral-bluish-850,#2c2c2e)}
body[data-ds-dark-theme] .skm-toast-ok{color:#6ee7a8}
body[data-ds-dark-theme] .skm-toast-err{color:#ff8a7a}

/* ── 空技能包：可见 + 可操作（旧实现把 0 成员的包整段过滤掉，建完包就「消失」） ── */
.skm-bundle-empty{grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap;box-sizing:border-box;margin:2px 0 6px;padding:14px 16px;border:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.18));border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.02));animation:skm-fade-up 260ms ease both}
.skm-bundle-empty-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#333)}
.skm-bundle-empty-hint{flex:1 1 200px;min-width:160px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b9099)}
.skm-bundle-empty-btn{flex:none;display:inline-flex;align-items:center;gap:6px;appearance:none;border:1px solid var(--dsw-alias-state-business-primary,#4176e6);border-radius:9px;padding:5px 12px;font-size:12px;line-height:18px;font-family:inherit;cursor:pointer;color:var(--dsw-alias-state-business-primary,#4176e6);background:transparent;transition:background 160ms ease,color 160ms ease,transform 160ms ease,box-shadow 160ms ease}
.skm-bundle-empty-btn:hover{background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff;transform:translateY(-1px);box-shadow:0 4px 14px color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent)}
.skm-bundle-empty-btn:active{transform:translateY(0)}
@keyframes skm-fade-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* ── 账本失效引用：明说「包里有指向已删除技能的条目」并一键清理 ── */
.skm-bundle-missing{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:2px 0 6px;padding:8px 12px;border-radius:10px;border:1px solid rgba(240,150,40,.38);background:rgba(240,150,40,.09);font-size:12px;line-height:18px;color:#8a5a12;animation:skm-fade-up 260ms ease both}
.skm-bundle-missing code{padding:1px 6px;border-radius:5px;background:rgba(240,150,40,.16);font-size:11.5px}
.skm-bundle-missing-btn{appearance:none;border:1px solid rgba(240,150,40,.55);background:transparent;border-radius:8px;padding:2px 9px;font-size:11.5px;line-height:18px;font-family:inherit;cursor:pointer;color:inherit;transition:background 140ms ease,transform 140ms ease}
.skm-bundle-missing-btn:hover{background:rgba(240,150,40,.2);transform:translateY(-1px)}
body[data-ds-dark-theme] .skm-bundle-missing{color:#f0c48a}
.skm-install-hint{margin:2px 0 0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#8b9099)}

/* ── 移动端：侧栏收窄/隐藏、查看器上下堆叠、卡片网格单列 ───────── */
@media (max-width: 767.98px) {
  .skm-viewer-modal,.skm-viewer-modal-full{width:calc(100vw - 48px)}
  .skm-viewer-body,.skm-viewer-modal-full .skm-viewer-body{height:calc(100vh - 76px)}
  .skm-viewer-body > div:nth-of-type(2){padding:0 10px 10px}
  .skm-viewer-toolbar{flex-wrap:wrap;gap:6px;padding-bottom:8px}
  .skm-viewer-layout{flex-direction:column}
  .skm-viewer-nav{width:100%;border-right:none;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex:none;max-height:38%}
  .skm-viewer-content{flex:1;min-height:0;padding:16px 14px 28px}
  .skm-skill-grid{grid-template-columns:minmax(0,1fr)}
  .skm-main-scroll{padding:12px 12px 20px}
}

/* ── 减弱动效：卡片入场/悬停位移与开关回弹全部收敛 ───────────── */
@media (prefers-reduced-motion: reduce) {
  .skm-skill-card{animation:none;opacity:1;transition:none}
  .skm-assign-card{animation:none;opacity:1;transition:none}
  .skm-viewer-modal{animation:none}
  .skm-viewer-modal,.skm-viewer-body,.skm-viewer-content,.skm-viewer-nav-item,.skm-viewer-tool-btn{transition:none}
  .skm-toggle-knob{transition:none}
  .skm-toggle{transition:none}
  .skm-tag{transition:none}
  .skm-skill-foot-icon,.skm-assign-card{transition:none}
  .skm-toast{animation:none}
  .skm-toast-dot{animation:none}
  .skm-bundle-empty,.skm-bundle-missing{animation:none}
  .skm-bundle-empty-btn,.skm-bundle-missing-btn{transition:none}
  .skm-skill-card::before,.skm-skill-badge,.skm-skill-title,.skm-tag-status{transition:none}
  /* hover 竖线现在是 ::before（::after 是旧卡片状态的残留，已随样式一起删掉） */
  .skm-skill-card::before,.skm-skill-card-foot,.skm-skill-meta,.skm-skill-card-toggle{transition:none}
  .skm-bundle-cat-tag,.skm-cat-selected-tag{animation:none}
  .skm-bundle-cat-tag,.skm-cat-preset,.skm-cat-remove,.skm-cat-input,.skm-filter-tab{transition:none}
  /* 减弱动效：竖线不靠 scaleY 过渡出场，hover 时直接切换可见性；
     操作组同理，按钮切换不做淡入淡出（但仍需 hover 才出现，避免常驻占位）。 */
  .skm-skill-card:hover::before,.skm-skill-card:focus-within::before{transition:none}
  .skm-toggle-knob,.skm-toggle{transition:none}
  .skm-viewer-media img{animation:none}
  .skm-viewer-media-open{transition:none}
}
`

function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = SHEET
  document.head.appendChild(tag)
}

/** ---------------------------------------------------------------- 文件收集 */

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

interface CollectedFile { path: string; file: File }

async function collectEntry(entry: FileSystemEntry, prefix: string, out: CollectedFile[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    const file = await readEntryFile(fileEntry)
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    out.push({ path, file })
    return
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    const all: FileSystemEntry[] = []
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject)
      })
      if (batch.length === 0) break
      all.push(...batch)
    }
    const nextPrefix = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    for (const child of all) await collectEntry(child, nextPrefix, out)
  }
}

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 32768
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
    }
    return btoa(binary)
  })
}


/** ---------------------------------------------------------------- 查看器偏好 */

const VIEWER_FONT_SIZES = [13.5, 15, 17]
const VIEWER_PREF_KEY = 'dsh.triad.skillViewer'
/** 三档字号的悬浮文案（与 VIEWER_FONT_SIZES 一一对应）。 */
const VIEWER_FONT_LABELS = ['小字号', '标准字号', '大字号']

interface ViewerPrefs { font: number; full: boolean }

/** 读查看器偏好（字号 + 全屏）；localStorage 不可用时回落到默认值。 */
function readViewerPrefs(): ViewerPrefs {
  try {
    const raw = localStorage.getItem(VIEWER_PREF_KEY)
    if (typeof raw !== 'string' || raw === '') return { font: 1, full: false }
    const parsed = JSON.parse(raw) as Partial<ViewerPrefs>
    const font = typeof parsed.font === 'number' && parsed.font >= 0 && parsed.font < VIEWER_FONT_SIZES.length
      ? Math.trunc(parsed.font)
      : 1
    return { font, full: parsed.full === true }
  } catch {
    return { font: 1, full: false }
  }
}

/** 写查看器偏好；隐私模式等写入失败时静默降级为「只活到本次刷新」。 */
function writeViewerPrefs(prefs: ViewerPrefs): void {
  try { localStorage.setItem(VIEWER_PREF_KEY, JSON.stringify(prefs)) } catch { /* 忽略 */ }
}

/** 全屏 / 还原：对角箭头，状态切换时靠 CSS 过渡翻转。 */
function ViewerExpandIcon({ full }: { full: boolean }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {full
        ? <path d="M6.2 2.2v4h-4M9.8 2.2v4h4M6.2 13.8v-4h-4M9.8 13.8v-4h4" />
        : <path d="M2.2 6.2v-4h4M13.8 6.2v-4h-4M2.2 9.8v4h4M13.8 9.8v4h-4" />}
    </svg>
  )
}

interface ViewRow { kind: 'dir' | 'file'; path: string; depth: number; main: boolean }

function skillFileRows(files: string[]): ViewRow[] {
  const rows: ViewRow[] = []
  const seenDirs = new Set<string>()
  for (const path of files) {
    const parts = path.split('/')
    let dirPath = ''
    for (let i = 0; i < parts.length - 1; i += 1) {
      dirPath = dirPath === '' ? parts[i] : dirPath + '/' + parts[i]
      if (!seenDirs.has(dirPath)) {
        seenDirs.add(dirPath)
        rows.push({ kind: 'dir', path: dirPath + '/', depth: i, main: false })
      }
    }
    rows.push({ kind: 'file', path, depth: parts.length - 1, main: path === 'SKILL.md' })
  }
  return rows
}


/**
 * 二进制技能文件预览。
 *
 * 按族分派到浏览器原生元素：图片 <img>、视频 <video controls>、音频 <audio controls>、
 * PDF <iframe>（浏览器自带查看器）。其余二进制（zip / 字体 / wasm）不给渲染器，
 * 只报「不是纯文本」并给一个在新标签打开的原生链接 —— 硬塞进文本流就是乱码。
 *
 * 全部走 host 的 raw 子路由：字节原样返回，浏览器负责解码与缓存，不经 base64。
 *
 * @param viewer - 当前查看器状态（含 skill / file / mime / size）。
 */
function SkillBinaryPreview({ viewer }: { viewer: ViewerState }): JSX.Element {
  const kind = mediaKindOf(viewer.file)
  const url = skillRawUrl(viewer.skill.name, viewer.file)
  const sizeText = formatBytes(viewer.size)
  /**
   * `resourceError`：raw 请求真的失败了（最常见的原因是 host 半身还没重启，
   * 路由仍是旧的）。有它就把裂图换成人话，别让用户对着一个破图标猜。
   */
  const [resourceError, setResourceError] = useState(false)
  useEffect(() => { setResourceError(false) }, [url])
  const onError = (): void => { setResourceError(true) }

  const note = (
    <div className={css.viewerMediaNote}>
      <span>{[sizeText, viewer.mime ?? ''].filter((part) => part !== '').join(' · ')}</span>
      <a className={css.viewerMediaOpen} href={url} download target="_blank" rel="noreferrer">
        {skillT('previewOpenTab')}
      </a>
    </div>
  )

  if (resourceError) {
    return (
      <div className={css.viewerMedia}>
        <p>{skillT('previewLoadFailed')}</p>
        {note}
      </div>
    )
  }
  if (kind === 'image') {
    return (
      <div className={css.viewerMedia}>
        <img src={url} alt={skillT('previewImageAlt', { name: viewer.file })} loading="lazy" decoding="async" onError={onError} />
        {note}
      </div>
    )
  }
  if (kind === 'video') {
    return (
      <div className={css.viewerMedia}>
        <video src={url} controls preload="metadata" onError={onError} />
        {note}
      </div>
    )
  }
  if (kind === 'audio') {
    return (
      <div className={css.viewerMedia}>
        <audio src={url} controls preload="metadata" onError={onError} />
        {note}
      </div>
    )
  }
  if (kind === 'pdf') {
    return (
      <div className={css.viewerMedia}>
        <iframe src={url} title={viewer.file} />
        {note}
      </div>
    )
  }
  return (
    <div className={css.viewerMedia}>
      <p>{skillT('previewNotText')}</p>
      {note}
    </div>
  )
}

/** 复制图标（Feather copy，线性描边，与导航手绘图标同风）。 */
function CopyIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/** 完成勾图标（Feather check）。 */
function CheckIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function TagIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  )
}

function CategoryEditor({ value, onChange, label }: {
  value: string[]
  onChange: (next: string[]) => void
  label: string
}): JSX.Element {
  const [draft, setDraft] = useState('')
  const full = value.length >= MAX_BUNDLE_CATEGORIES
  const add = (raw: string): void => {
    const name = raw.trim().slice(0, 24)
    setDraft('')
    if (name === '' || value.includes(name) || full) return
    onChange([...value, name])
  }
  return (
    <div className={css.catEditor}>
      {value.length === 0 ? (
        <p className={css.catEmpty}>{skillT('bundleCatEmptyHint')}</p>
      ) : (
        <ul className={css.catSelected} aria-label={label}>
          {value.map((name) => (
            <li key={name} className={css.catSelectedTag}>
              <span className={css.catSelectedName}>{name}</span>
              <button
                type="button"
                className={css.catRemove}
                aria-label={skillT('bundleCatRemove', { name })}
                onClick={() => { onChange(value.filter((item) => item !== name)) }}
              >
                <IconCloseOutline16 size={11} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={css.catSuggest} role="group" aria-label={skillT('bundleCatTitle')}>
        {PRESET_BUNDLE_CATEGORIES.filter((preset) => !value.includes(preset)).map((preset) => (
          <button
            type="button"
            key={preset}
            className={css.catPreset}
            disabled={full}
            title={skillT('bundleCatAddPreset', { name: preset })}
            onClick={() => { add(preset) }}
          >
            <span className={css.catPresetPlus} aria-hidden="true">+</span>{preset}
          </button>
        ))}
      </div>
      <input
        className={css.catInput}
        value={draft}
        placeholder={skillT('bundleCatPlaceholder')}
        aria-label={skillT('bundleCatCustom')}
        disabled={full}
        onChange={(event) => { setDraft(event.currentTarget.value) }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(draft) } }}
      />
      {full && <p className={css.catLimit}>{skillT('bundleCatLimit', { n: MAX_BUNDLE_CATEGORIES })}</p>}
    </div>
  )
}

function SkillCard({ skill, bundleId, bundleName, enabled, scopeLabel, index, onToggle, onView, onAssign, onRemove, onDelete }: {
  skill: SkillInfo
  bundleId: string | null
  bundleName: string | null
  enabled: boolean
  /** 作用域 pill 文案：技能开关落在 SKILL.md frontmatter，恒为全局层。 */
  scopeLabel: string
  /** 网格序号：入场错峰动画延时。 */
  index: number
  onToggle: (skill: SkillInfo, enabled: boolean) => void
  onView: (skill: SkillInfo, file?: string) => void
  onAssign?: (skill: SkillInfo) => void
  onRemove?: (skill: SkillInfo) => void
  onDelete?: (skill: SkillInfo) => void
}): JSX.Element {
  const files = Array.isArray(skill.files) ? skill.files : []
  const description = skill.description ?? ''
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
  }, [])

  const flashCopied = (): void => {
    setCopied(true)
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => { setCopied(false) }, 1200)
  }
  /** 复制技能名：主用 clipboard API，回退一个隐藏 textarea + execCommand。 */
  const copyName = (): void => {
    const fallback = (): void => {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = skill.name
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      } catch {
        /* 复制失败静默：按钮仍给出已复制反馈，无副作用。 */
      }
    }
    try {
      if (navigator.clipboard !== undefined) {
        void navigator.clipboard.writeText(skill.name).then(flashCopied, () => { fallback(); flashCopied() })
      } else {
        fallback()
        flashCopied()
      }
    } catch {
      fallback()
      flashCopied()
    }
  }

  const toggleLabel = enabled ? skillT('disableSkill') : skillT('enableSkill')
  const fileMeta = typeof skill.fileCount === 'number' ? skill.fileCount : files.length
  /** 卡片内文件树展开态（效果图「展开技能文件」；有文件才给入口）。 */
  const [filesOpen, setFilesOpen] = useState(false)
  const canExpand = files.length > 0
  return (
    <li
      className={css.skillCard}
      data-off={enabled ? undefined : 'true'}
      style={{ '--skm-i': index } as CSSProperties}
    >
      <div className={css.skillCardHead}>
        <span className={css.skillBadge} aria-hidden="true">skill</span>
        <button
          type="button"
          className={css.skillTitle}
          title={skill.name}
          onClick={() => { onView(skill) }}
        >
          {skill.name}
        </button>
      </div>
      {description !== '' && (
        <button type="button" className={css.skillDesc} title={description} onClick={() => { onView(skill) }}>{description}</button>
      )}
      {/* 标记行：整块隐藏（见样式注释），但「N 文件」要留下——它是右列那一格的唯一内容，
          设计稿 .sf 就是它。之前它挂在这个 div 里，跟着 display:none 一起消失了，
          右侧变成一片空白，行读起来像「只有名字和描述」。改成与标记行平级的独立节点。 */}
      <div className={css.skillTags}>
        <span className={`${css.tag} ${css.tagSource}`}>{bundleName ?? skillT('tagLoose')}</span>
        <span className={`${css.tag} ${css.tagScope}`} data-off={enabled ? undefined : 'true'}>{scopeLabel}</span>
        {skill.builtin === true && <span className={`${css.tag} ${css.tagBuiltin}`}>{skillT('builtinTag')}</span>}
        {!enabled && <span className={`${css.tag} ${css.tagStatus}`}>{skillT('skillOffTag')}</span>}
      </div>
      <span className={css.skillMeta}>{skillT('fileCount', { n: fileMeta })}</span>
      {/* 展开技能文件：卡内文件树（只读，点文件名进查看器）。默认收起，
          只对有文件的技能给入口——空文件列表展开出一条空轨道毫无意义。 */}
      {filesOpen && canExpand && (
        <ul className={css.skillFiles}>
          {files.map((file) => (
            <li key={file}>
              <button
                type="button"
                className={css.skillFile}
                data-main={file === 'SKILL.md' ? 'true' : undefined}
                title={file}
                onClick={() => { onView(skill, file) }}
              >
                <IconCodeOutline16 size={12} aria-hidden="true" />
                {file}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={css.skillCardFoot}>
        <div className={css.skillCardActions}>
          {/* 开关放在操作组第一位：目录行默认只显示「名称 + 描述 + 文件数」，
              开关跟着操作组一起在 hover / 键盘聚焦时浮出，行才能压到设计稿的密度。
              它仍然是真 <button role="switch">，键盘 Tab 可达；而 hover 本来就要先
              进出这一行，浮出后鼠标就停在那里，点得动（上一轮的回归正是因为它
              浮出后又被 hover 规则隐藏，这里只浮出、不隐藏）。 */}
          <Tooltip label={toggleLabel} side="bottom" delayMs={500}>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={toggleLabel}
              title={toggleLabel}
              className={`${css.toggle} ${enabled ? css.toggleOn : css.toggleOff}`}
              onClick={(event) => {
                event.stopPropagation()
                onToggle(skill, !enabled)
              }}
            >
              <span className={css.toggleKnob} aria-hidden="true" />
            </button>
          </Tooltip>
          {canExpand && (
            <Tooltip label={skillT('expandSkillFiles')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.skillFootIcon}
                data-open={filesOpen ? 'true' : undefined}
                aria-expanded={filesOpen}
                aria-label={skillT('expandSkillFiles')}
                title={skillT('expandSkillFiles')}
                onClick={() => { setFilesOpen((value) => !value) }}
              >
                <IconChevronDownOutline14 size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
          <Tooltip label={skillT('copySkillName')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.skillFootIcon}
              data-copied={copied ? 'true' : undefined}
              aria-label={copied ? skillT('copiedSkillName') : skillT('copySkillName')}
              title={copied ? skillT('copiedSkillName') : skillT('copySkillName')}
              onClick={copyName}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </Tooltip>
          {bundleId !== null ? (
            <Tooltip label={skillT('removeSkill')} side="bottom" delayMs={500}>
              <button type="button" className={css.skillFootIcon} aria-label={skillT('removeSkill')}
                title={skillT('removeSkill')} onClick={() => { onRemove?.(skill) }}>
                <IconCloseOutline16 size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          ) : (
            <Tooltip label={skillT('assignToBundle')} side="bottom" delayMs={500}>
              <button type="button" className={css.skillFootIcon} aria-label={skillT('assignToBundle')}
                title={skillT('assignToBundle')} onClick={() => { onAssign?.(skill) }}>
                <IconPlusOutline16 size={14} aria-hidden="true" />
              </button>
            </Tooltip>
          )}
          <Tooltip label={skill.builtin === true ? skillT('builtinNotDeletable') : skillT('deleteSkillBtn')} side="bottom" delayMs={500}>
            <button type="button" className={`${css.skillFootIcon} ${css.skillFootIconDanger}`}
              aria-label={skillT('deleteSkillBtn')} title={skill.builtin === true ? skillT('builtinNotDeletable') : skillT('deleteSkillBtn')}
              disabled={skill.builtin === true}
              onClick={() => { onDelete?.(skill) }}>
              <IconTrashOutline16 size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
    </li>
  )
}

/** ---------------------------------------------------------------- 面板 */

type ConfirmState =
  | { kind: 'bundle'; bundle: BundleInfo }
  | { kind: 'skill'; name: string; dir?: string }
type InstallState =
  | { archive: true; name: string; data: string; folderName: string }
  | { archive?: false; files: CollectedFile[]; folderName: string }
/**
 * 查看器状态。
 *
 * `binary` 是 2026-10-20 补的：原来所有文件都按 markdown 渲染，二进制文件被
 * host 当 UTF-8 解码后（再叠加 markdown 渲染）就是满屏乱码。现在 host 会带出
 * `binary` / `mime` / `size`，客户端按类型分派到 <img> / <video> / <audio> /
 * <iframe>（PDF），只有真文本才走 markdown。
 */
type ViewerState = {
  skill: SkillInfo
  file: string
  loading: boolean
  error?: string
  content?: string
  binary?: boolean
  mime?: string
  size?: number
}

const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * 收起态每个包最多显示几行技能。
 *
 * 设计稿 dir-1 用的是 6（`list.slice(0, 6)`）；这里取 8，因为插件的技能行是
 * 「名称 + 单行描述」的紧凑两行，8 行在 3 列下正好排满一屏可见区域，
 * 再多就会把下一个包挤出视野，用户反而要点「还有 N 个」才能看到别的包。
 */
const COLLAPSED_ROWS = 8

/** 从 SKILL.md 文本里取 frontmatter 的 name（安装弹窗预览真实技能名用）。 */
function frontmatterName(text: string): string | null {
  const lines = text.split(/\r?\n/).slice(0, 80)
  if ((lines[0] ?? '').trim() !== '---') return null
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break
    const pair = /^\s*name\s*:\s*(.+?)\s*$/.exec(line)
    if (pair !== null) return (pair[1] ?? '').replace(/^["']|["']$/g, '')
  }
  return null
}

export function SkillsPanel({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }): JSX.Element {
  ensureStyles()
  const [state, setState] = useState<PanelState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  // 分区展开集合：默认空 = 全部收起（面板打开时只显示技能包标题行）。
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // 散装技能区展开。
  const [looseOpen, setLooseExpanded] = useState(false)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  /** 查看器偏好：字号档位 + 是否全屏（localStorage 持久化，跨会话记住）。 */
  const [viewerFont, setViewerFont] = useState<number>(() => readViewerPrefs().font)
  const [viewerFull, setViewerFull] = useState<boolean>(() => readViewerPrefs().full)
  const [assignTarget, setAssignTarget] = useState<SkillInfo | null>(null)
  const [newBundleOpen, setNewBundleOpen] = useState(false)
  const [newBundleName, setNewBundleName] = useState('')
  /** 新建技能包弹窗里同时挂的分类。 */
  const [newBundleCats, setNewBundleCats] = useState<string[]>([])
  const [creatingBundle, setCreatingBundle] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ bundleId: string; name: string } | null>(null)
  const [renaming, setRenaming] = useState(false)
  // 改名成功的卡片 id：触发一次高亮脉冲，随后自动清除。
  const [renamedFlash, setRenamedFlash] = useState<string | null>(null)
  const renamedTimer = useRef<number | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [install, setInstall] = useState<InstallState | null>(null)
  /** 添加技能弹窗开关（选完文件后同一弹窗内填表单）。 */
  const [addOpen, setAddOpen] = useState(false)
  const [installName, setInstallName] = useState('')
  const [installDescription, setInstallDescription] = useState('')
  const [installBundleId, setInstallBundleId] = useState<string | undefined>(undefined)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  /**
   * 面板级提示条。旧实现把所有失败都塞进 installError，而它只在「添加技能」弹窗里
   * 渲染 —— 于是删除技能、归组、改名、开关失败时面板上什么都不显示，用户只看到
   * 「点了没反应」。成败反馈统一走这里。
   */
  const [toasts, setToasts] = useState<Array<{ id: number; tone: 'ok' | 'err'; text: string }>>([])
  const toastTimers = useRef<number[]>([])
  const pushToast = (tone: 'ok' | 'err', text: string): void => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current.slice(-2), { id, tone, text }])
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
    }, tone === 'err' ? 6400 : 2800)
    toastTimers.current.push(timer)
  }
  /** 统一失败提示：label 说清是哪一步，message 用 host 原文。 */
  const failToast = (label: string, error: unknown): void => {
    pushToast('err', skillT('opFailed', { label, message: error instanceof Error ? error.message : String(error) }))
  }
  /** 文件夹导入时 SKILL.md 里写的技能名：与用户填的名字不一致时提前说明会改写。 */
  const [installMetaName, setInstallMetaName] = useState<string | null>(null)
  useEffect(() => {
    if (install === null || install.archive === true) { setInstallMetaName(null); return undefined }
    const entry = install.files.find((item) => item.path === 'SKILL.md')
    if (entry === undefined) { setInstallMetaName(null); return undefined }
    let current = true
    void entry.file.text().then((text) => {
      if (!current) return
      setInstallMetaName(frontmatterName(text))
    }, () => { if (current) setInstallMetaName(null) })
    return () => { current = false }
  }, [install])
  const [dropActive, setDropActive] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // 技能/技能包开关状态（skillName → enabled；bundleId → enabled）
  const [toggles, setToggles] = useState<{ skills: Record<string, boolean>; bundles: Record<string, boolean> }>({ skills: {}, bundles: {} })
  // 切换进行中的 key（避免重复点击）
  const [toggling, setToggling] = useState<Set<string>>(new Set())
  /** 启用状态筛选：全部 / 已启用 / 已停用。 */
  const [statusFilter, setStatusFilter] = useState<'all' | 'on' | 'off'>('all')
  /** 技能库搜索词：匹配包名 / 分类 / 技能名 / 技能描述。 */
  const [query, setQuery] = useState('')
  /** 工具条刷新钮的短暂旋转态（真实取数在 refresh()，这里只做点击反馈）。 */
  const [refreshing, setRefreshing] = useState(false)
  /** 「全部展开 / 全部收起」总开关：true 时所有包都按展开渲染（不再逐个 toggle）。 */
  const [allOpen, setAllOpen] = useState(false)
  /** 技能包分类筛选：null = 不筛；分类名或 UNCATEGORIZED = 只看该类。 */
  const [catFilter, setCatFilter] = useState<string | null>(null)
  /** 「设置分类」弹窗的目标包（null = 关）；catDraft 是弹窗内的编辑副本。 */
  const [catTarget, setCatTarget] = useState<{ bundleId: string; name: string } | null>(null)
  const [catDraft, setCatDraft] = useState<string[]>([])
  const [savingCats, setSavingCats] = useState(false)
  /** 自定义下拉/菜单：来源筛选 / Agent 预设 / 名称排序 / 快捷筛选 / 行内更多菜单（哪个开着，null = 都关）。 */
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const refresh = (): void => {
    // 技能目录变更后,同步失效 skill-source 的 slash 菜单快照缓存。
    void import('../../skill-source').then(({ invalidateSkillCache }) => invalidateSkillCache())
    setReload((value) => value + 1)
  }

  /** 静默同步：不置 loading，直接替换数据（自动同步机制用）。 */
  const silentSync = (): void => {
    void import('../../skill-source').then(({ invalidateSkillCache }) => invalidateSkillCache())
    void skillApi.list().then((snapshot) => {
      setState((current) => current.status === 'error'
        ? current
        : { status: 'ready', snapshot })
    }, () => { /* 保持当前显示 */ })
    void skillApi.toggleStatus().then((status) => { setToggles(status) }, () => { /* 保持当前显示 */ })
  }

  /** 自动同步机制：面板打开期间 30s 轮询 + 页面重新可见/聚焦立即刷新（不闪烁）。 */
  useEffect(() => {
    const timer = window.setInterval(silentSync, 30_000)
    const onVis = (): void => { if (document.visibilityState === 'visible') silentSync() }
    const onFocus = (): void => { silentSync() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 开关切换后静默同步:仅失效 slash 缓存并重拉开关状态,不重载整个面板(避免闪烁)。 */
  const refreshTogglesOnly = (): void => {
    void import('../../skill-source').then(({ invalidateSkillCache }) => invalidateSkillCache())
    void skillApi.toggleStatus().then((status) => { setToggles(status) }, () => { /* 保持当前显示 */ })
  }

  const t = skillT

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void skillApi.list().then(
      (snapshot) => {
        if (current) setState({ status: 'ready', snapshot })
      },
      () => {
        if (current) setState({ status: 'error' })
      },
    )
    void skillApi.toggleStatus().then(
      (status) => { if (current) setToggles(status) },
      () => { /* 开关接口也不可用时保持空状态（开关仍可操作,失败会提示）。 */ },
    )
    return () => { current = false }
    // reload 拆分为变化键；open 恒 true（本组件在打开时才渲染）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])

  // 卸载时清掉改名高亮与提示条定时器，避免卸载后 setState。
  useEffect(() => () => {
    if (renamedTimer.current !== null) window.clearTimeout(renamedTimer.current)
    for (const timer of toastTimers.current) window.clearTimeout(timer)
  }, [])

  const runToggle = async (key: string, action: () => Promise<unknown>): Promise<void> => {
    if (toggling.has(key)) return
    setToggling((current) => new Set(current).add(key))
    setInstallError(null)
    try {
      await action()
      // 开关只改 frontmatter,技能列表结构不变:静默同步即可,不重载面板。
      refreshTogglesOnly()
    } catch (error) {
      pushToast('err', skillT('toggleFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setToggling((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const toggleSkill = (skill: SkillInfo, enabled: boolean): void => {
    void runToggle(`skill:${skill.name}`, () => skillApi.setSkillEnabled(skill.name, enabled))
  }

  const toggleBundle = (bundle: BundleInfo, enabled: boolean): void => {
    void runToggle(`bundle:${bundle.id}`, () => skillApi.setBundleEnabled(bundle.id, enabled))
  }

  /** 当前视图里一个技能的开关值：直接读全局层（SKILL.md frontmatter）。 */
  const skillEnabledIn = (name: string): boolean => toggles.skills[name] !== false

  /** 技能包在当前视图下的开关值：内部技能全开才算开。 */
  const bundleEnabledIn = (bundle: BundleInfo): boolean => toggles.bundles[bundle.id] !== false

  const toggleExpanded = (bundleId: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(bundleId)) next.delete(bundleId)
      else next.add(bundleId)
      return next
    })
  }

  // Skills Hub 默认全展开（参考图整页可见）；用户手动收起后保持各自状态。

  const loadViewerContent = async (skillName: string, filePath: string): Promise<void> => {
    try {
      const res = await fetch(`/api/skill-manager/skills/${encodeURIComponent(skillName)}/files/${encodeURIComponent(filePath)}`)
      const body = await res.json() as { error?: unknown; content?: unknown; binary?: unknown; mime?: unknown; size?: unknown }
      if (body.error !== undefined) throw new Error(String(body.error))
      setViewer((v) => v === null ? v : {
        ...v,
        loading: false,
        content: (body.content ?? '') as string,
        binary: body.binary === true,
        mime: typeof body.mime === 'string' ? body.mime : undefined,
        size: typeof body.size === 'number' ? body.size : undefined,
      })
    } catch (error) {
      setViewer((v) => v === null ? v : { ...v, loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * 打开技能文件查看器。
   * @param skill - 目标技能。
   * @param file - 首屏文件；缺省 SKILL.md（点技能名进查看器的老路径）。
   */
  const openViewer = (skill: SkillInfo, file = 'SKILL.md'): void => {
    setViewer({ skill, file, loading: true })
    void loadViewerContent(skill.name, file)
  }

  /** 切字号档位（夹到合法区间）。 */
  const setViewerFontLevel = (level: number): void => {
    setViewerFont(Math.min(Math.max(level, 0), VIEWER_FONT_SIZES.length - 1))
  }

  /** 全屏 / 还原：弹窗宽高走 CSS 过渡，不重挂内容，滚动位置保持。 */
  const toggleViewerFull = (): void => {
    setViewerFull((current) => !current)
  }

  // 偏好统一在这里落盘：连点两个控件时，事件回调读到的是同一帧的旧闭包值，
  // 分开写会把其中一项存成旧值。
  useEffect(() => { writeViewerPrefs({ font: viewerFont, full: viewerFull }) }, [viewerFont, viewerFull])

  const selectViewerFile = (filePath: string): void => {
    if (viewer === null) return
    setViewer({ ...viewer, file: filePath, loading: true, error: undefined })
    void loadViewerContent(viewer.skill.name, filePath)
  }

  const doAssign = async (skill: SkillInfo, bundleId: string): Promise<void> => {
    try {
      if (state.status !== 'ready') return
      const bundle = state.snapshot.bundles.find((candidate) => candidate.id === bundleId)
      if (bundle === undefined) throw new Error('bundle not found')
      await skillApi.setBundleSkills(bundleId, [...bundle.skills.map((s) => s.name), skill.name])
      setAssignTarget(null)
      pushToast('ok', skillT('assignOk', { name: skill.name }))
      refresh()
    } catch (error) {
      failToast('归入技能包', error)
    }
  }

  const acceptFiles = (files: File[] | null): void => {
    if (files === null || files.length === 0) return
    const collected: CollectedFile[] = []
    for (const file of files) {
      const relative = file.webkitRelativePath
      if (relative === '') continue
      const parts = relative.split('/')
      if (parts.length < 2) continue
      collected.push({ path: parts.slice(1).join('/'), file })
    }
    if (collected.length === 0) return
    const zipCandidate = collected.length === 1 && collected[0].path.toLowerCase().endsWith('.zip') ? collected[0] : undefined
    if (zipCandidate !== undefined) {
      const reader = new FileReader()
      reader.onload = () => {
        const data = String(reader.result ?? '').split(',')[1] ?? ''
        setInstall({ archive: true, name: zipCandidate.path, data, folderName: zipCandidate.path })
        setInstallError(null)
        setAddOpen(true)
      }
      reader.readAsDataURL(zipCandidate.file)
      return
    }
    const rootName = collected[0]?.path.split('/')[0] ?? ''
    setInstallName(rootName)
    setInstallError(null)
    setInstall({ files: collected, folderName: rootName })
    setAddOpen(true)
  }

  const onDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDropActive(false)
    const collected: CollectedFile[] = []
    const items = event.dataTransfer.items
    if (items === undefined) return
    const pending: Array<Promise<void>> = []
    for (const item of Array.from(items)) {
      const entry = item.webkitGetAsEntry?.()
      if (entry !== undefined && entry !== null) pending.push(collectEntry(entry, '', collected))
    }
    await Promise.all(pending)
    if (collected.length === 0) return
    const zipCandidate = collected.length === 1 && collected[0].path.toLowerCase().endsWith('.zip') ? collected[0] : undefined
    if (zipCandidate !== undefined) {
      setInstall({ archive: true, name: zipCandidate.path, data: await fileToBase64(zipCandidate.file), folderName: zipCandidate.path })
      setInstallError(null)
      setAddOpen(true)
      return
    }
    const rootName = collected[0]?.path.split('/')[0] ?? ''
    setInstallName(rootName)
    setInstallError(null)
    setInstall({ files: collected, folderName: rootName })
    setAddOpen(true)
  }

  const confirmInstall = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (install === null || installing) return
    if (install.archive !== true && installName.trim() === '') return
    setInstalling(true)
    setInstallError(null)
    try {
      let installed: { name?: string } = {}
      if (install.archive === true) {
        installed = await skillApi.installSkill({
          archive: install.data,
          description: installDescription.trim(),
          ...installBundleId === undefined ? {} : { bundleId: installBundleId },
        })
      } else {
        const files = await Promise.all(install.files.map(async ({ path, file }) => ({
          path,
          data: await fileToBase64(file),
        })))
        installed = await skillApi.installSkill({
          skillName: installName.trim(),
          description: installDescription.trim(),
          ...installBundleId === undefined ? {} : { bundleId: installBundleId },
          files,
        })
      }
      // 名字以 host 落地的规范名为准：目录名与技能名不一致时，用户看得到装成了什么。
      pushToast('ok', skillT('installedOk', { name: installed.name ?? installName.trim() }))
      setInstall(null)
      setInstallName('')
      setInstallDescription('')
      setInstallBundleId(undefined)
      setAddOpen(false)
      refresh()
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : String(error))
    } finally {
      setInstalling(false)
    }
  }

  const submitNewBundle = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (creatingBundle || newBundleName.trim() === '') return
    setCreatingBundle(true)
    try {
      const created = newBundleName.trim()
      await skillApi.createBundle(created, newBundleCats)
      setNewBundleName('')
      setNewBundleCats([])
      setNewBundleOpen(false)
      pushToast('ok', skillT('bundleCreated', { name: created }))
      refresh()
    } catch (error) {
      failToast('新建技能包', error)
    } finally {
      setCreatingBundle(false)
    }
  }

  /** 打开「设置分类」弹窗：草稿从快照里的当前值起步。 */
  const openCatEditor = (bundle: BundleInfo): void => {
    setCatTarget({ bundleId: bundle.id, name: bundle.name })
    setCatDraft([...(bundle.categories ?? [])])
  }

  /** 保存分类：PATCH 只带 categories；顺手把筛选跟到新值，避免改完包「消失」。 */
  const submitCategories = async (): Promise<void> => {
    if (catTarget === null || savingCats) return
    setSavingCats(true)
    try {
      await skillApi.setBundleCategories(catTarget.bundleId, catDraft)
      if (activeCat !== null && !catDraft.includes(activeCat) && activeCat !== UNCATEGORIZED) setCatFilter(null)
      pushToast('ok', skillT('bundleCatSaved', { name: catTarget.name }))
      setCatTarget(null)
      refresh()
    } catch (error) {
      failToast('设置分类', error)
    } finally {
      setSavingCats(false)
    }
  }

  const submitRename = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {

    event.preventDefault()
    if (renaming || renameTarget === null || renameTarget.name.trim() === '') return
    setRenaming(true)
    try {
      await skillApi.renameBundle(renameTarget.bundleId, renameTarget.name.trim())
      // 改名成功后让卡片闪一下高亮（1600ms 后自动清除）。
      const renamedId = renameTarget.bundleId
      if (renamedTimer.current !== null) window.clearTimeout(renamedTimer.current)
      setRenamedFlash(renamedId)
      renamedTimer.current = window.setTimeout(() => { setRenamedFlash(null) }, 1600)
      setRenameTarget(null)
      refresh()
    } catch (error) {
      failToast('重命名技能包', error)
    } finally {
      setRenaming(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (confirm === null || confirming) return
    setConfirming(true)
    const label = confirm.kind === 'bundle' ? confirm.bundle.name : confirm.name
    try {
      if (confirm.kind === 'bundle') await skillApi.deleteBundle(confirm.bundle.id)
      else await skillApi.deleteSkill(confirm.name)
      setConfirm(null)
      pushToast('ok', confirm.kind === 'bundle'
        ? skillT('bundleDeleted', { name: label })
        : skillT('deletedOk', { name: label }))
      refresh()
    } catch (error) {
      // 旧实现把失败写进只在安装弹窗里渲染的 installError：删除失败时面板上毫无反应。
      failToast(confirm.kind === 'bundle' ? '删除技能包' : '删除技能', error)
    } finally {
      setConfirming(false)
    }
  }

  const removeFromBundle = async (bundleId: string, name: string): Promise<void> => {
    try {
      if (state.status !== 'ready') return
      const bundle = state.snapshot.bundles.find((candidate) => candidate.id === bundleId)
      if (bundle === undefined) return
      await skillApi.setBundleSkills(bundleId, bundle.skills.map((skill) => skill.name).filter((skillName) => skillName !== name))
      pushToast('ok', skillT('removedOk', { name }))
      refresh()
    } catch (error) {
      failToast('移出技能包', error)
    }
  }

  /** 清理账本里指向已删除技能的条目（技能包显示「N 个失效引用」时用）。 */
  const pruneBundle = async (bundle: BundleInfo): Promise<void> => {
    try {
      // 必须回到未过滤的快照取成员：视图里的 bundle 可能已被搜索/状态筛选裁掉过。
      const full = state.status === 'ready'
        ? (state.snapshot.bundles.find((candidate) => candidate.id === bundle.id) ?? bundle)
        : bundle
      await skillApi.setBundleSkills(bundle.id, full.skills.map((skill) => skill.name))
      pushToast('ok', skillT('pruned'))
      refresh()
    } catch (error) {
      failToast('清理失效引用', error)
    }
  }

  /** 从空技能包的引导按钮直接进入「添加技能」，并把归组预选成它。 */
  const openInstallFor = (bundleId: string): void => {
    setInstall(null)
    setInstallError(null)
    setInstallBundleId(bundleId)
    setAddOpen(true)
  }

  const bundles = state.status === 'ready' ? state.snapshot.bundles : []
  const loose = state.status === 'ready' ? state.snapshot.loose : []
  /** 卡片上的作用域 pill 文案：技能开关落在 SKILL.md frontmatter，恒为全局层。 */
  const scopeLabel = t('scopeAll')

  /* ── 派生数据：启用状态筛选 / 分类索引 ── */
  const statusMatch = (skill: SkillInfo): boolean => {
    // 「全部」= 不分启用状态一律显示。旧实现在这里也 return on，于是技能一关卡片就
    // 当场从列表里消失，想再打开只能切到「已停用」档去捞 —— 关掉即隐身。
    if (statusFilter === 'all') return true
    const on = toggles.skills[skill.name] !== false
    return statusFilter === 'on' ? on : !on
  }
  const filteredSkills = (list: SkillInfo[]): SkillInfo[] =>
    [...list].sort((a, b) => a.name.localeCompare(b.name)).filter((skill) => statusMatch(skill))
  /**
   * 全量筛选结果（批量操作作用于全部）。
   * 空技能包必须留在列表里：旧实现一律 filter(skills.length > 0)，于是新建的包、
   * 以及账本按目录名记账导致成员解析不到的包，都会从面板上凭空消失 —— 既看不到
   * 也点不到，没法再往里归技能。只有真正带筛选条件时才按命中情况隐藏。
   */
  const filtering = statusFilter !== 'all'
  /**
   * 分类索引：分类名 → 挂了它的技能包数；没挂任何分类的包归到 UNCATEGORIZED 桶。
   * 顶栏胶囊与包名旁的标签都从这里取数，所以两边口径天然一致。
   */
  const categoryCounts = (() => {
    const counts = new Map<string, number>()
    for (const bundle of bundles) {
      const cats = bundle.categories ?? []
      if (cats.length === 0) {
        counts.set(UNCATEGORIZED, (counts.get(UNCATEGORIZED) ?? 0) + 1)
        continue
      }
      for (const cat of cats) counts.set(cat, (counts.get(cat) ?? 0) + 1)
    }
    return counts
  })()
  const categoryList = sortCategories(categoryCounts)
  /** 选中的分类被最后一个包摘掉时自动回落「全部」，不留一个筛不出东西的死状态。 */
  const activeCat = catFilter !== null && categoryCounts.has(catFilter) ? catFilter : null
  const catMatch = (bundle: BundleInfo): boolean => {
    if (activeCat === null) return true
    const cats = bundle.categories ?? []
    return activeCat === UNCATEGORIZED ? cats.length === 0 : cats.includes(activeCat)
  }
  /* ── 搜索：包名 / 分类 / 技能名 / 描述，四路 OR；命中时包内只留命中的技能 ── */
  const needle = query.trim().toLowerCase()
  const textHit = (value: string | undefined): boolean =>
    needle === '' || (value ?? '').toLowerCase().includes(needle)
  const skillHit = (skill: SkillInfo): boolean =>
    textHit(skill.name) || textHit(skill.description)
  const bundleSelfHit = (bundle: BundleInfo): boolean =>
    needle === '' || textHit(bundle.name) || (bundle.categories ?? []).some((cat) => textHit(cat))
  /**
   * 搜索态下包内技能先按搜索词收窄（包名/分类命中则整包保留），
   * 再叠启用状态筛选 —— 否则搜到包名却只列出「已启用」的子集，读起来像丢数据。
   */
  const searchedSkills = (bundle: BundleInfo): SkillInfo[] => {
    const base = bundleSelfHit(bundle) ? bundle.skills : bundle.skills.filter(skillHit)
    return filteredSkills(base)
  }
  const visibleBundleAll = bundles
    .filter((bundle) => catMatch(bundle))
    .map((bundle) => ({ ...bundle, skills: searchedSkills(bundle) }))
    .filter((bundle) => {
      if (bundle.skills.length > 0) return true
      if (bundle.skillCount === 0 && !filtering && needle === '') return true
      // 搜索命中包名/分类但包内没有技能命中时，仍把包本身留在结果里（空包可见）。
      return needle !== '' && bundleSelfHit(bundle) && !filtering
    })
  const visibleLooseAll = (activeCat !== null ? [] : filteredSkills(loose))
    .filter((skill) => needle === '' || skillHit(skill))
  const noResults = visibleBundleAll.length === 0 && visibleLooseAll.length === 0

  /* ── 概览统计（概览条四格） ── */
  const totalSkills = bundles.reduce((sum, bundle) => sum + bundle.skillCount, 0) + loose.length
  const enabledSkills = [...bundles.flatMap((bundle) => bundle.skills), ...loose]
    .filter((skill) => toggles.skills[skill.name] !== false).length
  const realCategories = categoryList.filter((cat) => cat !== UNCATEGORIZED)
  const matchedSkills = visibleBundleAll.reduce((sum, bundle) => sum + bundle.skills.length, 0)
    + visibleLooseAll.length
  /** 散装技能列表的列数：与技能包内同一算法（ceil(n/2)，上限 3）。 */
  const looseCols = Math.min(3, Math.max(1, Math.ceil(visibleLooseAll.length / 2)))

  const trimmedName = installName.trim()
  const nameInvalid = trimmedName !== '' && !SKILL_NAME_PATTERN.test(trimmedName)

  const confirmTitle = confirm === null
    ? t('deleteSkillConfirm', { name: '' })
    : confirm.kind === 'bundle'
      ? t('deleteBundleConfirm', { name: confirm.bundle.name })
      : t('deleteSkillConfirm', { name: confirm.name })
        // 目录名与技能名不一致时说明白：删的是那个目录，避免用户以为删错东西。
          + (confirm.kind === 'skill' && confirm.dir !== undefined && confirm.dir !== confirm.name
            ? t('deleteSkillDirNote', { dir: confirm.dir }) : '')

  const shellOrWrap = (children: JSX.Element): JSX.Element => (
    embedded
      ? <div style={{ flex: '1 1 auto', minHeight: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>{children}</div>
      : (
        <PopoverShell
          onClose={() => {
            // 安装/确认进行中禁止关闭；二级弹窗（新建/添加/确认/查看器/归组）打开时 Esc 归二级弹窗。
            if (installing || confirming) return
            if (newBundleOpen || addOpen || confirm !== null || viewer !== null || assignTarget !== null || catTarget !== null) return
            onClose()
          }}
          ariaLabel={t('panelTitle')}
        >
          {children}
        </PopoverShell>
      )
  )

  return shellOrWrap(
    <>
      {/* 头部：**嵌入工作台时不再画标题行**——上面的 wb2 页头已经是「SKILL / 会什么」，
          再来一条 SKILL 横条是重复标题（2026-10-22 用户点名「展示页好丑」的主因之一）。
          只有独立 main 座位（非 embedded）才需要这条自带标题。 */}
      {!embedded && (
        <div className="psh-head">
          <span className="psh-title" style={{ flex: 'none' }}>{t('panelTitle')}</span>
        </div>
      )}
      <PshBody className={css.modalBody}>
      <span data-skm-panel-marker aria-hidden="true" style={{ display: 'none' }} />
      <div className={css.hub} aria-busy={state.status === 'loading'}>
        {/* ── 刊头：大标题 + 三格统计（嵌入工作台时替代 wb2 页头的角色，
            但保留工作台统一页头，这里只补信息密度，不重复标题语义） ── */}
        <div className={css.mast}>
          <span className={css.mastWord}>Skills</span>
          <span className={css.mastZh}>索引</span>
          <span className={css.mastGrow} />
          <div className={css.mastStats}>
            <div className={css.mastStat}><b>{bundles.length}</b><span>{t('statBundles')}</span></div>
            <div className={css.mastStat}><b>{totalSkills}</b><span>{t('statSkills')}</span></div>
            <div className={css.mastStat}><b>{enabledSkills}</b><span>{t('statEnabled')}</span></div>
          </div>
        </div>

        {/* ── 工具条：搜索 + 分类筛选 + 全部展开（上下实线，与目录同一条版心） ── */}
        <div className={css.bar}>
          <label className={css.search}>
            <IconSearchOutline16 size={13} aria-hidden="true" />
            <input
              className={css.searchInput}
              type="search"
              value={query}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
              onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
            />
            {query !== '' && (
              <button type="button" className={css.searchClear} aria-label={t('searchClear')} title={t('searchClear')}
                onClick={() => { setQuery('') }}>
                <IconCloseOutline16 size={11} aria-hidden="true" />
              </button>
            )}
          </label>
          <div className={css.barCats} role="group" aria-label={t('bundleCatFilterAria')}>
            <button type="button" className={css.filterTab} data-active={activeCat === null || undefined}
              aria-pressed={activeCat === null} onClick={() => { setCatFilter(null) }}>
              {t('bundleCatAllShort')}<i className={css.filterCount}>{bundles.length}</i>
            </button>
            {categoryList.map((cat) => {
              const none = cat === UNCATEGORIZED
              const active = activeCat === cat
              return (
                <button type="button" key={cat} className={css.filterTab} data-active={active || undefined}
                  aria-pressed={active} onClick={() => { setCatFilter(active ? null : cat) }}>
                  {none ? t('bundleCatNone') : cat}<i className={css.filterCount}>{categoryCounts.get(cat) ?? 0}</i>
                </button>
              )
            })}
          </div>
          <span className={css.barDivider} aria-hidden="true" />
          <div className={css.filterTabsRight} role="group" aria-label={t('statusAll')}>
            {([['all', t('statusAllShort')], ['on', t('statusOn')], ['off', t('statusOff')]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={css.filterTab}
                data-active={statusFilter === value || undefined}
                aria-pressed={statusFilter === value}
                onClick={() => { setStatusFilter(value) }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className={css.barGrow} />
          <button type="button" className={css.barBtn} onClick={() => { setAllOpen((value) => !value) }}>
            {allOpen ? t('collapseAllShort') : t('expandAllShort')}
          </button>
          <button type="button" className={css.barBtn} data-spin={refreshing || undefined}
            aria-label={t('refresh')} title={t('refresh')}
            onClick={() => {
              setRefreshing(true)
              window.setTimeout(() => { setRefreshing(false) }, 720)
              refresh()
            }}>
            <IconRefreshOutline14 size={13} aria-hidden="true" />
          </button>
          <button type="button" className={css.barAdd}
            onClick={() => { setInstall(null); setInstallError(null); setAddOpen(true) }}>
            <IconPlusOutline16 size={12} aria-hidden="true" />
            {t('addSkillsTitle')}
          </button>
        </div>


        {/* ── 主区 ── */}
        <div className={css.hubMain}>
          {/* 内容区：技能包 sections + 散装技能 */}
          <div className={`${css.mainScroll} ${modalStaggerClass}`}>
            {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
            {state.status === 'error' ? (
              <div className={css.failure}>
                <p role="alert">{t('error')}</p>
                <Button variant="outline" onClick={refresh}><IconRefreshOutline14 /> {t('retry')}</Button>
              </div>
            ) : null}

            {state.status === 'ready' && (
              noResults ? (
                <>
                  <p className={css.noResult}>{t('noMatch')}</p>
                  {/* 列表整个空时（一个包都没有 / 全被筛掉）面板上没有任何可点入口，
                      这里补一个安装兜底：有内容时它不出现，不占常驻位置。 */}
                  {visibleBundleAll.length === 0 && visibleLooseAll.length === 0 && (
                    <button
                      type="button"
                      className={css.bundleEmptyBtn}
                      onClick={() => { setInstall(null); setInstallError(null); setAddOpen(true) }}
                    >
                      <CloudUpIcon size={14} />
                      {t('addSkillsTitle')}
                    </button>
                  )}
                </>
              ) : (
                <>
                  {visibleBundleAll.map((bundle) => {
                    const open2 = expanded.has(bundle.id)
                    const renamingThis = renameTarget?.bundleId === bundle.id
                    const bundleEnabled = bundleEnabledIn(bundle)
                    const bundleToggling = toggling.has(`bundle:${bundle.id}`)
                    const gridClass = css.skillGrid
                    const missing = bundle.missingSkills ?? []
                    const bundleCats = bundle.categories ?? []
                    const emptyBundle = bundle.skillCount === 0
                    // 空包默认展开显示引导：折叠着只剩一行标题，用户会以为包丢了。
                    const openView = open2 || allOpen || emptyBundle
                    // 预览与进度永远按**整包**算：搜索/状态筛选只该裁展开后的列表，
                    // 不该让「12/25 已启用」跟着筛选结果一起变。
                    const rawBundle = state.status === 'ready'
                      ? state.snapshot.bundles.find((item) => item.id === bundle.id)
                      : undefined
                    const allSkills = rawBundle?.skills ?? bundle.skills
                    const onCount = allSkills.filter((skill) => toggles.skills[skill.name] !== false).length
                    /* ── 收起 / 展开：**同一个列表，只差渲染数量** ─────────────────
                       设计稿 dir-1 的原话就是 `const shown = open ? list : list.slice(0, 6)`，
                       压根没有第二套结构。插件之前把它实现成了两套 DOM（收起
                       .skm-bundle-preview-chip / 展开 .skm-skill-card），于是两边外观
                       永远对不齐、每次改一边另一边就"掉队"。2026-10-23 合并成一套：
                       两种状态都用 <SkillRow>，收起态只多渲染一个「还有 N 个」尾巴。 */
                    const listSource = needle !== '' ? bundle.skills : allSkills
                    const shownSkills = openView ? listSource : listSource.slice(0, COLLAPSED_ROWS)
                    // 列数按**实际渲染的行数**算（设计稿 dir-1 的同一招：ceil(n/2)，上限 3）。
                    // 必须用 shownSkills 而不是整包：收起态只显示 8 个，
                    // 若按整包算，只有 1 个技能的包（Kr）会被排成 3 列，右侧空出两大片。
                    const skillCols = Math.min(3, Math.max(1, Math.ceil(shownSkills.length / 2)))
                    return (
                      <section key={bundle.id} className={css.hubSection} data-open={openView ? 'true' : undefined} data-empty={emptyBundle ? 'true' : undefined}>
                        <header
                          className={css.bundleRowOuter}
                          data-open={openView ? 'true' : undefined}
                        >
                          {/* 左栏：包名（点开/收起整包）+ 分类（点即筛选）+ 启用计数 */}
                          <div className={css.bundleLeft}>
                            <button
                              type="button"
                              className={css.bundleRow}
                              aria-expanded={openView}
                              title={openView ? t('collapseBundle') : t('expandBundle')}
                              onClick={() => { toggleExpanded(bundle.id) }}
                            >
                              <span className={css.bundleName}>{bundle.name}</span>
                            </button>
                            <div className={css.bundleMeta}>
                              {bundleCats.length > 0 && (
                                <span className={css.bundleCats}>
                                  {bundleCats.map((cat, catIndex) => (
                                    <span key={cat}>
                                      {catIndex > 0 && <span className={css.bundleSep} aria-hidden="true" />}
                                      <button
                                        type="button"
                                        className={css.bundleCatTag}
                                        data-skm-cat={cat}
                                        data-active={activeCat === cat || undefined}
                                        title={t('bundleCatTip', { name: cat })}
                                        onClick={() => { setCatFilter(activeCat === cat ? null : cat) }}
                                      >
                                        {cat}
                                      </button>
                                    </span>
                                  ))}
                                  <span className={css.bundleSep} aria-hidden="true" />
                                </span>
                              )}
                              <span>{t('skillsCount', { n: bundle.skillCount })}</span>
                            </div>
                            <button
                              type="button"
                              className={css.bundleToggle}
                              role="switch"
                              aria-checked={bundleEnabled}
                              aria-label={bundleEnabled ? t('disableBundle') : t('enableBundle')}
                              title={bundleEnabled ? t('disableBundle') : t('enableBundle')}
                              data-on={bundleEnabled || undefined}
                              disabled={bundleToggling || bundle.skillCount === 0}
                              onClick={() => { toggleBundle(bundle, !bundleEnabled) }}
                            >
                              <span className={css.toggleDot} aria-hidden="true" />
                              {onCount > 0
                                ? <span>{t('enabledShort')} <b>{onCount}/{allSkills.length}</b></span>
                                : <span>{t('allDisabled')}</span>}
                            </button>
                          </div>
                          {/* 右栏：技能目录。收起 / 展开共用同一套行。
                              2026-10-23：列表必须留在右栏**里面**——
                              之前把它挪到了 header 外面，它就横跨整行、压到左栏包名
                              区域的正下方，左栏那 262px 只放了「包名 / 分类 / 计数」
                              三行字，右边一大片被技能行占走，视觉上像包名挂在
                              技能列表的边角上。左栏就该整列独占给技能包。 */}
                          <div className={css.bundleRight}>
                            {bundle.skills.length === 0 ? (
                              <ul className={gridClass} data-cols="1" style={{ '--skm-cols': 1 } as CSSProperties}>
                                <li className={css.bundleEmpty}>
                                  <span className={css.bundleEmptyTitle}>{t('bundleEmptyTitle')}</span>
                                  <span className={css.bundleEmptyHint}>{t('bundleEmptyHint')}</span>
                                  <button type="button" className={css.bundleEmptyBtn} onClick={() => { openInstallFor(bundle.id) }}>
                                    <CloudUpIcon size={14} />
                                    {t('bundleUploadHere')}
                                  </button>
                                </li>
                              </ul>
                            ) : (
                              <ul className={gridClass} data-cols={skillCols} style={{ '--skm-cols': skillCols } as CSSProperties} data-renamed={renamedFlash === bundle.id ? 'true' : undefined}>
                                {shownSkills.map((skill, index) => (
                                  <SkillCard key={skill.name} skill={skill} bundleId={bundle.id} bundleName={bundle.name}
                                    enabled={skillEnabledIn(skill.name)}
                                    scopeLabel={scopeLabel}
                                    index={index}
                                    onToggle={toggleSkill}
                                    onView={openViewer}
                                    onRemove={(s) => { void removeFromBundle(bundle.id, s.name) }}
                                    onDelete={(s) => { setConfirm({ kind: 'skill', name: s.name, dir: s.dir }) }} />
                                ))}
                                {!openView && listSource.length > shownSkills.length && (
                                  <li className={css.skillMoreRow}>
                                    <button type="button" className={css.bundlePreviewMore} onClick={() => { toggleExpanded(bundle.id) }}>
                                      {t('moreSkills', { n: listSource.length - shownSkills.length })}
                                      <IconChevronDownOutline14 size={10} aria-hidden="true" />
                                    </button>
                                  </li>
                                )}
                              </ul>
                            )}
                          </div>
                          <div className={css.bundleMore}>
                            <Menu
                              open={openMenu === `bundle:${bundle.id}`}
                              onClose={() => { setOpenMenu(null) }}
                              onSelect={(id) => {
                                setOpenMenu(null)
                                if (id === 'enable') toggleBundle(bundle, true)
                                else if (id === 'disable') toggleBundle(bundle, false)
                                else if (id === 'upload') openInstallFor(bundle.id)
                                else if (id === 'new') setNewBundleOpen(true)
                                else if (id === 'add') { setInstall(null); setInstallError(null); setAddOpen(true) }
                                else if (id === 'rename') setRenameTarget({ bundleId: bundle.id, name: bundle.name })
                                else if (id === 'cat') openCatEditor(bundle)
                                else if (id === 'delete') setConfirm({ kind: 'bundle', bundle })
                              }}
                              portal
                              items={[
                                { id: 'enable', label: t('enableBundle'), icon: <IconCheckOutline16 size={14} /> },
                                { id: 'disable', label: t('disableBundle'), icon: <IconCloseOutline16 size={14} /> },
                                { type: 'separator', id: 'gap' },
                                { id: 'upload', label: t('bundleUploadHere'), icon: <CloudUpIcon size={14} /> },
                                { id: 'rename', label: t('rename'), icon: <IconEditOutline16 size={14} /> },
                                { id: 'cat', label: t('bundleCatEdit'), icon: <TagIcon /> },
                                { type: 'separator', id: 'gap2' },
                                { id: 'new', label: t('newBundle'), icon: <IconPlusOutline16 size={14} /> },
                                { id: 'add', label: t('addSkillsTitle'), icon: <CloudUpIcon size={14} /> },
                                { type: 'separator', id: 'gap3' },
                                { id: 'delete', label: t('delete'), icon: <IconTrashOutline16 size={14} />, danger: true },
                              ]}
                              anchor={(
                                <button
                                  type="button"
                                  className={css.bundleMoreBtn}
                                  aria-label={t('moreActions')}
                                  aria-haspopup="menu"
                                  aria-expanded={openMenu === `bundle:${bundle.id}` || undefined}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setOpenMenu(openMenu === `bundle:${bundle.id}` ? null : `bundle:${bundle.id}`)
                                  }}
                                >
                                  <IconEllipsisOutline16 size={15} aria-hidden="true" />
                                </button>
                              )}
                            />
                          </div>
                        </header>
                        {renamingThis && renameTarget !== null && (
                          <form className={`${css.inlineForm} ${css.inlineFormBlock}`} onSubmit={(event) => { void submitRename(event) }}>
                            <input className={css.inlineInput} value={renameTarget.name} placeholder={t('renameBundlePlaceholder')}
                              aria-label={t('renameBundlePlaceholder')} autoFocus disabled={renaming}
                              onChange={(event) => {
                                // 先把值取出再进 setState 回调：React 合成事件在
                                // 回调执行完毕后会把 currentTarget 置空，若在函数式
                                // updater 里才读 event.currentTarget.value，渲染阶段
                                // 会抛 Cannot read properties of null，整个技能面板
                                // 被 ErrorBoundary 摘掉——表现就是「改名时卡片消失」。
                                const next = event.currentTarget.value
                                setRenameTarget((current) => current === null ? current : { ...current, name: next })
                              }} />
                            <Button variant="primary" type="submit" disabled={renaming || renameTarget.name.trim() === ''}>{t('rename')}</Button>
                            <Button variant="outline" type="button" disabled={renaming} onClick={() => { setRenameTarget(null) }}>{t('cancel')}</Button>
                          </form>
                        )}
                        {missing.length > 0 && (
                          <div className={css.bundleMissing} role="status">
                            <span>{t('bundleMissingN', { n: missing.length })}</span>
                            <code>{missing.join('、')}</code>
                            <button type="button" className={css.bundleMissingBtn} onClick={() => { void pruneBundle(bundle) }}>
                              {t('bundlePrune')}
                            </button>
                          </div>
                        )}

                      </section>
                    )
                  })}

                  {visibleLooseAll.length > 0 && (
                    <section className={css.hubSection} data-open={looseOpen ? 'true' : undefined}>
                      <header
                        className={css.bundleRowOuter}
                        data-open={looseOpen ? 'true' : undefined}
                      >
                        <div className={css.bundleLeft}>
                          <button
                            type="button"
                            className={css.bundleRow}
                            aria-expanded={looseOpen}
                            title={looseOpen ? t('collapseBundle') : t('expandBundle')}
                            onClick={() => { setLooseExpanded((value) => !value) }}
                          >
                            <span className={css.bundleName}>{t('looseTitle')}</span>
                          </button>
                          <div className={css.bundleMeta}>
                            <span>{t('skillsCount', { n: visibleLooseAll.length })}</span>
                          </div>
                        </div>
                        <div className={css.bundleRight} />
                      </header>
                      {looseOpen && (
                        <ul className={css.skillGrid} data-cols={looseCols} style={{ '--skm-cols': looseCols } as CSSProperties}>
                          {visibleLooseAll.map((skill, index) => (
                            <SkillCard key={skill.name} skill={skill} bundleId={null} bundleName={null}
                              enabled={skillEnabledIn(skill.name)}
                              scopeLabel={scopeLabel}
                              index={index}
                              onToggle={toggleSkill}
                              onView={openViewer}
                              onAssign={(s) => { setAssignTarget(s) }}
                              onDelete={(s) => { setConfirm({ kind: 'skill', name: s.name, dir: s.dir }) }} />
                          ))}
                        </ul>
                      )}
                    </section>
                  )}

                  {/* 新建技能包入口在技能包行的「更多」菜单里（改名前先建包） */}
                </>
              )
            )}
          </div>
        </div>
      </div>
      </PshBody>
      {/* 操作回执：安装/删除/归组/开关的成败都从这里冒出来（面板右下角，自动收起） */}
      {toasts.length > 0 && (
        <div className={css.toastStack} role="status" aria-live="polite">
          {toasts.map((item) => (
            <span key={item.id} className={`${css.toast} ${item.tone === 'err' ? css.toastErr : css.toastOk}`} data-tone={item.tone}>
              <i className={css.toastDot} aria-hidden="true" />
              {item.text}
            </span>
          ))}
        </div>
      )}
      {/* 新建技能包弹窗：名字与分类一起给，省得建完再进去设置一次。 */}
      <Modal
        open={newBundleOpen}
        onClose={() => { if (!creatingBundle) { setNewBundleOpen(false); setNewBundleCats([]) } }}
        closeLabel={t('close')}
        title={t('newBundle')}
      >
        <form className={css.stackForm} onSubmit={(event) => { void submitNewBundle(event) }}>
          <input className={css.inlineInput} value={newBundleName} placeholder={t('newBundlePlaceholder')}
            aria-label={t('newBundlePlaceholder')} autoFocus disabled={creatingBundle}
            onChange={(event) => { setNewBundleName(event.currentTarget.value) }} />
          <CategoryEditor value={newBundleCats} onChange={setNewBundleCats} label={t('newBundle')} />
          <div className={css.inlineForm}>
            <Button variant="primary" type="submit" disabled={creatingBundle || newBundleName.trim() === ''}>{t('create')}</Button>
            <Button variant="outline" type="button" disabled={creatingBundle} onClick={() => { setNewBundleOpen(false); setNewBundleCats([]) }}>{t('cancel')}</Button>
          </div>
        </form>
      </Modal>

      {/* 设置分类弹窗：与新建包共用同一个 CategoryEditor，值走草稿态，保存才落盘。 */}
      <Modal
        open={catTarget !== null}
        onClose={() => { if (!savingCats) setCatTarget(null) }}
        closeLabel={t('close')}
        title={t('bundleCatEditTitle', { name: catTarget?.name ?? '' })}
      >
        <div className={css.stackForm}>
          <CategoryEditor value={catDraft} onChange={setCatDraft} label={t('bundleCatEdit')} />
          <div className={css.inlineForm}>
            <Button variant="primary" type="button" disabled={savingCats} onClick={() => { void submitCategories() }}>{t('bundleCatDone')}</Button>
            <Button variant="outline" type="button" disabled={savingCats} onClick={() => { setCatTarget(null) }}>{t('cancel')}</Button>
          </div>
        </div>
      </Modal>

      {/* 添加技能弹窗：先拖放/浏览选文件，再填表单安装 */}
      <Modal
        open={addOpen}
        onClose={() => {
          if (installing) return
          setAddOpen(false)
          setInstall(null)
          setDropActive(false)
        }}
        closeLabel={t('close')}
        title={t('addSkillsTitle')}
      >
        {install === null ? (
          <div
            className={`${css.addCard} ${dropActive ? css.addCardActive : ''}`}
            role="button"
            tabIndex={0}
            aria-label={t('addSkillsTitle')}
            onClick={() => { fileInput.current?.click() }}
            onDragOver={(event) => { event.preventDefault(); setDropActive(true) }}
            onDragLeave={() => { setDropActive(false) }}
            onDrop={(event) => { void onDrop(event) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                fileInput.current?.click()
              }
            }}
          >
            <span className={css.addCardHead}>
              <span className={css.addCardIcon}><CloudUpIcon size={22} /></span>
              <span className={css.addCardTitle}>{t('bannerTitle')}</span>
            </span>
            <span className={css.addCardSub}>{t('bannerSub')}</span>
            <span className={css.addDrop}>
              <CloudUpIcon size={18} />
              <span className={css.addDropText}>{t('dropHere')}</span>
              <span className={css.addDropHint}>{t('dropFormat')}</span>
            </span>
            <button type="button" className={css.addBtn} onClick={(event) => { event.stopPropagation(); fileInput.current?.click() }}>
              {t('browseImport')}
            </button>
            <input
              ref={fileInput}
              type="file"
              className={css.hiddenInput}
              multiple
              {...{ webkitdirectory: '' }}
              onChange={(event) => {
                acceptFiles(event.currentTarget.files === null ? null : Array.from(event.currentTarget.files))
              }}
            />
          </div>
        ) : (
          <form className={css.installForm} onSubmit={(event) => { void confirmInstall(event) }}>
            <div className={css.installRow}>
              <input className={css.inlineInput} value={installName}
                placeholder={install.archive === true ? t('installNameFromArchive') : t('installNamePlaceholder')}
                aria-label={t('installName')}
                disabled={installing || install.archive === true}
                onChange={(event) => { setInstallName(event.currentTarget.value) }} />
              <input className={css.inlineInput} value={installDescription} placeholder={t('installDescription')}
                aria-label={t('installDescription')} disabled={installing}
                onChange={(event) => { setInstallDescription(event.currentTarget.value) }} />
              <label className={css.bundleSelect}>
                <span className={css.visuallyHidden}>{t('installBundle')}</span>
                <select value={installBundleId ?? ''} disabled={installing}
                  onChange={(event) => { setInstallBundleId(event.currentTarget.value === '' ? undefined : event.currentTarget.value) }}>
                  <option value="">{t('installLoose')}</option>
                  {bundles.map((bundle) => <option key={bundle.id} value={bundle.id}>{bundle.name}</option>)}
                </select>
              </label>
              <span className={css.installMeta}>
                {install.archive === true
                  ? t('uploadMeta', { n: 1, folder: install.folderName })
                  : t('uploadMeta', { n: install.files.length, folder: install.folderName })}
              </span>
            </div>
            {install.archive !== true && nameInvalid && <p className={css.error} role="alert">{t('installNameInvalid')}</p>}
            {install.archive !== true && !nameInvalid && trimmedName !== '' && installMetaName !== null && installMetaName !== trimmedName && (
              <p className={css.installHint}>{t('installNameRewrite', { meta: installMetaName, name: trimmedName })}</p>
            )}
            <div className={css.installActions}>
              <Button variant="primary" type="submit" disabled={installing || (install.archive !== true && (trimmedName === '' || nameInvalid))}>{t('installConfirm')}</Button>
              <Button variant="outline" type="button" disabled={installing} onClick={() => { setInstall(null); setAddOpen(false) }}>{t('installCancel')}</Button>
            </div>
            {installError !== null && <p className={css.error} role="alert">{installError}</p>}
          </form>
        )}
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => {
          if (!confirming) setConfirm(null)
        }}
        closeLabel={t('close')}
        title={confirmTitle}
        footer={
          <>
            <Button variant="outline" disabled={confirming} onClick={() => { setConfirm(null) }}>{t('cancel')}</Button>
            <Button variant="primary" disabled={confirming} onClick={() => { void confirmDelete() }}>{t('delete')}</Button>
          </>
        }
      />

      {viewer !== null && (
        <Modal
          open
          onClose={() => { setViewer(null) }}
          closeLabel={t('close')}
          title={viewer.skill.name + (viewer.file === 'SKILL.md' ? '' : ' · ' + viewer.file)}
          className={css.viewerModal + (viewerFull ? ' ' + css.viewerModalFull : '')}
          contentClassName={css.viewerBody}
        >
          {/* 工具条：当前文件 + 字号三档 + 全屏切换（偏好持久化） */}
          <div className={css.viewerToolbar}>
            <span className={css.viewerPath}>
              <b>{viewer.file}</b>
              <span>{t('viewerFilesCount', { n: Array.isArray(viewer.skill.files) ? viewer.skill.files.length : 0 })}</span>
            </span>
            <span className={css.viewerToolGroup} role="group" aria-label={t('viewerFont')}>
              {VIEWER_FONT_SIZES.map((size, level) => (
                <button
                  key={size}
                  type="button"
                  className={css.viewerToolBtn + (level === 0 ? ' ' + css.viewerToolBtnA1 : level === 2 ? ' ' + css.viewerToolBtnA3 : '')}
                  data-active={viewerFont === level ? 'true' : undefined}
                  title={VIEWER_FONT_LABELS[level]}
                  aria-label={VIEWER_FONT_LABELS[level]}
                  aria-pressed={viewerFont === level}
                  onClick={() => { setViewerFontLevel(level) }}
                >A</button>
              ))}
            </span>
            <button
              type="button"
              className={css.viewerToolBtn + ' ' + css.viewerToolBtnFrame}
              data-active={viewerFull ? 'true' : undefined}
              title={viewerFull ? t('viewerExitFull') : t('viewerFull')}
              aria-label={viewerFull ? t('viewerExitFull') : t('viewerFull')}
              aria-pressed={viewerFull}
              onClick={toggleViewerFull}
            >
              <ViewerExpandIcon full={viewerFull} />
            </button>
          </div>
          <div className={css.viewerLayout}>
            <nav className={css.viewerNav} aria-label={t('viewerNav')}>
              {skillFileRows(Array.isArray(viewer.skill.files) ? viewer.skill.files : []).map((row, index) => (
                <div
                  key={row.path + '-' + String(index)}
                  className={css.viewerNavItem + (row.kind === 'dir' ? ' ' + css.viewerNavDir : '')}
                  data-active={row.kind === 'file' && row.path === viewer.file ? 'true' : undefined}
                  data-dir={row.kind === 'dir' ? 'true' : undefined}
                  style={{ paddingLeft: 8 + row.depth * 14 }}
                  title={row.path}
                  onClick={row.kind === 'file' ? () => { selectViewerFile(row.path) } : undefined}
                >
                  {row.kind === 'dir' ? '📁 ' : '📄 '}
                  {row.path}
                </div>
              ))}
            </nav>
            <div className={css.viewerContent} style={{ '--skm-vfs': `${String(VIEWER_FONT_SIZES[viewerFont])}px` } as CSSProperties}>
              {viewer.loading === true
                ? t('previewLoading')
                : viewer.error !== undefined
                  ? viewer.error
                  : viewer.binary === true || mediaKindOf(viewer.file) !== 'none'
                    // 二进制：绝不再走 markdown。原来一路 readFile(…,'utf8') + markdown
                    // 渲染，PNG 就变成满屏 `IHDR` 乱码（用户 2026-10-20 反馈）。
                    ? <SkillBinaryPreview viewer={viewer} />
                    : <div dangerouslySetInnerHTML={{ __html: renderSkillMarkdown(viewer.content ?? '', { skillName: viewer.skill.name, dir: dirNameOf(viewer.file) }) }} />}
            </div>
          </div>
        </Modal>
      )}

      {assignTarget !== null && (
        <Modal
          open
          onClose={() => { setAssignTarget(null) }}
          closeLabel={t('close')}
          title={t('assignTitle', { name: assignTarget.name })}
          className={css.assignModal}
          contentClassName={css.assignModalBody}
        >
          {bundles.length === 0 ? (
            <p className={css.looseEmpty}>{t('assignEmpty')}</p>
          ) : (
            <ul className={css.assignList}>
              {bundles.map((bundle, index) => (
                <li key={bundle.id} style={{ listStyle: 'none' }}>
                  <button
                    type="button"
                    className={css.assignCard}
                    style={{ '--skm-i': index } as CSSProperties}
                    onClick={() => { void doAssign(assignTarget, bundle.id) }}
                  >
                    <span className={css.assignCardIcon} aria-hidden="true"><IconFolderOpenOutline16 size={16} /></span>
                    <span className={css.assignCardBody}>
                      <span className={css.assignCardName}>{bundle.name}</span>
                      <span className={css.assignCardDesc}>{t('skillsCount', { n: bundle.skillCount })}</span>
                    </span>
                    <span className={css.assignGo} aria-hidden="true"><IconChevronDownOutline14 size={14} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  )
}
