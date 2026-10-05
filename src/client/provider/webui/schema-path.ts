/**
 * dsh-provider-hub — settings schema 同步工具（vendor）。
 *
 * 逐字移植自 DSH 官方 `packages/client/ui-settings/src/client/schema.ts`
 * （`SettingsSchemaService` 的纯函数部分），让 webui 供应商页（store /
 * ChatProviderList / ChatProviderDetail）在本插件的浏览器包里跑起来：
 * 当前 DSH 的 client 模块表只含 8 个平台模块，`@deepseek-ai/dsh-client-
 * schema-form` 不在表内，不能运行时 require，只能随包内联。
 *
 * 唯一例外是 schema 反序列化：官方调 `new Schema(json)`（schemastery），
 * 这里同样用随包内联的 `@deepseek-ai/schemastery`（见 build.mjs 的
 * client 外部化例外），行为与官方一致。
 */
import Schema from '../../../vendor/schemastery/index.mjs'

/** Live schemastery node（与官方 SchemaNode 同义）。 */
export type SchemaNode = InstanceType<typeof Schema>

function cloneContainer(container: unknown, key: string): Record<string, unknown> | unknown[] {
  if (Array.isArray(container)) return [...container as unknown[]]
  if (typeof container === 'object' && container !== null) return { ...container as Record<string, unknown> }
  return /^\d+$/.test(key) ? [] : {}
}

function cloneSpine(root: Record<string, unknown>, path: readonly string[]): {
  result: Record<string, unknown>
  parent: Record<string, unknown> | unknown[]
  leaf: string
} {
  const result = { ...root }
  let target: Record<string, unknown> | unknown[] = result
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index] as string
    const child = cloneContainer(
      Array.isArray(target) ? target[Number(key)] : target[key],
      path[index + 1] as string,
    )
    if (Array.isArray(target)) target[Number(key)] = child
    else target[key] = child
    target = child
  }
  return { result, parent: target, leaf: path[path.length - 1] as string }
}

/**
 * 反序列化一份 `schema.toJSON()` 信封为 live schema 节点（与官方 rehydrate 同义）。
 */
export function rehydrateSchema(serialized: unknown): SchemaNode {
  return new (Schema as any)(serialized) as SchemaNode
}

/**
 * 校验 settings 草稿，返回失败文本，无错返回 undefined（与官方 validate 同义）。
 */
export function validateDraft(schema: SchemaNode, draft: unknown): string | undefined {
  try {
    ;(schema as unknown as (value: unknown) => unknown)(draft)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * 沿 settings 路径解析 object/dict/array schema 节点（与官方 nodeAtPath 同义）。
 */
export function nodeAtPath(root: SchemaNode, path: readonly string[]): SchemaNode | undefined {
  let node: SchemaNode | undefined = root
  for (const key of path) {
    if (node === undefined) return undefined
    if ((node as any).type === 'object') node = ((node as any).dict as Record<string, SchemaNode> | undefined)?.[key]
    else if ((node as any).type === 'dict' || (node as any).type === 'array') node = (node as any).inner as SchemaNode | undefined
    else return undefined
  }
  return node
}

/**
 * 按字符串键/数组下标读嵌套值（与官方 getPath 同义）。
 */
export function getPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (Array.isArray(current)) {
      current = current[Number(key)]
      continue
    }
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * 路径终点是否存在（与值无关；与官方 hasPath 同义）。
 */
export function hasPath(value: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return value !== undefined
  const parent = getPath(value, path.slice(0, -1))
  const key = path[path.length - 1] as string
  if (Array.isArray(parent)) return Number(key) < parent.length
  if (typeof parent !== 'object' || parent === null) return false
  return key in parent
}

/**
 * 不可变深设置（缺失容器自动物化；与官方 setPath 同义）。
 */
export function setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) throw new Error('dsh-provider-hub: setPath needs a non-empty path')
  const { result, parent, leaf } = cloneSpine(root, path)
  if (Array.isArray(parent)) parent[Number(leaf)] = value
  else parent[leaf] = value
  return result
}

/**
 * 不可变深删除（路径缺席返回原对象；与官方 deletePath 同义）。
 */
export function deletePath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  if (path.length === 0) throw new Error('dsh-provider-hub: deletePath needs a non-empty path')
  if (!hasPath(root, path)) return root
  const { result, parent, leaf } = cloneSpine(root, path)
  if (Array.isArray(parent)) parent.splice(Number(leaf), 1)
  else Reflect.deleteProperty(parent, leaf)
  return result
}
