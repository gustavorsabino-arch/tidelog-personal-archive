import { runCron } from '@/lib/cron/runner'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'

export const maxDuration = 300

export async function GET(req: Request) {
  return runCron('fetch-transactions', req, fetchTransactionsJob)
}
