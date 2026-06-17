// POST /api/qb/post-preview
//   Body: { entity: QboEntity, txIds: string[] }
//
// Dry-run companion to /api/qb/post-batch. Returns the JE shapes the modal
// will display before the user confirms. Pure read against the DB + computed
// JE structure via buildJournalEntry. Does NOT call QuickBooks, does NOT
// write. No audit log (this is a read).
//
// Implementation note: we share buildPostPlan() with the real post path so
// the partitioning (skipped / bulk-groups / individuals) stays DRY between
// preview and post. See lib/qb/post-batch.ts.

import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import {
  buildPostPlan,
  groupDescription,
  loadedTxToTxForPost,
  type GroupSpec,
} from '@/lib/qb/post-batch'
import { buildJournalEntry } from '@/lib/qb/post-journal-entry'
import {
  formatBulkDocNumber,
  formatIndividualDocNumber,
} from '@/lib/qb/doc-number'
import { isQboEntity } from '@/lib/qb/config'
import type { QbJournalEntry } from '@/lib/qb/types'
import type { GlSource } from '@/lib/qb/resolve-wallet-gl'

const MAX_BATCH_SIZE = 50

export type PostPreviewResult = {
  groups: Array<{
    kind: 'individual' | 'bulk'
    docNumberPreview: string
    memberTxIds: string[]
    je: QbJournalEntry
    glSource: GlSource | null
    token: string | null
  }>
  skipped: Array<{ txId: string; reason: string }>
}

// Individual sequences are assigned at post time inside an advisory lock
// (D6) — preview can't know the real number yet. Substitute "??" for the
// sequence tail so the UI can render `TL-Feb-JE??` and signal preview-ness.
function previewIndividualDocNumber(blockTime: Date): string {
  // formatIndividualDocNumber(date, 0) → 'TL-Feb-JE00'; chop the trailing two
  // zeros and append '??'. Cheap + keeps the format authority in one place.
  const placeholder = formatIndividualDocNumber(blockTime, 0)
  return placeholder.replace(/00$/, '??')
}

export async function POST(req: NextRequest) {
  // Preview is still gated by qb:post — seeing the JE shape leaks GL/wallet
  // mapping detail that's the same surface the actual post would expose.
  const { deny } = await requirePermission('qb:post', req)
  if (deny) return deny

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'expected object' }, { status: 400 })
  }
  const b = body as { entity?: unknown; txIds?: unknown }

  if (typeof b.entity !== 'string' || !isQboEntity(b.entity)) {
    return NextResponse.json(
      { error: 'entity required (valid QboEntity)' },
      { status: 400 },
    )
  }
  if (
    !Array.isArray(b.txIds) ||
    b.txIds.length === 0 ||
    !b.txIds.every((x) => typeof x === 'string')
  ) {
    return NextResponse.json(
      { error: 'txIds required (non-empty string array)' },
      { status: 400 },
    )
  }
  if (b.txIds.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `batch size exceeds ${MAX_BATCH_SIZE} — post in smaller groups` },
      { status: 400 },
    )
  }

  try {
    const { groups, skipped } = await buildPostPlan({
      entity: b.entity,
      txIds: b.txIds as string[],
    })

    const previewGroups: PostPreviewResult['groups'] = groups.map((group: GroupSpec) => {
      if (group.kind === 'individual') {
        const docNumberPreview = previewIndividualDocNumber(group.tx.blockTime)
        const je = buildJournalEntry({
          txs: [loadedTxToTxForPost(group.tx)],
          docNumber: docNumberPreview,
          // Preview omits catalog resolvers — vendor/class names come from the
          // per-tx catalog and are shown verbatim in the modal. Real posting
          // supplies resolvers that map names → QB Ids.
          description: groupDescription(group),
        })
        return {
          kind: 'individual',
          docNumberPreview,
          memberTxIds: [group.tx.id],
          je,
          glSource: group.tx.walletGlSource,
          token: group.tx.asset,
        }
      }
      const docNumberPreview = formatBulkDocNumber(group.token, group.monthDate)
      const je = buildJournalEntry({
        txs: group.members.map(loadedTxToTxForPost),
        docNumber: docNumberPreview,
        description: groupDescription(group),
      })
      return {
        kind: 'bulk',
        docNumberPreview,
        memberTxIds: group.members.map((m) => m.id),
        je,
        glSource: group.members[0]?.walletGlSource ?? null,
        token: group.token,
      }
    })

    return NextResponse.json({
      groups: previewGroups,
      skipped,
    } satisfies PostPreviewResult)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Preview failed'
    // 403 if entity ownership check failed in buildPostPlan; 500 otherwise.
    const status = msg.startsWith('Forbidden') ? 403 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
