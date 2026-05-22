import { fetchQboJson } from './client'
import { getQboRealmId, type QboEntity } from './config'

export type QbVendor = { Id: string; DisplayName: string }

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchVendorByLabel(
  label: string,
  vendors: QbVendor[],
): QbVendor | null {
  const target = normalize(label)
  if (!target) return null
  return vendors.find((v) => normalize(v.DisplayName) === target) ?? null
}

// In-memory cache keyed by entity, with a 1-hour TTL. On Vercel serverless the
// cache dies per-invocation anyway (cold start), so this primarily bounds
// staleness on long-running deployments (self-host / dev). Vendors added in QB
// will become visible after at most 1h.
const VENDOR_CACHE_TTL_MS = 60 * 60 * 1000
const vendorCache = new Map<QboEntity, { vendors: QbVendor[]; fetchedAt: number }>()

export async function getQbVendors(entity: QboEntity): Promise<QbVendor[]> {
  const cached = vendorCache.get(entity)
  if (cached && Date.now() - cached.fetchedAt < VENDOR_CACHE_TTL_MS) {
    return cached.vendors
  }
  const realmId = getQboRealmId(entity)
  const query = `SELECT Id, DisplayName FROM Vendor MAXRESULTS 1000`
  const res = await fetchQboJson<{ QueryResponse?: { Vendor?: QbVendor[] } }>(
    entity,
    `/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`,
  )
  const vendors = res.QueryResponse?.Vendor ?? []
  vendorCache.set(entity, { vendors, fetchedAt: Date.now() })
  return vendors
}
