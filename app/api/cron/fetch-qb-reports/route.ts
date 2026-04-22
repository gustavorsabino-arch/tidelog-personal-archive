import { runCron } from '@/lib/cron/runner'
import { fetchQbReportsJob } from '@/lib/cron/fetch-qb-reports'

export async function POST(req: Request) {
  return runCron('fetch-qb-reports', req, fetchQbReportsJob)
}
