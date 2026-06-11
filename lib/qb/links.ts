// Helpers for building user-facing deep links into QuickBooks Online.
//
// The exact URL format is QB's responsibility and has shifted over time. We
// route through these helpers so a future correction is a one-file change
// rather than a scattered grep-and-replace.
//
// Current format (QBO web app): https://app.qbo.intuit.com/app/journal?txnId=<id>
// — opens the JE detail view directly. (The path is `journal`, not
// `journalentry`.) If Intuit changes this we expect a noisy redirect rather
// than a silent break.
//
// We deliberately do NOT append `realmId`: QuickBooks opens a deep link in
// whichever company is ACTIVE in the user's session, and a `realmId` param does
// not switch companies — it bounces to an all-entities chooser instead. The JE
// id resolves against the active company, so callers must tell the user which
// company the link targets and let them switch first.

/**
 * Build a clickable URL to a specific QuickBooks Online journal entry.
 *
 * @param qbJournalEntryId QB's internal numeric Id for the JournalEntry record
 *   (from `qb_post.qb_journal_entry_id`). Returns null when missing so callers
 *   can render an inert label instead of a broken link.
 */
export function qbJeUrl(
  qbJournalEntryId: string | null | undefined,
): string | null {
  if (!qbJournalEntryId) return null
  const params = new URLSearchParams({ txnId: qbJournalEntryId })
  return `https://app.qbo.intuit.com/app/journal?${params.toString()}`
}

/**
 * Heuristic for whether a QB document number was created by tidelog's bulk
 * grouping flow (D6 — `BULK-{TOKEN}-{YYYY-MM}`). The drill-down panel keys off
 * this to decide whether to open a side panel or to deep-link straight to QB.
 *
 * We accept either a docNumber OR a postId match for callers that have richer
 * context (multiple txs sharing the same postId is also a bulk signal); this
 * function is the docNumber half.
 */
export function isBulkDocNumber(docNumber: string | null | undefined): boolean {
  if (!docNumber) return false
  return docNumber.startsWith('BULK-')
}
