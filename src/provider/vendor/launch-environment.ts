/**
 * Vendored launch-environment leaf module — verbatim copy of
 * `packages/util/launch-environment/src/index.ts` (pure functions; only
 * `type { Context }` import, erased at build). Vendor rationale: see
 * ./error.ts header.
 */

import type { Context } from '@deepseek-ai/cordis'

/**
 * Which layer supplied a value, from most to least trusted: the environment
 * this process inherited, the invoking directory's `.env`, the Harness home's
 * `.env`.
 */
export type LaunchEnvironmentSource = 'process' | 'project-env' | 'user-env'

/** Layer order, most trusted first. */
const SOURCE_ORDER: readonly LaunchEnvironmentSource[] = ['process', 'project-env', 'user-env']

/** One resolved variable and the layer it came from. */
export interface LaunchEnvironmentEntry {
  /** The value as the layer supplied it; may be empty, which each owner judges for itself. */
  value: string
  /** The layer that supplied it. */
  source: LaunchEnvironmentSource
  /** Absolute path of the file that supplied it; absent for `process`. */
  path?: string
}

/**
 * The frozen environment of one launch. Nothing mutates it afterwards, so a
 * later `chdir`, workspace switch, or resumed session observes the same values
 * a consumer resolved at boot.
 */
export interface LaunchEnvironmentSnapshot {
  /**
   * Resolve one name across every layer, most trusted first.
   * @param name - the variable name.
   * @returns the winning entry, or `undefined` when no layer supplies it.
   */
  get(name: string): LaunchEnvironmentEntry | undefined
  /**
   * Resolve one name only from `sources`, retaining canonical trust order.
   * @param name - the variable name.
   * @param sources - the layers allowed in the canonical trust order.
   * @returns the first matching entry, or `undefined`.
   */
  getFrom(name: string, sources: readonly LaunchEnvironmentSource[]): LaunchEnvironmentEntry | undefined
}

/** The map key one variable name resolves under; Windows folds case. */
function lookupKey(name: string): string {
  return process.platform === 'win32' ? name.toUpperCase() : name
}

/** One layer's raw contents. */
export interface LaunchEnvironmentLayerInput {
  source: LaunchEnvironmentSource
  /** Absolute path of the file behind this layer; omit for `process`. */
  path?: string
  values: Readonly<Record<string, string>>
}

/** Build the snapshot from each layer's contents (canonical trust order search). */
export function createLaunchEnvironmentSnapshot(layers: readonly LaunchEnvironmentLayerInput[]): LaunchEnvironmentSnapshot {
  const bySource = new Map<LaunchEnvironmentSource, { path?: string; values: Map<string, string> }>()
  for (const layer of layers) {
    bySource.set(layer.source, {
      ...(layer.path === undefined ? {} : { path: layer.path }),
      values: new Map(Object.entries(layer.values).map(([name, value]) => [lookupKey(name), value])),
    })
  }
  const getFrom = (name: string, sources: readonly LaunchEnvironmentSource[]): LaunchEnvironmentEntry | undefined => {
    const key = lookupKey(name)
    for (const source of SOURCE_ORDER) {
      if (!sources.includes(source)) continue
      const layer = bySource.get(source)
      const value = layer?.values.get(key)
      if (value === undefined) continue
      return { value, source, ...(layer?.path === undefined ? {} : { path: layer.path }) }
    }
    return undefined
  }
  return {
    get: name => getFrom(name, SOURCE_ORDER),
    getFrom,
  }
}

/** Context slot the launcher fills with this run's snapshot before any config entry mounts. */
const DSH_LAUNCH_ENVIRONMENT_KEY = 'launchEnvironment'

/**
 * Return the launcher's snapshot, or the inherited environment as the sole
 * layer when the host provided none.
 * @param ctx - the consuming plugin's context.
 * @returns the snapshot to resolve user-facing values against.
 */
export function launchEnvironmentOf(ctx: Context): LaunchEnvironmentSnapshot {
  return ctx.get(DSH_LAUNCH_ENVIRONMENT_KEY)
    ?? createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env as Record<string, string> }])
}
