/**
 * dsh-triad — 技能开关回归测试（目录名 ≠ frontmatter name 时开关是否还打得动）。
 *
 * 直接跑构建产物 lib/index.js：DSH_AGENTS_HOME / DSH_HOME 指到临时目录，
 * 不碰用户真实技能。Usage: node scripts/test-skill-toggles.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { EventEmitter } from "node:events"

const sandbox = mkdtempSync(join(tmpdir(), "dsh-triad-toggles-"))
process.env.DSH_AGENTS_HOME = join(sandbox, "agents")
process.env.DSH_HOME = join(sandbox, "dsh")
const agentsSkills = join(process.env.DSH_AGENTS_HOME, "skills")
mkdirSync(join(process.env.DSH_HOME, "skills"), { recursive: true })
mkdirSync(agentsSkills, { recursive: true })

// 目录名 odd-dir，frontmatter 规范名 canon-name —— 面板/账本给的都是 canon-name
mkdirSync(join(agentsSkills, "odd-dir"), { recursive: true })
writeFileSync(join(agentsSkills, "odd-dir", "SKILL.md"), "---\nname: canon-name\ndescription: 目录名不一致的技能\n---\n\nbody\n")
writeFileSync(join(agentsSkills, ".bundles.json"), JSON.stringify({ version: 1, bundles: [{ id: "odd", name: "Odd", skills: ["odd-dir"] }] }, null, 2))

const mod = await import(pathToFileURL(join(process.cwd(), "lib/index.js")).href)
const routes = new Map()
const noop = () => () => {}
const ctx = {
  logger: { info: noop(), warn: noop(), debug: noop() },
  webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } },
  tools: { register: noop() },
  on: () => () => {},
  get: () => undefined,
  effect: (fn) => { fn?.(); return () => {} },
  /*
   * 延迟注入桩：host 半身的 apply 全部走 ctx.inject([...], cb)。
   * 桩里「服务齐全」= 立刻同步执行回调（与 cordis 在依赖就绪时的行为一致），
   * 否则 apply 一进来就 TypeError（2026-10-17 实测该测试早已红）。
   */
  inject: (deps, cb) => { cb(ctx) },
  settings: { get: () => ({ providers: {} }), register: () => () => {} },
  credentials: {}, sessions: {}, sessionPersistence: {}, llm: {},
}
await mod.apply(ctx, {})
/*
 * 等延迟注入里的异步装配跑完。
 *
 * applyTriadHost 是 async，内部 `await applySkillToggles(ctx)` 才把
 * /api/skill-toggles 挂上去；而 ctx.inject 的回调是同步返回的，await 链挂在
 * 微任务里。不让出几轮事件循环，下面第一发请求会撞上「route not mounted」。
 */
for (let i = 0; i < 50 && !routes.has("/api/skill-toggles"); i += 1) {
  await new Promise(resolve => setTimeout(resolve, 20))
}

function call(prefix, method, url, body) {
  const handler = routes.get(prefix)
  if (handler === undefined) throw new Error(`route ${prefix} not mounted`)
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
        try { parsed = JSON.parse(payload) } catch { /* 原样 */ }
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
const check = (cond, msg) => { if (cond) console.log(`ok    ${msg}`); else { failed += 1; console.error(`FAIL  ${msg}`) } }
const TOGGLES = "/api/skill-toggles"
const SKILL_MD = join(agentsSkills, "odd-dir", "SKILL.md")

// 1. 按规范名禁用：旧实现只按目录名定位 → not found，面板开关点了没反应
const off = await call(TOGGLES, "PUT", "/api/skill-toggles/skills/canon-name", { enabled: false })
check(off.status === 200 && off.body.ok === true, "按规范名禁用目录名不一致的技能")
check(readFileSync(SKILL_MD, "utf8").includes("user-invocable: false"), "SKILL.md 写入禁用字段")

// 2. 状态表按规范名回报
const status = await call(TOGGLES, "GET", "/api/skill-toggles/status")
check(status.body.skills["canon-name"] === false, "status 按规范名回报禁用状态")

// 3. 整包开关：账本条目是目录名也要能处理
const bundleOn = await call(TOGGLES, "PUT", "/api/skill-toggles/bundles/odd", { enabled: true })
check(bundleOn.status === 200 && bundleOn.body.handled === 1, "整包开关按目录名条目也能命中成员")
check(!readFileSync(SKILL_MD, "utf8").includes("user-invocable: false"), "整包启用后禁用字段已移除")

// 4. 整包状态：目录名条目要能查到规范名的状态
const off2 = await call(TOGGLES, "PUT", "/api/skill-toggles/skills/canon-name", { enabled: false })
const status2 = await call(TOGGLES, "GET", "/api/skill-toggles/status")
check(off2.status === 200 && status2.body.bundles.odd === false, "整包状态跟随成员禁用（不再因别名漏判）")

// 5. 预设层：整包关闭要按规范名写账本
const preset = await call(TOGGLES, "PUT", "/api/skill-toggles/presets/standard/bundles/odd", { enabled: false })
check(preset.status === 200 && preset.body.changed === 1, "预设层整包关闭写入规范名")
const ledger = JSON.parse(readFileSync(join(agentsSkills, ".preset-skills.json"), "utf8"))
check(ledger.presets.standard["canon-name"] === false, "预设账本键为规范名（闸门才遮得住）")

rmSync(sandbox, { recursive: true, force: true })
console.log(failed === 0 ? "\nSKILL-TOGGLES TEST PASSED" : `\nSKILL-TOGGLES TEST FAILED (${String(failed)})`)
process.exit(failed === 0 ? 0 : 1)
