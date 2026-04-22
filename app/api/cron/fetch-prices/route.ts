import { runCron } from '@/lib/cron/runner'
import { fetchPricesJob } from '@/lib/cron/fetch-prices'

export async function POST(req: Request) {
  return runCron('fetch-prices', req, fetchPricesJob)
}
