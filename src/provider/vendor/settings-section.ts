/**
 * Host-side settings wiring for dsh-web-search-anysearch — a faithful
 * re-implementation of the two host leaves this plugin needs, copied from:
 *   - `packages/settings/settings/src/index.ts` (`settingsNamespace` +
 *     `installSettingsSection`)
 *   - `@deepseek-ai/schemastery` minimal object-node semantics
 *
 * WHY NOT IMPORTED: a plugin installed into a profile's `node_modules` cannot
 * resolve `@deepseek-ai/dsh-settings` / `@deepseek-ai/schemastery` at runtime
 * (DSH ships them as source only). `installSettingsSection` itself is pure
 * cordis wiring (`ctx.inject` / `ctx.settings.register` / `ctx.fiber`) so it is
 * re-stated here against the same runtime APIs — no cordis import needed, the
 * `ctx` arrives as the plugin's `apply(ctx)` argument. The schema is replaced
 * by a minimal callable node covering exactly what the settings service
 * consumes: validation + defaults (callable), the structural view host
 * `redactSecrets` walks (`type` / `meta` / `dict`), and `toJSON()` for the
 * descriptor served to the client.
 */

import type { Context } from '@deepseek-ai/cordis'

// ── namespace brand ─────────────────────────────────────────────────────────

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/

/** Brand of a lowercase kebab-case settings namespace. */
export type SettingsNamespace = string & { readonly __settingsNamespace?: unique symbol }

/**
 * Brand a raw string as a {@link SettingsNamespace}.
 * @param value - candidate namespace; lowercase kebab-case, as in plugin short names.
 * @returns the branded namespace.
 */
export function settingsNamespace(value: string): SettingsNamespace {
  if (!NAMESPACE_PATTERN.test(value)) {
    throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`)
  }
  return value as SettingsNamespace
}

// ── minimal schemastery-compatible schema ───────────────────────────────────

/** Structural view of a schema node the host's `redactSecrets` walker needs. */
export interface SectionSchemaNode {
  type?: string
  meta?: { role?: unknown }
  /** `object` properties, keyed by property name. */
  dict?: Record<string, SectionSchemaNode>
  /** `dict`/`array` element schema. */
  inner?: SectionSchemaNode
}

/** One field's constraint in the section schema. */
export interface SectionFieldSpec {
  type: 'string' | 'number'
  /** Declared role, e.g. `secret` (redacted from wire surfaces) or `credential-ref`. */
  role?: string
  /** For numbers: inclusive minimum (1 keeps `maxResults` a positive count). */
  min?: number
  /** Value applied while the section carries none. */
  default?: unknown
}

/** What a schema built by {@link sectionSchema} resolves a section into. */
export type SectionSchema<T> = ((input: unknown) => T) & SectionSchemaNode & {
  toJSON(): unknown
}

/** Whether a value is a plain data object (not an array, null, or class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Validate and default one field's value; returns the normalized entry. */
function normalizeField(field: string, def: SectionFieldSpec, raw: unknown): unknown | undefined {
  if (raw === undefined) {
    return def.default === undefined ? undefined : def.default
  }
  if (def.type === 'string') {
    if (typeof raw !== 'string') {
      throw new TypeError(`settings section field "${field}" must be a string`)
    }
    return raw
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw new TypeError(`settings section field "${field}" must be an integer`)
  }
  if (def.min !== undefined && raw < def.min) {
    throw new TypeError(`settings section field "${field}" must be at least ${String(def.min)}`)
  }
  return raw
}

/**
 * Build a callable, redactable, JSON-serializable section schema.
 *
 * Callable: `schema(merged)` validates field types and applies per-field
 * defaults, returning a fresh plain object (unknown keys are dropped, exactly
 * like schemastery's `z.object`). Node view: `type:'object'` with `dict`
 * carrying each field's `{ type, meta }` so the host settings service's
 * `redactSecrets` walk strips `role('secret')` values off the wire. `toJSON()`
 * returns the JSON-safe node for the descriptor served to the client.
 * @param fields - field specs in declaration order.
 * @returns the schema object.
 */
export function sectionSchema<T extends Record<string, unknown>>(
  fields: Record<string, SectionFieldSpec>,
): SectionSchema<T> {
  const nodes: Record<string, SectionSchemaNode> = {}
  for (const [field, def] of Object.entries(fields)) {
    nodes[field] = {
      type: def.type,
      ...(def.role === undefined ? {} : { meta: { role: def.role } }),
    }
  }
  const schema = ((input: unknown) => {
    if (!isPlainObject(input)) {
      throw new TypeError('settings section must be an object of keys')
    }
    const out: Record<string, unknown> = {}
    for (const [field, def] of Object.entries(fields)) {
      const value = normalizeField(field, def, input[field])
      if (value !== undefined) out[field] = value
    }
    return out as T
  }) as SectionSchema<T>
  schema.type = 'object'
  schema.dict = nodes
  schema.toJSON = () => {
    // Schemastery reference envelope — the REAL serialization contract:
    // `{ uid, refs }` where inner nodes appear as numeric uids in the root
    // `dict` and every uid lands in `refs` (see schemastery
    // `Schema.prototype.toJSON`).
    //
    // This is mandatory: the browser half of ui-settings rehydrates the
    // descriptor's `schema` with `new Schema(serialized)` and marks the bound
    // namespace `ready` only when rehydration + validation succeed. A foreign
    // envelope silently leaves the scope `status: 'unavailable'` and the
    // settings card renders nothing (exactly the bug this comment guards).
    const rootUid = 1
    const refs: Record<string, unknown> = {}
    const dict: Record<string, unknown> = {}
    let nextUid = rootUid + 1
    for (const [field, node] of Object.entries(nodes)) {
      const uid = nextUid++
      refs[String(uid)] = {
        type: node.type,
        ...(node.meta === undefined ? {} : { meta: node.meta }),
      }
      dict[field] = uid
    }
    refs[String(rootUid)] = { type: 'object', dict }
    return { uid: rootUid, refs }
  }
  return schema
}

// ── installSettingsSection equivalent ───────────────────────────────────────

/**
 * Value mirror of the `FiberState` members {@link isUnloading} compares
 * against: a const enum has no runtime object to import, and the value is
 * needed at runtime (same approach as the host's settings package).
 */
const FIBER_DISPOSED = 4
const FIBER_UNLOADING = 5

/** Whether the consumer's own fiber is tearing down. */
function isUnloading(ctx: Context): boolean {
  const state: number = (ctx as { fiber?: { state?: number } }).fiber?.state ?? 0
  return state === FIBER_UNLOADING || state === FIBER_DISPOSED
}

/** Hooks a consumer hands to {@link installSettingsSection}. */
export interface SettingsSectionHooks<T> {
  /**
   * Receive the active configuration source: the resolved settings scope
   * while one is attached, the composition entry otherwise.
   * @param current - thunk returning the currently authoritative value.
   */
  setSource(current: () => T): void
  /**
   * Re-judge anything derived from the source after an attach, a detach, or a
   * committed change.
   */
  onChange(): void
}

/**
 * Install the canonical optional-settings consumer wiring (equivalent of the
 * host's `installSettingsSection`): while a settings service exists, register
 * `ns` with the consumer's composition entry as the `base` layer and point the
 * source thunk at the resolved scope; when the service goes away, fall back to
 * the entry so the provider keeps working exactly as composed. The
 * registration rides the scoped fiber: no settings service ever mounted means
 * none of this runs, and the provider still registers with plain config.
 * @param ctx - consumer plugin context owning the wiring.
 * @param ns - the consumer-owned settings namespace.
 * @param schema - schema resolving the namespace.
 * @param entry - the consumer's composition entry config, used as `base`.
 * @param hooks - source sink and change notification.
 */
export function installSettingsSection<T>(
  ctx: Context,
  ns: SettingsNamespace,
  schema: SectionSchema<T>,
  entry: T,
  hooks: SettingsSectionHooks<T>,
): void {
  ctx.inject(['settings'], (sctx) => {
    if (typeof sctx.settings?.register !== 'function') return
    const scope = sctx.settings.register(ns, schema, { base: entry })
    hooks.setSource(() => scope.get())
    sctx.effect(() => () => {
      // Disposal: provider detaching keeps the consumer running, so it must
      // fall back to its composition entry; the consumer's own unload must not
      // re-judge derived state while teardown releases resources.
      if (isUnloading(ctx)) return
      hooks.setSource(() => entry)
      hooks.onChange()
    })
    hooks.onChange()
    scope.watch(() => {
      if (isUnloading(ctx)) return
      hooks.onChange()
    })
  })
}
