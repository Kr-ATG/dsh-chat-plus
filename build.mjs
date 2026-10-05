/**
 * dsh-chat-plus — build script.
 *
 * Two bundles from one esbuild run (模板：dsh-done-pill/build.mjs）：
 *
 *   lib/index.js   host half    ESM,  node platform,  self-contained
 *   lib/client.js  browser half CJS,  browser platform, wrapped in the
 *                  `window.__ModuleLoader__.load` factory contract
 *
 * host 半身没有任何运行时导入（apply 为 no-op），产物完全自包含——见
 * assertHostExternals()。client 半身只 external 平台种子词（react 家族）
 * 与 @deepseek-ai/*（运行时由 DSH client 模块表提供同一份实例）。
 *
 * Usage: node build.mjs
 */

import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH_CHECKOUT = process.env.DSH_CHECKOUT ?? 'D:/AI/deepseek-harness'
const PLUGIN_ID = 'dsh-chat-plus'

/** Resolve esbuild (own node_modules → DSH checkout pnpm store → error). */
function loadEsbuild() {
  const localRequire = createRequire(resolve(HERE, 'package.json'))
  try {
    return localRequire('esbuild')
  } catch {
    // Not installed locally; fall through to the checkout scan.
  }

  const store = join(DSH_CHECKOUT, 'node_modules', '.pnpm')
  const candidates = []
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('esbuild@')) continue
      candidates.push(join(store, entry, 'node_modules', 'esbuild'))
    }
  }
  if (candidates.length > 0) {
    const pick = candidates.sort().at(-1)
    return createRequire(resolve(pick, 'package.json'))(pick)
  }

  throw new Error(
    'dsh-chat-plus: cannot find esbuild.\n'
    + '  Run `pnpm install` in this directory (esbuild is a devDependency).\n'
    + `  Or set DSH_CHECKOUT to a DSH checkout to borrow its copy (currently: ${DSH_CHECKOUT}).`,
  )
}

const esbuild = loadEsbuild()

/** Platform seed words + react come from the DSH module table at runtime. */
const CLIENT_EXTERNAL = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
]

/** Browser half: one CJS factory registered with the host module loader. */
const clientBundle = {
  entryPoints: [resolve(HERE, 'src/client/index.ts')],
  outfile: resolve(HERE, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  sourcemap: true,
  logLevel: 'info',
  external: CLIENT_EXTERNAL,
  // @deepseek-ai/* 默认走运行时 require（模块表）；唯二例外随包内联：
  // schemastery + cosmokit —— 工作台「供应商」页要反序列化 settings schema
  // （webui/schema-path.ts），而这两个包不在浏览器模块表里，运行时 require 会炸。
  alias: {
    '@deepseek-ai/schemastery': resolve(HERE, 'src/vendor/schemastery/index.mjs'),
    '@deepseek-ai/cosmokit': resolve(HERE, 'src/vendor/cosmokit/index.js'),
  },
  plugins: [{
    name: 'chat-flow-external-platform',
    setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\// }, args => ({ path: args.path, external: true }))
    },
  }],
  banner: {
    js: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (__rawRequire) => {`,
      'const require = (id) => {',
      '  const mod = __rawRequire(id);',
      "  if (id === '@deepseek-ai/dsh-client-ui-primitives' && mod && typeof mod === 'object') {",
      '    return new Proxy(mod, {',
      '      get(target, prop) {',
      '        if (prop in target) return target[prop];',
      "        if (typeof prop === 'string') {",
      "          const regular = prop.replace(/\\d+$/, 'Regular');",
      '          if (regular in target) return target[regular];',
      "          const medium = prop.replace(/\\d+$/, 'Medium');",
      '          if (medium in target) return target[medium];',
      '        }',
      '        return target[prop];',
      '      }',
      '    });',
      '  }',
      '  return mod;',
      '};',
      'var module = { exports: {} };',
      'var exports = module.exports;',
      'Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    ].join('\n'),
  },
  footer: {
    js: 'return module.exports; } });',
  },
}

/**
 * host 产物里允许留给运行时解析的裸包名：**空**。
 *
 * 融合进来的四工作台 host 需要的 DSH 叶子模块全部 vendor 化在
 * `src/vendor/` 下（dsh-llm / dsh-tools / dsh-session / dsh-util-crypto /
 * usage-skill），所以产物对 `@deepseek-ai/*` 零运行时依赖。
 *
 * 曾经 `@deepseek-ai/dsh-util-crypto` 是例外（它有 lib/index.js 且自身零导入），
 * 实测证伪了：装进 profile 后裸 node 解析不到（profile 的 node_modules 里根本没
 * 有这个包，DSH 靠 tsx 的 tsconfig paths 才跑得起来），于是 smoke 在源码目录
 * 一 import 就 ERR_MODULE_NOT_FOUND。改 vendor 化后产物完全自包含。
 * 详见 src/vendor/README.md。
 */
const HOST_RUNTIME_EXTERNAL_ALLOWLIST = new Set([
  // 融合 dsh-provider-hub 后新增的三个：schemastery / cosmokit 由本插件的
  // alias 映射到 src/vendor 内联副本（构建期就地打进产物，不算运行时外部）；
  // undici 必须留给运行时——它的加载器按 process.versions.undici 挑同大版本
  // 实例，内联会锁死版本并与 Node 内置 fetch 的 dispatcher 协议对不上。
  'undici',
])

/** Host half: ESM, self-contained except node builtins and the allowlist. */
const hostBundle = {
  entryPoints: [resolve(HERE, 'src/host.ts')],
  outfile: resolve(HERE, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // host 半身不出 source map：Node 只有带 --enable-source-maps 时才会读它，
  // DSH 服务没开这个 flag，13.6MB 的 map 纯属占地方（也占 git 历史）。
  // client 半身的 map 保留 —— 浏览器 DevTools 默认会读，调插件前端要用。
  sourcemap: false,
  logLevel: 'info',
  external: [],
  // schemastery / cosmokit 随包内联（两个包都是零 cordis 依赖的纯工具库，
  // 不会与宿主产生第二份实例问题）；其余 @deepseek-ai/* 保持 external，
  // 由 assertHostExternals 兜住解析面。
  alias: {
    '@deepseek-ai/schemastery': resolve(HERE, 'src/vendor/schemastery/index.mjs'),
    '@deepseek-ai/cosmokit': resolve(HERE, 'src/vendor/cosmokit/index.js'),
  },
  // Any runtime CJS dep (none today) would need a real require: keep the guard.
  banner: {
    js: [
      "import { createRequire as __thinkToolsCreateRequire } from 'node:module';",
      'const require = __thinkToolsCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  plugins: [{
    name: 'chat-flow-external-platform',
    setup(build) {
      build.onResolve({ filter: /^(@deepseek-ai\/|node:)/ }, (args) => {
        if (args.path === '@deepseek-ai/schemastery' || args.path === '@deepseek-ai/cosmokit') return null
        return { path: args.path, external: true }
      })
      // undici 绝不可内联：代理加载器按 process.versions.undici 挑同大版本实例，
      // 内联会锁死版本并与 Node 内置 fetch 的 dispatcher 协议对不上。
      build.onResolve({ filter: /^undici$/ }, args => ({ path: args.path, external: true }))
    },
  }],
}

/** Fail the build if the host bundle still hands an unresolvable specifier. */
function assertHostExternals(outfile) {
  const source = readFileSync(outfile, 'utf8')
  const specifiers = new Set()
  for (const m of source.matchAll(/(?:^|[;\n])\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g)) {
    specifiers.add(m[1])
  }
  for (const m of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.add(m[1])
  }

  const violations = [...specifiers].filter((spec) => {
    if (spec.startsWith('node:')) return false
    return !HOST_RUNTIME_EXTERNAL_ALLOWLIST.has(spec)
  })

  if (violations.length > 0) {
    throw new Error(
      'dsh-chat-plus: host bundle imports packages that an installed plugin cannot resolve.\n'
      + violations.map(v => `  - ${v}`).join('\n')
      + '\n\n'
      + 'DSH ships @deepseek-ai/* as source only; a plugin inside a profile\'s\n'
      + 'node_modules gets plain node resolution and finds no lib/index.js.\n'
      + `Add the name to HOST_RUNTIME_EXTERNAL_ALLOWLIST in ${basename(fileURLToPath(import.meta.url))}\n`
      + 'after verifying the package really ships runtime JS.',
    )
  }
  return [...specifiers]
}

/**
 * 注入式 CSS 字符串守卫：产物里每个「赋值给标识符的模板字面量」都必须求值为
 * 字符串，且长度够大（真样式表至少几千字符）。
 *
 * 起因：TypeScript/esbuild **不会**转义写在模板字面量内部的反引号——包括
 * 写在 CSS 注释里的。一旦某条注释里出现一个反引号，模板就在那里提前闭合，
 * 剩下的正文被当作 JS 表达式求值，整段变成一个布尔比较（`false`）。产物语法
 * 完全合法，构建不报错、冒烟不报错，页面里那张 style 元素也真的建出来了，
 * 只是 textContent 是字符串 "false"：整张表静默全失，肉眼看就是「改了没反应」。
 * 这里逐个求值把它变成构建期硬失败。
 *
 * @param {string} outfile client 产物路径
 * @returns {number} 检查过的模板字面量数量
 */
function assertInjectedCssStrings(outfile) {
  const source = readFileSync(outfile, 'utf8')
  const TICK = String.fromCharCode(96)
  const violations = []
  let checked = 0
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== TICK) continue
    // 只看「紧跟在 = 或 return 之后的反引号」，其余（属性键、注释里的）跳过。
    const before = source.slice(Math.max(0, i - 24), i)
    if (!/=\s*$/.test(before) && !/return\s*$/.test(before)) continue
    // 配对扫描：跳过 \` 转义，直到未转义的收尾反引号。
    let j = i + 1
    let closed = -1
    while (j < source.length) {
      if (source[j] === '\\') { j += 2; continue }
      if (source[j] === TICK) { closed = j; break }
      j++
    }
    if (closed < 0) continue
    const literal = source.slice(i, closed + 1)
    // 含插值的模板（`${…}`）是正常的运行时字符串，不是注入式 CSS 常量：
    // 它们本来就该在调用时求值，跳过。
    if (literal.includes('${')) { i = closed; continue }
    // 只看够大的那种：真正的样式表至少几千字符，短模板不构成风险。
    if (literal.length < 200) { i = closed; continue }
    checked++
    let value
    try {
      // eslint-disable-next-line no-eval -- 构建期对自家产物求值，是本守卫的判据本身
      value = (0, eval)(literal)
    } catch (error) {
      violations.push(`  - offset ${i}: 模板字面量求值抛错 ${String(error)}`)
      i = closed
      continue
    }
    if (typeof value !== 'string') {
      violations.push(`  - offset ${i}: 求值得到 ${typeof value}（${String(value).slice(0, 32)}），`
        + '模板很可能被注释里的反引号提前闭合了')
    }
    i = closed
  }
  if (violations.length > 0) {
    throw new Error(
      'dsh-chat-plus: client 产物里有求值不出字符串的模板字面量。\n'
      + violations.join('\n')
      + '\n\n注入式 CSS 的正文与注释里都不能出现反引号 ` —— 它会让模板提前闭合，\n'
      + '整张样式表在运行时静默变成 false。注释请改用「直接子级」这类文字表述。\n',
    )
  }
  return checked
}

await Promise.all([esbuild.build(clientBundle), esbuild.build(hostBundle)])
const hostExternals = assertHostExternals(resolve(HERE, 'lib/index.js'))
assertInjectedCssStrings(resolve(HERE, 'lib/client.js'))
console.log('[dsh-chat-plus] built lib/index.js + lib/client.js')
console.log(`[dsh-chat-plus] host runtime imports: ${hostExternals.length === 0 ? '(none)' : hostExternals.join(', ')}`)
