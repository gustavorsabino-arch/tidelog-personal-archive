import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { vendorDefault } from '@/lib/db/schema'
import { VENDOR_SEED } from './seed-data'
import { ensureApprovalsSchema } from '@/lib/db/approvals-schema'

export type VendorDefaults = { glAccount: string; className: string | null }

export async function seedVendorDefaultsIfEmpty(): Promise<number> {
  await ensureApprovalsSchema().catch(() => {})
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(vendorDefault)
  if (n > 0) return 0
  await db.insert(vendorDefault).values(VENDOR_SEED.map(v => ({
    vendorName: v.vendorName, glAccount: v.glAccount,
    glAccountName: v.glAccountName, className: v.className,
    updatedBy: 'book12-seed',
  }))).onConflictDoNothing()
  return VENDOR_SEED.length
}

// The QB picker and the finance vendor master are separate catalogs. Resolve
// the selected QB display name against the master at save time, including bulk
// edits, rather than depending on a second client request having completed.
export async function findVendorDefaults(name: string): Promise<VendorDefaults | null> {
  await seedVendorDefaultsIfEmpty()
  const [row] = await db.select({
    glAccount: vendorDefault.glAccount,
    className: vendorDefault.className,
  }).from(vendorDefault)
    .where(sql`lower(trim(${vendorDefault.vendorName})) = lower(trim(${name}))`)
    .limit(1)
  return row ?? null
}
