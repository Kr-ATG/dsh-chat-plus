/**
 * 工作台本地资产收集与还原（档案、记忆、技能）。
 *
 * 不碰系统提示词与全局设定。所有写盘走原子写与目录递归保护。
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { getWebuiMemoryStore } from '../memory-store-singleton.js'
import { memoryHome } from '../memory/engine/store.js'
import { VaultCipher } from '../vault/crypto.js'
import { VaultStore, vaultHome } from '../vault/store.js'

function dshHome(): string {
  const env = process.env.DSH_HOME
  return env !== undefined && env.trim() !== '' ? env.trim() : join(homedir(), '.dsh')
}

export function skillsHome(): string {
  return join(dshHome(), 'skills')
}

export interface GatheredVault {
  key?: string
  vaultJson?: string
  blobs?: Array<{ sha256: string; base64: string }>
}

export interface GatheredMemory {
  entriesJson?: string
  stateJson?: string
  projects?: Record<string, string> // projectHash -> meta.json text
}

export interface GatheredSkills {
  files: Record<string, string> // relativePath -> base64
}

export interface GatheredWorkbenchPayload {
  format: 'dsh-workbench-sync'
  version: 1
  createdAt: string
  vault?: GatheredVault
  memory?: GatheredMemory
  skills?: GatheredSkills
}

/** 递归统计目录大小（支持忽略以 . 开头的隐藏目录/回收站）。 */
export async function getDirSize(dirPath: string, ignoreHidden = false): Promise<number> {
  if (!existsSync(dirPath)) return 0
  let total = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (ignoreHidden && entry.name.startsWith('.')) continue
      const full = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += await getDirSize(full, ignoreHidden)
      } else if (entry.isFile()) {
        const s = await stat(full)
        total += s.size
      }
    }
  } catch {
    // 忽略部分临时文件或无权限读取
  }
  return total
}

/** 精准统计纯净核心业务资产体积（排除同步运行历史账本、审计追加日志与回收站，保持数据无变动时体积绝对恒定）。 */
export async function getWorkbenchSizes(): Promise<{
  vaultBytes: number
  memoryBytes: number
  skillsBytes: number
  totalBytes: number
}> {
  // 1. 档案：vault.json + key + blobs/（排除 store/workbench-sync.json 运行历史与 audit.jsonl 审计日志）
  let vaultBytes = 0
  const vRoot = vaultHome()
  if (existsSync(join(vRoot, 'vault.json'))) {
    vaultBytes += (await stat(join(vRoot, 'vault.json')).catch(() => ({ size: 0 }))).size
  }
  if (existsSync(join(vRoot, 'key'))) {
    vaultBytes += (await stat(join(vRoot, 'key')).catch(() => ({ size: 0 }))).size
  }
  const blobsDir = join(vRoot, 'blobs')
  if (existsSync(blobsDir)) {
    vaultBytes += await getDirSize(blobsDir, true)
  }

  // 2. 记忆：entries.json + state.json + projects/（排除日常运行追加的 changes/*.jsonl）
  let memoryBytes = 0
  const mRoot = memoryHome()
  const entriesFile = join(mRoot, 'store', 'entries.json')
  const stateFile = join(mRoot, 'store', 'state.json')
  if (existsSync(entriesFile)) {
    memoryBytes += (await stat(entriesFile).catch(() => ({ size: 0 }))).size
  }
  if (existsSync(stateFile)) {
    memoryBytes += (await stat(stateFile).catch(() => ({ size: 0 }))).size
  }
  const projectsDir = join(mRoot, 'projects')
  if (existsSync(projectsDir)) {
    memoryBytes += await getDirSize(projectsDir, true)
  }

  // 3. 技能：skills/ 目录下的自定义技能（排除 .trash 回收站）
  let skillsBytes = 0
  const sRoot = skillsHome()
  if (existsSync(sRoot)) {
    skillsBytes += await getDirSize(sRoot, true)
  }

  return {
    vaultBytes,
    memoryBytes,
    skillsBytes,
    totalBytes: vaultBytes + memoryBytes + skillsBytes,
  }
}

/** 收集本地档案数据。 */
async function gatherVault(store: VaultStore): Promise<GatheredVault> {
  const root = store.root
  const keyFile = store.keyFile
  let key: string | undefined
  if (existsSync(keyFile)) {
    try {
      const keyBuf = await readFile(keyFile)
      key = keyBuf.toString('base64')
    } catch {}
  }
  const vaultJsonFile = join(root, 'vault.json')
  let vaultJson: string | undefined
  if (existsSync(vaultJsonFile)) {
    try {
      vaultJson = await readFile(vaultJsonFile, 'utf8')
    } catch {}
  }

  // 收集图片 blobs
  const blobs: Array<{ sha256: string; base64: string }> = []
  try {
    const snapshot = await store.blobs.snapshot()
    for (const item of snapshot) {
      const buf = await store.blobs.read(item.sha256)
      if (buf !== null && buf.length > 0) {
        blobs.push({ sha256: item.sha256, base64: buf.toString('base64') })
      }
    }
  } catch {}

  return { key, vaultJson, blobs }
}

/** 收集本地记忆数据。 */
async function gatherMemory(): Promise<GatheredMemory> {
  const root = memoryHome()
  const entriesFile = join(root, 'store', 'entries.json')
  const stateFile = join(root, 'store', 'state.json')
  let entriesJson: string | undefined
  let stateJson: string | undefined
  if (existsSync(entriesFile)) {
    try { entriesJson = await readFile(entriesFile, 'utf8') } catch {}
  }
  if (existsSync(stateFile)) {
    try { stateJson = await readFile(stateFile, 'utf8') } catch {}
  }

  const projects: Record<string, string> = {}
  const projectsDir = join(root, 'projects')
  if (existsSync(projectsDir)) {
    try {
      const hashes = await readdir(projectsDir)
      for (const hash of hashes) {
        const metaFile = join(projectsDir, hash, 'meta.json')
        if (existsSync(metaFile)) {
          projects[hash] = await readFile(metaFile, 'utf8')
        }
      }
    } catch {}
  }

  return { entriesJson, stateJson, projects }
}

/** 递归收集目录下的所有文件（自动排除以 . 开头的隐藏目录/回收站/系统隐藏文件）。 */
async function collectFilesRecursively(dir: string, baseDir: string, out: Record<string, string>): Promise<void> {
  if (!existsSync(dir)) return
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    // 排除以 . 开头的隐藏目录（如 .trash, .git 等）与隐藏文件
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await collectFilesRecursively(full, baseDir, out)
    } else if (entry.isFile()) {
      try {
        const rel = relative(baseDir, full).replace(/\\/g, '/')
        const buf = await readFile(full)
        out[rel] = buf.toString('base64')
      } catch {}
    }
  }
}

/** 收集自定义技能文件。 */
async function gatherSkills(): Promise<GatheredSkills> {
  const root = skillsHome()
  const files: Record<string, string> = {}
  if (existsSync(root)) {
    await collectFilesRecursively(root, root, files)
  }
  return { files }
}

/** 整体收集工作台本地资产。 */
export async function gatherWorkbenchAssets(options: {
  includeVault: boolean
  includeMemory: boolean
  includeSkills: boolean
  vaultStore: VaultStore
}): Promise<GatheredWorkbenchPayload> {
  const [vault, memory, skills] = await Promise.all([
    options.includeVault ? gatherVault(options.vaultStore) : undefined,
    options.includeMemory ? gatherMemory() : undefined,
    options.includeSkills ? gatherSkills() : undefined,
  ])

  return {
    format: 'dsh-workbench-sync',
    version: 1,
    createdAt: new Date().toISOString(),
    ...(vault ? { vault } : {}),
    ...(memory ? { memory } : {}),
    ...(skills ? { skills } : {}),
  }
}

/** 原子写文本。 */
async function atomicWriteFile(filePath: string, content: Buffer | string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = filePath + '.tmp-' + String(Date.now())
  await writeFile(tmp, content)
  await rename(tmp, filePath).catch(async () => {
    // Windows rename 目标已存在时抛 EPERM，先 unlink
    await unlink(filePath).catch(() => undefined)
    await rename(tmp, filePath)
  })
}

/** 还原档案数据。 */
export async function restoreVault(vault: GatheredVault, store: VaultStore): Promise<{ records: number }> {
  let recordsCount = 0
  if (vault.key) {
    const keyBuf = Buffer.from(vault.key, 'base64')
    const cipher = VaultCipher.fromKey(keyBuf)
    await store.replaceCipher(cipher)
  }
  if (vault.vaultJson) {
    try {
      const parsed = JSON.parse(vault.vaultJson) as { records?: unknown[]; scenes?: unknown[] }
      if (Array.isArray(parsed.records)) {
        const vaultJsonFile = join(store.root, 'vault.json')
        if (existsSync(vaultJsonFile)) {
          await atomicWriteFile(vaultJsonFile + '.bak-before-sync', await readFile(vaultJsonFile)).catch(() => undefined)
        }
        recordsCount = parsed.records.length
        await store.replaceAll({
          records: parsed.records as never,
          ...(Array.isArray(parsed.scenes) ? { scenes: parsed.scenes as never } : {}),
        })
      }
    } catch {}
  }
  if (Array.isArray(vault.blobs)) {
    for (const b of vault.blobs) {
      try {
        const buf = Buffer.from(b.base64, 'base64')
        await store.blobs.put(buf, { width: 0, height: 0, photoId: 'sync:' + b.sha256.slice(0, 12) })
      } catch {}
    }
  }
  return { records: recordsCount }
}

/** 还原记忆数据（含覆盖前安全备份与孤儿项目目录隔离）。 */
export async function restoreMemory(memory: GatheredMemory): Promise<{ entries: number }> {
  const root = memoryHome()
  let entriesCount = 0
  if (memory.entriesJson) {
    const entriesFile = join(root, 'store', 'entries.json')
    // 覆盖前自动生成本地安全快照备份，防误操作
    if (existsSync(entriesFile)) {
      await atomicWriteFile(entriesFile + '.bak-before-sync', await readFile(entriesFile)).catch(() => undefined)
    }
    await atomicWriteFile(entriesFile, memory.entriesJson)
    try {
      const parsed = JSON.parse(memory.entriesJson) as { entries?: unknown[] }
      if (Array.isArray(parsed.entries)) entriesCount = parsed.entries.length
    } catch {}
  }
  if (memory.stateJson) {
    const stateFile = join(root, 'store', 'state.json')
    await atomicWriteFile(stateFile, memory.stateJson)
  }
  if (memory.projects) {
    for (const [hash, metaJson] of Object.entries(memory.projects)) {
      const metaFile = join(root, 'projects', hash, 'meta.json')
      await atomicWriteFile(metaFile, metaJson)
    }
    // 孤儿项目目录隔离（云端已无引用的废弃项目）
    try {
      const projectsDir = join(root, 'projects')
      if (existsSync(projectsDir)) {
        const localHashes = await readdir(projectsDir)
        const remoteHashes = new Set(Object.keys(memory.projects))
        for (const h of localHashes) {
          if (!remoteHashes.has(h)) {
            const trashDir = join(root, '.trash')
            await mkdir(trashDir, { recursive: true })
            await rename(join(projectsDir, h), join(trashDir, `${Date.now()}-project-${h}`)).catch(() => undefined)
          }
        }
      }
    } catch {}
  }

  // 通知内存态重载
  const activeStore = getWebuiMemoryStore() as { reload?: () => void } | undefined
  if (activeStore && typeof activeStore.reload === 'function') {
    activeStore.reload()
  }

  return { entries: entriesCount }
}

/** 还原技能数据（含孤儿技能安全隔离清理与内置技能防删保护）。 */
export async function restoreSkills(skills: GatheredSkills): Promise<{ files: number; removedSkills: number }> {
  const root = skillsHome()
  if (!existsSync(root)) {
    await mkdir(root, { recursive: true })
  }

  // 1. 整理云端包包含的顶层技能目录
  const remoteTopDirs = new Set<string>()
  for (const relPath of Object.keys(skills.files)) {
    const normalized = relPath.replace(/\\/g, '/')
    const parts = normalized.split('/')
    if (parts.length > 0 && parts[0] && !parts[0].startsWith('.')) {
      remoteTopDirs.add(parts[0])
    }
  }

  // 2. 识别本地需要被清理的孤儿技能目录（在云端包中已被删除的自定义技能）
  let removedCount = 0
  try {
    const localEntries = await readdir(root, { withFileTypes: true })
    const trashRoot = join(root, '.trash')

    for (const entry of localEntries) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      // 保护项 1：隐藏目录（.trash 等）不清理
      if (name.startsWith('.')) continue

      const fullPath = join(root, name)
      // 保护项 2：随包分发的内置技能绝对不清理
      const isBundled = existsSync(join(fullPath, '.dsh-chat-plus-bundled.json'))
      if (isBundled) continue

      // 如果云端包内已不包含该技能目录下的任何文件，说明在云端已被删除
      if (!remoteTopDirs.has(name)) {
        await mkdir(trashRoot, { recursive: true })
        const dest = join(trashRoot, `${Date.now()}-${name}`)
        await rename(fullPath, dest).catch(async () => {
          await cp(fullPath, dest, { recursive: true }).catch(() => undefined)
          await rm(fullPath, { recursive: true, force: true }).catch(() => undefined)
        })
        removedCount++
      }
    }
  } catch {}

  // 3. 写入/恢复云端包内文件
  let count = 0
  for (const [relPath, base64] of Object.entries(skills.files)) {
    const full = join(root, relPath)
    const buf = Buffer.from(base64, 'base64')
    await atomicWriteFile(full, buf)
    count++
  }

  return { files: count, removedSkills: removedCount }
}
