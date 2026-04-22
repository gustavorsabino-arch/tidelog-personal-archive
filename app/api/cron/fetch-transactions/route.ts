import { runCron } from '@/lib/cron/runner'
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'

export async function POST(req: Request) {
  return runCron('fetch-transactions', req, fetchTransactionsJob)
}
