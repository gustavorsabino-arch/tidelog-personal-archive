// POST /api/qb/post-void
//   Body: { postId: string }
//
// Voids a previously-posted QB journal entry. Per D14: QB keeps the JE visible
// with $0 amounts and a Voided flag — audit trail intact. tidelog flips the
// row's posting_status to 'voided' but keeps qb_journal_entry_id and members'
// post_id FKs so historical drill-down still works.
//
// The audit log for the void itself is written inside `voidPost()` — don't
// duplicate it here.

import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { voidPost } from '@/lib/qb/post-batch'

export async function POST(req: NextRequest) {
  const { user, deny } = await requirePermission('qb:post', req)
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
  const b = body as { postId?: unknown }
  if (typeof b.postId !== 'string' || !b.postId) {
    return NextResponse.json(
      { error: 'postId required (string)' },
      { status: 400 },
    )
  }

  try {
    await voidPost({ postId: b.postId, userId: user!.id })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Void failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
