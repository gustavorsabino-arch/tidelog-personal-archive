// Maps a sheet/roster class name to QuickBooks' live class vocabulary.
// QB uses "Ops" (not the sheet's "Operations") and "Finance" (not
// "Finance & Accounting"); everything else passes through unchanged.
const RELABEL: Record<string, string> = {
  'operations': 'Ops',
  'finance & accounting': 'Finance',
}
export function reconcileClassName(name: string): string {
  const trimmed = name.trim()
  return RELABEL[trimmed.toLowerCase()] ?? trimmed
}
