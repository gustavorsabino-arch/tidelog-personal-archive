'use client'

import { useEffect, useMemo } from 'react'

import { getBudgetDepartmentLabel } from '@/lib/budget/departments'
import { fmtUSD } from '@/lib/format'
import type { BudgetDepartment, BudgetTeamMember } from '@/lib/budget/types'

type BudgetHeadcountModalProps = {
  open: boolean
  year: number
  department: BudgetDepartment | null
  members: readonly BudgetTeamMember[]
  onClose: () => void
}

export function BudgetHeadcountModal({
  open,
  year,
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
    const totalSalaryUsd = members.reduce((sum, member) => sum + (member.salary || 0), 0)
    const totalBonusUsd = members.reduce((sum, member) => sum + (member.bonus || 0), 0)

    return {
      activeMembers: members.length,
      totalSalaryUsd,
      totalBonusUsd,
      totalCompUsd: totalSalaryUsd + totalBonusUsd,
    }
  }, [members])

  if (!open || !department) return null
  const departmentLabel = getBudgetDepartmentLabel(department)

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: '960px', maxWidth: '96vw' }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{departmentLabel} Headcount</div>
            <div className="modal-sub">
              Active roster assumptions for {year}, sorted from the canonical team tracker.
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close headcount modal">×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          <div className="cards-grid" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="card-label">Active Members</div>
              <div className="card-value">{summary.activeMembers}</div>
              <div className="card-sub">Current members in {departmentLabel}</div>
            </div>
            <div className="card">
              <div className="card-label">Salary</div>
              <div className="card-value">{fmtUSD(summary.totalSalaryUsd, 0)}</div>
            </div>
            <div className="card">
              <div className="card-label">Bonus</div>
              <div className="card-value">{fmtUSD(summary.totalBonusUsd, 0)}</div>
            </div>
            <div className="card">
              <div className="card-label">Total Comp</div>
              <div className="card-value">{fmtUSD(summary.totalCompUsd, 0)}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Classification</th>
                  <th className="num">Salary</th>
                  <th className="num">Bonus</th>
                  <th className="num">Total Comp</th>
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
                    <td className="num">{fmtUSD(member.salary, 0)}</td>
                    <td className="num">{member.bonus ? fmtUSD(member.bonus, 0) : '—'}</td>
                    <td className="num">{fmtUSD((member.salary || 0) + (member.bonus || 0), 0)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty budget-empty-inline">
                        <div className="empty-icon">∅</div>
                        <div>No active team members are currently assigned to {departmentLabel}.</div>
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
