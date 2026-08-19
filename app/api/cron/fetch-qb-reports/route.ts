import { runCron } from '@/lib/cron/runner'
import { fetchQbReportsJob } from '@/lib/cron/fetch-qb-reports'

// 800 is the Vercel Pro ceiling (the force-refresh route already runs at
// 800). At 300 the run was consistently wall-killed mid-way through the GL
// spec list: GL specs are ordered by account number, so accounts late in
// the list (70xxx/71xxx) never got their newer months cached and the P&L
// amount-drill showed stale/partial data for them.
export const maxDuration = 800

export async function GET(req: Request) {
  return runCron('fetch-qb-reports', req, fetchQbReportsJob)
}
