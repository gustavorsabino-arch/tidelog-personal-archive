#!/usr/bin/env bun
/**
 * One-time backfill: assign qb_class_name (and qb_vendor_name for known
 * vendors) to every external wallet that is currently missing them.
 *
 * Resolution order:
 *   1. EXPLICIT_VENDORS map (keyed by lowercased wallet label) — covers the
 *      handful of real vendor wallets (Triton, Vamient, etc.)
 *   2. matchTeamMember() against the live roster — derives class from the
 *      matched member's department via reconcileClassName().
 *   3. Unresolved — logged and left blank.
 *
 * Both resolved class and vendor names are validated against the union of
 * live QB catalogs across all four entities. Unknown class → dropped (log).
 * Unknown vendor → dropped (log), class kept if valid.
 *
 * Usage:
 *   DB_MODE=local DATABASE_URL=<url> bun run scripts/backfill-wallet-vendor-class.ts             # dry-run
 *   DB_MODE=local DATABASE_URL=<url> bun run scripts/backfill-wallet-vendor-class.ts --apply     # write to DB
 *   DB_MODE=local DATABASE_URL=<url> bun run scripts/backfill-wallet-vendor-class.ts --apply --force  # overwrite existing
 */

import { eq, isNotNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { wallet, budgetTeamMember } from '@/lib/db/schema'
import { matchTeamMember, type RosterMember } from '@/lib/qb/match-team-member'
import { reconcileClassName } from '@/lib/qb/reconcile-class'
import { readCachedClassCatalog, readCachedVendorCatalog } from '@/lib/qb/cache-reads'
import { QBO_ENTITIES } from '@/lib/qb/config'

// ---------------------------------------------------------------------------
// Explicit vendor map: keyed by lowercased+trimmed wallet label.
// Covers the small set of real vendor/counterparty wallets.
// ---------------------------------------------------------------------------
const EXPLICIT_VENDORS: Record<string, { vendor: string; className: string }> = {
  'triton': { vendor: 'Triton One (RPC Pool)', className: 'Engineering' },
  'vamient capital': { vendor: 'Vamient Capital', className: 'Finance' },
  'nathan d.': { vendor: 'Nathan Davis', className: 'General' },
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const FORCE = args.includes('--force')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Source = 'vendor-map' | 'roster' | 'none'

interface Resolution {
  address: string
  label: string
  existingVendor: string | null
  existingClass: string | null
  resolvedVendor: string | null
  resolvedClass: string | null
  source: Source
  skipped: boolean
  skipReason: string | null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nbackfill-wallet-vendor-class  [${APPLY ? 'APPLY' : 'DRY-RUN'}]${FORCE ? ' [FORCE]' : ''}`)
  console.log('='.repeat(60))

  // 1. Load external wallets
  const wallets = await db
    .select({
      address: wallet.address,
      label: wallet.label,
      qbVendorName: wallet.qbVendorName,
      qbClassName: wallet.qbClassName,
    })
    .from(wallet)
    .where(eq(wallet.type, 'external'))

  console.log(`\nLoaded ${wallets.length} external wallet(s).`)

  // 2. Load roster
  const rosterRows = await db
    .select({ name: budgetTeamMember.name, department: budgetTeamMember.department, status: budgetTeamMember.status })
    .from(budgetTeamMember)
  const roster: RosterMember[] = rosterRows

  console.log(`Loaded ${roster.length} roster member(s) (${roster.filter(r => r.status === 'active').length} active).`)

  // 3. Build QB class + vendor name sets (union across all entities)
  const qbClassNames = new Set<string>()
  const qbVendorNames = new Set<string>()

  for (const entity of QBO_ENTITIES) {
    const classes = await readCachedClassCatalog(entity)
    for (const c of classes) qbClassNames.add(c.qbClassName)

    const vendors = await readCachedVendorCatalog(entity)
    for (const v of vendors) qbVendorNames.add(v.displayName)
  }

  console.log(`QB catalog: ${qbClassNames.size} distinct class name(s), ${qbVendorNames.size} distinct vendor name(s).`)

  // 4. Resolve each wallet
  const resolutions: Resolution[] = []

  for (const w of wallets) {
    const key = w.label.toLowerCase().trim()
    const existingVendor = w.qbVendorName
    const existingClass = w.qbClassName

    let rawVendor: string | null = null
    let rawClass: string | null = null
    let source: Source = 'none'

    // Resolution
    if (EXPLICIT_VENDORS[key]) {
      const entry = EXPLICIT_VENDORS[key]
      rawVendor = entry.vendor
      rawClass = entry.className
      source = 'vendor-map'
    } else {
      const member = matchTeamMember(w.label, roster)
      if (member) {
        rawVendor = null
        rawClass = reconcileClassName(member.department)
        source = 'roster'
      }
    }

    // Validate class against QB catalog
    let resolvedClass = rawClass
    if (resolvedClass !== null && !qbClassNames.has(resolvedClass)) {
      console.warn(`  WARN [${w.label}]: class "${resolvedClass}" not in QB catalog — left blank`)
      resolvedClass = null
    }

    // Validate vendor against QB catalog
    let resolvedVendor = rawVendor
    if (resolvedVendor !== null && !qbVendorNames.has(resolvedVendor)) {
      console.warn(`  WARN [${w.label}]: vendor "${resolvedVendor}" not in QB catalog — left blank`)
      resolvedVendor = null
    }

    // Skip logic: if not --force, skip any wallet that already has the target field(s) set
    let skipped = false
    let skipReason: string | null = null

    if (!FORCE) {
      const classAlreadySet = existingClass !== null && resolvedClass !== null
      const vendorAlreadySet = existingVendor !== null && resolvedVendor !== null

      if (classAlreadySet && vendorAlreadySet) {
        skipped = true
        skipReason = 'both class and vendor already set (use --force to overwrite)'
      } else if (classAlreadySet) {
        skipped = true
        skipReason = 'class already set (use --force to overwrite)'
      } else if (vendorAlreadySet) {
        skipped = true
        skipReason = 'vendor already set (use --force to overwrite)'
      }
    }

    resolutions.push({
      address: w.address,
      label: w.label,
      existingVendor,
      existingClass,
      resolvedVendor,
      resolvedClass,
      source,
      skipped,
      skipReason,
    })
  }

  // 5. Print per-wallet table
  console.log('\n' + '-'.repeat(100))
  console.log(
    'LABEL'.padEnd(28) +
    'SOURCE'.padEnd(12) +
    'RESOLVED VENDOR'.padEnd(28) +
    'RESOLVED CLASS'.padEnd(20) +
    'STATUS'
  )
  console.log('-'.repeat(100))

  for (const r of resolutions) {
    const vendorCell = r.resolvedVendor ?? '—'
    const classCell = r.resolvedClass ?? '—'
    const statusCell = r.skipped
      ? `SKIP (${r.skipReason})`
      : r.source === 'none'
        ? 'BLANK (no match)'
        : APPLY ? 'WRITE' : 'would write'

    console.log(
      r.label.slice(0, 27).padEnd(28) +
      r.source.padEnd(12) +
      vendorCell.slice(0, 27).padEnd(28) +
      classCell.slice(0, 19).padEnd(20) +
      statusCell
    )
  }

  console.log('-'.repeat(100))

  // 6. Summary
  const bySource = {
    'vendor-map': resolutions.filter(r => r.source === 'vendor-map').length,
    'roster': resolutions.filter(r => r.source === 'roster').length,
    'none': resolutions.filter(r => r.source === 'none').length,
  }
  const wouldWrite = resolutions.filter(r => !r.skipped && r.source !== 'none' && (r.resolvedClass !== null || r.resolvedVendor !== null)).length
  const skippedAlreadySet = resolutions.filter(r => r.skipped).length
  const leftBlank = resolutions.filter(r => !r.skipped && r.source === 'none').length
  const droppedValue = resolutions.filter(r => r.source !== 'none' && r.resolvedClass === null && r.resolvedVendor === null).length

  console.log('\nSummary:')
  console.log(`  Wallets loaded     : ${wallets.length}`)
  console.log(`  By source          : vendor-map=${bySource['vendor-map']}, roster=${bySource['roster']}, none=${bySource['none']}`)
  console.log(`  Would write        : ${wouldWrite}`)
  console.log(`  Skipped (set,no-force): ${skippedAlreadySet}`)
  console.log(`  Left blank (no match) : ${leftBlank}`)
  console.log(`  Dropped (catalog mismatch): ${droppedValue}`)

  // 7. Apply writes
  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to commit changes.')
    process.exit(0)
  }

  console.log('\nApplying updates...')
  let written = 0

  for (const r of resolutions) {
    if (r.skipped) continue
    if (r.resolvedClass === null && r.resolvedVendor === null) continue

    // Build update payload — only set the fields we have; don't null out the other
    const updatePayload: { qbClassName?: string; qbVendorName?: string } = {}

    if (r.resolvedClass !== null) {
      // If --force or field is currently null, set it
      if (FORCE || r.existingClass === null) {
        updatePayload.qbClassName = r.resolvedClass
      }
    }
    if (r.resolvedVendor !== null) {
      if (FORCE || r.existingVendor === null) {
        updatePayload.qbVendorName = r.resolvedVendor
      }
    }

    if (Object.keys(updatePayload).length === 0) continue

    await db
      .update(wallet)
      .set(updatePayload)
      .where(eq(wallet.address, r.address))

    console.log(`  wrote [${r.label}]: class=${updatePayload.qbClassName ?? '(unchanged)'}, vendor=${updatePayload.qbVendorName ?? '(unchanged)'}`)
    written++
  }

  console.log(`\nDone. ${written} wallet(s) updated.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
