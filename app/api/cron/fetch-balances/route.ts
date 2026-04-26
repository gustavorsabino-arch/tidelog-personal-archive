import { runCron } from '@/lib/cron/runner'
import { fetchBalancesJob } from '@/lib/cron/fetch-balances'

export const maxDuration = 300

export async function GET(req: Request) {
  return runCron('fetch-balances', req, fetchBalancesJob)
}
