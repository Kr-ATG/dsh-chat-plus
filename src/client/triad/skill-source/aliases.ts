/**
 * 技能别名表:让 `/` 菜单能用**中文/口语**搜到技能。
 *
 * 技能名几乎全是英文(`no-comments`、`flowchart`、`lark-base`…),
 * 而用户的输入习惯是「我要那个画流程图的」「能把注释清掉的」。内核的
 * `rankByName` 只做 ASCII 子序列匹配,中文 query 一律零命中 —— 菜单直接
 * 变成空,用户只能记得住英文原名才选得到。
 *
 * 所以给每个技能配一组人话别名:
 *  · 键是技能**规范名**(与 /api/skill-manager/list 返回的 name 一致);
 *  · 值是用户可能打出来的词,中英文都行,按需往这里加;
 *  · 匹配是**子串**(互不区分大小写):别名「电子表格」能命中 query「表格」。
 *
 * 这张表是纯数据、可增量维护:新增技能没配别名也不影响(还走英文名匹配 +
 * 描述兜底),补上就多一条中文入口。**不要在别处再写一份中文映射**——
 * 两套真相迟早对不上。
 */
export const SKILL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // ── 飞书 Lark ──────────────────────────────────────────────────────────
  'lark-approval': ['审批', 'approval'],
  'lark-attendance': ['考勤', '打卡', 'attendance'],
  'lark-base': ['多维表格', '数据表', 'base'],
  'lark-calendar': ['日历', '日程', 'calendar'],
  'lark-contact': ['通讯录', '联系人', 'contact'],
  'lark-doc': ['云文档', '文档', 'doc'],
  'lark-drive': ['云空间', '网盘', '文件', 'drive'],
  'lark-event': ['事件订阅', '事件', 'event'],
  'lark-im': ['即时通讯', '消息', '群聊', 'im'],
  'lark-mail': ['邮件', '邮箱', 'mail'],
  'lark-markdown': ['markdown', 'md 文件'],
  'lark-minutes': ['妙记', '会议纪要', 'minutes'],
  'lark-okr': ['okr', '目标'],
  'lark-openapi-explorer': ['openapi', '原生接口', '接口探索'],
  'lark-shared': ['登录配置', 'cli 配置', 'shared'],
  'lark-sheets': ['电子表格', '表格', 'sheets'],
  'lark-skill-maker': ['制作技能', '自定义技能', '封装技能'],
  'lark-slides': ['幻灯片', '演示文稿', 'slides'],
  'lark-task': ['任务', '待办', 'task'],
  'lark-vc': ['视频会议', '会议', 'vc'],
  'lark-vc-agent': ['会议机器人', '代为参会', '参会'],
  'lark-whiteboard': ['白板', 'whiteboard'],
  'lark-wiki': ['知识库', 'wiki'],
  'lark-workflow-meeting-summary': ['纪要整理', '会议汇总'],
  'lark-workflow-standup-report': ['待办摘要', '日报', '周报'],

  // ── 知识与图表 ────────────────────────────────────────────────────────
  'kb-wiki-skill': ['知识库', 'kb', 'wiki', '文档', 'prd'],
  'diagram-design': ['架构图', '流程图', '图表', '可视化', '示意图'],
  'dynamic-archify': ['架构图', '动态架构', '架构动画'],
  'flowchart': ['流程图', '概念图', '原理图'],
  'network-protocol-viz': ['网络协议', '协议', 'tcp', '可视化'],
  'lieflat-charts': ['图表', '数据可视化', '报告', 'charts'],
  'scholar-notes': ['笔记', '学习笔记', '学霸笔记'],
  'stacked-data-cards': ['数据卡片', '论点卡', '数据卡'],
  'card-theater': ['卡片轮播', '轮播', '卡片剧场'],

  // ── 演示与动效 ────────────────────────────────────────────────────────
  'ppt-animation': ['ppt', '演示', '翻页', '幻灯片'],
  'phone-ui-demos': ['手机演示', '手机 ui', '录屏动画'],
  'video-shot-demos': ['视频演示', '分镜', '镜头', '演示动画'],
  'motion-primitives': ['动效', '动画', '过渡', 'motion'],

  // ── DSH 插件开发 ──────────────────────────────────────────────────────
  'dsh-plugin-port': ['插件移植', '移植', '打包插件'],
  'dsh-plugin-resolution': ['插件加载失败', '解析失败', '模块找不到', '报错'],
  'dsh-plugin-shipping': ['插件打包', '插件发布', '分发', '安装验收'],
  'dsh-plugin-ui-slots': ['插槽', '槽位', '座位', '界面挂载'],
  'dsh-upgrade-client-half': ['升级客户端', '客户端迁移', '前端迁移'],
  'dsh-upgrade-host-half': ['升级宿主', '宿主迁移', '后端迁移'],
  'dsh-upgrade-manifest-contract': ['清单契约', '构建契约', 'package 契约'],
  'dsh-upgrade-plugin-011-to-012': ['插件升级', '版本升级', '迁移'],

  // ── 代码卫生 ──────────────────────────────────────────────────────────
  'no-comments': ['注释', '代码注释', '清理注释', '无用注释'],
}

/**
 * 判断一个技能是否被 query 的**中文人话**命中。
 *
 * @param skillName - 技能规范名。
 * @param needle - 已 trim + 小写的 query。
 * @returns 任一同义词包含 needle 时为 true(子串,不是精确匹配)。
 */
export function matchesAlias(skillName: string, needle: string): boolean {
  const aliases = SKILL_ALIASES[skillName]
  if (aliases === undefined || needle === '') return false
  return aliases.some((alias) => alias.toLowerCase().includes(needle))
}
