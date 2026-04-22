import { ENTITIES } from '@/lib/constants'

// DB stores entity_id lowercase ('opco', 'foundation', 'juku', 'zagreus',
// 'external'). UI code compares against the capitalized ENTITIES constant
// ('Opco', etc). These helpers translate at every boundary.

const DISPLAY_BY_LOWER = new Map<string, string>(ENTITIES.map((e) => [e.toLowerCase(), e]))

/** DB row → UI: `'opco'` → `'Opco'` (falls back to title-case for unknown ids). */
export function toDisplayEntity(id: string | null | undefined): string {
  if (!id) return ''
  const mapped = DISPLAY_BY_LOWER.get(id.toLowerCase())
  if (mapped) return mapped
  return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase()
}

/** UI filter → DB: `'Opco'` → `'opco'`. Identity for already-lowercase strings. */
export function toDbEntity(display: string | null | undefined): string {
  return (display ?? '').toLowerCase()
}
