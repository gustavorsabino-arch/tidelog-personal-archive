'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useQbAccounts } from '@/lib/hooks/use-qb-accounts'
import { useAllQbClasses } from '@/lib/hooks/use-qb-classes'
import { fmtUSD } from '@/lib/format'
import {
  reconcile,
  addMonths,
  type GlRow,
  type PrepaymentItem,
  type MonthCell,
} from '@/lib/prepayments/schedule'

/**
 * Prepayment map — the amortization roll-forward big companies keep in a
 * spreadsheet, reconciled LIVE against the prepaid account's QB ledger:
 *   rows = prepayments (register), columns = months, cells = scheduled vs
 *   actually-posted amortization (✓ posted · ⚠ overdue · ✗ wrong amount).
 * Plus: import candidates from the ledger's positive entries, orphan
 * amortizations, and a "to book this month" JE checklist.
 */

type PrepaymentApiRow = {
  id: string
  entityId: string
  prepaidAccount: string
  vendorName: string
  description: string | null
  totalAmount: string
  startMonth: string
  months: number
  expenseGlAccount: string | null
  className: string | null
  sourceTxnId: string | null
  sourceDate: string | null
  status: 'active' | 'archived'
  notes: string | null
}

type FormState = {
  id: string | null
  vendorName: string
  description: string
  totalAmount: string
  startMonth: string
  months: string
  expenseGlAccount: string
  className: string
  notes: string
  sourceTxnId: string | null
  sourceDate: string | null
}

const EMPTY_FORM: FormState = {
  id: null, vendorName: '', description: '', totalAmount: '', startMonth: '',
  months: '12', expenseGlAccount: '', className: '', notes: '', sourceTxnId: null, sourceDate: null,
}

function currentYm(): string {
  return new Date().toISOString().slice(0, 7)
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${ym}-${String(d).padStart(2, '0')}`
}

const CELL_STYLE: Record<MonthCell['status'], { bg: string; fg: string; icon: string }> = {
  posted:    { bg: 'rgba(6,214,160,0.10)',  fg: '#06D6A0', icon: '✓' },
  overdue:   { bg: 'rgba(212,160,23,0.14)', fg: '#D4A017', icon: '⚠' },
  mismatch:  { bg: 'rgba(217,48,37,0.10)',  fg: '#d93025', icon: '✗' },
  scheduled: { bg: 'transparent',           fg: 'var(--muted)', icon: '' },
}

// Known prepaid asset accounts per entity — the input defaults to the first;
// chips switch between them (Zagreus splits prepaids across two accounts, and
// each account gets its own map and its own global monthly JE).
const ENTITY_PREPAID_ACCOUNTS: Record<string, string[]> = {
  opco: ['14000'],
  foundation: ['14110'],
  zagreus: ['14001', '14004'],
}

export function PrepaymentsPanel({ entity }: { entity: string }) {
  const entityAccounts = ENTITY_PREPAID_ACCOUNTS[entity.toLowerCase()] ?? ['14000']
  const [account, setAccount] = useState(entityAccounts[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setAccount(ENTITY_PREPAID_ACCOUNTS[entity.toLowerCase()]?.[0] ?? '14000') }, [entity])
  const [items, setItems] = useState<PrepaymentApiRow[] | null>(null)
  const [glRows, setGlRows] = useState<GlRow[] | null>(null)
  const [glFetchedAt, setGlFetchedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bookMonth, setBookMonth] = useState(currentYm())

  // Add/Edit modal
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Resizable sticky first column — drag the handle on the header edge.
  const [supW, setSupW] = useState(240)
  function startColResize(e: React.MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startW = supW
    const onMove = (ev: MouseEvent) => {
      setSupW(Math.min(560, Math.max(140, startW + (ev.clientX - startX))))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const supCellStyle: React.CSSProperties = {
    position: 'sticky', left: 0, zIndex: 2,
    background: 'var(--card, #ffffff)',
    width: supW, minWidth: supW, maxWidth: supW,
    overflow: 'hidden',
    borderRight: '2px solid var(--border)',
  }

  const { accounts } = useQbAccounts(entity)
  const glOptions = useMemo(
    () => accounts.map((a) => ({ value: a.qbAccountNumber, label: `${a.qbAccountNumber} — ${a.qbAccountName}` })),
    [accounts],
  )
  const { classes: allClasses } = useAllQbClasses()
  const classOptions = useMemo(() => [...new Set(allClasses.map((c) => c.qbClassName))].sort(), [allClasses])

  // Vendor master (Book12): prefills the expense GL + class when a
  // candidate's vendor guess matches a known vendor. Best-effort.
  const [vendorMaster, setVendorMaster] = useState<Map<string, { glAccount: string; className: string | null }>>(new Map())
  useEffect(() => {
    let cancelled = false
    apiFetch<{ vendors: { vendorName: string; glAccount: string; className: string | null }[] }>('/api/vendors')
      .then((res) => {
        if (cancelled) return
        setVendorMaster(new Map(res.vendors.map((v) => [v.vendorName.toLowerCase(), { glAccount: v.glAccount, className: v.className }])))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  function flash(text: string) {
    setNotice(text)
    setTimeout(() => setNotice(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    // One automatic retry — serverless cold starts occasionally time out on
    // the first DB connection (write CONNECT_TIMEOUT) and succeed right after.
    async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
      try {
        return await fn()
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (/CONNECT_TIMEOUT|ECONNRESET|fetch failed|network/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 1500))
          return await fn()
        }
        throw e
      }
    }

    // Register and GL load independently: a register failure must not hide
    // the QB ledger (candidates/orphans still render), and vice-versa.
    let loadedItems: PrepaymentApiRow[] = []
    const problems: string[] = []
    try {
      const res = await withRetry(() =>
        apiFetch<{ items: PrepaymentApiRow[] }>(`/api/prepayments?entity=${encodeURIComponent(entity)}`))
      loadedItems = res.items
      setItems(res.items)
    } catch (e) {
      setItems([])
      problems.push(`register: ${e instanceof Error ? e.message : 'failed'}`)
    }

    try {
      // GL window: from the account's practical beginning (2025 — verified
      // against finance's full 14000 export) or a month before the earliest
      // registered item, whichever is older, through the current month end.
      const FLOOR = '2025-02'
      const starts = loadedItems.map((i) => i.sourceDate?.slice(0, 7) ?? i.startMonth)
      const earliestItem = starts.length > 0 ? [...starts].sort()[0] : FLOOR
      const earliest = earliestItem < FLOOR ? earliestItem : FLOOR
      const from = `${addMonths(earliest, -1)}-01`
      const to = lastDayOfMonth(currentYm())
      const gl = await withRetry(() =>
        apiFetch<{ rows: GlRow[]; fetchedAt: string }>(
          `/api/prepayments/gl?entity=${encodeURIComponent(entity)}&account=${encodeURIComponent(account)}&from=${from}&to=${to}`,
        ))
      setGlRows(gl.rows)
      setGlFetchedAt(gl.fetchedAt)
    } catch (e) {
      setGlRows(null)
      problems.push(`QB ledger: ${e instanceof Error ? e.message : 'failed'}`)
    }

    setError(problems.length > 0 ? `${problems.join(' · ')} — click Check QB postings to retry` : null)
    setLoading(false)
  }, [entity, account])

  useEffect(() => { void load() }, [load])

  const activeItems = useMemo(
    () => (items ?? []).filter((i) => i.status === 'active' && i.prepaidAccount === account.trim()),
    [items, account],
  )
  const scheduleItems: PrepaymentItem[] = useMemo(
    () => activeItems.map((i) => ({
      id: i.id,
      vendorName: i.vendorName,
      description: i.description,
      totalAmount: Number(i.totalAmount),
      startMonth: i.startMonth,
      months: i.months,
      sourceTxnId: i.sourceTxnId,
      sourceDate: i.sourceDate,
    })),
    [activeItems],
  )

  const recon = useMemo(
    () => reconcile(scheduleItems, glRows ?? [], currentYm()),
    [scheduleItems, glRows],
  )

  const monthTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of recon.perItem.values()) {
      for (const c of r.cells) totals.set(c.month, (totals.get(c.month) ?? 0) + c.scheduled)
    }
    return totals
  }, [recon])

  const overdueCount = useMemo(() => {
    let n = 0
    for (const r of recon.perItem.values()) for (const c of r.cells) if (c.status === 'overdue') n++
    return n
  }, [recon])
  const mismatchCount = useMemo(() => {
    let n = 0
    for (const r of recon.perItem.values()) for (const c of r.cells) if (c.status === 'mismatch') n++
    return n
  }, [recon])

  // Old ledger rows are history, not work: candidates/orphans older than
  // 120 days belong to completed contracts and only add noise.
  const historyCutoff = useMemo(
    () => new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    [],
  )
  // Unregistered additions: on an already-set-up account only recent ones
  // matter (older ones are completed history), but on a first-time setup —
  // no contracts registered for this account yet — every unlinked addition
  // shows, so the whole register can be built from QB in a few clicks.
  const recentCandidates = useMemo(
    () => (activeItems.length === 0
      ? recon.candidates
      : recon.candidates.filter((c) => c.date >= historyCutoff)),
    [recon, historyCutoff, activeItems],
  )

  // Diagnostic: recent amortizations in QB that no registered contract
  // claims. When a month shows pending but QB already posted it, the row is
  // here — usually a vendor-spelling/description mismatch to fix via Edit.
  const unmatchedAmorts = useMemo(
    () => (activeItems.length === 0
      ? []
      : recon.orphanNegatives.filter((o) => o.date >= historyCutoff)),
    [recon, historyCutoff, activeItems],
  )

  // "To book" list for the selected month.
  const toBook = useMemo(() => {
    const out: { item: PrepaymentApiRow; cell: MonthCell }[] = []
    for (const it of activeItems) {
      const cell = recon.perItem.get(it.id)?.cells.find((c) => c.month === bookMonth)
      if (!cell || cell.scheduled === 0) continue
      if (cell.status === 'posted') continue
      out.push({ item: it, cell })
    }
    return out
  }, [activeItems, recon, bookMonth])

  // ── Global monthly JE: one QB journal entry with every pending release ──
  const [postingJe, setPostingJe] = useState(false)
  const [jeModalOpen, setJeModalOpen] = useState(false)
  const [jeError, setJeError] = useState<string | null>(null)
  const jeLines = useMemo(() =>
    toBook
      .filter(({ cell }) => cell.status === 'overdue') // nothing posted yet — mismatches need a human look first
      .map(({ item: it, cell }) => ({
        vendorName: it.vendorName,
        amount: cell.scheduled,
        expenseGlAccount: it.expenseGlAccount,
        className: it.className,
      })),
    [toBook])
  const jeTotal = useMemo(() => Math.round(jeLines.reduce((s, l) => s + l.amount, 0) * 100) / 100, [jeLines])
  const jeMissingGl = jeLines.filter((l) => !l.expenseGlAccount)

  async function postGlobalJe() {
    if (jeLines.length === 0 || jeMissingGl.length > 0) return
    setPostingJe(true)
    setJeError(null)
    try {
      const res = await apiFetch<{ docNumber: string; qbJournalEntryId: string; total: number }>(
        '/api/prepayments/post-je',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entity, month: bookMonth, prepaidAccount: account, lines: jeLines }),
        },
      )
      setJeModalOpen(false)
      flash(`✓ Posted ${res.docNumber} to QuickBooks — ${fmtUSD(res.total)} across ${jeLines.length} contracts`)
      await load() // the fresh GL shows the new amortizations → cells turn ✓
    } catch (e) {
      setJeError(e instanceof Error ? e.message : 'Posting failed')
    } finally {
      setPostingJe(false)
    }
  }

  function openAdd(prefill?: Partial<FormState>) {
    setForm({ ...EMPTY_FORM, startMonth: currentYm(), ...prefill })
    setFormOpen(true)
  }
  function openEdit(it: PrepaymentApiRow) {
    setForm({
      id: it.id,
      vendorName: it.vendorName,
      description: it.description ?? '',
      totalAmount: it.totalAmount,
      startMonth: it.startMonth,
      months: String(it.months),
      expenseGlAccount: it.expenseGlAccount ?? '',
      className: it.className ?? '',
      notes: it.notes ?? '',
      sourceTxnId: it.sourceTxnId,
      sourceDate: it.sourceDate,
    })
    setFormOpen(true)
  }

  async function saveForm() {
    const totalAmount = parseFloat(form.totalAmount)
    const months = parseInt(form.months, 10)
    if (!form.vendorName.trim()) { setError('Vendor is required'); return }
    if (!/^\d{4}-\d{2}$/.test(form.startMonth)) { setError('Start month must be YYYY-MM'); return }
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) { setError('Total must be positive'); return }
    if (!Number.isFinite(months) || months < 1) { setError('Months must be ≥ 1'); return }
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        vendorName: form.vendorName.trim(),
        description: form.description || null,
        totalAmount,
        startMonth: form.startMonth,
        months,
        expenseGlAccount: form.expenseGlAccount || null,
        className: form.className || null,
        notes: form.notes || null,
      }
      if (form.id) {
        await apiFetch('/api/prepayments', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: form.id, ...body }),
        })
        flash('Prepayment updated')
      } else {
        await apiFetch('/api/prepayments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entity,
            prepaidAccount: account,
            sourceTxnId: form.sourceTxnId,
            sourceDate: form.sourceDate,
            ...body,
          }),
        })
        flash('Prepayment added')
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem() {
    if (!form.id) return
    if (!window.confirm(`Delete "${form.vendorName}" from the prepayment register? The QB ledger is untouched.`)) return
    setSaving(true)
    try {
      await apiFetch(`/api/prepayments?id=${encodeURIComponent(form.id)}`, { method: 'DELETE' })
      flash('Prepayment deleted')
      setFormOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Prepaid account</span>
        <input
          className="fsearch"
          style={{ width: 90, fontFamily: 'var(--mono)' }}
          value={account}
          onChange={(e) => setAccount(e.target.value.trim())}
        />
        {entityAccounts.length > 1 ? entityAccounts.map((a) => (
          <button
            key={a}
            className="fsel"
            onClick={() => setAccount(a)}
            style={{
              fontFamily: 'var(--mono)',
              fontWeight: account === a ? 700 : 400,
              ...(account === a ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}),
            }}
          >
            {a}
          </button>
        )) : null}
        <button className="fsel" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Check QB postings'}
        </button>
        <button
          className="fsel"
          onClick={() => openAdd()}
          style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }}
        >
          + Add prepayment
        </button>
        {glFetchedAt ? (
          <span style={{ fontSize: '0.66rem', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            QB ledger as of {glFetchedAt.slice(0, 16).replace('T', ' ')} UTC
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {overdueCount > 0 ? (
          <span style={{ fontSize: '0.72rem', color: '#D4A017', fontWeight: 600 }}>⚠ {overdueCount} overdue</span>
        ) : null}
        {mismatchCount > 0 ? (
          <span style={{ fontSize: '0.72rem', color: '#d93025', fontWeight: 600 }}>✗ {mismatchCount} amount mismatch</span>
        ) : null}
      </div>

      {notice ? (
        <div className="status-bar" style={{ marginBottom: 10 }}>
          <span className="status-dot ok" /><span className="status-text">{notice}</span>
        </div>
      ) : null}
      {error ? (
        <div className="status-bar" style={{ marginBottom: 10 }}>
          <span className="status-dot warn" /><span className="status-text">{error}</span>
        </div>
      ) : null}

      {/* Amortization matrix */}
      {items === null ? (
        <div style={{ color: 'var(--muted)', padding: 24 }}>Loading register…</div>
      ) : activeItems.length === 0 ? (
        <div className="empty" style={{ padding: 32, textAlign: 'center' }}>
          <div className="empty-icon">∅</div>
          <div>No prepayments registered yet. Import from the candidates below, or add one manually.</div>
        </div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 18 }}>
          <table>
            <thead>
              <tr>
                <th style={{ ...supCellStyle, zIndex: 3, textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Prepayment</span>
                    <span
                      onMouseDown={startColResize}
                      title="Drag to resize this column"
                      style={{ cursor: 'col-resize', userSelect: 'none', padding: '0 4px', color: 'var(--muted)' }}
                    >⇔</span>
                  </div>
                </th>
                <th style={{ textAlign: 'right' }}>Total</th>
                {recon.months.map((m) => (
                  <th key={m} style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '0.66rem' }}>{m}</th>
                ))}
                <th style={{ textAlign: 'right' }}>Posted</th>
                <th style={{ textAlign: 'right' }}>Remaining</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {activeItems.map((it) => {
                const r = recon.perItem.get(it.id)
                const cellsByMonth = new Map((r?.cells ?? []).map((c) => [c.month, c]))
                return (
                  <tr key={it.id}>
                    <td style={supCellStyle}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.vendorName}</div>
                      <div
                        title={`${it.description ?? ''}${it.expenseGlAccount ? ` · DR ${it.expenseGlAccount}` : ''}${it.className ? ` · ${it.className}` : ''}`}
                        style={{ fontSize: '0.66rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {it.description || ''} {it.expenseGlAccount ? `· DR ${it.expenseGlAccount}` : '· ⚠ no expense GL'}
                        {it.className ? ` · ${it.className}` : ''}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(Number(it.totalAmount))}</td>
                    {recon.months.map((m) => {
                      const c = cellsByMonth.get(m)
                      if (!c || c.scheduled === 0 && c.posted === 0) {
                        return <td key={m} style={{ textAlign: 'right', color: 'var(--muted)' }}>—</td>
                      }
                      const s = CELL_STYLE[c.status]
                      const rowsDetail = c.postedRows.length > 0
                        ? '\n\nQB rows matched:\n' + c.postedRows
                            .map((pr) => `  ${pr.date}  ${fmt(Math.abs(pr.amount))}  ${(pr.memo ?? '').slice(0, 70)}`)
                            .join('\n')
                        : ''
                      return (
                        <td
                          key={m}
                          title={`${it.vendorName} · ${m}\nScheduled: $${fmt(c.scheduled)}\nPosted in QB: $${fmt(c.posted)}\nStatus: ${c.status}${rowsDetail}`}
                          style={{ textAlign: 'right', fontFamily: 'var(--mono)', background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}
                        >
                          {s.icon ? `${s.icon} ` : ''}{fmt(c.status === 'mismatch' ? c.posted : c.scheduled)}
                        </td>
                      )
                    })}
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(r?.postedTotal ?? 0)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmt(r?.remaining ?? Number(it.totalAmount))}</td>
                    <td>
                      <button className="fsel" style={{ fontSize: '0.68rem' }} onClick={() => openEdit(it)}>Edit</button>
                    </td>
                  </tr>
                )
              })}
              <tr style={{ fontWeight: 700 }}>
                <td style={supCellStyle}>Total scheduled / month</td>
                <td />
                {recon.months.map((m) => (
                  <td key={m} style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmt(monthTotals.get(m) ?? 0)}</td>
                ))}
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* To book this month */}
      <div className="card" style={{ padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            To book
          </span>
          <input className="fsearch" style={{ width: 110, fontFamily: 'var(--mono)' }} type="month" value={bookMonth} onChange={(e) => setBookMonth(e.target.value)} />
        </div>
        {activeItems.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
            No prepayments registered yet — nothing to compute for {bookMonth}.
          </div>
        ) : toBook.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
            Nothing pending for {bookMonth} — every scheduled amortization is posted. ✓
          </div>
        ) : (
          <>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {toBook.map(({ item: it, cell }) => (
                <li key={it.id} style={{ fontSize: '0.8rem', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ color: CELL_STYLE[cell.status].fg, fontWeight: 700 }}>{CELL_STYLE[cell.status].icon}</span>
                  <strong>{it.vendorName}</strong>
                  <span style={{ fontFamily: 'var(--mono)' }}>
                    DR {it.expenseGlAccount ?? '⚠ set expense GL'}{it.className ? ` (${it.className})` : ''} {fmtUSD(cell.scheduled)}
                    {' · '}CR {account} Prepaid
                  </span>
                  {cell.status === 'mismatch' ? (
                    <span style={{ color: '#d93025', fontSize: '0.7rem' }}>
                      posted {fmtUSD(cell.posted)} — expected {fmtUSD(cell.scheduled)} · excluded from the global JE, resolve manually
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {jeLines.length > 0 ? (
              <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <button
                  className="fsel"
                  onClick={() => { setJeError(null); setJeModalOpen(true) }}
                  disabled={postingJe}
                  style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 700 }}
                  title={jeMissingGl.length > 0
                    ? `Set the expense GL on: ${jeMissingGl.map((l) => l.vendorName).join(', ')}`
                    : `Creates ONE journal entry in QuickBooks dated ${lastDayOfMonth(bookMonth)}`}
                >
                  {postingJe ? 'Posting to QuickBooks…' : `Post global JE to QB — ${fmtUSD(jeTotal)} (${jeLines.length} lines)`}
                </button>
                {jeMissingGl.length > 0 ? (
                  <span style={{ fontSize: '0.7rem', color: '#D4A017' }}>
                    ⚠ set the expense GL on {jeMissingGl.map((l) => l.vendorName).join(', ')} first
                  </span>
                ) : (
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                    One JE dated {lastDayOfMonth(bookMonth)}: {jeLines.length} debits · CR {account} {fmtUSD(jeTotal)}
                  </span>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* New prepaid additions in QB with no registered contract — values
          come straight from the ledger; Register opens the Add form
          pre-filled (vendor, total, date, GL/class from the vendor master).
          The user confirms only the number of months — no guessed terms. */}
      {recentCandidates.length > 0 ? (
        <div className="card" style={{ padding: 14, marginBottom: 18, borderColor: '#D4A017' }}>
          <div style={{ fontSize: '0.72rem', color: '#D4A017', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            New additions in QB (account {account}) without a registered prepayment — {recentCandidates.length}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {recentCandidates.map((c, i) => {
              const master = c.name ? vendorMaster.get(c.name.trim().toLowerCase()) : undefined
              return (
                <div key={`${c.txnId ?? i}-${c.date}-${c.amountUsd}`} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.78rem' }}>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{c.date}</span>
                  <strong>{c.name ?? '—'}</strong>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmtUSD(Math.abs(c.amountUsd ?? 0))}</span>
                  <span style={{ color: 'var(--muted)', flex: 1, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.memo ?? ''}>{c.memo ?? ''}</span>
                  <button
                    className="fsel"
                    style={{ fontWeight: 600 }}
                    onClick={() => openAdd({
                      vendorName: c.name ?? '',
                      description: c.memo ?? '',
                      totalAmount: String(Math.abs(c.amountUsd ?? 0)),
                      startMonth: c.date.slice(0, 7),
                      months: '',
                      expenseGlAccount: master?.glAccount ?? '',
                      className: master?.className ?? '',
                      sourceTxnId: c.txnId,
                      sourceDate: c.date,
                    })}
                  >
                    + Register
                  </button>
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: 8 }}>
            Values come straight from QB — confirm the number of months (and expense GL / class when not prefilled) and save.
          </div>
        </div>
      ) : null}

      {/* Diagnostic: amortizations in QB no registered contract claims —
          explains any month that shows pending although QB has the posting. */}
      {unmatchedAmorts.length > 0 ? (
        <div className="card" style={{ padding: 14, marginBottom: 18 }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Amortizations in QB not matched to any registered contract — {unmatchedAmorts.length}
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            {unmatchedAmorts.map((o, i) => (
              <div key={`${o.txnId ?? i}-${o.date}-${o.amountUsd}`} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.76rem' }}>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{o.date}</span>
                <strong>{o.name ?? '—'}</strong>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmtUSD(Math.abs(o.amountUsd ?? 0))}</span>
                <span style={{ color: 'var(--muted)', flex: 1, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.memo ?? ''}>{o.memo ?? ''}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: 8 }}>
            These reduce the prepaid account but no contract claims them. If a month above shows pending although QB posted it, adjust that contract&apos;s vendor spelling or description (Edit) so these rows match.
          </div>
        </div>
      ) : null}

      {/* Global JE confirm modal — same visual language as the transactions
          post modal: warning banner, balanced JE preview, explicit footer. */}
      {jeModalOpen ? (
        <div className="modal-overlay open" onClick={postingJe ? undefined : () => setJeModalOpen(false)}>
          <div
            className="modal post-qb-modal"
            style={{ width: 640, maxWidth: '96vw', maxHeight: '88vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="modal-title">Post global JE to QuickBooks</div>
                <div className="modal-sub">
                  Entity: {entity} · 1 journal entry · {jeLines.length} contract{jeLines.length === 1 ? '' : 's'} · dated {lastDayOfMonth(bookMonth)}
                </div>
              </div>
              <button className="modal-close" onClick={() => setJeModalOpen(false)} disabled={postingJe} aria-label="Close">×</button>
            </div>

            <div className="modal-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--warn, #d97706)',
                  background: 'color-mix(in srgb, var(--warn, #d97706) 8%, transparent)',
                  fontSize: '0.74rem',
                  color: 'var(--text)',
                }}
              >
                <strong style={{ color: 'var(--warn, #d97706)' }}>⚠ Posting hits QuickBooks.</strong>
                {' '}One real journal entry will be created — don&apos;t close this browser tab until complete.
              </div>

              {jeMissingGl.length > 0 ? (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--red, #dc2626)',
                    background: 'color-mix(in srgb, var(--red, #dc2626) 8%, transparent)',
                    fontSize: '0.78rem',
                    color: 'var(--red, #dc2626)',
                  }}
                >
                  <strong>Expense GL missing on: {jeMissingGl.map((l) => l.vendorName).join(', ')}.</strong>
                  {' '}Click Edit on each contract row, pick the expense account (and class), save, then reopen this dialog.
                </div>
              ) : null}

              <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, background: 'var(--surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Prepaid amortization {bookMonth} · doc number allocated on post
                  </span>
                  <span style={{ fontSize: '0.7rem', fontFamily: 'var(--mono)', color: 'var(--green, #10b981)', fontWeight: 600 }}>
                    ✓ Balanced
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: '0.7rem' }}>
                  <tbody>
                    {jeLines.map((l, li) => (
                      <tr key={li} style={{ borderTop: li === 0 ? 'none' : '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 8px 4px 0', color: 'var(--green, #10b981)', fontWeight: 600, width: 60 }}>Debit</td>
                        <td style={{ padding: '4px 8px', color: l.expenseGlAccount ? 'var(--muted)' : 'var(--red, #dc2626)', whiteSpace: 'nowrap' }}>
                          {l.expenseGlAccount ? `${l.expenseGlAccount}${l.className ? ` · ${l.className}` : ''}` : '⚠ set expense GL'}
                        </td>
                        <td style={{ padding: '4px 8px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.vendorName}</td>
                        <td style={{ padding: '4px 0 4px 8px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>
                          ${l.amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--red, #dc2626)', fontWeight: 600, width: 60 }}>Credit</td>
                      <td style={{ padding: '4px 8px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{account} · Prepaid expenses</td>
                      <td style={{ padding: '4px 8px' }} />
                      <td style={{ padding: '4px 0 4px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        ${jeTotal.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {jeError ? (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--red, #dc2626)',
                    background: 'color-mix(in srgb, var(--red, #dc2626) 8%, transparent)',
                    fontSize: '0.78rem',
                    color: 'var(--red, #dc2626)',
                  }}
                >
                  Post failed: {jeError}
                </div>
              ) : null}
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="fsel" onClick={() => setJeModalOpen(false)} disabled={postingJe}>Cancel</button>
              <button
                className="fsel"
                onClick={() => void postGlobalJe()}
                disabled={postingJe || jeLines.length === 0 || jeMissingGl.length > 0}
                style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 700 }}
                title={jeMissingGl.length > 0 ? `Set the expense GL on: ${jeMissingGl.map((l) => l.vendorName).join(', ')}` : undefined}
              >
                {postingJe ? 'Posting…' : 'Post to QuickBooks'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add / Edit modal */}
      {formOpen ? (
        <div className="modal-overlay open" onClick={() => { if (!saving) setFormOpen(false) }}>
          <div className="modal" style={{ width: 560, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{form.id ? `Edit — ${form.vendorName}` : 'Add prepayment'}</span>
              <button className="modal-close" onClick={() => { if (!saving) setFormOpen(false) }} aria-label="Close">×</button>
            </div>
            <div className="modal-body" style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Vendor *</span>
                <input className="fsearch" value={form.vendorName} onChange={(e) => setForm((p) => ({ ...p, vendorName: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Total amount (USD) *</span>
                <input className="fsearch" type="number" step="0.01" min="0" value={form.totalAmount} onChange={(e) => setForm((p) => ({ ...p, totalAmount: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>First amortization month *</span>
                <input className="fsearch" type="month" value={form.startMonth} onChange={(e) => setForm((p) => ({ ...p, startMonth: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Months (straight-line) *</span>
                <input className="fsearch" type="number" min="1" max="120" value={form.months} onChange={(e) => setForm((p) => ({ ...p, months: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Expense GL (DR side)</span>
                <select className="fsel" value={form.expenseGlAccount} onChange={(e) => setForm((p) => ({ ...p, expenseGlAccount: e.target.value }))}>
                  <option value="">—</option>
                  {glOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Class</span>
                <select className="fsel" value={form.className} onChange={(e) => setForm((p) => ({ ...p, className: e.target.value }))}>
                  <option value="">—</option>
                  {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Description</span>
                <input className="fsearch" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
              </label>
              <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Notes</span>
                <input className="fsearch" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
              </label>
              {form.totalAmount && form.months && Number(form.months) > 0 ? (
                <div style={{ gridColumn: '1 / -1', fontSize: '0.7rem', color: 'var(--muted)' }}>
                  ≈ {fmtUSD(parseFloat(form.totalAmount || '0') / Math.max(1, parseInt(form.months || '1', 10)))} / month, straight-line
                </div>
              ) : null}
            </div>
            <div className="modal-footer">
              {form.id ? (
                <button className="fsel" onClick={() => void deleteItem()} disabled={saving} style={{ color: '#d93025' }}>
                  Delete
                </button>
              ) : null}
              <span style={{ flex: 1 }} />
              <button className="fsel" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
              <button
                className="fsel"
                onClick={() => void saveForm()}
                disabled={saving}
                style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }}
              >
                {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add prepayment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
