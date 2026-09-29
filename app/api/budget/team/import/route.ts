import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { logAudit } from '@/lib/audit'
import { requireBudgetAccess } from '@/lib/budget/access-control'
import { loadBudgetTeamState, memberToRowValuesForImport, ensureBudgetTeamDatesSchema, validateBudgetTeamMemberInput } from '@/lib/budget/team'
import { db } from '@/lib/db'
import { budgetTeamEmploymentDates, budgetTeamMember } from '@/lib/db/schema/budget'
import type { BudgetTeamMemberInput } from '@/lib/budget/types'
import { parseMasterRosterWorkbook } from '@/lib/budget/master-roster-import'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const access = await requireBudgetAccess(req, { requirement: 'manage-team' })
  if (!access.ok) return access.response

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Upload a .xlsx workbook.' }, { status: 415 })
  }
  const candidates = await (async () => {
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.xlsx') || file.size > 8_000_000) {
        throw new Error('Upload the 2026 master .xlsx file (8 MB maximum).')
      }
      return parseMasterRosterWorkbook(new Uint8Array(await file.arrayBuffer()))
    })().catch((error) => error)
  if (candidates instanceof Error) return NextResponse.json({ error: candidates.message }, { status: 400 })
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 100) {
    return NextResponse.json({ error: 'Supply 1–100 team members.' }, { status: 400 })
  }

  try {
    const members: BudgetTeamMemberInput[] = candidates.map((candidate: unknown) => validateBudgetTeamMemberInput(candidate))
    const emailSet = new Set(members.map((member) => member.email))
    if (emailSet.size !== members.length) throw new Error('Duplicate email in import.')
    await ensureBudgetTeamDatesSchema()
    const result = await db.transaction(async (tx) => {
      const existing = await tx.select({ id: budgetTeamMember.id, email: budgetTeamMember.email }).from(budgetTeamMember)
      const byEmail = new Map<string, string>()
      for (const row of existing) {
        if (!row.email) continue
        const email = row.email.trim().toLowerCase()
        if (byEmail.has(email) && emailSet.has(email)) throw new Error(`Duplicate existing email: ${email}`)
        byEmail.set(email, row.id)
      }

      let created = 0
      let updated = 0
      for (const member of members) {
        const values = memberToRowValuesForImport(member)
        const id = byEmail.get(member.email)
        let memberId: string
        if (id) {
          await tx.update(budgetTeamMember).set({ ...values, updatedAt: new Date() }).where(eq(budgetTeamMember.id, id))
          memberId = id
          updated++
        } else {
          const [inserted] = await tx.insert(budgetTeamMember).values(values).returning({ id: budgetTeamMember.id })
          memberId = inserted.id
          created++
        }
        await tx.insert(budgetTeamEmploymentDates)
          .values({ memberId, startDate: member.startDate || null, terminationDate: member.terminationDate || null })
          .onConflictDoUpdate({ target: budgetTeamEmploymentDates.memberId, set: { startDate: member.startDate || null, terminationDate: member.terminationDate || null } })
      }
      return { created, updated }
    })
    await logAudit({
      userId: access.user.id === 'dev-user' ? null : access.user.id,
      action: 'budget.team.imported',
      resourceType: 'budget_team_member',
      metadata: { year: 2026, ...result, source: 'Team Tracker - MASTER (2).xlsx' },
    })
    const team = await loadBudgetTeamState(2026, true)
    return NextResponse.json({ success: true, ...result, total: team.members.length })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Import failed.' }, { status: 400 })
  }
}
