// Pure GL resolution. Decides WHICH account number applies to a (wallet, token)
// movement and which tier it came from. No DB, no QB Ids — number space only.
// Empty strings are treated as unset (falsy), so a blank tier falls through.
export type GlSource = 'override' | 'token' | 'default'
export type ResolveWalletGlInput = {
  override?: string | null  // per-tx glAccountOverride
  perToken?: string | null  // wallet_token_account_code for (wallet, asset)
  default?: string | null   // wallet.account_code
}
export type ResolvedGl = { code: string | null; source: GlSource | null }

export function resolveWalletGl(input: ResolveWalletGlInput): ResolvedGl {
  if (input.override) return { code: input.override, source: 'override' }
  if (input.perToken) return { code: input.perToken, source: 'token' }
  if (input.default) return { code: input.default, source: 'default' }
  return { code: null, source: null }
}
