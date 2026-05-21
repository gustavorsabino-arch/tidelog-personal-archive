/**
 * Resolves the effective GL account for a transaction's counterparty.
 *
 * Order (highest priority first):
 *   1. Per-tx override (tx_qb_state.counterparty_gl_override) — explicit
 *      "this specific tx needs a different GL than the counterparty default."
 *   2. Counterparty map (counterparty_gl_map.gl_account_number) — the
 *      memorized "this counterparty usually maps to this GL."
 *   3. null — no choice made yet; user must pick before posting.
 *
 * Pure — no DB, no I/O. Caller passes both layers.
 */
export function resolveCounterpartyGl({
  override,
  mapped,
}: {
  override: string | null
  mapped: string | null
}): string | null {
  return override ?? mapped ?? null
}
