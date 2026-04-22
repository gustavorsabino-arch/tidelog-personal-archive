import { runCron } from '@/lib/cron/runner'
import { refreshQbTokensJob } from '@/lib/cron/refresh-qb-tokens'

export async function POST(req: Request) {
  return runCron('refresh-qb-tokens', req, refreshQbTokensJob)
}
