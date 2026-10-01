import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { logAudit } from '@/lib/audit'
import { recomputeEntityAssetGains, recomputeEntityGains, GAINS_ASSETS } from '@/lib/orca-gains-writer'
import { ENTITIES } from '@/lib/constants'

/**
 * GET /api/admin/recompute-orca-gains?entity=Foundation
 * GET /api/admin/recompute-orca-gains?all=true
 * GET /api/admin/recompute-orca-gains?entity=Opco&asset=ORCA
 *
 * Manually rebuilds the FIFO cost basis for one entity (or all), optionally
 * limited to one asset — writes to `transaction_gain` + `fifo_state` only for
 * the selected scope. The nightly cron already calls this
 * inside fetchTransactionsJob for entities that had NEW inserts on that run,
 * so a healthy cron keeps things fresh. This endpoint exists for the rescue
 * case: the ORCA Ledger shows txns without balanceAfter because a fetch
 * inserted rows without triggering a recompute (silent recompute error,
 * partial-cron scenario, or the manual /api/admin/refetch-all-transactions
 * path fixed rows without also recomputing).
 *
 * Auth: admin:manage_data. The recomputation is idempotent —
 * safe to hit multiple times; each run walks the entity's transactions
 * from the beginning and re-writes the derived state, so it converges.
 *
 * The optional asset scope does not change FIFO calculation or the cron path.
 */
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const { user, deny } = await requirePermission('admin:manage_data', req)
  if (deny) return deny

  const url = req.nextUrl
  const entityParam = url.searchParams.get('entity')
  const allParam = url.searchParams.get('all')
  const assetParam = url.searchParams.get('asset')

  const targets: string[] = allParam === 'true'
    ? [...ENTITIES]
    : entityParam
      ? [entityParam]
      : []

  if (targets.length === 0) {
    return NextResponse.json({
      error: 'Pass ?entity=<Opco|Foundation|Juku|Zagreus> OR ?all=true',
      code: 'admin.bad_request',
    }, { status: 400 })
  }

  // Validate the entity spelling matches ENTITIES exactly — recomputeEntityGains
  // is case-sensitive (uses toDbEntity/toDisplayEntity paths internally).
  const invalid = targets.filter((t) => !ENTITIES.includes(t as (typeof ENTITIES)[number]))
  if (invalid.length > 0) {
    return NextResponse.json({
      error: `Unknown entity value(s): ${invalid.join(', ')}. Allowed: ${ENTITIES.join(', ')}`,
      code: 'admin.bad_entity',
    }, { status: 400 })
  }
  if (assetParam && !GAINS_ASSETS.includes(assetParam as (typeof GAINS_ASSETS)[number])) {
    return NextResponse.json({
      error: `Unknown asset: ${assetParam}. Allowed: ${GAINS_ASSETS.join(', ')}`,
      code: 'admin.bad_asset',
    }, { status: 400 })
  }

  const startedAt = Date.now()
  const results: Record<string, { totals?: Record<string, number>; error?: string }> = {}

  // Iterate sequentially — recomputeEntityGains does DB writes; parallelism
  // could contend on the same rows if two entities somehow shared assets.
  for (const entity of targets) {
    try {
      const totals = assetParam
        ? { [assetParam]: (await recomputeEntityAssetGains(entity, assetParam as (typeof GAINS_ASSETS)[number])).updated }
        : (await recomputeEntityGains(entity)).totals
      results[entity] = { totals }
    } catch (err) {
      results[entity] = { error: (err as Error).message }
    }
  }

  const anyFailed = Object.values(results).some((r) => r.error)
  await logAudit({
    userId: user.id === 'dev-user' ? null : user.id,
    action: anyFailed
      ? 'admin.recompute_orca_gains.partial'
      : 'admin.recompute_orca_gains.succeeded',
    resourceType: 'orca_gains',
    resourceId: targets.join(','),
    metadata: {
      byEmail: user.email,
      targets,
      asset: assetParam ?? 'all',
      durationMs: Date.now() - startedAt,
      results,
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: !anyFailed,
    elapsedMs: Date.now() - startedAt,
    targets,
    asset: assetParam ?? 'all',
    results,
  })
}
