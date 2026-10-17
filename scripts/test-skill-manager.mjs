/**
 * dsh-triad — 技能管理 host 路由回归测试（技能身份 / 导入 / 删除 / 账本自愈）。
 *
 * 全程在临时目录里跑：DSH_AGENTS_HOME / DSH_HOME 指到 mkdtemp 出来的沙箱，
 * 不碰用户真实的 ~/.agents/skills 与 ~/.dsh/skills。
 *
 * Usage: node scripts/test-skill-manager.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { EventEmitter } from "node:events"

const sandbox = mkdtempSync(join(tmpdir(), "dsh-triad-skills-"))
process.env.DSH_AGENTS_HOME = join(sandbox, "agents")
process.env.DSH_HOME = join(sandbox, "dsh")
mkdirSync(join(process.env.DSH_AGENTS_HOME, "skills"), { recursive: true })
mkdirSync(join(process.env.DSH_HOME, "skills"), { recursive: true })

const SKILL = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\n---\n\nbody of ${name}\n`

// 预置：一个「目录名 != frontmatter name」的历史技能 + 按目录名记的账本条目
const agentsSkills = join(process.env.DSH_AGENTS_HOME, "skills")
mkdirSync(join(agentsSkills, "kr-wiki"), { recursive: true })
writeFileSync(join(agentsSkills, "kr-wiki", "SKILL.md"), SKILL("kb-wiki-skill", "知识库操作"))
writeFileSync(
  join(agentsSkills, ".bundles.json"),
  JSON.stringify({ version: 1, bundles: [
    { id: "kr", name: "Kr", skills: ["kr-wiki"] },
    { id: "empty", name: "空包", skills: [] },
    { id: "ghost", name: "有悬挂引用", skills: ["gone-skill"] },
  ] }, null, 2),
)

// vendor/ 在 dsh-triad 并入 dsh-chat-plus 时整体迁到了 src/vendor/（路径原来是 dsh-triad 的，
// 融合后没同步改，这个套件自那之后就一直是红的）。这里指向真实位置。
const mod = await import(pathToFileURL(join(process.cwd(), "src/vendor/usage-skill/skills-host.js")).href)
let handler = null
mod.apply({ effect: (fn) => fn(), webServer: { register: (route) => { handler = route.handler; return () => {} } } })
if (handler === null) { console.error("FAIL  route not registered"); process.exit(1) }

/** 打一次路由：method + url(+ 可选 JSON body) → { status, body }。 */
function call(method, url, body) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter()
    req.method = method
    req.url = url
    req.headers = { host: "localhost" }
    req.socket = { remoteAddress: "127.0.0.1" }
    const res = {
      statusCode: 0,
      writeHead(status) { this.statusCode = status },
      end(payload) {
        let parsed = payload
        try { parsed = JSON.parse(payload) } catch { /* 原样返回 */ }
        resolve({ status: this.statusCode, body: parsed })
      },
    }
    handler(req, res)
    queueMicrotask(() => {
      if (body === undefined) { req.emit("end"); return }
      req.emit("data", Buffer.from(JSON.stringify(body)))
      req.emit("end")
    })
  })
}

let failed = 0
function check(cond, msg) {
  if (cond) { console.log(`ok    ${msg}`) } else { failed += 1; console.error(`FAIL  ${msg}`) }
}
const b64 = (text) => Buffer.from(text, "utf8").toString("base64")

// ── 1. 账本自愈：按目录名记的成员要解析成规范技能，空包与悬挂引用要如实报出来
const first = (await call("GET", "/api/skill-manager/list")).body
const kr = first.bundles.find((b) => b.id === "kr")
check(kr !== undefined && kr.skillCount === 1, "目录名记的账本条目解析成功（技能包不再显示为空）")
check(kr?.skills?.[0]?.name === "kb-wiki-skill" && kr?.skills?.[0]?.dir === "kr-wiki", "技能同时带出规范名与目录名")
check((first.bundles.find((b) => b.id === "empty")?.skills ?? null) !== null, "空技能包出现在列表里（skillCount 0）")
check(first.bundles.find((b) => b.id === "empty")?.skillCount === 0, "空技能包 skillCount = 0")
check(first.bundles.find((b) => b.id === "ghost")?.missingSkills?.[0] === "gone-skill", "悬挂引用如实上报 missingSkills")
check(first.loose.every((s) => s.name !== "kb-wiki-skill"), "已归组的技能不再出现在散装区")
const healed = JSON.parse(readFileSync(join(agentsSkills, ".bundles.json"), "utf8"))
check(healed.bundles.find((b) => b.id === "kr").skills[0] === "kb-wiki-skill", "账本自愈：目录名条目改写成规范名")
check(healed.bundles.find((b) => b.id === "ghost").skills[0] === "gone-skill", "悬挂引用保留在账本里（由用户显式清理）")

// ── 2. 读文件：按规范名也要能读到（旧实现按目录名找 → 404）
const file = await call("GET", "/api/skill-manager/skills/kb-wiki-skill/files/SKILL.md")
check(file.status === 200 && String(file.body.content ?? "").includes("name: kb-wiki-skill"), "按规范名读取技能文件")

// ── 3. 导入文件夹：目录名与 SKILL.md 不一致时统一到用户填的名字，并改写 frontmatter
const imported = await call("POST", "/api/skill-manager/skills", {
  skillName: "my-tool",
  description: "",
  bundleId: "empty",
  files: [
    { path: "DropFolder/SKILL.md", data: b64(SKILL("inner-name", "拖进来的技能")) },
    { path: "DropFolder/references/a.md", data: b64("ref a") },
  ]
})
check(imported.status === 200 && imported.body.name === "my-tool", "导入返回规范名（面板填的名字优先）")
check(existsSync(join(agentsSkills, "my-tool", "SKILL.md")), "导入写到 <root>/my-tool/SKILL.md（顶层文件夹层已剥掉）")
check(!existsSync(join(agentsSkills, "my-tool", "DropFolder")), "没有把文件夹名嵌进技能目录")
check(readFileSync(join(agentsSkills, "my-tool", "SKILL.md"), "utf8").includes("name: my-tool"), "SKILL.md 的 name 同步改写，目录名=规范名")
const afterImport = (await call("GET", "/api/skill-manager/list")).body
check(afterImport.bundles.find((b) => b.id === "empty")?.skillCount === 1, "导入时归组：技能包立刻有技能（不再空包）")

// ── 4. 删除：按规范名删目录名不一致的技能
const deleted = await call("DELETE", "/api/skill-manager/skills/kb-wiki-skill")
check(deleted.status === 200 && deleted.body.removed?.[0]?.dir === "kr-wiki", "按规范名删除目录名不一致的技能")
check(!existsSync(join(agentsSkills, "kr-wiki")), "技能目录已移除")
const afterDelete = JSON.parse(readFileSync(join(agentsSkills, ".bundles.json"), "utf8"))
check(afterDelete.bundles.find((b) => b.id === "kr").skills.length === 0, "删除后账本里不再残留该成员")
const missing = await call("DELETE", "/api/skill-manager/skills/kb-wiki-skill")
check(missing.status === 400, "重复删除给出明确错误（而不是静默）")

// ── 5. 归组/移出：目录名与规范名都接受
const putByName = await call("PUT", "/api/skill-manager/bundles/ghost/skills", { skillNames: ["my-tool"] })
check(putByName.status === 200 && putByName.body.skillCount === 1, "setBundleSkills 接受规范名")
const putUnknown = await call("PUT", "/api/skill-manager/bundles/ghost/skills", { skillNames: ["nope-not-here"] })
check(putUnknown.status === 400, "未知技能名报错而不是静默丢成员")

// ── 6. 越界查询名与「不填名字」的导入
const traversal = await call("GET", "/api/skill-manager/skills/..%2F..%2Fetc/files/SKILL.md")
check(traversal.status === 400, "带路径分隔的技能名被拒（不再越界读技能根外的文件）")
const traversalDelete = await call("DELETE", "/api/skill-manager/skills/..%2F..%2Fagents")
check(traversalDelete.status === 400, "删除接口同样拒绝越界名")
const noName = await call("POST", "/api/skill-manager/skills", {
  description: "",
  files: [{ path: "whatever/SKILL.md", data: b64(SKILL("fallback-name", "没填名字")) }],
})
check(noName.status === 200 && noName.body.name === "fallback-name", "不填技能名时回落 SKILL.md 的 name")
check(existsSync(join(agentsSkills, "fallback-name", "SKILL.md")), "回落名建出的目录存在")

// ── 7. 构建产物里确实带上了这套修复（防止「源码改了没重新构建」）
const built = readFileSync(join(process.cwd(), "lib/index.js"), "utf8")
for (const marker of ["resolveSkillEntry", "normalizeUploadFiles", "setFrontmatterName", "missingSkills", "normalizeCategories"]) {
  check(built.includes(marker), `lib/index.js 含 ${marker}（构建产物已更新）`)
}

// ── 8. 技能包分类：老账本读成空数组，写入归一，PATCH 只改传进来的字段
const legacy = (await call("GET", "/api/skill-manager/list")).body
check(Array.isArray(legacy.bundles.find((b) => b.id === "kr")?.categories)
  && legacy.bundles.find((b) => b.id === "kr").categories.length === 0, "老账本（无 categories 字段）读成未分类，不报错")
const madeBundle = await call("POST", "/api/skill-manager/bundles", { name: "分类包", categories: ["开发", " 开发 ", "", 1, "设计"] })
check(madeBundle.status === 200 && JSON.stringify(madeBundle.body.categories) === JSON.stringify(["开发", "设计"]),
  "新建时分类去重去空白、非字符串丢弃")
const madeId = madeBundle.body.id
const dirty = await call("PATCH", "/api/skill-manager/bundles/" + madeId, {
  categories: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "  " + "x".repeat(40)],
})
check(dirty.status === 200 && dirty.body.categories.length === 8, "分类数量封顶 8 个")
check(dirty.body.categories[7].length <= 24, "单个分类长度封顶 24 字符")
check(dirty.body.name === "分类包", "PATCH 不带 name 时包名保持不变")
const renamed = await call("PATCH", "/api/skill-manager/bundles/" + madeId, { name: "改名包", categories: ["办公协同"] })
check(renamed.status === 200 && renamed.body.name === "改名包" && renamed.body.categories[0] === "办公协同",
  "PATCH 同时改名与改分类")
const ledgerCats = JSON.parse(readFileSync(join(agentsSkills, ".bundles.json"), "utf8")).bundles.find((b) => b.id === madeId)
check(JSON.stringify(ledgerCats.categories) === JSON.stringify(["办公协同"]), "分类落盘进 .bundles.json")
const putSkills = await call("PUT", "/api/skill-manager/bundles/" + madeId + "/skills", { skillNames: ["my-tool"] })
check(putSkills.status === 200 && JSON.stringify(putSkills.body.categories) === JSON.stringify(["办公协同"]),
  "改成员不丢分类（整条记录是展开写的，不是重建）")
const listed = (await call("GET", "/api/skill-manager/list")).body
check(listed.bundles.find((b) => b.id === madeId)?.categories?.[0] === "办公协同", "list 快照带出分类")
const badCatType = await call("PATCH", "/api/skill-manager/bundles/" + madeId, { categories: "开发" })
check(badCatType.status === 200 && Array.isArray(badCatType.body.categories), "categories 传非数组时按未处理忽略（不炸面板）")

rmSync(sandbox, { recursive: true, force: true })
console.log(failed === 0 ? "\nSKILL-MANAGER TEST PASSED" : `\nSKILL-MANAGER TEST FAILED (${String(failed)})`)
process.exit(failed === 0 ? 0 : 1)
