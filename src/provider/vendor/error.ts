/**
 * Vendored error classes — copies of the host's leaf modules:
 *   - `HarnessError`  <- packages/llm/llm/src/error.ts
 *   - `WebError`      <- packages/web/web/src/types.ts (`extends HarnessError`)
 *
 * WHY VENDORED: a plugin installed into a profile's `node_modules` gets plain
 * node resolution, and DSH ships `@deepseek-ai/*` as source only (no runtime
 * `lib/index.js`), so importing either class at runtime would throw
 * ERR_MODULE_NOT_FOUND on the user's install. Both leaves are zero-import, so
 * copying is safe.
 *
 * KNOWN LIMITATION (documented, accepted): the host's tool registry extracts
 * structured `{ name, code }` failure info with `error instanceof HarnessError`
 * (host class identity). A vendored instance is not a host instance, so
 * `web_search` failures surface the human-readable message but not the
 * structured code in the tool-failure `info`. Providers inside the DSH repo
 * (exa/perplexity/deepseek) keep the full info because they run under tsx
 * paths; a third-party plugin cannot obtain the host class without a runtime
 * import that must not exist.
 */

/**
 * Base class for all harness errors. Carries a `code` (stable, programmatic —
 * e.g. `WEB_PROVIDER_ERROR`) distinct from the human-readable `message`, and
 * supports `cause` chaining via the standard `ErrorOptions`.
 */
export class HarnessError extends Error {
  /** Stable machine-routable failure class; route on this, never by parsing `message`. */
  readonly code: string

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = new.target.name
  }
}

/**
 * Typed web error with a machine-routable, open-string `code` and chained
 * `cause`. Consumers must tolerate provider-specific codes; shared codes cover
 * cancellation (`WEB_ABORTED`) and provider failure (`WEB_PROVIDER_ERROR`).
 */
export class WebError extends HarnessError {}
