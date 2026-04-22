import { runCron } from '@/lib/cron/runner'
import { pruneCacheJob } from '@/lib/cron/prune-cache'

export async function POST(req: Request) {
  return runCron('prune-cache', req, pruneCacheJob)
}
