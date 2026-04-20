import type {
  BudgetDepartmentActualScope,
  BudgetDepartmentViewScope,
} from './types.ts'

export type BudgetActualRequest =
  | {
      kind: 'overview'
      cacheKey: string
      requestKey: string
    }
  | {
      kind: 'department'
      cacheKey: string
      requestKey: string
      department: BudgetDepartmentActualScope
    }
  | {
      kind: 'headcount'
      cacheKey: string
      requestKey: string
    }

type BudgetActualRequestOptions = {
  activeDepartment: BudgetDepartmentViewScope | ''
  activeTab: string
  departmentCacheKey: string | null
  headcountCacheKey: string
  overviewCacheKey: string
  overviewDepartment: BudgetDepartmentActualScope | null
}

export function getBudgetActualRequest(options: BudgetActualRequestOptions): BudgetActualRequest | null {
  const {
    activeDepartment,
    activeTab,
    departmentCacheKey,
    headcountCacheKey,
    overviewCacheKey,
    overviewDepartment,
  } = options

  if (activeTab === 'headcount') {
    return {
      kind: 'headcount',
      cacheKey: headcountCacheKey,
      requestKey: `headcount:${headcountCacheKey}`,
    }
  }

  if (activeTab === 'overview') {
    if (overviewDepartment && departmentCacheKey) {
      return {
        kind: 'department',
        cacheKey: departmentCacheKey,
        requestKey: `department:${departmentCacheKey}`,
        department: overviewDepartment,
      }
    }

    return {
      kind: 'overview',
      cacheKey: overviewCacheKey,
      requestKey: `overview:${overviewCacheKey}`,
    }
  }

  if (activeTab !== 'departments' || !activeDepartment) {
    return null
  }

  if (activeDepartment === 'All') {
    return {
      kind: 'overview',
      cacheKey: overviewCacheKey,
      requestKey: `overview:${overviewCacheKey}`,
    }
  }

  if (!departmentCacheKey) return null
  return {
    kind: 'department',
    cacheKey: departmentCacheKey,
    requestKey: `department:${departmentCacheKey}`,
    department: activeDepartment,
  }
}
