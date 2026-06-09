export type QbAccountLite = { qbAccountNumber: string; qbAccountName: string }
export type GlOption = { value: string; label: string }

export function toGlOptions(accounts: QbAccountLite[]): GlOption[] {
  return accounts.map((a) => ({ value: a.qbAccountNumber, label: `${a.qbAccountNumber} · ${a.qbAccountName}` }))
}

export function filterGlOptions(options: GlOption[], query: string): GlOption[] {
  const q = query.toLowerCase().trim()
  if (!q) return options
  return options.filter((o) => o.label.toLowerCase().includes(q))
}

export function isOrphanValue(value: string | null, accounts: QbAccountLite[]): boolean {
  if (!value) return false
  if (accounts.length === 0) return false
  return !accounts.some((a) => a.qbAccountNumber === value)
}
