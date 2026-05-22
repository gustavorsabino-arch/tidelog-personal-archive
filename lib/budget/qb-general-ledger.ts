type QboGeneralLedgerColumn = {
  value?: string
  id?: string
}

type QboGeneralLedgerColumnMeta = {
  ColTitle?: string
  ColType?: string
  MetaData?: Array<{ Name?: string; Value?: string }>
}

type QboGeneralLedgerRowLike = {
  type?: string
  ColData?: QboGeneralLedgerColumn[]
  Rows?: { Row?: QboGeneralLedgerRowLike[] }
}

type QboGeneralLedgerReportLike = {
  Columns?: { Column?: QboGeneralLedgerColumnMeta[] }
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

// QB returns a `Columns` metadata array describing each column by a stable
// ColKey (e.g. "tx_date", "klass_name", "subt_nat_home_amount"). We use that
// to locate fields by name rather than by position — different realm
// configurations return different column sets in different orders, but the
// ColKey-based lookup is stable across them all.
type ColumnIndex = Map<string, number>

// Column-key aliases — different realm configurations use different keys for
// the same logical field. We probe each in order. Amount/balance have several
// variants:
//   subt_nat_home_amount = native home-currency (default for most realms)
//   subt_nat_amount      = native transaction-currency (multi-currency)
//   subt_amount          = legacy / non-localized amount
const KEY_DATE = ['tx_date'] as const
const KEY_TYPE = ['txn_type'] as const
const KEY_DOC_NUM = ['doc_num'] as const
const KEY_NAME = ['name'] as const
const KEY_CLASS = ['klass_name'] as const
const KEY_MEMO = ['memo'] as const
const KEY_SPLIT = ['split_acc'] as const
const KEY_AMOUNT = ['subt_nat_home_amount', 'subt_nat_amount', 'subt_amount'] as const
const KEY_BALANCE = ['rbal_nat_home_amount', 'rbal_nat_amount', 'rbal_amount'] as const

function colKeyOf(col: QboGeneralLedgerColumnMeta): string | null {
  const meta = col.MetaData?.find((entry) => entry.Name === 'ColKey')
  return meta?.Value ?? null
}

function buildColumnIndex(report: QboGeneralLedgerReportLike): ColumnIndex {
  const map: ColumnIndex = new Map()
  const cols = report.Columns?.Column ?? []
  cols.forEach((col, index) => {
    const key = colKeyOf(col)
    if (key) map.set(key, index)
  })
  return map
}

function findByKey(map: ColumnIndex, keys: readonly string[]): number | null {
  for (const key of keys) {
    const idx = map.get(key)
    if (idx !== undefined) return idx
  }
  return null
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function normalizeLedgerDate(value: string | undefined): string | null {
  if (!value) return null
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

function colAt(
  columns: readonly QboGeneralLedgerColumn[],
  idx: number | null,
): QboGeneralLedgerColumn | undefined {
  return idx === null ? undefined : columns[idx]
}

function parseQboGeneralLedgerDataRow(
  columns: readonly QboGeneralLedgerColumn[],
  colIndex: ColumnIndex,
): ParsedQboGeneralLedgerRow | null {
  const dateCol = colAt(columns, findByKey(colIndex, KEY_DATE))
  const date = normalizeLedgerDate(dateCol?.value)
  if (!date) return null

  const typeCol = colAt(columns, findByKey(colIndex, KEY_TYPE))

  return {
    columnCount: columns.length,
    date,
    txnId: typeCol?.id?.trim() ?? null,
    transactionType: normalizeText(typeCol?.value),
    documentNumber: normalizeText(colAt(columns, findByKey(colIndex, KEY_DOC_NUM))?.value),
    name: normalizeText(colAt(columns, findByKey(colIndex, KEY_NAME))?.value),
    className: normalizeText(colAt(columns, findByKey(colIndex, KEY_CLASS))?.value),
    memo: normalizeText(colAt(columns, findByKey(colIndex, KEY_MEMO))?.value),
    splitName: normalizeText(colAt(columns, findByKey(colIndex, KEY_SPLIT))?.value),
    amountUsd: parseMoneyValue(colAt(columns, findByKey(colIndex, KEY_AMOUNT))?.value),
    runningBalanceUsd: parseMoneyValue(colAt(columns, findByKey(colIndex, KEY_BALANCE))?.value),
  }
}

export function parseQboGeneralLedgerRows(
  report: QboGeneralLedgerReportLike,
): ParsedQboGeneralLedgerRow[] {
  const colIndex = buildColumnIndex(report)
  const parsed: ParsedQboGeneralLedgerRow[] = []

  function walk(rows: readonly QboGeneralLedgerRowLike[] | undefined) {
    if (!rows) return
    for (const row of rows) {
      if (row.type === 'Data' && row.ColData) {
        const r = parseQboGeneralLedgerDataRow(row.ColData, colIndex)
        if (r) parsed.push(r)
      }
      if (row.Rows?.Row) walk(row.Rows.Row)
    }
  }

  walk(report.Rows?.Row)
  return parsed
}
