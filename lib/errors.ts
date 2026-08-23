/**
 * Extract a human-readable message from any thrown value.
 *
 * Route catch blocks that do `(err as Error).message` silently produce an
 * empty error body when the throw is a non-Error, or an AggregateError —
 * Node's driver-level connection failures (multiple resolved addresses)
 * arrive as AggregateError with message '' and the detail in `.errors`.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof AggregateError) {
    const first = err.errors?.[0]
    const inner = first instanceof Error ? first.message : first !== undefined ? String(first) : ''
    return err.message || inner || 'connection failure (AggregateError)'
  }
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code
    return err.message || code || err.name || 'unknown error'
  }
  if (err === null || err === undefined) return 'unknown error'
  return String(err)
}
