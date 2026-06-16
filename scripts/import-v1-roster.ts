// Import V1 roster into budget_team_member.
//
// Idempotent: deletes all existing rows then re-inserts from V1_ROSTER.
// Comp (salary/bonus) is intentionally NOT imported — only name/dept/entity
// are needed for the QB class backfill.
//
// Run:
//   DB_MODE=local DATABASE_URL=<url> bun run scripts/import-v1-roster.ts

import { db } from '../lib/db'
import { budgetTeamMember } from '../lib/db/schema/budget'
import { V1_ROSTER } from './data/v1-roster'

const VALID_ENTITY_IDS = new Set(['opco', 'foundation', 'juku', 'zagreus', 'external'])

const rows = V1_ROSTER.map((m) => {
  const entityId = m.entity.toLowerCase()
  const resolvedEntityId = VALID_ENTITY_IDS.has(entityId) ? entityId : null

  if (resolvedEntityId === null) {
    console.warn(`[warn] unknown entity — setting entityId=null for "${m.name}" (entity="${m.entity}")`)
  }

  return {
    name: m.name,
    department: m.dept,
    email: m.email ?? null,
    classification: m.classification ?? null,
    role: m.role ?? null,
    location: m.location ?? null,
    entityId: resolvedEntityId,
    status: (m.status === 'Current' ? 'active' : 'inactive') as 'active' | 'inactive',
    ft: m.ft === 'FT',
    // salary/bonus intentionally omitted (data minimization)
  }
})

await db.transaction(async (tx) => {
  await tx.delete(budgetTeamMember)
  await tx.insert(budgetTeamMember).values(rows)
})

const nullEntityCount = rows.filter((r) => r.entityId === null).length
console.log(`imported ${rows.length} team members (${nullEntityCount} with null entityId)`)
process.exit(0)
