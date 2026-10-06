/**
 * dsh-soul 面板文案（zh/en 双语，zh 为 key 源）。
 *
 * 为什么不复用 memory/locales.ts：
 *  - 那份字典的 key 类型是 MemoryLocaleKey，面板经官方 locale 命名空间 dshMemory
 *    取词；灵魂面板在 composer 浮层里也会渲染（SoulToggleRow），那里拿不到
 *    memory 的 t，只有 api。
 *  - 两个模块由不同的人维护，共用一个 600 行的字典文件会让每次改动都变成
 *    「谁的 key 说了算」的协调问题。文案就近放在自己的目录里，代价是多一份
 *    30 行的 makeT（与 memory 那份实现完全同款：跟随 <html lang> + {n} 插值）。
 */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  soulTitle: '灵魂',
  soulDesc: '记忆库之上的身份契约层：我是谁、用什么语气、守什么准则。每个会话首步注入一次，跨会话恒定。',
  soulLoading: '读取中…',
  soulEmpty: '还没有灵魂。写一段人设，或从记忆里蒸馏一份。',
  soulEmptyCta: '写第一句',
  soulHostStale: 'host 半身未更新：/soul 路由不存在',
  soulHostStaleHint: '浏览器半身已生效，服务端还是旧进程——重启 DSH 后本面板即可用。',
  soulLoadFailed: '灵魂读取失败：{reason}',
  soulRetry: '重试',
  soulClose: '关闭',

  soulZonePreview: '预览',
  soulZoneEdit: '修改',
  soulZoneEditHint: '整段改写入口：正文、身份字段、档案、蒸馏',
  soulPreviewCardsTab: '卡片',
  soulPreviewTextTab: '全文',
  soulPreviewRendered: '渲染后的全文 · 改完即时同步',
  soulContentLabel: '灵魂正文',
  soulContentPlaceholder: '用第一人称写一段人设：你是谁、怎么说话、在意什么…',
  soulCharCount: '{n} 字',
  soulCharLimitHint: '注入上限 {n} 字符，超出部分会被截断。',
  soulPreviewEmpty: '正文为空，预览没有内容',

  soulIdentityLabel: '结构化身份',
  soulIdentityHint: '这段会以字段形式独立注入，模型读起来比一段散文更确定。',
  soulName: '名字',
  soulNamePlaceholder: '例如：Seeker',
  soulRole: '角色',
  soulRolePlaceholder: '例如：严谨的编程搭子',
  soulTone: '语气',
  soulTonePlaceholder: '例如：直接、简洁、不客套',
  soulLanguage: '语言',
  soulLanguagePlaceholder: '例如：简体中文',
  soulPrinciples: '行为准则',
  soulPrinciplesPlaceholder: '一行一条准则',
  soulPrinciplesCount: '{n} 条',

  soulSave: '保存',
  soulSaving: '保存中…',
  soulSaved: '已保存',
  soulSavedNotice: '灵魂已保存',
  soulDirty: '有未保存的修改',
  soulReset: '撤销修改',
  soulUnchanged: '没有改动',
  soulSavedAt: '更新于 {time}',
  soulNeverSaved: '尚未保存过',
  soulVersion: 'v{n}',

  soulProfiles: '灵魂档案',
  soulProfilesHint: '一份档案 = 一套人格。主档是 soul.md 本体，档案可随时切换。',
  soulProfileNew: '新建档案',
  soulProfileNamePlaceholder: '档案名（如：工作 / 写作）',
  soulProfileCreate: '创建',
  soulProfileCancel: '取消',
  soulProfileActivate: '启用',
  soulProfileActive: '使用中',
  soulProfileMain: '主档',
  soulProfileDelete: '删除',
  soulProfileDeleteConfirm: '删除档案「{name}」？此操作不可恢复。',
  soulProfileNameRequired: '档案名不能为空',
  soulProfileEmpty: '还没有备用人格',
  soulProfileSwitchFailed: '切换档案失败：{reason}',

  soulDistill: '从记忆蒸馏',
  soulDistilling: '蒸馏中…',
  soulDistillHint: '把库里已沉淀的身份与偏好条目交给模型，整理成一份灵魂草案（不会自动覆盖，先给你看）。',
  soulDistillFailed: '蒸馏未完成：{reason}',
  soulDistillEmpty: '记忆库里还没有可用于蒸馏的身份/偏好条目',
  soulDistillStats: '本次用了 {n} 条记忆',
  soulDistillNoModel: '没有可用模型，无法蒸馏',

  soulDraftTitle: '灵魂草案',
  soulDraftNotes: '模型说明',
  soulDraftApply: '采用草案',
  soulDraftApplying: '采用中…',
  soulDraftApplied: '草案已采用',
  soulDraftDiscard: '丢弃',
  soulDraftCurrent: '当前灵魂',
  soulDraftHint: '两侧高亮的行表示各自独有的内容',
  soulDraftEmptySide: '（空）',

  soulInjectLabel: '灵魂人设',
  soulInjectOn: '灵魂注入：开',
  soulInjectOff: '灵魂注入：关',
  soulInjectHint: '每会话首步注入一次，与记忆注入开关互不影响',
  soulInjectBuiltin: '内置',
  soulInjectReadFailed: '读取开关失败',

  soulCards: '灵魂卡片',
  soulCardsHint: '每张卡单独注入；关掉的卡保留但不生效，顺序即注入顺序。',
  soulCardsCount: '{n} 张 · {on} 张生效',
  soulCardsEmpty: '还没有卡片——从下面的预设挑一套，或点「新增卡片」自己写。',
  soulCardNew: '新增卡片',
  soulCardCreate: '创建',
  soulCardCancel: '取消',
  soulCardSave: '保存',
  soulCardTitleLabel: '卡片标题',
  soulCardTitlePlaceholder: '例如：语言与口吻',
  soulCardBodyLabel: '卡片内容',
  soulCardBodyPlaceholder: '这张卡要注入的内容，写清楚即可（支持多行）',
  soulCardNewTitle: '新卡片标题',
  soulCardUntitled: '未命名卡片',
  soulCardExpand: '展开',
  soulCardCollapse: '收起',
  soulCardDelete: '删除卡片',
  soulCardEnable: '启用卡片',
  soulCardDisable: '禁用卡片',
  soulCardMoveUp: '上移',
  soulCardMoveDown: '下移',
  soulCardChars: '{n} 字',
  soulCardCharCount: '{n}/{max} 字',
  soulCardFromPreset: '来自预设',
  soulCardKindLabel: '卡片种类',
  soulCardKindIdentity: '身份',
  soulCardKindTone: '语气',
  soulCardKindPrinciples: '准则',
  soulCardKindBoundaries: '边界',
  soulCardKindStyle: '风格',
  soulCardKindCustom: '自定义',

  soulPresets: '灵魂预设',
  soulPresetsHint: '整体替换 = 换成这一套；合并应用 = 同种卡片被覆盖，自定义卡保留。',
  soulPresetsCount: '{n} 套',
  soulPresetsEmpty: '还没有预设（host 未返回内置预设）',
  soulPresetBuiltin: '内置',
  soulPresetCustom: '自定义',
  soulPresetCardCount: '{n} 张卡',
  soulPresetApplyReplace: '整体替换',
  soulPresetApplyMerge: '合并应用',
  soulPresetApplied: '已应用',
  soulPresetDelete: '删除预设',
  soulPresetSaveAs: '存为预设',
  soulPresetSave: '保存预设',
  soulPresetSaving: '保存中…',
  soulPresetCancel: '取消',
  soulPresetNameLabel: '预设名',
  soulPresetNamePlaceholder: '例如：我的工作人格',
  soulPresetDescLabel: '说明',
  soulPresetDescPlaceholder: '一句话说明这套人格用在什么场景',

  soulCardsLoadFailed: '卡片读取失败：{reason}',
  soulCardsSaveFailed: '卡片保存失败：{reason}',
  soulPresetApplyFailed: '应用预设失败：{reason}',
  soulPresetSaveFailed: '保存预设失败：{reason}',
  soulPresetDeleteFailed: '删除预设失败：{reason}',
  soulWhaleLabel: 'DSH 鲸鱼',
} satisfies Record<string, string>

/** dsh-soul locale key union. */
export type SoulLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  soulTitle: 'Soul',
  soulDesc: 'The identity contract above the memory store: who I am, how I speak, what I hold to. Injected once per session, stable across sessions.',
  soulLoading: 'Loading…',
  soulEmpty: 'No soul yet. Write one, or distill it from your memories.',
  soulEmptyCta: 'Write the first line',
  soulHostStale: 'Host half not updated: no /soul route',
  soulHostStaleHint: 'The browser half is live but the server process is still old — restart DSH to enable this panel.',
  soulLoadFailed: 'Failed to load soul: {reason}',
  soulRetry: 'Retry',
  soulClose: 'Close',

  soulZonePreview: 'Preview',
  soulZoneEdit: 'Edit',
  soulZoneEditHint: 'Whole-text entry: prose, identity fields, profiles, distill',
  soulPreviewCardsTab: 'Cards',
  soulPreviewTextTab: 'Full text',
  soulPreviewRendered: 'Rendered text · updates as you type',
  soulContentLabel: 'Soul text',
  soulContentPlaceholder: 'Write the persona in first person: who you are, how you speak, what you care about…',
  soulCharCount: '{n} chars',
  soulCharLimitHint: 'Injection cap is {n} chars; anything beyond is truncated.',
  soulPreviewEmpty: 'Nothing to preview — the text is empty',

  soulIdentityLabel: 'Structured identity',
  soulIdentityHint: 'Injected as discrete fields, which the model reads far more reliably than prose.',
  soulName: 'Name',
  soulNamePlaceholder: 'e.g. Seeker',
  soulRole: 'Role',
  soulRolePlaceholder: 'e.g. a rigorous coding partner',
  soulTone: 'Tone',
  soulTonePlaceholder: 'e.g. direct, concise, no pleasantries',
  soulLanguage: 'Language',
  soulLanguagePlaceholder: 'e.g. Simplified Chinese',
  soulPrinciples: 'Principles',
  soulPrinciplesPlaceholder: 'One principle per line',
  soulPrinciplesCount: '{n} items',

  soulSave: 'Save',
  soulSaving: 'Saving…',
  soulSaved: 'Saved',
  soulSavedNotice: 'Soul saved',
  soulDirty: 'Unsaved changes',
  soulReset: 'Discard changes',
  soulUnchanged: 'No changes',
  soulSavedAt: 'Updated {time}',
  soulNeverSaved: 'Never saved',
  soulVersion: 'v{n}',

  soulProfiles: 'Soul profiles',
  soulProfilesHint: 'One profile = one persona. The main profile is soul.md itself; profiles switch at any time.',
  soulProfileNew: 'New profile',
  soulProfileNamePlaceholder: 'Profile name (e.g. work / writing)',
  soulProfileCreate: 'Create',
  soulProfileCancel: 'Cancel',
  soulProfileActivate: 'Activate',
  soulProfileActive: 'Active',
  soulProfileMain: 'Main',
  soulProfileDelete: 'Delete',
  soulProfileDeleteConfirm: 'Delete profile "{name}"? This cannot be undone.',
  soulProfileNameRequired: 'Profile name is required',
  soulProfileEmpty: 'No alternate personas yet',
  soulProfileSwitchFailed: 'Failed to switch profile: {reason}',

  soulDistill: 'Distill from memories',
  soulDistilling: 'Distilling…',
  soulDistillHint: 'Feed the settled identity/preference memories to the model and draft a soul from them. Nothing is overwritten — you review the draft first.',
  soulDistillFailed: 'Distillation failed: {reason}',
  soulDistillEmpty: 'No identity/preference memories to distill from yet',
  soulDistillStats: 'Used {n} memories',
  soulDistillNoModel: 'No model available for distillation',

  soulDraftTitle: 'Soul draft',
  soulDraftNotes: 'Model notes',
  soulDraftApply: 'Apply draft',
  soulDraftApplying: 'Applying…',
  soulDraftApplied: 'Draft applied',
  soulDraftDiscard: 'Discard',
  soulDraftCurrent: 'Current soul',
  soulDraftHint: 'Highlighted lines exist on one side only',
  soulDraftEmptySide: '(empty)',

  soulInjectLabel: 'Soul persona',
  soulInjectOn: 'Soul injection: on',
  soulInjectOff: 'Soul injection: off',
  soulInjectHint: 'Injected once at the first step of each session; independent of the memory switch',
  soulInjectBuiltin: 'Built-in',
  soulInjectReadFailed: 'Failed to read the switch',

  soulCards: 'Soul cards',
  soulCardsHint: 'Each card is injected on its own. Disabled cards stay but do not apply; the order is the injection order.',
  soulCardsCount: '{n} cards · {on} live',
  soulCardsEmpty: 'No cards yet — apply a preset below, or add one yourself.',
  soulCardNew: 'New card',
  soulCardCreate: 'Create',
  soulCardCancel: 'Cancel',
  soulCardSave: 'Save',
  soulCardTitleLabel: 'Card title',
  soulCardTitlePlaceholder: 'e.g. Language and voice',
  soulCardBodyLabel: 'Card body',
  soulCardBodyPlaceholder: 'What this card injects — plain text, multiple lines fine',
  soulCardNewTitle: 'New card title',
  soulCardUntitled: 'Untitled card',
  soulCardExpand: 'Expand',
  soulCardCollapse: 'Collapse',
  soulCardDelete: 'Delete card',
  soulCardEnable: 'Enable card',
  soulCardDisable: 'Disable card',
  soulCardMoveUp: 'Move up',
  soulCardMoveDown: 'Move down',
  soulCardChars: '{n} chars',
  soulCardCharCount: '{n}/{max} chars',
  soulCardFromPreset: 'from preset',
  soulCardKindLabel: 'Card kind',
  soulCardKindIdentity: 'Identity',
  soulCardKindTone: 'Tone',
  soulCardKindPrinciples: 'Principles',
  soulCardKindBoundaries: 'Boundaries',
  soulCardKindStyle: 'Style',
  soulCardKindCustom: 'Custom',

  soulPresets: 'Soul presets',
  soulPresetsHint: 'Replace swaps the whole set; merge overwrites same-kind cards and keeps your custom ones.',
  soulPresetsCount: '{n} presets',
  soulPresetsEmpty: 'No presets (host returned none)',
  soulPresetBuiltin: 'Built-in',
  soulPresetCustom: 'Custom',
  soulPresetCardCount: '{n} cards',
  soulPresetApplyReplace: 'Replace all',
  soulPresetApplyMerge: 'Merge',
  soulPresetApplied: 'Applied',
  soulPresetDelete: 'Delete preset',
  soulPresetSaveAs: 'Save as preset',
  soulPresetSave: 'Save preset',
  soulPresetSaving: 'Saving…',
  soulPresetCancel: 'Cancel',
  soulPresetNameLabel: 'Preset name',
  soulPresetNamePlaceholder: 'e.g. My work persona',
  soulPresetDescLabel: 'Description',
  soulPresetDescPlaceholder: 'One line about when to use this persona',

  soulCardsLoadFailed: 'Failed to load cards: {reason}',
  soulCardsSaveFailed: 'Failed to save card: {reason}',
  soulPresetApplyFailed: 'Failed to apply preset: {reason}',
  soulPresetSaveFailed: 'Failed to save preset: {reason}',
  soulPresetDeleteFailed: 'Failed to delete preset: {reason}',
  soulWhaleLabel: 'DSH whale',
} satisfies Record<SoulLocaleKey, string>

/** 轻量翻译函数类型（面板与浮层开关共用）。 */
export type SoulT = (key: SoulLocaleKey, vars?: Record<string, string | number>) => string

const DICTS: Record<'zh' | 'en', Record<SoulLocaleKey, string>> = { zh, en }

/** 当前语言：跟随 DSH 同步到 <html lang> 的主子标签（缺省 zh）。 */
function currentLang(): 'zh' | 'en' {
  try {
    const lang = document.documentElement.lang.toLowerCase().split('-')[0]
    if (lang === 'en') return 'en'
  } catch { /* 非 DOM 环境 */ }
  return 'zh'
}

/** 轻量翻译：{n} 占位插值。 */
export function makeSoulT(): SoulT {
  return (key, vars) => {
    let text: string = DICTS[currentLang()][key] ?? zh[key]
    if (vars !== undefined) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

/** 灵魂注入文本的字符上限（与 host 注入器保持一致，用于面板计数提示）。 */
export const SOUL_CHAR_LIMIT = 2000
