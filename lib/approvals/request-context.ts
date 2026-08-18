/**
 * SOX request-context capture for the Approvals feature.
 *
 * On Vercel, `x-forwarded-for` is written by the platform proxy with the
 * verified client IP as the FIRST entry — it cannot be client-spoofed.
 * In cf-access mode Cloudflare appends but the first hop is still the
 * client. `user-agent` is self-reported by the browser (fine for SOX
 * device-fingerprint purposes — auditors expect best-effort UA capture).
 */
export type SoxRequestContext = {
  ip: string | null
  userAgent: string | null
}

export function getSoxRequestContext(req: Request): SoxRequestContext {
  const xff = req.headers.get('x-forwarded-for')
  const ip = xff ? xff.split(',')[0].trim() : (req.headers.get('x-real-ip') ?? null)
  const userAgent = req.headers.get('user-agent')
  return { ip: ip || null, userAgent: userAgent || null }
}
