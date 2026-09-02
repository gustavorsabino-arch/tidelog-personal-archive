import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth/require-permission'
import { isQboEntity } from '@/lib/qb/config'
import { getQboRealmId } from '@/lib/qb/config'
import { fetchQboJson } from '@/lib/qb/client'
import { readCachedAccountCatalogByNumber, readCachedClassCatalogByName } from '@/lib/qb/cache-reads'
import { formatIndividualDocNumber, getNextIndividualSequence } from '@/lib/qb/doc-number'
import { logAudit } from '@/lib/audit'
import { errorMessage } from '@/lib/errors'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * POST /api/prepayments/post-je — book each month's prepaid amortization as
 * its OWN journal entry in QuickBooks (one JE per contract):
 *   DR the contract's expense account (+class)   amount
 *   CR the prepaid asset account                  amount
 *
 * Body: {
 *   entity: 'Opco', month: 'YYYY-MM', prepaidAccount: '14000',
 *   lines: [{ vendorName, amount, expenseGlAccount, className? }]
 * }
 *
 * Each contract gets a distinct TL-<Mon>-JE## doc number and a stable
 * Request-Id (per entity+month+contract) as a URL query param, so re-running
 * after a QB timeout replays the originals instead of duplicating and resumes
 * the rest. Partial success is reported per contract. Line descriptions carry
 * the vendor name so the map's reconciler recognizes the amortizations.
 */
export async function POST(req: NextRequest) {
  const { user, deny } = await requirePermission('qb:post', req)
  if (deny) return deny

  const b = await req.json().catch(() => null) as {
    entity?: string
    month?: string
    prepaidAccount?: string
    lines?: { vendorName?: string; amount?: number; expenseGlAccount?: string; className?: string | null }[]
  } | null
  if (!b) return NextResponse.json({ error: 'invalid json' }, { status: 400 })

  const entity = b.entity
  if (!entity || !isQboEntity(entity)) {
    return NextResponse.json({ error: 'entity must be a QuickBooks entity' }, { status: 400 })
  }
  const month = b.month
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }
  const prepaidAccount = b.prepaidAccount?.trim()
  if (!prepaidAccount) return NextResponse.json({ error: 'prepaidAccount is required' }, { status: 400 })

  const lines = (b.lines ?? []).filter((l) =>
    l && typeof l.vendorName === 'string' && l.vendorName.trim()
    && typeof l.amount === 'number' && Number.isFinite(l.amount) && l.amount > 0
    && typeof l.expenseGlAccount === 'string' && l.expenseGlAccount.trim())
  if (lines.length === 0) {
    return NextResponse.json({ error: 'lines must contain at least one valid entry (vendorName, amount > 0, expenseGlAccount)' }, { status: 400 })
  }
  if (lines.length !== (b.lines ?? []).length) {
    return NextResponse.json({ error: 'every line needs vendorName, a positive amount, and an expense GL account' }, { status: 400 })
  }
  if (lines.length > 50) return NextResponse.json({ error: 'max 50 lines' }, { status: 400 })

  const round2 = (n: number) => Math.round(n * 100) / 100

  try {
    // Resolve account numbers → QB internal ids (QB rejects bare numbers).
    const accounts = await readCachedAccountCatalogByNumber(entity)
    const classes = await readCachedClassCatalogByName(entity)

    const prepaidRef = accounts.get(prepaidAccount)
    if (!prepaidRef) {
      return NextResponse.json({ error: `Account ${prepaidAccount} not found in the ${entity} QB catalog` }, { status: 400 })
    }
    const missing = [...new Set(lines.map((l) => l.expenseGlAccount!.trim()))]
      .filter((num) => !accounts.get(num))
    if (missing.length > 0) {
      return NextResponse.json({ error: `Expense account(s) not in the ${entity} QB catalog: ${missing.join(', ')}` }, { status: 400 })
    }

    // TxnDate = last day of the month; each contract gets its own sequential
    // TL-<Mon>-JE## number (base = max existing + 1).
    const [yy, mm] = month.split('-').map(Number)
    const txnDate = new Date(Date.UTC(yy, mm, 0))
    const txnDateIso = txnDate.toISOString().slice(0, 10)
    const baseSeq = await getNextIndividualSequence(entity, txnDate)
    const monthLabel = txnDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    const realmId = getQboRealmId(entity)

    const posted: { vendorName: string; docNumber: string; qbJournalEntryId: string; amount: number }[] = []
    const failed: { vendorName: string; error: string }[] = []

    // One JE per contract, posted sequentially. Stable Request-Id (per
    // entity+month+contract) makes each create idempotent so a re-run after a
    // QB timeout replays the original (no duplicate) and finishes the rest.
    for (let i = 0; i < lines.length; i += 1) {
      const l = lines[i]
      const amount = round2(l.amount as number)
      const acct = accounts.get(l.expenseGlAccount!.trim())!
      const debitDetail: Record<string, unknown> = {
        PostingType: 'Debit',
        AccountRef: { value: acct.qbAccountId, name: acct.qbAccountName },
      }
      const cls = l.className ? classes.get(l.className) : undefined
      if (cls) debitDetail.ClassRef = { value: cls.qbClassId, name: cls.qbClassName }

      const docNumber = formatIndividualDocNumber(txnDate, baseSeq + i)
      const payload = {
        DocNumber: docNumber,
        TxnDate: txnDateIso,
        PrivateNote: `${l.vendorName!.trim()} — prepaid release ${monthLabel} (tidelog)`,
        Line: [
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: amount,
            Description: `${l.vendorName!.trim()} — prepaid release ${monthLabel}`,
            JournalEntryLineDetail: debitDetail,
          },
          {
            DetailType: 'JournalEntryLineDetail',
            Amount: amount,
            Description: `${l.vendorName!.trim()} — prepaid release ${monthLabel}`,
            JournalEntryLineDetail: {
              PostingType: 'Credit',
              AccountRef: { value: prepaidRef.qbAccountId, name: prepaidRef.qbAccountName },
            },
          },
        ],
      }
      const requestId = `pp-${entity}-${month}-${l.expenseGlAccount!.trim()}-${l.vendorName!.trim()}`
        .replace(/[^a-zA-Z0-9-]/g, '')
        .slice(0, 50)

      try {
        const resp = await fetchQboJson<{ JournalEntry: { Id: string } }>(
          entity,
          `/v3/company/${realmId}/journalentry?minorversion=65&requestid=${encodeURIComponent(requestId)}`,
          { method: 'POST', body: JSON.stringify(payload), requestId },
        )
        posted.push({ vendorName: l.vendorName!.trim(), docNumber, qbJournalEntryId: resp.JournalEntry.Id, amount })
        logAudit({
          userId: user.id === 'dev-user' ? null : user.id,
          action: 'prepayment.je_posted',
          resourceType: 'qb_journal_entry',
          resourceId: resp.JournalEntry.Id,
          metadata: { entity, month, docNumber, amount, prepaidAccount, vendor: l.vendorName, account: l.expenseGlAccount, class: l.className ?? null, byEmail: user.email },
        }).catch(() => {})
      } catch (jeErr) {
        failed.push({ vendorName: l.vendorName!.trim(), error: errorMessage(jeErr) })
      }
    }

    return NextResponse.json({
      ok: failed.length === 0,
      posted,
      failed,
      count: posted.length,
      total: round2(posted.reduce((s, p) => s + p.amount, 0)),
    })
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 })
  }
}
