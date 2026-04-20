import { createAdminClient } from '@/lib/supabase/admin'
import type { AccessMeResponse, AccessRow, LoadedAccessConfig } from '@/lib/access-model'
import { resolveAccessUser } from '@/lib/access-model'
import { loadAccessConfigByEmailWithClient } from '@/lib/access-store'

type AccessLookupOptions = {
  year?: number | null
}

export async function loadAccessConfigByEmail(
  email: string,
  options: AccessLookupOptions = {},
): Promise<LoadedAccessConfig | null> {
  const supabase = createAdminClient()
  return loadAccessConfigByEmailWithClient(supabase, email, options)
}

export async function loadAccessRowByEmail(email: string): Promise<AccessRow | null> {
  const config = await loadAccessConfigByEmail(email)
  return config?.row ?? null
}

export async function getAccessForEmail(
  email: string,
  options: AccessLookupOptions = {},
): Promise<AccessMeResponse | null> {
  const config = await loadAccessConfigByEmail(email, options)
  return resolveAccessUser(config, email)
}
export {
  canAccessBudgetTab,
  canImportBudget,
  canManageBudgetTeam,
  canViewBudgetOverviewAllDepartments,
  canViewBudgetDepartment,
  getAllowedBudgetEntities,
  getAllowedBudgetDepartments,
  getAllowedBudgetMonthIndices,
  getAllowedBudgetViewModes,
  getBudgetViewRestrictions,
  getAllowedPages,
  getDefaultBudgetDepartment,
  getVisibleBudgetTabs,
  hasBudgetPageAccess,
  hasFullBudgetDepartmentAccess,
  isBudgetOnlyUser,
  resolveAccessUser,
} from '@/lib/access-model'
export type { AccessMeResponse, AccessPermissions, AccessRole, AccessRow, LoadedAccessConfig } from '@/lib/access-model'
