/**
 * Vendored `credentialRef` — leaf module copy of
 * `packages/credentials/credentials/src/index.ts` (the branding function only,
 * zero imports). Vendor rationale: see ./error.ts header.
 */

/** Brand of an environment-variable-style credential reference. */
export type CredentialRef = string & { readonly __credentialRef?: unique symbol }

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Brand a raw string as a {@link CredentialRef}.
 * @param value - candidate reference; a POSIX shell identifier such as `ANYSEARCH_API_KEY`.
 * @returns the branded reference.
 */
export function credentialRef(value: string): CredentialRef {
  if (!REF_PATTERN.test(value)) {
    throw new TypeError(`credential ref "${value}" must match ${String(REF_PATTERN)}`)
  }
  return value as CredentialRef
}
