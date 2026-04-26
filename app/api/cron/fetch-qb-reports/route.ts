import { runCron } from '@/lib/cron/runner'
import { fetchQbReportsJob } from '@/lib/cron/fetch-qb-reports'

export const maxDuration = 300

export async function GET(req: Request) {
  return runCron('fetch-qb-reports', req, fetchQbReportsJob)
}
