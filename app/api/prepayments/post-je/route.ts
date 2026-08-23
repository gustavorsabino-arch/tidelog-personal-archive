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
export const maxDuration = 120

/**
 * POST /api/prepayments/post-je — book the month's GLOBAL prepaid
 * amortization as ONE journal entry in QuickBooks:
 *   DR each contract's expense account (+class), one line per supplier
 *   CR the prepaid asset account for the total
 *
 * Body: {
 *   entity: 'Opco', month: 'YYYY-MM', prepaidAccount: '14000',
 *   lines: [{ vendorName, amount, expenseGlAccount, className? }]
 * }
 *
 * The client computes the lines from the reconciled map; this endpoint
 * validates them, resolves QB ids, allocates the next TL-<Mon>-JE## doc
 * number, posts, and audit-logs. Line descriptions carry the vendor name
 * so the map's reconciler recognizes the amortizations automatically.
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
  const total = round2(lines.reduce((s, l) => s + (l.amount as number), 0))

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

    // TxnDate = last day of the month; DocNumber follows the existing
    // TL-<Mon>-JE## convention (max existing + 1).
    const [yy, mm] = month.split('-').map(Number)
    const txnDate = new Date(Date.UTC(yy, mm, 0))
    const txnDateIso = txnDate.toISOString().slice(0, 10)
    const seq = await getNextIndividualSequence(entity, txnDate)
    const docNumber = formatIndividualDocNumber(txnDate, seq)

    const monthLabel = txnDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    const jeLines = lines.map((l) => {
      const acct = accounts.get(l.expenseGlAccount!.trim())!
      const detail: Record<string, unknown> = {
        PostingType: 'Debit',
        AccountRef: { value: acct.qbAccountId, name: acct.qbAccountName },
      }
      const cls = l.className ? classes.get(l.className) : undefined
      if (cls) detail.ClassRef = { value: cls.qbClassId, name: cls.qbClassName }
      return {
        DetailType: 'JournalEntryLineDetail',
        Amount: round2(l.amount as number),
        Description: `${l.vendorName!.trim()} — prepaid release ${monthLabel}`,
        JournalEntryLineDetail: detail,
      }
    })
    jeLines.push({
      DetailType: 'JournalEntryLineDetail',
      Amount: total,
      Description: `Prepaid amortization ${monthLabel} — global (tidelog)`,
      JournalEntryLineDetail: {
        PostingType: 'Credit',
        AccountRef: { value: prepaidRef.qbAccountId, name: prepaidRef.qbAccountName },
      },
    })

    const payload = {
      DocNumber: docNumber,
      TxnDate: txnDateIso,
      PrivateNote: `Prepaid amortization ${monthLabel} — global JE (tidelog prepayment map)`,
      Line: jeLines,
    }

    const resp = await fetchQboJson<{ JournalEntry: { Id: string } }>(
      entity,
      `/v3/company/${getQboRealmId(entity)}/journalentry?minorversion=65`,
      { method: 'POST', body: JSON.stringify(payload) },
    )
    const qbJournalEntryId = resp.JournalEntry.Id

    await logAudit({
      userId: user.id === 'dev-user' ? null : user.id,
      action: 'prepayment.je_posted',
      resourceType: 'qb_journal_entry',
      resourceId: qbJournalEntryId,
      metadata: {
        entity,
        month,
        docNumber,
        total,
        prepaidAccount,
        lines: lines.map((l) => ({ vendor: l.vendorName, amount: l.amount, account: l.expenseGlAccount, class: l.className ?? null })),
        byEmail: user.email,
      },
    }).catch(() => {})

    return NextResponse.json({ ok: true, docNumber, qbJournalEntryId, total, lineCount: lines.length })
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 })
  }
}
