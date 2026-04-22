import { runCron } from '@/lib/cron/runner'
import { fetchBalancesJob } from '@/lib/cron/fetch-balances'

export async function POST(req: Request) {
  return runCron('fetch-balances', req, fetchBalancesJob)
}
