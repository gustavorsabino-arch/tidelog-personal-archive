'use client'

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITIES, TOKEN_COLORS } from '@/lib/constants'
import { fmtUSD, fmtNum, fmtAddr, monthToRange, yearToRange, MONTH_SHORT_NAMES } from '@/lib/format'
import { useEntityWallets } from '@/lib/hooks/use-entity-wallets'
import { useTransactionMonths } from '@/lib/hooks/use-transaction-months'
import { useAllQbVendors } from '@/lib/hooks/use-qb-vendors'
import { useAllQbClasses } from '@/lib/hooks/use-qb-classes'
import { Skeleton } from '@/components/skeleton'
import { DataTable } from '@/components/data-table'
import { CopyButton } from '@/components/copy-button'
import { EditableCell } from '@/components/editable-cell'
import { EditableSelectCell, type SelectOption } from '@/components/editable-select-cell'
import { PostToQbModal } from '@/components/post-to-qb-modal'
import { TransactionsExportModal } from '@/components/transactions-export-modal'
import { PrepaymentsPanel } from '@/components/prepayments-panel'
import { QbBulkDrilldownPanel } from '@/components/qb-bulk-drilldown-panel'
import { useSharedAccess } from '@/lib/access-context'
import { hasPermission } from '@/lib/auth/permissions'
import { isQboEntity, type QboEntity } from '@/lib/qb/config'
import { qbJeUrl, isBulkDocNumber } from '@/lib/qb/links'
import type { Transaction, TransactionSummary, TransactionsResponse, PriceSourceTag } from '@/lib/types'
import { PriceWithSource } from '@/components/price-with-source'

// Status filter values map directly to t.qbPostingStatus (with the addition of
// 'all' for no filter and 'unposted' which also covers null). Keep this in
// sync with the dropdown options below.
type QbStatusFilter = '' | 'unposted' | 'posted' | 'posted_modified' | 'posted_manually' | 'voided' | 'failed'

// Client-side mirror of the server-enforced cap (D13). Disables the post
// button with a helper note when the user has selected more than this many
// rows — server-side check at /api/qb/post-batch is the source of truth.
// Mirrors the server cap (app/api/qb/post-batch): up to 1000 selected txs
// per post. The real limit is 50 JOURNAL ENTRIES per post (each individual-
// wallet tx = 1 JE; a bulk wallet's whole month = 1 JE) — enforced
// server-side with a clear error when exceeded.
const MAX_POST_BATCH = 1000

type TransactionsPageClientProps = {
  initialEntity: string
  initialTransactions: Transaction[]
  initialTotal: number
  initialSummary: TransactionSummary
  pageSize: number
}

function renderGainCell(
  gain: number | null | undefined,
  t: Transaction,
  monthStartMs: number | null,
  bucket: 'ST' | 'LT',
): React.ReactNode {
  if (gain == null) return <span style={{ color: 'var(--muted)' }}>—</span>
  // ⚠ when a consumed lot pre-dates the active filter window — the realized term may
  // not reflect the cost basis the user expects for "this month's" activity.
  const acqBeforeWindow =
    monthStartMs != null && (t.lots ?? []).some(l => Date.parse(l.acqDate) < monthStartMs)
  const sign = gain > 0 ? '+' : ''
  const cls = gain > 0 ? 'gain-pos' : gain < 0 ? 'gain-neg' : ''
  return (
    <span className={cls} style={{ fontWeight: 500 }}>
      {acqBeforeWindow && (
        <span
          title={`A consumed lot was acquired before the selected period; ${bucket} term may not reflect realized-in-period basis.`}
          style={{ color: 'var(--warn, #d97706)', marginRight: 4 }}
        >⚠</span>
      )}
      {gain === 0 ? '—' : `${sign}${fmtUSD(gain)}`}
    </span>
  )
}

export function TransactionsPageClient({
  initialEntity,
  initialTransactions,
  initialTotal,
  initialSummary,
  pageSize,
}: TransactionsPageClientProps) {
  const [entity, setEntity] = useState<string>(initialEntity)
  // Sub-view: the regular transactions list, or the Prepayments map.
  const [view, setView] = useState<'transactions' | 'prepayments'>('transactions')

  // Manual on-chain sync — the same job the twice-daily cron runs. Surfaces
  // the job's error message when it fails, which is the fastest way to see
  // WHY the scheduled sync stopped.
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  async function syncTransactionsNow() {
    setSyncing(true)
    setSyncNote('Syncing from the blockchain — this can take a few minutes…')
    try {
      const res = await apiFetch<{
        ok: boolean; inserted?: number; failed?: number; gainsFailed?: number;
        gains?: { entity: string; error?: string }[]
      }>(
        '/api/admin/cron/fetch-transactions',
        { method: 'POST' },
      )
      if (!res.ok) {
        const gainErrors = res.gains?.filter(g => g.error).map(g => `${g.entity}: ${g.error}`).join('; ')
        setSyncNote(`✗ Sync incomplete — ${res.inserted ?? 0} transactions inserted, ${res.failed ?? 0} wallets failed, ${res.gainsFailed ?? 0} gain/loss updates failed${gainErrors ? `. ${gainErrors}` : ''}.`)
        setSyncing(false)
        return
      }
      setSyncNote(`✓ Sync finished — ${res.inserted ?? 0} new transactions${res.failed ? `, ${res.failed} wallet(s) failed` : ''}. Reloading…`)
      setTimeout(() => window.location.reload(), 1800)
    } catch (e) {
      setSyncNote(`✗ Sync failed: ${e instanceof Error ? e.message : 'unknown error'}`)
      setSyncing(false)
    }
  }
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions)
  const [total, setTotal] = useState(initialTotal)
  const [summary, setSummary] = useState<TransactionSummary>(initialSummary)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Wave 2c — bulk-selection state. Holds the `id` of each currently-selected
  // transaction. We use a Set so toggle/has are O(1) and the column's per-row
  // render doesn't have to scan an array on every render.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [postModalOpen, setPostModalOpen] = useState(false)

  // qb:post permission gates the post button + the material-edit confirm path.
  // Pulled from the SSR-seeded AccessProvider, so no client round-trip.
  const { access } = useSharedAccess()
  const canPost = hasPermission(access?.role, 'qb:post')

  // Server-side filters
  const [tokenFilter, setTokenFilter] = useState('')
  const [dirFilter, setDirFilter] = useState('')
  // Year-then-month cascade: month is only meaningful when a year is selected.
  const [yearFilter, setYearFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [walletFilter, setWalletFilter] = useState('')
  // Wave 2c — client-side QB status filter over already-fetched rows.
  const [qbStatusFilter, setQbStatusFilter] = useState<QbStatusFilter>('')
  // Client-side search over the current page only
  const [search, setSearch] = useState('')
  // Export modal — downloads posted transactions for a month + entity to .xlsx.
  const [exportModalOpen, setExportModalOpen] = useState(false)

  // Per-row action state for Re-post / Void hover buttons. Keyed by tx.id so
  // multiple rows can spin independently. A row with a non-null entry is
  // currently in-flight.
  const [rowBusy, setRowBusy] = useState<Record<string, 'repost' | 'void' | undefined>>({})
  const [rowError, setRowError] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  // "Select all pages" (Gmail pattern) — fetches every matching tx id for
  // the current filters and selects them all.
  const [selectAllBusy, setSelectAllBusy] = useState(false)
  // Posted ids within a cross-page selection: the visible page can't tell
  // us about off-page rows, so the select-all fetch records them. Drives
  // the "will mark JEs stale" confirms even when the posted rows aren't
  // on screen. Cleared together with the selection.
  const [selectedPostedIds, setSelectedPostedIds] = useState<Set<string>>(new Set())
  // Staleness guard: a slow limit=all response must never reinstate a
  // selection after the user changed filters/pages (they'd act on rows
  // from the OLD filter without seeing them).
  const selectionEpoch = useRef(0)

  // Bulk Edit modal — month-specific per-tx overrides for the selected
  // rows: wallet GL / counterparty GL / vendor / class. Deliberately does
  // NOT memorize anything (no counterparty-map upsert, no wallet default) —
  // it's the surgical exception; next month needs the same edit again.
  const EDIT_UNCHANGED = '__unchanged__'
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [editDraft, setEditDraft] = useState<Record<'glAccountOverride' | 'counterpartyGlOverride' | 'vendorOverride' | 'classOverride', string>>({
    glAccountOverride: EDIT_UNCHANGED,
    counterpartyGlOverride: EDIT_UNCHANGED,
    vendorOverride: EDIT_UNCHANGED,
    classOverride: EDIT_UNCHANGED,
  })

  // Drill-down panel for bulk JEs. Holds the post we want to inspect; null = closed.
  type DrilldownTarget = {
    postId: string
    docNumber: string
    qbJournalEntryId: string | null
    postingStatus: NonNullable<Transaction['qbPostingStatus']> | null
  }
  const [drilldown, setDrilldown] = useState<DrilldownTarget | null>(null)

  // Pagination — offset into the server-side sorted result set
  const [offset, setOffset] = useState(0)

  const { options: walletOptions } = useEntityWallets(entity, true)
  const { years: yearOptions, byYear: monthsByYear } = useTransactionMonths(entity)

  // Wave 2b — QB account catalog for the Counterparty GL dropdown.
  // SWR caches across renders and dedupes concurrent requests per entity.
  type QbAccount = { qbAccountId: string; qbAccountNumber: string; qbAccountName: string; accountType: string | null }
  const { data: glAccountsData } = useSWR<{ entity: string; accounts: QbAccount[] }>(
    entity ? `/api/qb/accounts?entity=${entity}` : null,
    apiFetch,
  )
  const glOptions: SelectOption[] = useMemo(() => {
    const accounts = glAccountsData?.accounts ?? []
    return accounts.map(a => ({
      value: a.qbAccountNumber,
      label: `${a.qbAccountNumber} — ${a.qbAccountName}`,
    }))
  }, [glAccountsData])

  // Phase 4 — Vendor + Class union catalogs for the inline-override dropdowns.
  // useAllQbVendors/useAllQbClasses fetch across all QB entities so the options
  // are always populated regardless of which entity tab is active.
  const { vendors: allVendors } = useAllQbVendors()
  const { classes: allClasses } = useAllQbClasses()
  const vendorOptions: SelectOption[] = useMemo(
    () => allVendors.map(v => ({ value: v.displayName, label: v.displayName })),
    [allVendors],
  )
  const classOptions: SelectOption[] = useMemo(
    () => allClasses.map(c => ({ value: c.qbClassName, label: c.qbClassName })),
    [allClasses],
  )

  // Tracks the in-flight request so a newer fetch can cancel an older one.
  // Without this, responses can arrive out of order: e.g. selecting a year
  // fires a heavy "whole year" request, then selecting a month fires a light
  // "single month" one — the month response renders first, then the slower
  // year response lands last and clobbers the table with year-wide data while
  // the dropdown still says the month. Aborting the prior request prevents
  // that and cancels the wasted server work.
  const inFlight = useRef<AbortController | null>(null)

  // Cancel any in-flight request when the component unmounts, so its response
  // can't fire setState on a torn-down component.
  useEffect(() => () => inFlight.current?.abort(), [])

  // Offset is passed in explicitly — never read from closure — so pagination
  // and filter changes can each fire exactly one fetch with the right offset,
  // with no race between an "offset reset" effect and a "fetch on offset
  // change" effect.
  const fetchTransactions = useCallback(async (off: number) => {
    if (!entity) return
    // Supersede any request still in flight; its response would be stale.
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setLoading(true)
    try {
      const params = new URLSearchParams({ entity, limit: String(pageSize), offset: String(off) })
      if (tokenFilter) params.set('asset', tokenFilter)
      if (dirFilter) params.set('direction', dirFilter)
      if (walletFilter) params.set('wallet', walletFilter)
      if (qbStatusFilter) params.set('qbStatus', qbStatusFilter)
      const range = monthFilter ? monthToRange(monthFilter) : yearToRange(yearFilter)
      if (range) {
        params.set('from', range.from)
        params.set('to', range.to)
      }
      const res = await apiFetch<TransactionsResponse>(
        `/api/treasury/transactions?${params}`,
        { signal: controller.signal },
      )
      setTransactions(res.transactions)
      setTotal(res.total)
      setSummary(res.summary)
      setError(null)
    } catch (e: unknown) {
      // Aborted by a newer request — that request now owns the UI state, so
      // leave error/loading alone and let it finish.
      if (controller.signal.aborted) return
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      // Only the latest request clears the loading flag; a superseded request
      // must not flip it off while its replacement is still running.
      if (inFlight.current === controller) {
        setLoading(false)
        inFlight.current = null
      }
    }
  }, [entity, pageSize, tokenFilter, dirFilter, walletFilter, yearFilter, monthFilter, qbStatusFilter])

  // One-way flag: flips true the first time state moves away from SSR initial
  // values, and stays true. Skips the redundant initial fetch (state already
  // came from SSR) without suppressing later refetches when the user happens
  // to reset filters back to their initial values.
  const hasInteracted = useRef(false)

  // Filter/entity change → always page 1 and fetch.
  useEffect(() => {
    const atInitialState =
      entity === initialEntity &&
      !tokenFilter && !dirFilter && !yearFilter && !monthFilter && !walletFilter && !qbStatusFilter
    if (!atInitialState) hasInteracted.current = true
    if (!hasInteracted.current && atInitialState) return
    setOffset(0)
    // Selection is tied to the *currently visible* dataset; once filters or
    // entity change, the selected ids may not even be on the page anymore and
    // they're certainly not what the user meant to post. Always clear.
    selectionEpoch.current++
    setSelectedIds(new Set())
    setSelectedPostedIds(new Set())
    if (entity) fetchTransactions(0)
  }, [entity, initialEntity, tokenFilter, dirFilter, yearFilter, monthFilter, walletFilter, qbStatusFilter, fetchTransactions])

  // Pagination is an explicit user action, not derived state. Calling fetch
  // directly avoids the effect-driven double-fetch race entirely.
  const goToOffset = (off: number) => {
    setOffset(off)
    // Page-local selections are cleared on navigation (stale rows the user
    // can't see). A CROSS-PAGE select-all is different: its whole point is
    // rows beyond the page, the filters haven't changed, and clearing it
    // would destroy the selection exactly when the user pages through to
    // verify it before posting — so it survives navigation.
    const isCrossPage = selectedIds.size > visibleSelectableIds.length
    if (!isCrossPage) {
      selectionEpoch.current++
      setSelectedIds(new Set())
      setSelectedPostedIds(new Set())
    }
    fetchTransactions(off)
  }

  // Selection helpers — keep the Set immutable across updates so React re-runs
  // dependent memos (column render, post-button disabled state) cleanly.
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    selectionEpoch.current++
    setSelectedIds(new Set())
    setSelectedPostedIds(new Set())
  }, [])

  // Select every transaction matching the CURRENT server-side filters,
  // across all pages. Uses the same params as fetchTransactions with
  // limit=all; rows without an id (cron-only) are skipped, same as the
  // per-page checkbox.
  async function applyBulkEdit() {
    const provided = (Object.entries(editDraft) as [string, string][])
      .filter(([, v]) => v !== EDIT_UNCHANGED)
    if (provided.length === 0) { setEditModalOpen(false); return }

    const txIds = Array.from(selectedIds)
    if (txIds.length > MAX_POST_BATCH) {
      setRowError(`Selection exceeds ${MAX_POST_BATCH} transactions — narrow the filter before bulk editing.`)
      return
    }
    // Posted-row detection covers the FULL selection: the visible page scan
    // plus the posted ids recorded by select-all-across-pages.
    const hasPosted = selectedPostedIds.size > 0 || transactions.some(
      t => t.id && selectedIds.has(t.id) && t.qbPostingStatus === 'posted',
    )
    if (hasPosted) {
      const ok = window.confirm(
        'One or more selected rows are posted to QuickBooks. This edit will '
        + 'mark those journal entries stale and require re-posting. Continue?',
      )
      if (!ok) return
    }

    setEditBusy(true)
    try {
      const body: Record<string, unknown> = { txIds }
      for (const [k, v] of provided) body[k] = v === '' ? null : v
      const saved = await apiFetch<{ vendorMappingMissing: boolean }>('/api/treasury/transactions/bulk-qb-state', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      setRowError(saved.vendorMappingMissing
        ? `Vendor “${body.vendorOverride}” was saved, but has no matching GL/Class in Vendors / Apps.`
        : null)
      setEditModalOpen(false)
      setEditDraft({
        glAccountOverride: EDIT_UNCHANGED,
        counterpartyGlOverride: EDIT_UNCHANGED,
        vendorOverride: EDIT_UNCHANGED,
        classOverride: EDIT_UNCHANGED,
      })
      fetchTransactions(offset)
    } catch (err) {
      setRowError(`Bulk edit failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setEditBusy(false)
    }
  }

  const selectAllMatching = useCallback(async () => {
    if (!entity) return
    setSelectAllBusy(true)
    const epoch = selectionEpoch.current
    try {
      const params = new URLSearchParams({ entity, limit: 'all' })
      if (tokenFilter) params.set('asset', tokenFilter)
      if (dirFilter) params.set('direction', dirFilter)
      if (walletFilter) params.set('wallet', walletFilter)
      if (qbStatusFilter) params.set('qbStatus', qbStatusFilter)
      const range = monthFilter ? monthToRange(monthFilter) : yearToRange(yearFilter)
      if (range) {
        params.set('from', range.from)
        params.set('to', range.to)
      }
      const res = await apiFetch<TransactionsResponse>(`/api/treasury/transactions?${params}`)
      // Stale response? The user changed filters/pages while this was in
      // flight — installing the old-filter selection would let them act on
      // rows they can no longer see. Drop it.
      if (selectionEpoch.current !== epoch) return
      setSelectedIds(new Set(
        res.transactions.map((t) => t.id).filter((id): id is string => !!id),
      ))
      // Remember which selected rows are POSTED — the visible page can't
      // answer that for off-page rows, and the material-edit confirms need it.
      setSelectedPostedIds(new Set(
        res.transactions
          .filter((t) => t.qbPostingStatus === 'posted')
          .map((t) => t.id)
          .filter((id): id is string => !!id),
      ))
      setRowError(null)
    } catch (err) {
      setRowError(`Select all failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSelectAllBusy(false)
    }
  }, [entity, tokenFilter, dirFilter, walletFilter, qbStatusFilter, monthFilter, yearFilter])

  // Drop the selected wallet/year/month if they fall out of the available
  // options (entity switch, wallet deletion, etc.). Avoids a stuck filter that
  // would silently produce zero rows.
  useEffect(() => {
    if (walletFilter && walletOptions.length > 0 && !walletOptions.some((o) => o.value === walletFilter)) {
      setWalletFilter('')
    }
  }, [walletFilter, walletOptions])

  useEffect(() => {
    if (!yearFilter) return
    if (yearOptions.length > 0 && !yearOptions.includes(yearFilter)) {
      setYearFilter('')
      setMonthFilter('')
    }
  }, [yearFilter, yearOptions])

  useEffect(() => {
    if (!monthFilter) return
    const [y, m] = monthFilter.split('-')
    const monthsForYear = monthsByYear[y]
    if (monthsForYear && !monthsForYear.includes(m)) {
      setMonthFilter('')
    }
  }, [monthFilter, monthsByYear])

  // Counts per postId so we can detect bulk JEs even when a docNumber happens
  // to NOT start with BULK- (defense in depth — D6 says bulk uses BULK- prefix,
  // but if multiple txs share the same qb_post row that's the authoritative
  // signal). Built off the raw `transactions` (unfiltered) so a status filter
  // doesn't accidentally turn a bulk into a singleton.
  const postIdCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of transactions) {
      if (!t.qbPostId) continue
      m.set(t.qbPostId, (m.get(t.qbPostId) ?? 0) + 1)
    }
    return m
  }, [transactions])

  const isBulkPost = useCallback(
    (t: Transaction): boolean => {
      if (isBulkDocNumber(t.qbDocNumber)) return true
      if (t.qbPostId && (postIdCount.get(t.qbPostId) ?? 0) > 1) return true
      return false
    },
    [postIdCount],
  )

  // `search` is the only client-side filter (narrows the current page). Token /
  // dir / wallet / date / qbStatus are all server filters that operate across
  // the whole dataset (so e.g. "Posted (manual)" finds rows on any page).
  const filtered = useMemo(() => {
    if (!search) return transactions
    const s = search.toLowerCase()
    return transactions.filter((t) =>
      (t.txHash || '').toLowerCase().includes(s) ||
      (t.wallet || '').toLowerCase().includes(s) ||
      (t.walletAddr || '').toLowerCase().includes(s) ||
      (t.asset || '').toLowerCase().includes(s),
    )
  }, [transactions, search])

  // Per-row Re-post handler. For posted / posted_modified rows: void the
  // current QB JE then re-post. For voided rows: skip the void (already done)
  // and just re-post — creates a NEW qb_post row (D14).
  const handleRepostRow = useCallback(async (t: Transaction) => {
    if (!t.id || !t.qbPostId) return
    if (!isQboEntity(t.entity)) {
      setRowError(`Cannot post: ${t.entity} is not a QuickBooks entity.`)
      return
    }
    const ok = window.confirm(
      'Re-post this row? The current QuickBooks entry will be voided and a new one created.',
    )
    if (!ok) return

    const id = t.id
    setRowBusy((prev) => ({ ...prev, [id]: 'repost' }))
    setRowError(null)
    try {
      // Skip the void leg when the entry is already voided — calling void on
      // a voided entry would error or no-op depending on QB's behavior.
      if (t.qbPostingStatus !== 'voided') {
        await apiFetch('/api/qb/post-void', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ postId: t.qbPostId }),
        })
      }
      await apiFetch('/api/qb/post-batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity: t.entity, txIds: [t.id] }),
      })
      fetchTransactions(offset)
    } catch (e: unknown) {
      setRowError(e instanceof Error ? e.message : 'Re-post failed')
    } finally {
      setRowBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }, [fetchTransactions, offset])

  // Per-row Void handler. Confirms first, then POSTs the void endpoint. The
  // row's qbPostingStatus flips to 'voided' but qb_post.qb_journal_entry_id
  // is kept so "View in QB" still works (D14).
  const handleVoidRow = useCallback(async (t: Transaction) => {
    if (!t.id || !t.qbPostId) return
    const ok = window.confirm(
      'Void this QuickBooks entry? It will remain in QB with $0 amounts and a Voided flag. The row in tidelog returns to unposted state but keeps the link to the voided QB entry for audit.',
    )
    if (!ok) return

    const id = t.id
    setRowBusy((prev) => ({ ...prev, [id]: 'void' }))
    setRowError(null)
    try {
      await apiFetch('/api/qb/post-void', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId: t.qbPostId }),
      })
      fetchTransactions(offset)
    } catch (e: unknown) {
      setRowError(e instanceof Error ? e.message : 'Void failed')
    } finally {
      setRowBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }, [fetchTransactions, offset])

  // DocNumber click → either open the drill-down panel (bulk) or deep-link
  // to QB in a new tab (individual).
  const handleDocNumberClick = useCallback((t: Transaction) => {
    if (!t.qbPostId || !t.qbDocNumber) return
    if (isBulkPost(t)) {
      setDrilldown({
        postId: t.qbPostId,
        docNumber: t.qbDocNumber,
        qbJournalEntryId: t.qbJournalEntryId ?? null,
        postingStatus: t.qbPostingStatus ?? null,
      })
      return
    }
    // Individual JE → external link. Fall back to a no-op when we have no
    // qbJournalEntryId (failed post never populated it).
    const url = qbJeUrl(t.qbJournalEntryId)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }, [isBulkPost])

  // Members of the currently-open bulk drill-down. Computed off the page's
  // transactions; if the bulk has more members than fit on a page the panel
  // shows what we have plus the "members truncated" note.
  const drilldownMembers = useMemo(() => {
    if (!drilldown) return []
    return transactions.filter((t) => t.qbPostId === drilldown.postId)
  }, [drilldown, transactions])

  // Ids of visible rows that have a usable id (cron-only rows without id can't
  // be posted) drive the "select all on this page" header checkbox. Each rule:
  //   - all visible selected → header is checked
  //   - some visible selected → header is indeterminate
  //   - none selected → header is unchecked
  const visibleSelectableIds = useMemo(
    () => filtered.map(t => t.id).filter((id): id is string => !!id),
    [filtered],
  )
  const visibleSelectedCount = useMemo(
    () => visibleSelectableIds.filter(id => selectedIds.has(id)).length,
    [visibleSelectableIds, selectedIds],
  )
  const allVisibleSelected =
    visibleSelectableIds.length > 0 && visibleSelectedCount === visibleSelectableIds.length
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        // Deselect only the visible rows — preserves any cross-filter selections
        // (rare, since we clear on filter change, but be defensive).
        for (const id of visibleSelectableIds) next.delete(id)
      } else {
        for (const id of visibleSelectableIds) next.add(id)
      }
      return next
    })
  }, [allVisibleSelected, visibleSelectableIds])

  // Entity used for posting must be a QboEntity. The page already constrains
  // `entity` to the ENTITIES constant (which matches QBO_ENTITIES), but the
  // type is `string` here, so narrow defensively before opening the modal.
  const postEntity: QboEntity | null = useMemo(
    () => (isQboEntity(entity) ? entity : null),
    [entity],
  )

  // Snapshot the selected ids at modal-open time so the modal works against a
  // stable list — clearing selection mid-post (e.g. user accidentally clicks a
  // row) doesn't corrupt the in-flight request.
  const selectedIdsArray = useMemo(() => Array.from(selectedIds), [selectedIds])

  const totalIn = summary.inflowsUSD
  const totalOut = summary.outflowsUSD
  const totalNet = summary.netUSD

  const page = Math.floor(offset / pageSize) + 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const hasPrev = offset > 0
  const hasNext = offset + pageSize < total
  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + transactions.length, total)

  const monthStartMs = useMemo(() => {
    if (!monthFilter) return null
    const [y, m] = monthFilter.split('-').map(Number)
    return Date.UTC(y, m - 1, 1)
  }, [monthFilter])

  const columns = useMemo(() => {
    // Selection column lives first so it gets the sticky-first treatment from
    // DataTable. Header hosts a tri-state "select all on page" checkbox driven
    // by `someVisibleSelected` / `allVisibleSelected`. Width is intentionally
    // tight; pointer-cursor invites clicks even outside the box itself.
    const selectCol = {
      key: '__select',
      label: (
        <input
          type="checkbox"
          aria-label="Select all on this page"
          // Avoid bubbling — the th has a sort onClick handler.
          onClick={(e) => e.stopPropagation()}
          ref={(el) => {
            // `indeterminate` isn't a DOM attribute — must be set via ref.
            if (el) el.indeterminate = someVisibleSelected
          }}
          checked={allVisibleSelected}
          onChange={toggleSelectAllVisible}
          disabled={visibleSelectableIds.length === 0}
          style={{ cursor: visibleSelectableIds.length === 0 ? 'not-allowed' : 'pointer' }}
        />
      ),
      width: '36px',
      sortable: false,
      render: (t: Transaction) => {
        if (!t.id) {
          // Cron-built rows without an id can't be acted on; render a placeholder
          // so the column still aligns with the header.
          return <span style={{ color: 'var(--muted)' }}>—</span>
        }
        const id = t.id
        const checked = selectedIds.has(id)
        return (
          <input
            type="checkbox"
            aria-label={`Select transaction ${id.slice(0, 8)}`}
            checked={checked}
            onChange={() => toggleSelect(id)}
            onClick={(e) => e.stopPropagation()}
            style={{ cursor: 'pointer' }}
          />
        )
      },
    }
    const dateCol = {
      key: 'date', label: 'Date', width: yearFilter ? '140px' : '160px',
      render: (t: Transaction) => {
        const d = new Date(t.date)
        return (
          <span style={{ fontSize: '0.72rem' }}>
            {d.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              ...(yearFilter ? {} : { year: 'numeric' }),
              timeZone: 'UTC',
            })}
            {' '}
            <span style={{ color: 'var(--muted)', fontSize: '0.65rem' }}>
              {d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC
            </span>
          </span>
        )
      },
    }
    const walletCol = {
      key: 'wallet', label: 'Wallet', width: '180px',
      render: (t: Transaction) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 170, minWidth: 0 }}>
          <span
            title={t.wallet || t.walletAddr}
            style={{ fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            {t.wallet || fmtAddr(t.walletAddr)}
          </span>
          <CopyButton address={t.walletAddr} />
        </span>
      ),
    }
    const counterpartyCol = {
      key: 'counterparty', label: 'Counterparty', width: '180px', sortable: false,
      render: (t: Transaction) => {
        if (!t.counterparty) return <span style={{ color: 'var(--muted)' }}>—</span>
        const label = t.counterpartyLabel || fmtAddr(t.counterparty)
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 170, minWidth: 0 }}>
            <span
              title={t.counterpartyLabel || t.counterparty}
              style={{ fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
            >
              {label}
            </span>
            <CopyButton address={t.counterparty} />
          </span>
        )
      },
    }
    const dirCol = {
      key: 'dir', label: 'Dir', width: '50px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'} style={{ fontWeight: 600, fontSize: '0.72rem' }}>
          {t.dir}
        </span>
      ),
    }
    const assetCol = {
      key: 'asset', label: 'Token', width: '70px',
      render: (t: Transaction) => {
        const c = TOKEN_COLORS[t.asset] || '#888'
        return <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: `${c}18`, color: c }}>{t.asset}</span>
      },
    }
    const qtyCol = {
      key: 'qty', label: 'Qty', numeric: true, width: '120px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'}>
          {t.dir === 'In' ? '+' : '-'}{fmtNum(t.qty, t.asset === 'SOL' ? 4 : 2)}
        </span>
      ),
    }
    const priceCol = {
      key: 'price', label: 'Price', numeric: true, width: '90px',
      render: (t: Transaction) => (
        <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
          <PriceWithSource value={t.price} source={t.priceSource as PriceSourceTag} />
        </span>
      ),
    }
    const usdCol = {
      key: 'usd', label: 'USD', numeric: true, width: '110px',
      render: (t: Transaction) => (
        <span className={t.dir === 'In' ? 'gain-pos' : 'gain-neg'} style={{ fontWeight: 500 }}>
          {t.usd ? fmtUSD(t.usd) : '—'}
        </span>
      ),
    }
    const walletGlCol = {
      key: 'walletGl', label: 'Wallet GL', width: '200px', sortable: false,
      render: (t: Transaction) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <EditableSelectCell
            // value = the per-tx override; null → show the resolved effective GL
            // (per-token or wallet default) as the memorized default.
            value={t.glAccountOverride ?? null}
            defaultValue={t.effectiveGlAccount ?? undefined}
            options={glOptions}
            onSave={async (next) => {
              if (!t.id) {
                console.error('cannot save: transaction has no id', t)
                return
              }
              // Per-tx override ONLY — writes tx_qb_state.gl_account_override.
              // It never touches the wallet's account_code default or its
              // wallet_token_account_code per-token mappings; it just picks the
              // GL this single transaction posts with. Posted rows get the
              // re-post confirm (T9 flips the JE to 'posted_modified').
              if (t.qbPostingStatus === 'posted') {
                const ok = window.confirm(
                  'This row is posted to QuickBooks. Changing the Wallet GL will '
                  + 'mark the journal entry stale and require re-posting. Continue?',
                )
                if (!ok) throw new Error('Save cancelled')
              }
              await apiFetch(`/api/treasury/transactions/${t.id}/qb-state`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ glAccountOverride: next }),
              })
              fetchTransactions(offset)
            }}
          />
          {t.glSource === 'default' && !t.isPosted && t.glAccountOverride == null && (
            <span
              style={{
                fontSize: '0.65rem',
                fontWeight: 600,
                color: 'var(--red, #dc2626)',
                border: '1px solid var(--red, #dc2626)',
                borderRadius: 4,
                padding: '1px 5px',
                whiteSpace: 'nowrap',
                cursor: 'default',
              }}
              title={`No GL is mapped for ${t.asset ?? 'this token'} on this wallet, so its default account code will be used. Confirm this is correct for ${t.asset ?? 'this token'}, or pick a GL here just for this transaction.`}
            >
              ⚠ default GL
            </span>
          )}
        </span>
      ),
    }
    const counterpartyGlCol = {
      key: 'counterpartyGl', label: 'Counterparty GL', width: '220px', sortable: false,
      render: (t: Transaction) => {
        // D5: even when counterparty is null, render an editable cell — but save
        // to glAccountOverride (per-tx) instead of counterpartyGlOverride
        // (counterparty-keyed), and skip the counterparty_gl_map upsert.
        const hasCounterparty = !!t.counterparty
        const value = hasCounterparty
          ? (t.counterpartyGlOverride ?? null)
          : (t.glAccountOverride ?? null)
        const defaultValue = hasCounterparty
          ? (t.counterpartyGlAccount ?? undefined)
          : undefined  // no memorization for null counterparty
        return (
          <EditableSelectCell
            value={value}
            defaultValue={defaultValue}
            options={glOptions}
            onSave={async (next) => {
              if (!t.id) {
                console.error('cannot save: transaction has no id', t)
                return
              }
              // T11/T9 — material-edit confirm. GL changes on a posted row will
              // flip the linked qb_post.posting_status to 'posted_modified'
              // server-side (per T9). Prompt the user before that side effect.
              // Description edits explicitly DO NOT prompt (two-tier rule D3).
              if (t.qbPostingStatus === 'posted') {
                const ok = window.confirm(
                  'This row is posted to QuickBooks. Changing the Counterparty GL '
                  + 'will mark the journal entry stale and require re-posting. Continue?',
                )
                if (!ok) {
                  // Throwing here keeps the cell in edit mode so the user can pick
                  // a different value (or hit Esc/Cancel). Returning silently would
                  // close the cell with no save, which feels broken.
                  throw new Error('Save cancelled')
                }
              }
              // 1. Save the override — different target depending on whether
              //    there's a counterparty (D5).
              const patchBody = hasCounterparty
                ? { counterpartyGlOverride: next }
                : { glAccountOverride: next }
              await apiFetch(`/api/treasury/transactions/${t.id}/qb-state`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(patchBody),
              })
              // 2. Map side-effect — only when the row has a counterparty (D5).
              //    Pick → upsert (auto-memorize, D3).
              //    Clear (∅) → delete: aggressive clear so inheriting siblings
              //    lose the italic default. Sibling rows with their own per-tx
              //    override are untouched. User can re-pick on any row to
              //    re-establish the memorization.
              if (hasCounterparty) {
                if (next != null) {
                  await apiFetch('/api/qb/counterparty-map', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      entity: t.entity,
                      counterpartyAddress: t.counterparty,
                      glAccountNumber: next,
                    }),
                  })
                } else {
                  const params = new URLSearchParams({
                    entity: t.entity,
                    counterpartyAddress: t.counterparty!,
                  })
                  await apiFetch(`/api/qb/counterparty-map?${params}`, {
                    method: 'DELETE',
                  })
                }
              }
              // 3. Refresh page so other rows with the same counterparty pick up the new default
              fetchTransactions(offset)
            }}
          />
        )
      },
    }
    // Phase 4 — Vendor + Class inline-override columns.
    // value = per-tx override (null when unset); defaultValue = the counterparty
    // wallet's configured vendor/class shown in italics when value is null.
    // No counterparty-map side-effect — the wallet is the default source.
    const vendorCol = {
      key: 'vendor', label: 'Vendor', width: '180px', sortable: false,
      render: (t: Transaction) => (
        <EditableSelectCell
          value={t.vendorOverride ?? null}
          defaultValue={t.counterpartyVendorName ?? undefined}
          options={vendorOptions}
          placeholder="— vendor"
          alwaysSave
          onSave={async (next) => {
            if (!t.id) {
              console.error('cannot save: transaction has no id', t)
              return
            }
            if (t.qbPostingStatus === 'posted') {
              const ok = window.confirm(
                'This row is posted to QuickBooks. Changing the Vendor will '
                + 'mark the journal entry stale and require re-posting. Continue?',
              )
              if (!ok) throw new Error('Save cancelled')
            }
            // The server reads the master at save time and writes vendor,
            // class and GL together, even if this browser has no master cache.
            const saved = await apiFetch<{ vendorDefaults: { glAccount: string; className: string | null } | null; vendorMappingMissing: boolean }>(`/api/treasury/transactions/${t.id}/qb-state`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ vendorOverride: next }),
            })
            const master = saved.vendorDefaults
            // Memorize for the future (same auto-memorize pattern as the GL
            // cell) so sibling and FUTURE rows of this counterparty inherit
            // vendor, class and GL immediately — not only after posting.
            // PICKS only: clearing a per-tx override (next === null) means
            // "fall back to the default" — it must never DELETE the default.
            if (next != null && t.counterparty && t.counterpartyLabel) {
              // Registered counterparties only (label present = wallet row).
              await apiFetch(`/api/wallets/${t.counterparty}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  qbVendorName: next,
                  ...(master?.className ? { qbClassName: master.className } : {}),
                }),
              }).catch(() => {}) // memorization is best-effort
            }
            if (next != null && master?.glAccount && t.counterparty) {
              await apiFetch('/api/qb/counterparty-map', {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  entity: t.entity,
                  counterpartyAddress: t.counterparty,
                  glAccountNumber: master.glAccount,
                }),
              }).catch(() => {}) // memorization is best-effort
            }
            setRowError(saved.vendorMappingMissing
              ? `Vendor “${next}” was saved, but has no matching GL/Class in Vendors / Apps. Add its mapping there to fill those columns.`
              : null)
            await fetchTransactions(offset)
          }}
        />
      ),
    }
    const classCol = {
      key: 'class', label: 'Class', width: '160px', sortable: false,
      render: (t: Transaction) => (
        <EditableSelectCell
          value={t.classOverride ?? null}
          defaultValue={t.counterpartyClassName ?? undefined}
          options={classOptions}
          placeholder="— class"
          onSave={async (next) => {
            if (!t.id) {
              console.error('cannot save: transaction has no id', t)
              return
            }
            if (t.qbPostingStatus === 'posted') {
              const ok = window.confirm(
                'This row is posted to QuickBooks. Changing the Class will '
                + 'mark the journal entry stale and require re-posting. Continue?',
              )
              if (!ok) throw new Error('Save cancelled')
            }
            await apiFetch(`/api/treasury/transactions/${t.id}/qb-state`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ classOverride: next }),
            })
            // Same sibling-propagation as the Vendor cell: memorize the
            // class on the registered counterparty wallet — on affirmative
            // PICKS only, never when clearing back to the default.
            if (next != null && t.counterparty && t.counterpartyLabel) {
              await apiFetch(`/api/wallets/${t.counterparty}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ qbClassName: next }),
              }).catch(() => {}) // memorization is best-effort
            }
            fetchTransactions(offset)
          }}
        />
      ),
    }
    const txHashCol = {
      key: 'txHash', label: 'Tx', width: '100px', sortable: false,
      render: (t: Transaction) => {
        if (!t.txHash) return <span style={{ color: 'var(--muted)' }}>—</span>
        return (
          <a href={`https://solscan.io/tx/${t.txHash}`} target="_blank" rel="noreferrer"
            style={{ fontFamily: 'var(--mono)', fontSize: '0.63rem', color: 'var(--accent)', textDecoration: 'none' }}
            title={t.txHash}>
            {t.txHash.slice(0, 8)}…{t.txHash.slice(-4)}
          </a>
        )
      },
    }
    // Wave 2c — QB Status column. Renders the qb_post linkage and exposes
    // hover actions for Re-post / Void. Click on the DocNumber routes through
    // handleDocNumberClick to either open the bulk drill-down or deep-link
    // to QB.
    const qbStatusCol = {
      key: 'qbStatus', label: 'QB Status', width: '200px', sortable: false,
      render: (t: Transaction) => {
        const status = t.qbPostingStatus ?? null
        const docNumber = t.qbDocNumber ?? null
        const busy = t.id ? rowBusy[t.id] : undefined

        // Unposted / null → subtle em-dash so the column doesn't look broken.
        if (!status || status === 'unposted' || !docNumber) {
          return <span style={{ color: 'var(--muted)' }}>—</span>
        }

        const isBulk = isBulkPost(t)
        const docClickable = !!t.qbPostId && (isBulk || !!t.qbJournalEntryId)

        // Pick the visual treatment per status. Strikethrough lives on the
        // docNumber span (not the surrounding row) so the action buttons stay
        // legible.
        const styleForStatus = (() => {
          switch (status) {
            case 'posted':
              return { color: 'var(--green, #10b981)', icon: '✓', label: '' }
            case 'posted_modified':
              return { color: 'var(--warn, #d97706)', icon: '⚠', label: '(modified)' }
            case 'posted_manually':
              return { color: '#3b82f6', icon: '✓', label: '(manual)' }
            case 'voided':
              return { color: 'var(--muted)', icon: '⌀', label: '(voided)', strike: true }
            case 'failed':
              return { color: 'var(--red, #dc2626)', icon: '✗', label: '' }
            default:
              return { color: 'var(--muted)', icon: '·', label: '' }
          }
        })()

        const docEl = (
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: '0.7rem',
            fontWeight: 600,
            textDecoration: styleForStatus.strike ? 'line-through' : 'none',
          }}>
            {docNumber}
          </span>
        )

        return (
          <span
            className="qb-status-cell"
            title={status === 'posted_manually'
              ? 'Posted to QuickBooks manually (outside this tool) — identified by reconciliation.'
              : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              color: styleForStatus.color,
              fontSize: '0.7rem',
              position: 'relative',
            }}
          >
            <span aria-hidden="true">{styleForStatus.icon}</span>
            {docClickable ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleDocNumberClick(t) }}
                title={isBulk
                  ? 'View bulk JE members'
                  : `Open in QuickBooks — make sure QuickBooks is set to the ${t.entity} company first (deep links open in your active company, not the one in the link)`}
                style={{
                  background: 'none', border: 'none', padding: 0,
                  color: 'inherit', cursor: 'pointer',
                  textDecoration: styleForStatus.strike ? 'line-through' : 'underline',
                  textUnderlineOffset: 2,
                  font: 'inherit',
                }}
              >
                {docNumber}
              </button>
            ) : (
              docEl
            )}
            {styleForStatus.label && (
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>
                {styleForStatus.label}
              </span>
            )}
            {t.qbDuplicateWarning === true && (
              <span
                title="Possible duplicate detected in QuickBooks at post time — review and void the extra entry."
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 600,
                  color: 'var(--warn, #d97706)',
                  border: '1px solid var(--warn, #d97706)',
                  borderRadius: 3,
                  padding: '0 4px',
                  marginLeft: 2,
                  letterSpacing: '0.02em',
                }}
              >
                ⚠ dup
              </span>
            )}

            {/* Hover actions — Re-post / Void. Rendered for all rows with a post_id;
                CSS hover toggles visibility (.qb-status-cell:hover .qb-row-actions).
                Inline style fallback in case the CSS class isn't loaded yet. */}
            {canPost && t.id && t.qbPostId && (
              <span
                className="qb-row-actions"
                style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }}
              >
                {(status === 'posted' || status === 'posted_modified' || status === 'voided') && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRepostRow(t) }}
                    disabled={!!busy}
                    title="Re-post — voids the current QB entry and creates a new one"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      padding: '1px 6px',
                      fontSize: '0.62rem',
                      color: 'var(--text)',
                      cursor: busy ? 'wait' : 'pointer',
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy === 'repost' ? '…' : 'Re-post'}
                  </button>
                )}
                {(status === 'posted' || status === 'posted_modified') && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleVoidRow(t) }}
                    disabled={!!busy}
                    title="Void — marks the QB entry as voided ($0) without deleting"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      padding: '1px 6px',
                      fontSize: '0.62rem',
                      color: 'var(--text)',
                      cursor: busy ? 'wait' : 'pointer',
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy === 'void' ? '…' : 'Void'}
                  </button>
                )}
              </span>
            )}
          </span>
        )
      },
    }

    const descriptionCol = {
      key: 'description', label: 'Description', width: '240px', sortable: false,
      render: (t: Transaction) => (
        <EditableCell
          value={t.description ?? null}
          defaultValue={t.descriptionDefault}
          onSave={async (next) => {
            if (!t.id) {
              // Defensive — shouldn't happen because getTreasuryTransactions populates id.
              console.error('cannot save: transaction has no id', t)
              return
            }
            await apiFetch(`/api/treasury/transactions/${t.id}/qb-state`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ description: next }),
            })
            // Optimistic refresh — re-fetch the current page so the saved value shows immediately
            fetchTransactions(offset)
          }}
        />
      ),
    }

    // ST/LT columns are always shown for a stable mental model — non-ORCA rows
    // get "—" via renderGainCell. Avoids the "where did my columns go?" confusion
    // when pagination/filters happen to land on pages without any ORCA tx.
    const orcaCols = [
      {
        key: 'stGain', label: 'ST', numeric: true, width: '90px', sortable: false,
        render: (t: Transaction) => renderGainCell(t.stGain, t, monthStartMs, 'ST'),
      },
      {
        key: 'ltGain', label: 'LT', numeric: true, width: '90px', sortable: false,
        render: (t: Transaction) => renderGainCell(t.ltGain, t, monthStartMs, 'LT'),
      },
    ]

    return [
      selectCol,
      dateCol, walletCol, counterpartyCol,
      // QB-domain cluster — keep WalletGL/CounterpartyGL/QBStatus adjacent
      // so the user sees posting status in their natural reading zone without
      // scrolling past the wide ST/LT/Description columns.
      walletGlCol, counterpartyGlCol, vendorCol, classCol, qbStatusCol,
      dirCol, assetCol, qtyCol, priceCol, usdCol,
      ...orcaCols,
      descriptionCol,
      txHashCol,
    ]
  }, [
    yearFilter, monthStartMs, fetchTransactions, offset, glOptions, vendorOptions, classOptions,
    // Selection column re-renders when selection or visible-row state changes.
    selectedIds, allVisibleSelected, someVisibleSelected, visibleSelectableIds,
    toggleSelect, toggleSelectAllVisible,
    // QB status column reacts to per-row busy state, permission, and the
    // bulk-detection map.
    canPost, rowBusy, isBulkPost, handleRepostRow, handleVoidRow, handleDocNumberClick,
  ])

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Transactions</div>
        <div className="page-sub">All on-chain movements — debits and credits</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITIES.map(e => (
            <button key={e} className={`entity-tab${entity === e ? ' active' : ''}`} onClick={() => setEntity(e)}>
              {e}
            </button>
          ))}
        </div>
        <div className="entity-tabs" style={{ marginLeft: 'auto' }}>
          <button
            className="entity-tab"
            onClick={() => void syncTransactionsNow()}
            disabled={syncing}
            title="Fetch the latest on-chain transactions now (the automatic sync runs at 08:30 and 20:30 UTC)"
          >
            {syncing ? '↻ Syncing…' : '↻ Sync transactions'}
          </button>
          <button
            className={`entity-tab${view === 'transactions' ? ' active' : ''}`}
            onClick={() => setView('transactions')}
          >
            Transactions
          </button>
          <button
            className={`entity-tab${view === 'prepayments' ? ' active' : ''}`}
            onClick={() => setView('prepayments')}
            title="Prepaid-expense amortization map (register + schedule reconciled against QB)"
          >
            Prepayments
          </button>
        </div>
      </div>

      {syncNote ? (
        <div
          className="card"
          style={{
            padding: '8px 12px', marginBottom: 12, fontSize: '0.78rem',
            color: syncNote.startsWith('✗') ? '#d93025' : 'var(--muted)',
          }}
        >
          {syncNote}
        </div>
      ) : null}

      {view === 'prepayments' ? (
        <PrepaymentsPanel entity={entity} />
      ) : error ? (
        <div className="error-msg">{error}</div>
      ) : (
        <>
          {loading ? (
            <div className="cards-grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="card">
                  <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
                  <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
                  <Skeleton width={120} height={10} />
                </div>
              ))}
            </div>
          ) : (
          <div className="cards-grid">
            <div className="card">
              <div className="card-label">Inflows</div>
              <div className="card-value green">{fmtUSD(totalIn, 0)}</div>
              <div className="card-sub">matching filters</div>
            </div>
            <div className="card">
              <div className="card-label">Outflows</div>
              <div className="card-value red">{fmtUSD(totalOut, 0)}</div>
              <div className="card-sub">matching filters</div>
            </div>
            <div className="card">
              <div className="card-label">Net</div>
              <div className={`card-value ${totalNet >= 0 ? 'green' : 'red'}`}>
                {totalNet >= 0 ? '+' : ''}{fmtUSD(totalNet, 0)}
              </div>
              <div className="card-sub">matching filters</div>
            </div>
            <div className="card">
              <div className="card-label">Transactions</div>
              <div className="card-value">{total.toLocaleString()}</div>
              <div className="card-sub">matching filters</div>
            </div>
          </div>
          )}

          <div className="section">
            <div className="section-header">
              <span className="section-title">
                {total === 0
                  ? 'No transactions'
                  : `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()}`}
              </span>
              <div className="section-filters">
                {/* Bulk-post button — only rendered when the user has something
                    selected. Disabled (with helper text) when the selection
                    exceeds the server-side cap of 50. Also disabled if the user
                    lacks qb:post; we don't hide it in that case so admins on
                    the same page can see it's a real feature. */}
                {selectedIds.size > 0 && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {selectedIds.size > MAX_POST_BATCH ? (
                      <>
                        <button
                          className="fsel"
                          disabled
                          style={{ opacity: 0.5, cursor: 'not-allowed' }}
                        >
                          Post in batches of {MAX_POST_BATCH}
                        </button>
                        <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                          Selection exceeds {MAX_POST_BATCH} — deselect some rows to enable posting.
                        </span>
                      </>
                    ) : (
                      <button
                        className="fsel"
                        disabled={!canPost || !postEntity}
                        title={!canPost ? 'Your role does not have qb:post permission' : ''}
                        onClick={() => setPostModalOpen(true)}
                        style={{
                          background: canPost && postEntity ? 'var(--accent)' : undefined,
                          color: canPost && postEntity ? '#fff' : undefined,
                          borderColor: canPost && postEntity ? 'var(--accent)' : undefined,
                          cursor: canPost && postEntity ? 'pointer' : 'not-allowed',
                          opacity: canPost && postEntity ? 1 : 0.5,
                          fontWeight: 600,
                        }}
                      >
                        Post {selectedIds.size} selected to QB
                      </button>
                    )}
                    {/* Bulk vendor/class overrides — apply to all selected rows.
                        Choosing a value confirms on posted rows (they'll flip to
                        posted_modified), then PATCHes the bulk endpoint. */}
                    <select
                      className="fsel"
                      value=""
                      title={selectedIds.size > MAX_POST_BATCH ? `Selection exceeds ${MAX_POST_BATCH}` : 'Set vendor on selected rows'}
                      disabled={bulkBusy || selectedIds.size > MAX_POST_BATCH}
                      onChange={async (e) => {
                        const next = e.target.value || null
                        const txIds = Array.from(selectedIds)
                        const hasPosted = selectedPostedIds.size > 0 || transactions.some(
                          t => t.id && selectedIds.has(t.id) && t.qbPostingStatus === 'posted',
                        )
                        if (hasPosted) {
                          const ok = window.confirm(
                            'One or more selected rows are posted to QuickBooks. '
                            + 'Setting the Vendor will mark those journal entries stale and require re-posting. Continue?',
                          )
                          if (!ok) return
                        }
                        setBulkBusy(true)
                        try {
                          // The server applies this vendor's finance-master
                          // class/GL to each selected row in the same write.
                          const saved = await apiFetch<{ vendorMappingMissing: boolean }>('/api/treasury/transactions/bulk-qb-state', {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ txIds, vendorOverride: next }),
                          })
                          setRowError(saved.vendorMappingMissing
                            ? `Vendor “${next}” was saved, but has no matching GL/Class in Vendors / Apps.`
                            : null)
                          fetchTransactions(offset)
                        } catch (err) {
                          setRowError(`Bulk vendor update failed: ${err instanceof Error ? err.message : String(err)}`)
                        } finally {
                          setBulkBusy(false)
                        }
                      }}
                    >
                      <option value="">Set vendor…</option>
                      {vendorOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <select
                      className="fsel"
                      value=""
                      title={selectedIds.size > MAX_POST_BATCH ? `Selection exceeds ${MAX_POST_BATCH}` : 'Set class on selected rows'}
                      disabled={bulkBusy || selectedIds.size > MAX_POST_BATCH}
                      onChange={async (e) => {
                        const next = e.target.value || null
                        const txIds = Array.from(selectedIds)
                        const hasPosted = selectedPostedIds.size > 0 || transactions.some(
                          t => t.id && selectedIds.has(t.id) && t.qbPostingStatus === 'posted',
                        )
                        if (hasPosted) {
                          const ok = window.confirm(
                            'One or more selected rows are posted to QuickBooks. '
                            + 'Setting the Class will mark those journal entries stale and require re-posting. Continue?',
                          )
                          if (!ok) return
                        }
                        setBulkBusy(true)
                        try {
                          await apiFetch('/api/treasury/transactions/bulk-qb-state', {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ txIds, classOverride: next }),
                          })
                          setRowError(null)
                          fetchTransactions(offset)
                        } catch (err) {
                          setRowError(`Bulk class update failed: ${err instanceof Error ? err.message : String(err)}`)
                        } finally {
                          setBulkBusy(false)
                        }
                      }}
                    >
                      <option value="">Set class…</option>
                      {classOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button
                      className="fsel"
                      onClick={() => setEditModalOpen(true)}
                      disabled={bulkBusy || selectedIds.size > MAX_POST_BATCH}
                      style={{ fontWeight: 600, opacity: selectedIds.size > MAX_POST_BATCH ? 0.5 : 1 }}
                      title={selectedIds.size > MAX_POST_BATCH
                        ? `Selection exceeds ${MAX_POST_BATCH} — narrow the filter to bulk edit`
                        : 'Edit wallet GL / counterparty GL / vendor / class on the selected rows only (no defaults are memorized)'}
                    >
                      Edit {selectedIds.size} selected…
                    </button>
                    <button
                      className="fsel"
                      onClick={clearSelection}
                      style={{ fontSize: '0.7rem' }}
                      title="Clear selection"
                    >
                      Clear
                    </button>
                  </div>
                )}
                <select
                  className="fsel"
                  value={qbStatusFilter}
                  onChange={e => setQbStatusFilter(e.target.value as QbStatusFilter)}
                  title="Filter by QuickBooks posting status (current page)"
                >
                  <option value="">All QB statuses</option>
                  <option value="unposted">Unposted</option>
                  <option value="posted">Posted</option>
                  <option value="posted_manually">Posted (manual)</option>
                  <option value="posted_modified">Modified</option>
                  <option value="voided">Voided</option>
                  <option value="failed">Failed</option>
                </select>
                <select className="fsel" value={tokenFilter} onChange={e => setTokenFilter(e.target.value)}>
                  <option value="">All tokens</option>
                  <option value="SOL">SOL</option>
                  <option value="ORCA">ORCA</option>
                  <option value="USDC">USDC</option>
                  <option value="USDT">USDT</option>
                  <option value="USDG">USDG</option>
                  <option value="PYUSD">PYUSD</option>
                </select>
                <select className="fsel" value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
                  <option value="">In + Out</option>
                  <option value="In">In</option>
                  <option value="Out">Out</option>
                </select>
                <select
                  className="fsel"
                  value={yearFilter}
                  onChange={e => { setYearFilter(e.target.value); setMonthFilter('') }}
                >
                  <option value="">All years</option>
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select
                  className="fsel"
                  value={monthFilter}
                  onChange={e => setMonthFilter(e.target.value)}
                  disabled={!yearFilter}
                  title={yearFilter ? '' : 'Select a year first'}
                >
                  <option value="">{yearFilter ? 'All months' : 'Select year first'}</option>
                  {yearFilter && (monthsByYear[yearFilter] ?? []).map(m => (
                    <option key={m} value={`${yearFilter}-${m}`}>{MONTH_SHORT_NAMES[Number(m) - 1]}</option>
                  ))}
                </select>
                <select className="fsel" value={walletFilter} onChange={e => setWalletFilter(e.target.value)}>
                  <option value="">All wallets</option>
                  {walletOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input className="fsearch" placeholder="Tx hash / wallet / address (current page)…" value={search} onChange={e => setSearch(e.target.value)} />
                <button
                  className="fsel"
                  onClick={() => setExportModalOpen(true)}
                  style={{ fontWeight: 600 }}
                  title="Download posted transactions for a month (any entity or all)"
                >
                  Export
                </button>
              </div>
            </div>

            {/* Gmail-pattern cross-page selection. Offered once the visible
                page is fully selected and more matching rows exist beyond it
                (suppressed while the page-local search box narrows the view —
                search doesn't apply server-side). */}
            {allVisibleSelected && !search && total > visibleSelectableIds.length && selectedIds.size <= visibleSelectableIds.length ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '8px 12px', margin: '10px 0',
                background: 'rgba(39,117,202,0.08)', border: '1px solid rgba(39,117,202,0.3)',
                borderRadius: 6, fontSize: '0.75rem',
              }}>
                <span>All {visibleSelectableIds.length} transactions on this page are selected.</span>
                <button
                  className="fsel"
                  style={{ fontSize: '0.72rem', fontWeight: 600 }}
                  disabled={selectAllBusy}
                  onClick={() => void selectAllMatching()}
                >
                  {selectAllBusy ? 'Selecting…' : `Select all ${total.toLocaleString()} matching transactions`}
                </button>
              </div>
            ) : null}
            {selectedIds.size > visibleSelectableIds.length ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '8px 12px', margin: '10px 0',
                background: 'rgba(6,214,160,0.08)', border: '1px solid rgba(6,214,160,0.3)',
                borderRadius: 6, fontSize: '0.75rem',
              }}>
                <span style={{ fontWeight: 600 }}>
                  {selectedIds.size.toLocaleString()} transactions selected across all pages.
                </span>
                <button className="fsel" style={{ fontSize: '0.72rem' }} onClick={clearSelection}>
                  Clear selection
                </button>
              </div>
            ) : null}

            <DataTable
              data={filtered as unknown as Record<string, unknown>[]}
              columns={columns as any}
              defaultSort={{ col: 'date', dir: 'desc' }}
              maxHeight="650px"
              rowClassName={(row) => {
                const t = row as unknown as Transaction
                const classes: string[] = []
                if (t.internal) classes.push('tx-row-internal')
                // Wave 2c — subtle row tint per posting status so the user can
                // glance the table and spot posted/modified/voided/failed rows
                // without having to scan the QB Status column.
                switch (t.qbPostingStatus) {
                  case 'posted':          classes.push('tx-row-posted'); break
                  case 'posted_manually': classes.push('tx-row-posted-manually'); break
                  case 'posted_modified': classes.push('tx-row-modified'); break
                  case 'voided':          classes.push('tx-row-voided'); break
                  case 'failed':          classes.push('tx-row-failed'); break
                }
                return classes.length ? classes.join(' ') : undefined
              }}
            />

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderTop: '1px solid var(--border)', gap: 10,
            }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--muted)' }}>
                Page {page} of {pageCount}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="fsel"
                  disabled={!hasPrev || loading}
                  onClick={() => goToOffset(Math.max(0, offset - pageSize))}
                  style={{ cursor: hasPrev && !loading ? 'pointer' : 'not-allowed', opacity: hasPrev && !loading ? 1 : 0.5 }}
                >
                  ‹ Prev
                </button>
                <button
                  className="fsel"
                  disabled={!hasNext || loading}
                  onClick={() => goToOffset(offset + pageSize)}
                  style={{ cursor: hasNext && !loading ? 'pointer' : 'not-allowed', opacity: hasNext && !loading ? 1 : 0.5 }}
                >
                  Next ›
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Post-to-QB modal. Mounted lazily — only when a valid entity is selected
          and the modal is open. Snapshot the selected ids at mount time so a
          rapid click on the table doesn't change the request payload mid-flight. */}
      {postEntity && postModalOpen && (
        <PostToQbModal
          entity={postEntity}
          selectedTxIds={selectedIdsArray}
          open={postModalOpen}
          onClose={() => {
            setPostModalOpen(false)
            clearSelection()
          }}
          onSuccess={() => {
            // Refresh the table so newly-posted rows show their badges
            // (T12 surfaces the qbPostingStatus column). Selection is left
            // intact until the user clicks Close — they may want to read the
            // success/failure summary first. We must NOT clear it here: the
            // modal is still open and bound to selectedTxIds, so clearing would
            // empty its props and re-fire the preview fetch with [] → a
            // spurious "txIds required" 400. Cleared in onClose instead.
            fetchTransactions(offset)
          }}
        />
      )}

      {/* Per-row Re-post/Void error banner. Floats above the table at the
          bottom-right so it doesn't fight the page header for attention. */}
      {rowError && (
        <div
          role="alert"
          style={{
            position: 'fixed', bottom: 16, right: 16, zIndex: 200,
            padding: '10px 12px',
            background: 'color-mix(in srgb, var(--red, #dc2626) 12%, var(--surface))',
            border: '1px solid var(--red, #dc2626)',
            borderRadius: 6,
            color: 'var(--text)',
            fontSize: '0.74rem',
            maxWidth: 360,
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}
        >
          <span style={{ color: 'var(--red, #dc2626)', fontWeight: 600 }}>✗</span>
          <span style={{ flex: 1, minWidth: 0 }}>{rowError}</span>
          <button
            type="button"
            onClick={() => setRowError(null)}
            aria-label="Dismiss"
            style={{
              background: 'transparent', border: 'none', color: 'var(--muted)',
              cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1,
            }}
          >×</button>
        </div>
      )}

      {/* Bulk-JE drill-down side-panel. Members are filtered from the current
          page's already-loaded rows — no extra API call (Wave 2c scope). */}
      {drilldown && postEntity && (
        <QbBulkDrilldownPanel
          open={!!drilldown}
          entity={postEntity}
          postId={drilldown.postId}
          docNumber={drilldown.docNumber}
          qbJournalEntryId={drilldown.qbJournalEntryId}
          postingStatus={drilldown.postingStatus}
          members={drilldownMembers}
          // Heuristic: if the page is full AND the loaded member count equals
          // the page size, there's a good chance there are more members on
          // other pages. Conservative — false negatives are fine (we just
          // don't show the note), false positives are also fine (the note
          // says "members on this page" which is always true).
          membersPossiblyTruncated={
            transactions.length >= pageSize && drilldownMembers.length === transactions.length
          }
          canPost={canPost}
          onClose={() => setDrilldown(null)}
          onMutated={() => {
            fetchTransactions(offset)
          }}
        />
      )}

      {/* Bulk Edit modal — per-tx overrides on the selected rows only. */}
      {editModalOpen ? (
        <div className="modal-overlay open" onClick={() => { if (!editBusy) setEditModalOpen(false) }}>
          <div className="modal" style={{ width: 520, maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-title">Edit {selectedIds.size} selected transaction{selectedIds.size === 1 ? '' : 's'}</span>
                <div className="modal-sub" style={{ marginTop: 4 }}>
                  Applies only to selected rows. Picking a mapped Vendor also
                  fills its Class and Counterparty GL on those rows.
                </div>
              </div>
              <button className="modal-close" onClick={() => { if (!editBusy) setEditModalOpen(false) }} aria-label="Close">×</button>
            </div>
            <div className="modal-body" style={{ padding: 20, display: 'grid', gap: 12 }}>
              {([
                { key: 'glAccountOverride' as const, label: 'Wallet GL', options: glOptions },
                { key: 'counterpartyGlOverride' as const, label: 'Counterparty GL', options: glOptions },
                { key: 'vendorOverride' as const, label: 'Vendor', options: vendorOptions },
                { key: 'classOverride' as const, label: 'Class', options: classOptions },
              ]).map((f) => (
                <label key={f.key} style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{f.label}</span>
                  <select
                    className="fsel"
                    value={editDraft[f.key]}
                    disabled={editBusy}
                    onChange={(e) => setEditDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                  >
                    <option value={EDIT_UNCHANGED}>— leave unchanged —</option>
                    <option value="">∅ Clear override (back to default)</option>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              ))}
              <div style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                Other fields left as “unchanged” are not touched. Posted rows
                will be marked stale and need re-posting.
              </div>
            </div>
            <div className="modal-footer">
              <button className="fsel" onClick={() => setEditModalOpen(false)} disabled={editBusy}>Cancel</button>
              <button
                className="fsel"
                onClick={() => void applyBulkEdit()}
                disabled={editBusy || (Object.values(editDraft) as string[]).every((v) => v === EDIT_UNCHANGED)}
                style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', fontWeight: 600 }}
              >
                {editBusy ? 'Applying…' : 'OK — apply to selected'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <TransactionsExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        defaultEntity={entity}
        // Pre-fill the modal with whatever year/month is currently filtered.
        // Fallback to current UTC year/month when no filter is set.
        defaultYear={yearFilter ? parseInt(yearFilter, 10) : new Date().getUTCFullYear()}
        defaultMonth={
          monthFilter && /^\d{4}-\d{2}$/.test(monthFilter)
            ? parseInt(monthFilter.slice(5, 7), 10)
            : new Date().getUTCMonth() + 1
        }
      />
    </div>
  )
}
