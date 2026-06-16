// Pure mappers + lookups for the QB class & vendor catalogs. No DB, no I/O —
// safe to import from both the cron (lib/cron/fetch-qb-reports) and cache-reads.

export type QbClassRow = { entityId: string; qbClassId: string; qbClassName: string; fetchedAt: Date }
export type QbVendorRow = { entityId: string; qbVendorId: string; displayName: string; fetchedAt: Date }

type RawClass = { Id?: string; Name?: string; FullyQualifiedName?: string; Active?: boolean }
type RawVendor = { Id?: string; DisplayName?: string; Active?: boolean }

// Active classes only; store the fully-qualified name so sub-classes (e.g.
// "Ops:Ops - Global Colo") are distinguishable from their top-level parent.
export function mapQbClassesToRows(entityId: string, classes: RawClass[], now: Date): QbClassRow[] {
  return classes
    .filter((c) => c.Id && (c.FullyQualifiedName || c.Name) && c.Active !== false)
    .map((c) => ({
      entityId,
      qbClassId: String(c.Id),
      qbClassName: String(c.FullyQualifiedName || c.Name),
      fetchedAt: now,
    }))
}

export function mapQbVendorsToRows(entityId: string, vendors: RawVendor[], now: Date): QbVendorRow[] {
  return vendors
    .filter((v) => v.Id && v.DisplayName && v.Active !== false)
    .map((v) => ({
      entityId,
      qbVendorId: String(v.Id),
      displayName: String(v.DisplayName),
      fetchedAt: now,
    }))
}

export function classByName(rows: QbClassRow[]): Map<string, QbClassRow> {
  const m = new Map<string, QbClassRow>()
  for (const r of rows) m.set(r.qbClassName, r)
  return m
}

export function vendorByName(rows: QbVendorRow[]): Map<string, QbVendorRow> {
  const m = new Map<string, QbVendorRow>()
  for (const r of rows) m.set(r.displayName, r)
  return m
}
