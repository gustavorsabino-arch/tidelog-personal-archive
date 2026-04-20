'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { apiFetch, apiPost } from '@/lib/api'
import { useSharedAccess } from '@/lib/access-context'
import type {
  AdminAccessSnapshot,
  AdminAccessUserInput,
  AdminAccessUserRecord,
  AdminBudgetViewerSettings,
} from '@/lib/admin-access-model'
import { getAdminAccessUserValidationError } from '@/lib/admin-access-model'
import { formatBudgetDepartmentList, getBudgetDepartmentLabel } from '@/lib/budget/departments'
import type { AccessRole } from '@/lib/access-model'
import { BUDGET_DEPTS } from '@/lib/constants'
import { BUDGET_MONTH_LABELS } from '@/lib/budget/scope'

type AccessEditorDraft = {
  email: string
  role: AccessRole
  budgetDefaultDepartment: string
  departments: string[]
  aliasesText: string
}

const EMPTY_DRAFT: AccessEditorDraft = {
  email: '',
  role: 'restricted',
  budgetDefaultDepartment: '',
  departments: [],
  aliasesText: '',
}

const YEAR_OPTIONS = [2024, 2025, 2026, 2027]

function createDraftFromUser(user: AdminAccessUserRecord): AccessEditorDraft {
  return {
    email: user.email,
    role: user.role,
    budgetDefaultDepartment: user.budgetDefaultDepartment ?? '',
    departments: [...user.departments],
    aliasesText: user.aliases.join('\n'),
  }
}

function sortUsers(users: readonly AdminAccessUserRecord[]): AdminAccessUserRecord[] {
  return [...users].sort((left, right) => left.email.localeCompare(right.email))
}

function parseAliasesText(value: string): string[] {
  return value
    .split(/[\n,]+/g)
    .map((alias) => alias.trim())
    .filter(Boolean)
}

function countAliases(users: readonly AdminAccessUserRecord[]): number {
  return users.reduce((sum, user) => sum + user.aliases.length, 0)
}

function roleLabel(role: AccessRole): string {
  if (role === 'budget_admin') return 'Budget Admin'
  if (role === 'restricted') return 'Restricted'
  return 'Admin'
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function usesDepartmentScopedBudgetAccess(role: AccessRole): boolean {
  return role === 'restricted'
}

function isDraftEmpty(draft: AccessEditorDraft): boolean {
  return draft.email.trim() === ''
    && draft.role === EMPTY_DRAFT.role
    && draft.budgetDefaultDepartment === ''
    && draft.departments.length === 0
    && draft.aliasesText.trim() === ''
}

export default function AdminPage() {
  const router = useRouter()
  const { access, loading: accessLoading, error: accessError, refresh: refreshAccess } = useSharedAccess()
  const [selectedYear, setSelectedYear] = useState(2026)
  const [snapshot, setSnapshot] = useState<AdminAccessSnapshot | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | '__new__' | null>(null)
  const [draft, setDraft] = useState<AccessEditorDraft>(EMPTY_DRAFT)
  const [viewerMonthNumbers, setViewerMonthNumbers] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [flashMessage, setFlashMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  const isAdmin = access?.role === 'admin'
  const currentCanonicalEmail = access?.canonicalEmail ?? null
  const filteredUsers = useMemo(() => {
    const users = snapshot?.users ?? []
    const query = search.trim().toLowerCase()
    if (!query) return users

    return users.filter((user) => (
      user.email.toLowerCase().includes(query)
      || user.aliases.some((alias) => alias.toLowerCase().includes(query))
      || user.departments.some((department) => department.toLowerCase().includes(query))
      || roleLabel(user.role).toLowerCase().includes(query)
    ))
  }, [search, snapshot?.users])

  const draftPayload = useMemo<AdminAccessUserInput>(() => ({
    sourceEmail: selectedUserEmail && selectedUserEmail !== '__new__' ? selectedUserEmail : null,
    email: draft.email,
    role: draft.role,
    budgetDefaultDepartment: draft.budgetDefaultDepartment || null,
    departments: draft.departments,
    aliases: parseAliasesText(draft.aliasesText),
  }), [draft, selectedUserEmail])

  const draftValidationMessage = useMemo(() => (
    snapshot
      ? getAdminAccessUserValidationError(draftPayload, snapshot.users)
      : null
  ), [draftPayload, snapshot])

  const selectedUser = useMemo(() => {
    if (!snapshot || !selectedUserEmail || selectedUserEmail === '__new__') return null
    return snapshot.users.find((user) => user.email === selectedUserEmail) ?? null
  }, [selectedUserEmail, snapshot])

  const showDraftValidationMessage = useMemo(() => {
    if (!draftValidationMessage) return false
    if (selectedUserEmail === '__new__') return !isDraftEmpty(draft)
    if (!selectedUser) return false
    const baseline = createDraftFromUser(selectedUser)
    return JSON.stringify({
      ...draft,
      aliasesText: parseAliasesText(draft.aliasesText),
    }) !== JSON.stringify({
      ...baseline,
      aliasesText: parseAliasesText(baseline.aliasesText),
    })
  }, [draft, draftValidationMessage, selectedUser, selectedUserEmail])

  const roleCounts = useMemo(() => {
    const users = snapshot?.users ?? []
    return {
      admins: users.filter((user) => user.role === 'admin').length,
      budgetAdmins: users.filter((user) => user.role === 'budget_admin').length,
      restricted: users.filter((user) => user.role === 'restricted').length,
      aliases: countAliases(users),
    }
  }, [snapshot?.users])

  useEffect(() => {
    setFlashMessage(null)
  }, [selectedYear])

  useEffect(() => {
    if (snapshot?.viewerSettings) {
      setViewerMonthNumbers([...snapshot.viewerSettings.viewerMonthNumbers])
    }
  }, [snapshot?.viewerSettings])

  useEffect(() => {
    async function loadSnapshot() {
      if (accessLoading) return
      if (!isAdmin) {
        setPageLoading(false)
        return
      }

      setPageLoading(true)
      setPageError(null)
      try {
        const nextSnapshot = await apiFetch<AdminAccessSnapshot>(`/api/admin/access?year=${selectedYear}`)
        setSnapshot(nextSnapshot)
      } catch (error) {
        setPageError(error instanceof Error ? error.message : 'Failed to load access controls.')
      } finally {
        setPageLoading(false)
      }
    }

    void loadSnapshot()
  }, [accessLoading, isAdmin, selectedYear])

  useEffect(() => {
    if (!snapshot) return

    if (selectedUserEmail === null) {
      const firstUser = snapshot.users[0] ?? null
      if (firstUser) {
        setSelectedUserEmail(firstUser.email)
        setDraft(createDraftFromUser(firstUser))
      } else {
        setSelectedUserEmail('__new__')
        setDraft(EMPTY_DRAFT)
      }
      return
    }

    if (selectedUserEmail !== '__new__' && !snapshot.users.some((user) => user.email === selectedUserEmail)) {
      const fallbackUser = snapshot.users[0] ?? null
      if (fallbackUser) {
        setSelectedUserEmail(fallbackUser.email)
        setDraft(createDraftFromUser(fallbackUser))
      } else {
        setSelectedUserEmail('__new__')
        setDraft(EMPTY_DRAFT)
      }
    }
  }, [selectedUserEmail, snapshot])

  function selectExistingUser(user: AdminAccessUserRecord) {
    setSelectedUserEmail(user.email)
    setDraft(createDraftFromUser(user))
    setFlashMessage(null)
  }

  function startNewUser() {
    setSelectedUserEmail('__new__')
    setDraft(EMPTY_DRAFT)
    setFlashMessage(null)
  }

  function updateDraft(patch: Partial<AccessEditorDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function isCurrentUserEmail(email: string | null | undefined): boolean {
    if (!email) return false
    const normalized = email.trim().toLowerCase()
    return normalized === access?.email || normalized === currentCanonicalEmail
  }

  function toggleDepartment(department: string) {
    setDraft((current) => {
      const nextDepartments = current.departments.includes(department)
        ? current.departments.filter((value) => value !== department)
        : [...current.departments, department]

      const nextDefaultDepartment = nextDepartments.includes(current.budgetDefaultDepartment)
        ? current.budgetDefaultDepartment
        : (nextDepartments[0] ?? '')

      return {
        ...current,
        departments: nextDepartments,
        budgetDefaultDepartment: nextDefaultDepartment,
      }
    })
  }

  async function saveUser() {
    if (draftValidationMessage) {
      setFlashMessage({ tone: 'warn', text: draftValidationMessage })
      return
    }

    setSaveBusy(true)
    setFlashMessage(null)

    try {
      const response = await apiPost<{ user: AdminAccessUserRecord }>('/api/admin/access', { user: draftPayload })
      const updatedCurrentUser = isCurrentUserEmail(response.user.email)
      setSnapshot((current) => {
        const currentUsers = current?.users ?? []
        const nextUsers = sortUsers([
          ...currentUsers.filter((user) => user.email !== selectedUserEmail && user.email !== response.user.email),
          response.user,
        ])
        return current
          ? { ...current, users: nextUsers }
          : { users: nextUsers, viewerSettings: { year: selectedYear, viewerMonthNumbers } satisfies AdminBudgetViewerSettings }
      })
      setSelectedUserEmail(response.user.email)
      setDraft(createDraftFromUser(response.user))
      setFlashMessage({
        tone: 'ok',
        text: `${response.user.email} saved successfully.`,
      })
      if (updatedCurrentUser) {
        refreshAccess()
      }
      if (updatedCurrentUser && response.user.role !== 'admin') {
        router.replace('/budget')
      }
    } catch (error) {
      setFlashMessage({
        tone: 'warn',
        text: error instanceof Error ? error.message : 'Failed to save the access record.',
      })
    } finally {
      setSaveBusy(false)
    }
  }

  async function deleteUser() {
    if (!selectedUser || deleteBusy) return
    const confirmed = window.confirm(`Remove access for ${selectedUser.email}?`)
    if (!confirmed) return

    setDeleteBusy(true)
    setFlashMessage(null)

    try {
      const deletingCurrentUser = isCurrentUserEmail(selectedUser.email)
      await apiFetch<{ success: true }>(`/api/admin/access?email=${encodeURIComponent(selectedUser.email)}`, {
        method: 'DELETE',
      })

      setSnapshot((current) => {
        if (!current) return current
        const nextUsers = current.users.filter((user) => user.email !== selectedUser.email)
        return { ...current, users: nextUsers }
      })

      const remainingUsers = (snapshot?.users ?? []).filter((user) => user.email !== selectedUser.email)
      const fallbackUser = remainingUsers[0] ?? null
      if (fallbackUser) {
        setSelectedUserEmail(fallbackUser.email)
        setDraft(createDraftFromUser(fallbackUser))
      } else {
        setSelectedUserEmail('__new__')
        setDraft(EMPTY_DRAFT)
      }

      setFlashMessage({
        tone: 'ok',
        text: `${selectedUser.email} was removed.`,
      })
      if (deletingCurrentUser) {
        refreshAccess()
      }
      if (deletingCurrentUser) {
        router.replace('/budget')
      }
    } catch (error) {
      setFlashMessage({
        tone: 'warn',
        text: error instanceof Error ? error.message : 'Failed to delete the access record.',
      })
    } finally {
      setDeleteBusy(false)
    }
  }

  async function saveViewerSettings() {
    setSettingsBusy(true)
    setFlashMessage(null)
    try {
      const response = await apiPost<{ settings: AdminBudgetViewerSettings }>('/api/admin/access/settings', {
        year: selectedYear,
        viewerMonthNumbers,
      })
      setSnapshot((current) => current ? { ...current, viewerSettings: response.settings } : current)
      setFlashMessage({
        tone: 'ok',
        text: `Restricted-viewer month access updated for ${selectedYear}.`,
      })
    } catch (error) {
      setFlashMessage({
        tone: 'warn',
        text: error instanceof Error ? error.message : 'Failed to save restricted-viewer settings.',
      })
    } finally {
      setSettingsBusy(false)
    }
  }

  if (accessLoading || pageLoading) {
    return (
      <div>
        <div className="page-header">
          <div className="page-title">Access Control</div>
          <div className="page-sub">Loading admin access configuration…</div>
        </div>
        <div className="status-bar">
          <span className="status-dot loading" />
          <span className="status-text">Loading access configuration…</span>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div>
        <div className="page-header">
          <div className="page-title">Access Control</div>
          <div className="page-sub">Admin-only access management</div>
        </div>
        <div className="empty">
          <div className="empty-icon">🔒</div>
          <div>{accessError || 'Admin access is required to manage user permissions.'}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-access-page">
      <div className="page-header admin-access-header">
        <div>
          <div className="page-title">Access Control</div>
          <div className="page-sub">Configure admins, budget admins, restricted viewers, aliases, and closed-month visibility.</div>
        </div>
        <div className="admin-access-header-actions">
          <label className="budget-scope-inline-field">
            <span className="budget-scope-inline-label">Year:</span>
            <select
              className="fsel"
              value={String(selectedYear)}
              onChange={(event) => setSelectedYear(Number.parseInt(event.target.value, 10))}
            >
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <button className="btn-secondary" type="button" onClick={startNewUser}>
            New User
          </button>
        </div>
      </div>

      {flashMessage ? (
        <div className="status-bar">
          <span className={`status-dot ${flashMessage.tone}`} />
          <span className="status-text">{flashMessage.text}</span>
        </div>
      ) : null}

      {pageError ? (
        <div className="status-bar">
          <span className="status-dot warn" />
          <span className="status-text">{pageError}</span>
        </div>
      ) : null}

      <div className="cards-grid admin-access-summary-grid">
        <div className="card">
          <div className="card-label">Admins</div>
          <div className="card-value">{roleCounts.admins}</div>
          <div className="card-sub">Full app and budget access</div>
        </div>
        <div className="card">
          <div className="card-label">Budget Admins</div>
          <div className="card-value blue">{roleCounts.budgetAdmins}</div>
          <div className="card-sub">Overview-only across all departments, plus import access</div>
        </div>
        <div className="card">
          <div className="card-label">Restricted Viewers</div>
          <div className="card-value orange">{roleCounts.restricted}</div>
          <div className="card-sub">Overview-only for assigned departments</div>
        </div>
        <div className="card">
          <div className="card-label">Aliases</div>
          <div className="card-value">{roleCounts.aliases}</div>
          <div className="card-sub">Alternate sign-in emails mapped to canonical users</div>
        </div>
      </div>

      <div className="card admin-access-settings-card">
        <div className="section-header">
          <div>
            <div className="section-title">Scoped Budget Months</div>
            <div className="card-sub">Budget admins and restricted viewers can only choose these closed months for {selectedYear}.</div>
          </div>
          <button className="btn-primary" type="button" disabled={settingsBusy} onClick={saveViewerSettings}>
            {settingsBusy ? 'Saving…' : 'Save Months'}
          </button>
        </div>
        <div className="admin-access-month-grid">
          {BUDGET_MONTH_LABELS.map((label, index) => {
            const monthNumber = index + 1
            const checked = viewerMonthNumbers.includes(monthNumber)
            return (
              <label key={label} className={`admin-access-month-pill${checked ? ' selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => setViewerMonthNumbers((current) => (
                    current.includes(monthNumber)
                      ? current.filter((value) => value !== monthNumber)
                      : [...current, monthNumber].sort((left, right) => left - right)
                  ))}
                />
                <span>{label}</span>
              </label>
            )
          })}
        </div>
      </div>

      <div className="admin-access-layout">
        <section className="card admin-access-list-card">
          <div className="section-header">
            <div className="section-title">Configured Users</div>
            <input
              className="fsearch"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search email, alias, role, department"
            />
          </div>
          <div className="admin-access-list">
            {filteredUsers.length > 0 ? filteredUsers.map((user) => (
              <button
                key={user.email}
                type="button"
                className={`admin-access-list-item${selectedUserEmail === user.email ? ' active' : ''}`}
                onClick={() => selectExistingUser(user)}
              >
                <div className="admin-access-list-head">
                  <strong>{user.email}</strong>
                  <span className={`admin-access-role-badge ${user.role}`}>
                    {roleLabel(user.role)}
                  </span>
                </div>
                <div className="admin-access-list-meta">
                  {usesDepartmentScopedBudgetAccess(user.role)
                    ? (user.departments.length > 0
                      ? `${formatBudgetDepartmentList(user.departments)}${user.budgetDefaultDepartment ? ` · default ${getBudgetDepartmentLabel(user.budgetDefaultDepartment)}` : ''}`
                      : 'No departments assigned')
                    : (user.role === 'budget_admin' ? 'All budget departments' : 'No department restrictions')}
                </div>
                <div className="admin-access-list-meta">
                  {user.aliases.length > 0 ? `Aliases: ${user.aliases.join(', ')}` : 'No aliases configured'}
                </div>
              </button>
            )) : (
              <div className="empty admin-access-empty">
                <div className="empty-icon">∅</div>
                <div>No users match this search.</div>
              </div>
            )}
          </div>
        </section>

        <section className="card admin-access-editor-card">
          <div className="section-header">
            <div>
              <div className="section-title">
                {selectedUserEmail === '__new__' ? 'Create User Access' : 'Edit User Access'}
              </div>
              <div className="card-sub">
                Admins see the full app. Budget admins get Budget Overview only, across All Departments and each individual department, and can import budgets. Restricted viewers only get Budget Overview for their assigned departments.
              </div>
            </div>
          </div>

          <div className="admin-access-form-grid">
            <label className="budget-import-field">
              <span className="budget-import-field-label">Canonical Email</span>
              <input
                className="fsearch admin-access-email-input"
                type="email"
                value={draft.email}
                onChange={(event) => updateDraft({ email: event.target.value })}
                placeholder="name@orca.so"
                disabled={selectedUserEmail !== '__new__'}
              />
            </label>

            <label className="budget-import-field">
              <span className="budget-import-field-label">Role</span>
              <select
                className="fsel"
                value={draft.role}
                onChange={(event) => updateDraft({ role: event.target.value as AccessRole })}
              >
                <option value="admin">Admin</option>
                <option value="budget_admin">Budget Admin</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
          </div>

          <label className="budget-import-field budget-import-field-wide">
            <span className="budget-import-field-label">Aliases</span>
            <textarea
              className="admin-access-textarea"
              value={draft.aliasesText}
              onChange={(event) => updateDraft({ aliasesText: event.target.value })}
              placeholder={'One alias per line\nname.alias@orca.so'}
            />
            <span className="card-sub">Use aliases when the same person may sign in with multiple @orca.so email addresses.</span>
          </label>

          <div className={`admin-access-restricted-section${usesDepartmentScopedBudgetAccess(draft.role) ? ' active' : ''}`}>
            <div className="section-header">
              <div>
                <div className="section-title">Budget Scope</div>
                <div className="card-sub">Choose every department this user can view, then select the default landing department.</div>
              </div>
            </div>

            <div className="admin-access-department-grid">
              {BUDGET_DEPTS.map((department) => {
                const checked = draft.departments.includes(department)
                return (
                  <label key={department} className={`admin-access-department-pill${checked ? ' selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!usesDepartmentScopedBudgetAccess(draft.role)}
                      onChange={() => toggleDepartment(department)}
                    />
                    <span>{getBudgetDepartmentLabel(department)}</span>
                  </label>
                )
              })}
            </div>

            <label className="budget-import-field admin-access-default-select">
              <span className="budget-import-field-label">Default Department</span>
              <select
                className="fsel"
                value={draft.budgetDefaultDepartment}
                disabled={!usesDepartmentScopedBudgetAccess(draft.role) || draft.departments.length === 0}
                onChange={(event) => updateDraft({ budgetDefaultDepartment: event.target.value })}
              >
                {draft.departments.length === 0 ? (
                  <option value="">Select departments first</option>
                ) : draft.departments.map((department) => (
                  <option key={department} value={department}>{getBudgetDepartmentLabel(department)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="admin-access-form-actions">
            <div className="card-sub">
              {selectedUser
                ? `Updated ${formatTimestamp(selectedUser.updatedAt)}`
                : 'Create the user, then add any aliases and budget departments they need.'}
            </div>
            <div className="admin-access-button-row">
              {showDraftValidationMessage ? (
                <div className="admin-access-inline-warning" role="alert">
                  {draftValidationMessage}
                </div>
              ) : null}
              {selectedUser ? (
                <button className="btn-secondary danger" type="button" disabled={deleteBusy} onClick={deleteUser}>
                  {deleteBusy ? 'Removing…' : 'Remove User'}
                </button>
              ) : null}
              <button className="btn-secondary" type="button" onClick={() => (
                selectedUser ? setDraft(createDraftFromUser(selectedUser)) : setDraft(EMPTY_DRAFT)
              )}>
                Reset
              </button>
              <button className="btn-primary" type="button" disabled={saveBusy || !!draftValidationMessage} onClick={saveUser}>
                {saveBusy ? 'Saving…' : (selectedUser ? 'Save Changes' : 'Create User')}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
