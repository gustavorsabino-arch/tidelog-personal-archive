export const CRON_HISTORY_START = '2026-01'

const FROM_RE = /^(\d{4})-(\d{2})$/

export type ParseSuccess = {
  ok: true
  name: string
  full: boolean
  force: boolean
  forceFrom: string | null
}

export type ParseFailure = { ok: false; error: string }

export type ParseResult = ParseSuccess | ParseFailure

export function parseCronArgs(argv: string[]): ParseResult {
  const args = argv.slice(2)
  const name = args[0]
  if (!name || name.startsWith('--')) {
    return { ok: false, error: 'missing job name' }
  }

  const full = args.includes('--full')
  const force = args.includes('--force')
  let forceFrom: string | null = null

  for (const arg of args) {
    if (!arg.startsWith('--from=')) continue
    const value = arg.slice('--from='.length)
    const match = FROM_RE.exec(value)
    if (!match) {
      return { ok: false, error: `--from must be YYYY-MM (got: ${value})` }
    }
    const month = Number(match[2])
    if (month < 1 || month > 12) {
      return { ok: false, error: `--from month must be 01-12 (got: ${value})` }
    }
    if (value < CRON_HISTORY_START) {
      return { ok: false, error: `--from must be >= ${CRON_HISTORY_START} (got: ${value})` }
    }
    forceFrom = value
  }

  if (forceFrom !== null && !force) {
    return { ok: false, error: '--from requires --force' }
  }

  return { ok: true, name, full, force, forceFrom }
}

export function looksLikeProd(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false
  try {
    const url = new URL(databaseUrl)
    const host = url.hostname
    return host !== '' && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1'
  } catch {
    return false
  }
}

export async function confirmDestructive(opts: {
  databaseUrl: string
  prefix: string
  describeAction: string
  confirmWord: string
}): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises')
  const host = new URL(opts.databaseUrl).hostname
  console.error(`${opts.prefix} TARGET: ${host}`)
  console.error(`${opts.prefix} ${opts.describeAction}`)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`Type '${opts.confirmWord}' to proceed: `)
    return answer.trim() === opts.confirmWord
  } finally {
    rl.close()
  }
}
