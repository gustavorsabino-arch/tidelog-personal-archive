// Pure GL resolution. Decides WHICH account number applies to a (wallet, token)
// movement and which tier it came from. No DB, no QB Ids — number space only.
export type GlSource = 'override' | 'token' | 'default'
export type ResolveWalletGlInput = {
  override?: string | null  // per-tx glAccountOverride
  perToken?: string | null  // wallet_token_account_code for (wallet, asset)
  default?: string | null   // wallet.account_code
}
export type ResolvedGl = { code: string | null; source: GlSource | null }

export function resolveWalletGl(i: ResolveWalletGlInput): ResolvedGl {
  if (i.override) return { code: i.override, source: 'override' }
  if (i.perToken) return { code: i.perToken, source: 'token' }
  if (i.default) return { code: i.default, source: 'default' }
  return { code: null, source: null }
}
