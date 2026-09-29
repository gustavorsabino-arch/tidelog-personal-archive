'use client'

import { useEffect, useMemo } from 'react'

import { getBudgetDepartmentLabel } from '@/lib/budget/departments'
import { fmtUSD } from '@/lib/format'
import { getMemberMonthlySalaryBudget } from '@/lib/budget/selectors'
import type { BudgetDepartment, BudgetTeamMember } from '@/lib/budget/types'

type BudgetHeadcountModalProps = {
  open: boolean
  year: number
  month: number
  department: BudgetDepartment | null
  members: readonly BudgetTeamMember[]
  onClose: () => void
}

export function BudgetHeadcountModal({
  open,
  year,
  month,
  department,
  members,
  onClose,
}: BudgetHeadcountModalProps) {
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  const summary = useMemo(() => {
    const totalSalaryUsd = members.reduce((sum, member) => sum + getMemberMonthlySalaryBudget(member, year, month), 0)
    return {
      activeMembers: members.length,
      totalSalaryUsd,
    }
  }, [members, year, month])

  if (!open || !department) return null
  const departmentLabel = getBudgetDepartmentLabel(department)

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: '960px', maxWidth: '96vw' }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{departmentLabel} Headcount</div>
            <div className="modal-sub">
              Salary budget for {String(month).padStart(2, '0')}/{year}, including leavers who worked during the month.
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close headcount modal">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div className="cards-grid" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="card-label">Members in Month</div>
              <div className="card-value">{summary.activeMembers}</div>
              <div className="card-sub">Working days in {departmentLabel}</div>
            </div>
            <div className="card">
              <div className="card-label">Salary Budget Monthly</div>
              <div className="card-value">{fmtUSD(summary.totalSalaryUsd, 0)}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Classification</th>
                  <th>Last Day</th>
                  <th className="num">Salary Budget Monthly</th>
                </tr>
              </thead>
              <tbody>
                {members.length > 0 ? members.map((member) => (
                  <tr key={member.id}>
                    <td className="label" style={{ fontWeight: 500 }}>
                      {member.name}
                      <div style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 4 }}>
                        {member.role}
                      </div>
                    </td>
                    <td><span className={`status-badge ${member.status}`}>{member.status}</span></td>
                    <td><span className="dept-badge">{member.classification || '—'}</span></td>
                    <td>{member.terminationDate ?? '—'}</td>
                    <td className="num">{fmtUSD(getMemberMonthlySalaryBudget(member, year, month), 0)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty budget-empty-inline">
                        <div className="empty-icon">∅</div>
                        <div>No team members worked in {departmentLabel} this month.</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
