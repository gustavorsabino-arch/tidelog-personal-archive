// Client-side fuzzy search across the budget page's visible data model.
// Runs entirely on the browser: no lib dependency, no server round-trip. The
// caller passes only the already-access-filtered slices (allowed departments,
// team members that reached the client, on-screen report rows), so building
// the index cannot leak data the user isn't authorized to see.
//
// Match algorithm — score 0 (best) .. 1 (worst):
//   - exact (normalized equality)      → 0
//   - startsWith normalized substring   → 0.1
//   - includes  normalized substring    → 0.2
//   - normalized Levenshtein distance   → dist / max(len)   (only if <= 0.6)
// Anything above 0.6 is dropped. Hits are sorted by (score asc, label asc).

import type {
  BudgetActualDrillAccountSummary,
  BudgetActualDrillTransaction,
  BudgetDepartment,
  BudgetMonthKey,
  BudgetTeamMember,
} from './types.ts'
import { BUDGET_LINE_CATALOG } from './catalog.ts'

export type BudgetSearchHitKind =
  | 'line-item'
  | 'category'
  | 'department'
  | 'team-member'
  | 'transaction'

export type BudgetSearchHit = {
  kind: BudgetSearchHitKind
  label: string          // headline text ('Salaries & Wages', 'Gustavo Sabino')
  subtitle: string       // context ('Compensation & Benefits · Legal', 'Engineering · Contractor')
  score: number          // 0 = exact, higher = fuzzier
  isFuzzy: boolean       // true if match was not exact/substring
  // Where to send the user when they click. Consumer applies whichever fields
  // are set; missing fields mean "leave current selection".
  navigate: {
    department?: BudgetDepartment | 'All'
    month?: BudgetMonthKey
    tab?: 'overview' | 'coverage' | 'team' | 'headcount' | 'mapping'
    lineKey?: string
  }
}

export type BudgetSearchIndexInput = {
  allowedDepartments: readonly BudgetDepartment[]
  // Team members — pass [] for non-admins (they don't see this data anyway).
  teamMembers: readonly BudgetTeamMember[]
  // 'All' available in the dept dropdown for admins.
  canUseAllDepartments: boolean
  // Optional — transactions from the current-view drilldown so the search
  // covers vendor names, memos, and invoice numbers in addition to the
  // static line item / department catalog. Server already applies access
  // filtering when the drill endpoint is called, so anything present here
  // is safe to surface.
  transactions?: readonly BudgetActualDrillTransaction[]
  // Optional — the drill accounts that came alongside `transactions`, so we
  // can map each tx's accountNumber → mappingKeys[0] (the line item that
  // "owns" the account). The click handler uses that lineKey to open the
  // drill modal on the containing line item directly.
  accounts?: readonly BudgetActualDrillAccountSummary[]
}

type IndexEntry = {
  kind: BudgetSearchHitKind
  label: string
  subtitle: string
  // Extra strings to match against beyond `label` (e.g., role, email).
  aliases: string[]
  navigate: BudgetSearchHit['navigate']
}

export type BudgetSearchIndex = { entries: IndexEntry[] }

// -------- INDEX BUILD --------

export function buildBudgetSearchIndex(input: BudgetSearchIndexInput): BudgetSearchIndex {
  const entries: IndexEntry[] = []

  // Departments — inc. 'All' pseudo-option for admins.
  if (input.canUseAllDepartments) {
    entries.push({
      kind: 'department',
      label: 'All Departments',
      subtitle: 'Overview across every department',
      aliases: ['all', 'overview', 'all depts', 'total'],
      navigate: { department: 'All', tab: 'overview' },
    })
  }
  for (const dept of input.allowedDepartments) {
    entries.push({
      kind: 'department',
      label: dept,
      subtitle: `Department · Budget & Actual`,
      aliases: [`${dept} department`, `${dept} dept`],
      navigate: { department: dept, tab: 'overview' },
    })
  }

  // Categories (unique) from the line-item catalog.
  const categories = new Set<string>()
  for (const item of BUDGET_LINE_CATALOG) categories.add(item.category)
  for (const category of categories) {
    entries.push({
      kind: 'category',
      label: category,
      subtitle: 'Budget category',
      aliases: [],
      navigate: { tab: 'overview' },
    })
  }

  // Line items × allowed departments — a hit routes to (department, line).
  for (const dept of input.allowedDepartments) {
    for (const item of BUDGET_LINE_CATALOG) {
      entries.push({
        kind: 'line-item',
        label: item.label,
        subtitle: `${item.category} · ${dept}`,
        aliases: [item.key, `${item.label} ${dept}`, `${dept} ${item.label}`],
        navigate: { department: dept, tab: 'overview', lineKey: item.key },
      })
    }
  }

  // Transactions from the current-view drilldown — indexes vendor names,
  // memos, transaction types, GL accounts, and document numbers. Each hit
  // shows amount + date in the subtitle so operators know at a glance where
  // the entry lives. If the accounts array is supplied we can attach a
  // lineKey (via account.mappingKeys[0]) so clicks open the drill modal on
  // the containing line item directly, both for admin and dept-scoped viewers.
  const accountLineKey = new Map<string, string>()
  for (const a of input.accounts ?? []) {
    const lk = a.mappingKeys?.[0]
    if (lk) accountLineKey.set(a.accountNumber, lk)
  }
  for (const tx of input.transactions ?? []) {
    const amount = fmtSignedUsd(tx.amountUsd)
    const dept = tx.normalizedDepartment ?? ''
    const dateLabel = tx.date ? formatShortDate(tx.date) : ''
    const account = tx.accountName ?? tx.accountNumber
    const label = tx.name?.trim() || tx.memo?.trim() || tx.transactionType?.trim() || account || 'Transaction'
    const subtitleBits = [
      amount,
      dateLabel,
      account,
      dept,
      tx.transactionType,
    ].filter((s): s is string => !!s && s.length > 0)
    const lineKey = accountLineKey.get(tx.accountNumber)
    entries.push({
      kind: 'transaction',
      label,
      subtitle: subtitleBits.join(' · '),
      aliases: [
        tx.memo,
        tx.transactionType,
        tx.accountName,
        tx.documentNumber,
        tx.className,
      ].filter((s): s is string => !!s && s.length > 0),
      navigate: {
        ...(dept ? { department: dept as BudgetDepartment } : {}),
        tab: 'overview',
        ...(lineKey ? { lineKey } : {}),
      },
    })
  }

  // Team members — safe by construction: empty for non-admin (server strips).
  for (const member of input.teamMembers) {
    entries.push({
      kind: 'team-member',
      label: member.name,
      subtitle: `${member.dept} · ${member.role}${member.entity ? ` · ${member.entity}` : ''}`,
      aliases: [
        member.role,
        member.email,
        member.location,
        member.classification,
      ].filter(Boolean) as string[],
      navigate: { department: member.dept, tab: 'team' },
    })
  }

  return { entries }
}

// -------- QUERY --------

const MAX_RESULTS = 20
// Tightened from 0.6 → 0.3. Levenshtein normalized above ~0.35 drags in too
// many false positives (e.g. 'fireblocks' would fuzzy-match short unrelated
// labels). Fuzzy is also disabled entirely for very short queries where
// distance means nothing meaningful.
const FUZZY_THRESHOLD = 0.3
const MIN_FUZZY_QUERY_LEN = 3

export function searchBudget(
  index: BudgetSearchIndex,
  query: string,
): BudgetSearchHit[] {
  const q = normalize(query)
  if (!q) return []

  const scored: BudgetSearchHit[] = []

  for (const entry of index.entries) {
    const targets = [entry.label, ...entry.aliases]
    let best: { score: number; isFuzzy: boolean } | null = null

    for (const target of targets) {
      const t = normalize(target)
      if (!t) continue
      // Tier 1 — exact.
      if (q === t) {
        best = { score: 0, isFuzzy: false }
        break
      }
      // Tier 2 — starts with.
      if (t.startsWith(q)) {
        const s = 0.1
        if (!best || s < best.score) best = { score: s, isFuzzy: false }
        continue
      }
      // Tier 3 — includes.
      if (t.includes(q)) {
        const s = 0.2
        if (!best || s < best.score) best = { score: s, isFuzzy: false }
        continue
      }
      // Tier 4 — Levenshtein normalized. Disabled for very short queries
      // (distance means little there) and gated by the tight threshold.
      if (q.length >= MIN_FUZZY_QUERY_LEN) {
        const dist = levenshtein(q, t)
        const norm = dist / Math.max(q.length, t.length)
        if (norm <= FUZZY_THRESHOLD) {
          const s = 0.3 + norm * 0.4
          if (!best || s < best.score) best = { score: s, isFuzzy: true }
        }
      }
    }

    if (best) {
      scored.push({
        kind: entry.kind,
        label: entry.label,
        subtitle: entry.subtitle,
        score: best.score,
        isFuzzy: best.isFuzzy,
        navigate: entry.navigate,
      })
    }
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    return a.label.localeCompare(b.label)
  })

  return scored.slice(0, MAX_RESULTS)
}

// Whether the entire result set is fuzzy — used to render the
// "⚠ No exact match" banner.
export function hasOnlyFuzzyHits(hits: readonly BudgetSearchHit[]): boolean {
  return hits.length > 0 && hits.every(h => h.isFuzzy)
}

// Filter a raw transaction list by the same query the search box uses. Used
// by the "View all matches" flow to build a single aggregated drill view of
// every transaction that matched the query across all months and departments.
// Uses the same tolerance ladder as searchBudget: exact/startsWith/includes
// pass, and Levenshtein up to FUZZY_THRESHOLD on any single searchable field.
export function filterTransactionsByQuery(
  transactions: readonly BudgetActualDrillTransaction[],
  query: string,
): BudgetActualDrillTransaction[] {
  const q = normalize(query)
  if (!q) return []
  const out: BudgetActualDrillTransaction[] = []
  for (const tx of transactions) {
    const targets = [
      tx.name, tx.memo, tx.transactionType, tx.accountName,
      tx.documentNumber, tx.className, tx.normalizedDepartment,
    ].filter((s): s is string => !!s && s.length > 0)
    let hit = false
    for (const target of targets) {
      const t = normalize(target)
      if (!t) continue
      if (t === q || t.startsWith(q) || t.includes(q)) { hit = true; break }
      // Same tightened fuzzy rule as searchBudget — must have a substring
      // OR a small enough Levenshtein distance on a query long enough for
      // distance to be meaningful.
      if (q.length >= MIN_FUZZY_QUERY_LEN) {
        const dist = levenshtein(q, t)
        if (dist / Math.max(q.length, t.length) <= FUZZY_THRESHOLD) { hit = true; break }
      }
    }
    if (hit) out.push(tx)
  }
  return out
}

// -------- HELPERS --------

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function fmtSignedUsd(n: number): string {
  const abs = Math.abs(n)
  const rounded = Math.round(abs * 100) / 100
  const s = rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? '-' : '+'}$${s}`
}

function formatShortDate(iso: string): string {
  // Return 'Jun 30' style from 'YYYY-MM-DD' — falls back to the raw string
  // if parsing fails so we never silently drop useful context.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthName = months[Number(m[2]) - 1] ?? m[2]
  return `${monthName} ${Number(m[3])}`
}

// Iterative Levenshtein — O(n·m) with two rolling rows. Good enough for the
// per-keystroke workload (a few hundred entries × short query strings).
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const rowLen = b.length + 1
  let prev = new Array<number>(rowLen)
  let curr = new Array<number>(rowLen)
  for (let j = 0; j < rowLen; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j < rowLen; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,             // deletion
        prev[j - 1] + cost,      // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}
