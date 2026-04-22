type QboGeneralLedgerColumn = {
  value?: string
  id?: string
}

type QboGeneralLedgerRowLike = {
  type?: string
  ColData?: QboGeneralLedgerColumn[]
  Rows?: { Row?: QboGeneralLedgerRowLike[] }
}

type QboGeneralLedgerReportLike = {
  Rows?: { Row?: QboGeneralLedgerRowLike[] }
}

export type ParsedQboGeneralLedgerRow = {
  columnCount: number
  date: string
  txnId: string | null
  transactionType: string | null
  documentNumber: string | null
  name: string | null
  className: string | null
  memo: string | null
  splitName: string | null
  amountUsd: number | null
  runningBalanceUsd: number | null
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function normalizeLedgerDate(value: string): string | null {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const usMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!usMatch) return null

  const [, month, day, year] = usMatch
  return `${year}-${month}-${day}`
}

function parseMoneyValue(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || /^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return null
  if (/[A-Za-z]/.test(trimmed)) return null

  const wrappedNegative = trimmed.startsWith('(') && trimmed.endsWith(')')
  const normalized = trimmed
    .replace(/[,$]/g, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, '')

  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed)) return null
  return wrappedNegative ? -parsed : parsed
}

function pickAmountColumns(columns: readonly QboGeneralLedgerColumn[]) {
  const numericCandidates = columns
    .map((column, index) => ({
      index,
      amount: parseMoneyValue(column.value),
    }))
    .filter((candidate) => candidate.amount !== null && candidate.index >= 4)

  if (numericCandidates.length === 0) {
    return { amountIndex: null, amountUsd: null, runningBalanceUsd: null }
  }

  if (numericCandidates.length === 1) {
    return {
      amountIndex: numericCandidates[0].index,
      amountUsd: numericCandidates[0].amount,
      runningBalanceUsd: null,
    }
  }

  const amountCandidate = numericCandidates[numericCandidates.length - 2]
  const runningBalanceCandidate = numericCandidates[numericCandidates.length - 1]

  return {
    amountIndex: amountCandidate.index,
    amountUsd: amountCandidate.amount,
    runningBalanceUsd: runningBalanceCandidate.amount,
  }
}

function parseQboGeneralLedgerDataRow(
  columns: readonly QboGeneralLedgerColumn[],
): ParsedQboGeneralLedgerRow | null {
  const rawDate = columns[0]?.value?.trim() ?? ''
  const date = normalizeLedgerDate(rawDate)
  if (!date) return null

  const { amountIndex, amountUsd, runningBalanceUsd } = pickAmountColumns(columns)
  const columnCount = columns.length
  const name = normalizeText(columns[3]?.value)
  const className = parseMoneyValue(columns[4]?.value) === null ? normalizeText(columns[4]?.value) : null

  let splitName: string | null = null
  if (columnCount >= 9 && amountIndex !== null) {
    const candidate = normalizeText(columns[amountIndex - 1]?.value)
    if (candidate && parseMoneyValue(candidate) === null) {
      splitName = candidate
    }
  }

  const memoCandidates: string[] = []
  const memoStartIndex = className ? 5 : 4
  const memoEndIndex = amountIndex ?? columnCount
  for (let index = memoStartIndex; index < memoEndIndex; index += 1) {
    if (columnCount >= 9 && splitName && index === amountIndex! - 1) continue

    const value = normalizeText(columns[index]?.value)
    if (!value) continue
    if (parseMoneyValue(value) !== null) continue
    memoCandidates.push(value)
  }

  return {
    columnCount,
    date,
    txnId: columns[1]?.id?.trim?.() ?? null,
    transactionType: normalizeText(columns[1]?.value),
    documentNumber: normalizeText(columns[2]?.value),
    name,
    className,
    memo: memoCandidates[0] ?? null,
    splitName,
    amountUsd,
    runningBalanceUsd,
  }
}

export function parseQboGeneralLedgerRows(
  report: QboGeneralLedgerReportLike,
): ParsedQboGeneralLedgerRow[] {
  const parsedRows: ParsedQboGeneralLedgerRow[] = []

  function walk(rows: readonly QboGeneralLedgerRowLike[] | undefined) {
    if (!rows) return

    for (const row of rows) {
      if (row.type === 'Data' && row.ColData) {
        const parsed = parseQboGeneralLedgerDataRow(row.ColData)
        if (parsed) parsedRows.push(parsed)
      }

      if (row.Rows?.Row) {
        walk(row.Rows.Row)
      }
    }
  }

  walk(report.Rows?.Row)
  return parsedRows
}
