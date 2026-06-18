// Side-effect module — MUST be imported before any module that reads DB config
// (e.g. @/lib/db). When `--prod` is passed, remap the connection to the prod
// database. Bun auto-loads .env.local into process.env for `bun run`, so
// DATABASE_URL_PROD is already present; we just point DATABASE_URL at it and
// force DB_MODE=local. This keeps the prod URL out of shell history/args.
if (process.argv.includes('--prod')) {
  const prodUrl = process.env.DATABASE_URL_PROD
  if (!prodUrl) {
    throw new Error('--prod requires DATABASE_URL_PROD (set in .env.local, auto-loaded by Bun)')
  }
  process.env.DB_MODE = 'local'
  process.env.DATABASE_URL = prodUrl
  if (process.env.PGPASSWORD_PROD) process.env.PGPASSWORD = process.env.PGPASSWORD_PROD
  console.log('[--prod] targeting the production database (DATABASE_URL_PROD)')
}
