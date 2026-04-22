// Applies post-migration SQL that cannot be expressed in Drizzle schema.
// Currently: append-only trigger on audit_log (rejects UPDATE and DELETE).
//
// Run after drizzle-kit migrate:
//   bun run db:triggers
//
// This is the ONE place in the codebase where hand-written SQL is permitted.

import postgres from 'postgres'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required')
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 })

try {
  await sql`
    CREATE OR REPLACE FUNCTION audit_log_no_mutate()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'audit_log is append-only';
    END;
    $$ LANGUAGE plpgsql;
  `

  await sql`DROP TRIGGER IF EXISTS audit_log_no_update ON app.audit_log`

  await sql`
    CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE OR DELETE ON app.audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_no_mutate()
  `

  console.log('triggers applied: audit_log is append-only')
} finally {
  await sql.end()
}
