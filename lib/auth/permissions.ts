export const PERMISSIONS = [
  'budget:read',
  'budget:write',
  'treasury:read',
  'qb:read',
  'qb:post',
  'admin:manage_users',
  'admin:manage_data',
  'admin:*',
] as const

export type Permission = typeof PERMISSIONS[number]
export type Role = 'admin' | 'budget_viewer'

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  admin: new Set<Permission>(PERMISSIONS),
  budget_viewer: new Set<Permission>(['budget:read']),
}

export function hasPermission(
  role: Role | string | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false
  const perms = ROLE_PERMISSIONS[role as Role]
  if (!perms) return false
  return perms.has(permission)
}
