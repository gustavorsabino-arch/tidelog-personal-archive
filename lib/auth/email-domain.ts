/**
 * App-level email-domain allowlist. Defense-in-depth against Cloudflare Access
 * policy drift — CF Access is the primary gate, this is a belt-and-suspenders
 * check before we ever touch the database.
 *
 * Env var: ALLOWED_EMAIL_DOMAINS — comma-separated list (e.g. "orca.so,partner.io").
 * Unset/empty disables the check (relies on CF Access only).
 */

export function parseAllowedDomains(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export function isEmailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const domain = email.slice(at + 1).toLowerCase()
  return allowedDomains.some(d => d.toLowerCase() === domain)
}
