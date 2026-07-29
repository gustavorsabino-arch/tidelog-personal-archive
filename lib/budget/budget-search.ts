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

import type { BudgetDepartment, BudgetMonthKey, BudgetTeamMember } from './types.ts'
import { BUDGET_LINE_CATALOG } from './catalog.ts'

export type BudgetSearchHitKind =
  | 'line-item'
  | 'category'
  | 'department'
  | 'team-member'

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
const FUZZY_THRESHOLD = 0.6

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
      // Tier 4 — Levenshtein normalized.
      const dist = levenshtein(q, t)
      const norm = dist / Math.max(q.length, t.length)
      if (norm <= FUZZY_THRESHOLD) {
        // Fuzzy tier — never score better than 0.3 so pure fuzzy sits below
        // clean substring matches from other entries.
        const s = 0.3 + norm * 0.4
        if (!best || s < best.score) best = { score: s, isFuzzy: true }
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

// -------- HELPERS --------

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
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
