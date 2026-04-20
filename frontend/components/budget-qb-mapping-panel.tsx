'use client'

import { useEffect, useMemo, useState } from 'react'

import { BUDGET_LINE_CATALOG, BUDGET_LINE_ENTRY_BY_KEY } from '@/lib/budget/catalog'
import { findBudgetQbMappingDuplicates, sortBudgetQbMappingRows } from '@/lib/budget/qb-mapping'
import type { BudgetQbMappingRow, BudgetQbMappingState } from '@/lib/budget/types'

type BudgetQbMappingPanelProps = {
  mapping: BudgetQbMappingState | null
  loading: boolean
  saving: boolean
  error: string | null
  suggestedAccount: string | null
  onSuggestedAccountHandled: () => void
  onSave: (rows: BudgetQbMappingRow[]) => Promise<void> | void
}

function parseAccountNumber(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function buildEmptyRow(key: string): BudgetQbMappingRow {
  const catalogEntry = BUDGET_LINE_ENTRY_BY_KEY[key]
  return {
    key,
    line: catalogEntry?.label ?? key,
    cat: catalogEntry?.category ?? 'Other',
    accounts: [],
  }
}

export function BudgetQbMappingPanel({
  mapping,
  loading,
  saving,
  error,
  suggestedAccount,
  onSuggestedAccountHandled,
  onSave,
}: BudgetQbMappingPanelProps) {
  const [draftRows, setDraftRows] = useState<BudgetQbMappingRow[]>([])
  const [search, setSearch] = useState('')
  const [activeInlineRow, setActiveInlineRow] = useState<string | null>(null)
  const [inlineAccountDraft, setInlineAccountDraft] = useState<Record<string, string>>({})
  const [newLineKey, setNewLineKey] = useState<string>(BUDGET_LINE_CATALOG[0]?.key ?? '')
  const [newLineAccounts, setNewLineAccounts] = useState('')
  const [pendingSuggestedAccount, setPendingSuggestedAccount] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setDraftRows(mapping?.rows ?? [])
    setLocalError(null)
  }, [mapping])

  const missingCatalogLines = useMemo(() => {
    const existingKeys = new Set(draftRows.map((row) => row.key))
    return BUDGET_LINE_CATALOG.filter((entry) => !existingKeys.has(entry.key))
  }, [draftRows])

  useEffect(() => {
    if (missingCatalogLines.length > 0) {
      setNewLineKey((current) => (
        missingCatalogLines.some((entry) => entry.key === current)
          ? current
          : missingCatalogLines[0]!.key
      ))
    }
  }, [missingCatalogLines])

  useEffect(() => {
    if (!suggestedAccount) return
    setPendingSuggestedAccount(suggestedAccount)
    setNewLineAccounts(suggestedAccount)
    setLocalError(null)
    onSuggestedAccountHandled()
  }, [onSuggestedAccountHandled, suggestedAccount])

  const duplicates = useMemo(() => findBudgetQbMappingDuplicates(draftRows), [draftRows])
  const hasChanges = useMemo(() => {
    const original = JSON.stringify(mapping?.rows ?? [])
    const current = JSON.stringify(draftRows)
    return original !== current
  }, [draftRows, mapping?.rows])

  const visibleRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    if (!normalizedSearch) return draftRows

    return draftRows.filter((row) => {
      const haystacks = [
        row.cat,
        row.line,
        row.key,
        ...row.accounts.map((account) => String(account)),
      ]
      return haystacks.some((value) => value.toLowerCase().includes(normalizedSearch))
    })
  }, [draftRows, search])

  function updateRow(rowKey: string, updater: (row: BudgetQbMappingRow) => BudgetQbMappingRow | null) {
    setDraftRows((current) => sortBudgetQbMappingRows(current.flatMap((row) => {
      if (row.key !== rowKey) return [row]
      const nextRow = updater(row)
      return nextRow ? [nextRow] : []
    })))
  }

  function addAccountToRow(rowKey: string) {
    const nextAccount = parseAccountNumber(inlineAccountDraft[rowKey] ?? '')
    if (!nextAccount) {
      setLocalError('Enter a valid QuickBooks account number before adding it.')
      return
    }

    updateRow(rowKey, (row) => ({
      ...row,
      accounts: Array.from(new Set([...row.accounts, nextAccount])).sort((left, right) => left - right),
    }))
    setInlineAccountDraft((current) => ({ ...current, [rowKey]: '' }))
    setActiveInlineRow(null)
    if (pendingSuggestedAccount === String(nextAccount)) {
      setPendingSuggestedAccount(null)
    }
    setLocalError(null)
  }

  function addLine() {
    if (!newLineKey) return
    const accountNumbers = Array.from(new Set(
      newLineAccounts
        .split(',')
        .map((value) => parseAccountNumber(value))
        .filter((value): value is number => value !== null),
    )).sort((left, right) => left - right)

    if (accountNumbers.length === 0) {
      setLocalError('Add at least one account number when creating a new mapping row.')
      return
    }

    setDraftRows((current) => {
      const existing = current.find((row) => row.key === newLineKey)
      if (existing) {
        return sortBudgetQbMappingRows(current.map((row) => row.key === newLineKey
          ? { ...row, accounts: Array.from(new Set([...row.accounts, ...accountNumbers])).sort((left, right) => left - right) }
          : row))
      }

      return sortBudgetQbMappingRows([...current, { ...buildEmptyRow(newLineKey), accounts: accountNumbers }])
    })
    if (pendingSuggestedAccount && accountNumbers.includes(Number.parseInt(pendingSuggestedAccount, 10))) {
      setPendingSuggestedAccount(null)
    }
    setNewLineAccounts('')
    setLocalError(null)
  }

  async function saveMapping() {
    setLocalError(null)
    try {
      await onSave(draftRows)
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : 'Failed to save QB mapping.')
    }
  }

  if (loading) {
    return (
      <div className="status-bar">
        <span className="status-dot loading" />
        <span className="status-text">Loading QB mapping…</span>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="section-header budget-section-header">
        <div>
          <span className="section-title">QB Mapping</span>
          <div className="budget-section-note" style={{ marginTop: 4 }}>
            Assign QuickBooks account numbers to canonical budget lines. Duplicate accounts are blocked on save.
          </div>
        </div>
        <div className="budget-mapping-actions">
          <span className="budget-section-note">
            {mapping?.source === 'data-branch' ? 'Saved to data branch' : 'Using default mapping'}
            {mapping?.lastUpdatedAt ? ` · ${new Date(mapping.lastUpdatedAt).toLocaleString()}` : ''}
          </span>
          <button className="btn-primary" type="button" onClick={() => void saveMapping()} disabled={!hasChanges || saving || duplicates.length > 0}>
            {saving ? 'Saving…' : hasChanges ? 'Save Mapping' : 'Saved'}
          </button>
        </div>
      </div>

      {duplicates.length > 0 ? (
        <div className="status-bar budget-plan-status">
          <span className="status-dot warn" />
          <span className="status-text">
            Duplicate accounts found: {duplicates.map((duplicate) => `${duplicate.accountNumber} (${duplicate.lineLabels.join(' / ')})`).join(' · ')}
          </span>
        </div>
      ) : null}

      {pendingSuggestedAccount ? (
        <div className="status-bar budget-plan-status">
          <span className="status-dot ok" />
          <span className="status-text">
            Coverage suggested account {pendingSuggestedAccount}. Add it to an existing line or use it when creating a new mapping row.
          </span>
        </div>
      ) : null}

      {error || localError ? (
        <div className="status-bar budget-plan-status">
          <span className="status-dot warn" />
          <span className="status-text">{error || localError}</span>
        </div>
      ) : null}

      <div className="budget-mapping-toolbar">
        <input
          className="tt-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by line, category, or account…"
        />
        <select className="tt-fsel" value={newLineKey} onChange={(event) => setNewLineKey(event.target.value)} disabled={missingCatalogLines.length === 0}>
          {missingCatalogLines.length > 0 ? (
            missingCatalogLines.map((entry) => (
              <option key={entry.key} value={entry.key}>{entry.label}</option>
            ))
          ) : (
            <option value="">All catalog lines already exist</option>
          )}
        </select>
        <input
          className="tt-search"
          value={newLineAccounts}
          onChange={(event) => setNewLineAccounts(event.target.value)}
          placeholder="Account numbers, comma separated"
        />
        <button className="btn-secondary" type="button" onClick={addLine} disabled={missingCatalogLines.length === 0}>
          Add Budget Line
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Budget Line</th>
              <th>Accounts</th>
              <th className="num">Count</th>
              <th className="num">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? visibleRows.map((row) => (
              <tr key={row.key}>
                <td className="label">{row.cat}</td>
                <td className="label">
                  <div>{row.line}</div>
                  <div className="budget-line-category">{row.key}</div>
                </td>
                <td>
                  <div className="budget-chip-list">
                    {row.accounts.map((account) => (
                      <span key={`${row.key}-${account}`} className="budget-chip">
                        {account}
                        <button
                          className="budget-chip-remove"
                          type="button"
                          onClick={() => updateRow(row.key, (current) => ({
                            ...current,
                            accounts: current.accounts.filter((value) => value !== account),
                          }))}
                          aria-label={`Remove account ${account}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {activeInlineRow === row.key ? (
                      <span className="budget-inline-account-editor">
                        <input
                          className="tt-search budget-inline-account-input"
                          value={inlineAccountDraft[row.key] ?? ''}
                          onChange={(event) => setInlineAccountDraft((current) => ({ ...current, [row.key]: event.target.value }))}
                          placeholder="60110"
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') addAccountToRow(row.key)
                            if (event.key === 'Escape') setActiveInlineRow(null)
                          }}
                        />
                        <button className="btn-secondary" type="button" onClick={() => addAccountToRow(row.key)}>Add</button>
                      </span>
                    ) : (
                      <button
                        className="btn-secondary"
                        type="button"
                        onClick={() => {
                          setActiveInlineRow(row.key)
                          if (pendingSuggestedAccount && !(inlineAccountDraft[row.key] ?? '').trim()) {
                            setInlineAccountDraft((current) => ({ ...current, [row.key]: pendingSuggestedAccount }))
                          }
                        }}
                      >
                        + Add Account
                      </button>
                    )}
                  </div>
                </td>
                <td className="num">{row.accounts.length}</td>
                <td className="num">
                  <button className="btn-secondary danger" type="button" onClick={() => updateRow(row.key, () => null)}>
                    Remove Line
                  </button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5}>
                  <div className="empty budget-empty-inline">
                    <div className="empty-icon">∅</div>
                    <div>No mapping rows match the current filter.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
