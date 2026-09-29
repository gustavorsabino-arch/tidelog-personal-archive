import { NextRequest, NextResponse } from 'next/server'

import { logAudit } from '@/lib/audit'
import { requireBudgetAccess } from '@/lib/budget/access-control'
import type { TeamMasterRow } from '@/lib/budget/team-import'
import { replaceBudgetTeamRosterInDb } from '@/lib/budget/team'
import type { BudgetMonthKey } from '@/lib/budget/types'

export const runtime = 'nodejs'

// ONE-OFF roster sync — Team Tracker MASTER (Sep 2026), first block (1-23).
// Replaces the DB roster with exactly these 23 people (salary = Stables, bonus
// cleared). Day-to-day changes go through Add Team Member / Edit after this sync.
const ROSTER: TeamMasterRow[] = [
  {
    "status": "Voluntary leave",
    "name": "Bella Basuni (Basuni LLC)",
    "email": "bella@orca.so",
    "entity": "Zagreus",
    "classification": "Contractor",
    "dept": "Ops",
    "ft": "FT",
    "role": "Operations Lead",
    "location": "US - Georgia",
    "stables": 150000
  },
  {
    "status": "Current",
    "name": "Christopher Montagano (Montagano Group LLC)",
    "email": "montagano@orca.so",
    "entity": "Zagreus",
    "classification": "Contractor",
    "dept": "Legal",
    "ft": "FT",
    "role": "CLO",
    "location": "US - Utah",
    "stables": 370000
  },
  {
    "status": "Current",
    "name": "Emily Chan",
    "email": "emily@orca.so",
    "entity": "Zagreus",
    "classification": "Employee",
    "dept": "Legal",
    "ft": "FT",
    "role": "Legal Project Manager",
    "location": "US - NYC",
    "stables": 145000
  },
  {
    "status": "Current",
    "name": "Gustavo Sabino",
    "email": "gustavo@orca.so",
    "entity": "Opco",
    "classification": "Contractor",
    "dept": "Finance",
    "ft": "FT",
    "role": "Accountant",
    "location": "Portugal",
    "stables": 75000
  },
  {
    "status": "Current",
    "name": "Hyunsik Boo (Boosik)",
    "email": "boosik@orca.so",
    "entity": "Opco",
    "classification": "Contractor",
    "dept": "Eng",
    "ft": "FT",
    "role": "Developer Advocate",
    "location": "South Korea",
    "stables": 130000
  },
  {
    "status": "Voluntary leave",
    "name": "Isaac (Jun Hee) Kim",
    "email": "isaac@orca.so",
    "entity": "Zagreus",
    "classification": "Employee",
    "dept": "Ops",
    "ft": "FT",
    "role": "COO",
    "location": "US - Georgia",
    "stables": 255000
  },
  {
    "status": "Current",
    "name": "Kate San (SEAVest MM Ltd)",
    "email": "kate@orca.so",
    "entity": "Opco",
    "classification": "Contractor",
    "dept": "Finance",
    "ft": "FT",
    "role": "Controller",
    "location": "US - NYC",
    "stables": 165000
  },
  {
    "status": "Current",
    "name": "Kian Ghalibaf (Pangea3 Consulting)",
    "email": "kian@orca.so",
    "entity": "Zagreus",
    "classification": "Contractor",
    "dept": "BD",
    "ft": "FT",
    "role": "Head of BD",
    "location": "US - Texas",
    "stables": 175000
  },
  {
    "status": "Current",
    "name": "Matias Castro",
    "email": "mcastro@orca.so",
    "entity": "Zagreus",
    "classification": "Employee",
    "dept": "Product",
    "ft": "FT",
    "role": "Head of Product Management",
    "location": "US - NYC",
    "stables": 220000
  },
  {
    "status": "Current",
    "name": "Michael Hwang (TMOC Labs)",
    "email": "michael@orca.so",
    "entity": "Zagreus",
    "classification": "Contractor",
    "dept": "General",
    "ft": "FT",
    "role": "CEO",
    "location": "US - Las Vegas",
    "stables": 235000
  },
  {
    "status": "Current",
    "name": "Mike Yoo (Maleo Works)",
    "email": "mikeyoo@orca.so",
    "entity": "Opco",
    "classification": "Contractor",
    "dept": "BD",
    "ft": "FT",
    "role": "APAC Lead",
    "location": "South Korea",
    "stables": 100000
  },
  {
    "status": "Current",
    "name": "Sakae Kawakami (Yugure)",
    "email": "skawakami@orca.so",
    "entity": "Opco",
    "classification": "Contractor",
    "dept": "Eng",
    "ft": "FT",
    "role": "Software Engineer",
    "location": "Japan",
    "stables": 200000
  },
  {
    "status": "Current",
    "name": "Sandesh Ragati Sharanappa (Sententia Technologies Ltd)",
    "email": "sandesh@orca.so",
    "entity": "Opco",
    "classification": "Contractor",
    "dept": "Product",
    "ft": "FT",
    "role": "Product Manager",
    "location": "UK (London)",
    "stables": 185000
  },
  {
    "status": "Current",
    "name": "Sangyun Ock",
    "email": "sangyun@orca.so",
    "entity": "Opco",
    "classification": "Contractor",
    "dept": "Eng",
    "ft": "FT",
    "role": "Software Engineer",
    "location": "South Korea",
    "stables": 110000
  },
  {
    "status": "Current",
    "name": "Tyler Lowmiller",
    "email": "tlowmiller@orca.so",
    "entity": "Zagreus",
    "classification": "Employee",
    "dept": "Product",
    "ft": "FT",
    "role": "Product Designer",
    "location": "US - NYC",
    "stables": 145000
  },
  {
    "status": "Current",
    "name": "Zizheng Jiang (Zed) (Brickleap Labs)",
    "email": "zed@orca.so",
    "entity": "Opco",
    "classification": "Contractor",
    "dept": "Eng",
    "ft": "FT",
    "role": "Staff Software Engineer",
    "location": "Canada",
    "stables": 180000
  },
  {
    "status": "Current",
    "name": "Jose Preciado Perez",
    "email": "jose@orca.so",
    "entity": "Opco",
    "classification": "Contractor",
    "dept": "Legal",
    "ft": "PT",
    "role": "Legal Clerk",
    "location": "Panama",
    "stables": 27000
  },
  {
    "status": "Current",
    "name": "Luke Truitt",
    "email": "luke@orca.so",
    "entity": "Zagreus",
    "classification": "Employee",
    "dept": "General",
    "ft": "FT",
    "role": "CEO",
    "location": "US - NYC",
    "stables": 235000
  },
  {
    "status": "Current",
    "name": "Mary Gooneratne",
    "email": "mary@orca.so",
    "entity": "Zagreus",
    "classification": "Employee",
    "dept": "Product",
    "ft": "FT",
    "role": "CPO",
    "location": "US - NYC",
    "stables": 255000
  },
  {
    "status": "Current",
    "name": "Logan Larkin",
    "email": "logan@orca.so",
    "entity": "Zagreus",
    "classification": "Employee",
    "dept": "BD",
    "ft": "FT",
    "role": "Business Development",
    "location": "US - NYC",
    "stables": 120000
  },
  {
    "status": "Current",
    "name": "Jwalin Joshi",
    "email": "jwalin@orca.so",
    "entity": "Zagreus",
    "classification": "Employee",
    "dept": "Product",
    "ft": "FT",
    "role": "Product",
    "location": "US - CA",
    "stables": 200000
  },
  {
    "status": "Current",
    "name": "Chris Hagedorn",
    "email": "chagedorn@orca.so",
    "entity": "Zagreus",
    "classification": "Employee",
    "dept": "Eng",
    "ft": "FT",
    "role": "Software Engineer",
    "location": "US - NYC",
    "stables": 140000
  },
  {
    "status": "Current",
    "name": "Bhargava Macha",
    "email": "bhargava@orca.so",
    "entity": "Zagreus",
    "classification": "Contractor",
    "dept": "Eng",
    "ft": "FT",
    "role": "Software Engineer",
    "location": "US - NYC",
    "stables": 140000
  }
]

function currentMonthKey(): BudgetMonthKey {
  return String(new Date().getMonth() + 1).padStart(2, '0') as BudgetMonthKey
}

export async function POST(req: NextRequest) {
  const accessResult = await requireBudgetAccess(req, { requirement: 'manage-team' })
  if (!accessResult.ok) return accessResult.response

  let summary: Awaited<ReturnType<typeof replaceBudgetTeamRosterInDb>>
  try {
    summary = await replaceBudgetTeamRosterInDb(ROSTER, currentMonthKey())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Roster sync failed: ${message}` }, { status: 400 })
  }
  await logAudit({
    userId: accessResult.user.id === 'dev-user' ? null : accessResult.user.id,
    action: 'budget.team.roster-synced',
    metadata: { ...summary, actor: accessResult.user.email },
  })

  return NextResponse.json({ ok: true, ...summary })
}
