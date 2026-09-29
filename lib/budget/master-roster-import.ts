import * as XLSX from 'xlsx'

import type { BudgetTeamMemberInput } from './types.ts'

const DEPARTMENT_MAP: Record<string, string> = {
  Eng: 'Engineering',
  BD: 'Business Development',
}

function isoDate(cell: XLSX.CellObject | undefined): string | null {
  if (!cell?.v) return null
  if (cell.v instanceof Date) return cell.v.toISOString().slice(0, 10)
  if (typeof cell.v === 'number') {
    const parts = XLSX.SSF.parse_date_code(cell.v)
    return parts ? `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}` : null
  }
  if (typeof cell.v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cell.v)) return cell.v.slice(0, 10)
  throw new Error(`Invalid workbook date: ${String(cell.v)}`)
}

export function parseMasterRosterWorkbook(bytes: Uint8Array): BudgetTeamMemberInput[] {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets['Total Comp Tracker']
  if (!sheet || sheet['C3']?.v !== 'Name' || sheet['P3']?.v !== 'Stables' || sheet['AP3']?.v !== 'Last day') {
    throw new Error('Expected Total Comp Tracker with Name, Stables and Last day columns.')
  }

  const rows = [...Array.from({ length: 23 }, (_, i) => i + 4), ...Array.from({ length: 27 }, (_, i) => i + 28)]
  return rows.map((row) => {
    const get = (column: string) => String(sheet[`${column}${row}`]?.v ?? '').trim()
    const startDate = isoDate(sheet[`K${row}`])
    const terminationDate = isoDate(sheet[`AP${row}`])
    if (!get('C') || !get('D') || !startDate || !Number.isFinite(Number(sheet[`P${row}`]?.v))) {
      throw new Error(`Missing name, email, start date or Stables salary at row ${row}.`)
    }
    return {
      name: get('C'), email: get('D').toLowerCase(), entity: get('F'),
      classification: get('G'), dept: (DEPARTMENT_MAP[get('H')] ?? get('H')) as BudgetTeamMemberInput['dept'],
      ft: get('J'), role: get('L'), location: get('M'),
      salary: Number(sheet[`P${row}`]?.v), bonus: 0,
      startDate, terminationDate,
      terminationMonth: terminationDate ? terminationDate.slice(5, 7) as BudgetTeamMemberInput['terminationMonth'] : null,
      status: terminationDate && terminationDate < new Date().toISOString().slice(0, 10) ? 'Terminated' : 'Current',
    }
  })
}
