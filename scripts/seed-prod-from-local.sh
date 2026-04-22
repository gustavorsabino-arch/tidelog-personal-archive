#!/usr/bin/env bash
# One-shot: dump data from local Supabase and load into prod RDS.
#
# Prerequisites:
#   - RDS is terraform-applied and bootstrap.sql has been run (master user,
#     tidelog_app IAM user, app schema created).
#   - App tables exist in prod: run `MIGRATE_DATABASE_URL=... bun db:migrate`
#     against RDS BEFORE this script.
#   - Triggers applied: run `DATABASE_URL=... bun db:triggers` against RDS.
#
# Required env vars:
#   DATABASE_URL         local Supabase URL (password in URL)
#   DATABASE_URL_PROD    prod RDS URL for master user (no password in URL)
#   PGPASSWORD_PROD      prod master password
#
# Usage:
#   scripts/seed-prod-from-local.sh

set -euo pipefail

# Convenience: source .env.local if present
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local 2>/dev/null || true
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL required (local)}"
: "${DATABASE_URL_PROD:?DATABASE_URL_PROD required (prod RDS)}"
: "${PGPASSWORD_PROD:?PGPASSWORD_PROD required (prod master password)}"

command -v pg_dump >/dev/null || { echo "pg_dump not found in PATH"; exit 1; }
command -v psql    >/dev/null || { echo "psql not found in PATH"; exit 1; }

mask() { sed -E 's|(://[^:]+:)[^@]+(@)|\1***\2|' <<< "$1"; }

echo "Seeding prod RDS from local data."
echo "  FROM: $(mask "$DATABASE_URL")"
echo "  TO:   $(mask "$DATABASE_URL_PROD")"
echo
read -p "Type 'seed' to proceed: " CONFIRM
[[ "$CONFIRM" == "seed" ]] || { echo "Aborted."; exit 0; }

# Preflight: prod has the 20 app tables
TABLE_COUNT=$(PGPASSWORD="$PGPASSWORD_PROD" psql "$DATABASE_URL_PROD" -Atc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='app'")
if [[ "$TABLE_COUNT" != "20" ]]; then
  echo "ERROR: prod has $TABLE_COUNT tables in schema 'app', expected 20."
  echo "Run 'MIGRATE_DATABASE_URL=... bun db:migrate' against RDS first."
  exit 1
fi

# Preflight: prod is empty-ish
ROW_TOTAL=$(PGPASSWORD="$PGPASSWORD_PROD" psql "$DATABASE_URL_PROD" -Atc \
  "SELECT COALESCE(SUM(n_live_tup),0) FROM pg_stat_user_tables WHERE schemaname='app'")
if [[ "$ROW_TOTAL" -gt 0 ]]; then
  echo "WARNING: prod already has ~$ROW_TOTAL rows in app schema."
  echo "Unique/PK conflicts will abort the transaction."
  read -p "Continue anyway? Type 'yes' to proceed: " CONT
  [[ "$CONT" == "yes" ]] || { echo "Aborted."; exit 0; }
fi

echo "Dumping and restoring..."
# Filter SETs emitted by pg_dump 17+ that PG 15 doesn't recognize
# (e.g. transaction_timeout). Safe to drop — they're session defaults.
pg_dump \
  --data-only \
  --schema=app \
  --no-owner \
  --no-privileges \
  "$DATABASE_URL" \
  | sed -E '/^SET transaction_timeout/d' \
  | PGPASSWORD="$PGPASSWORD_PROD" psql \
    --single-transaction \
    -v ON_ERROR_STOP=1 \
    "$DATABASE_URL_PROD"

echo
echo "Refreshing row-count estimates..."
PGPASSWORD="$PGPASSWORD_PROD" psql "$DATABASE_URL_PROD" -c "ANALYZE" >/dev/null

echo
echo "Row counts in prod app schema:"
PGPASSWORD="$PGPASSWORD_PROD" psql "$DATABASE_URL_PROD" -c \
  "SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables WHERE schemaname='app' ORDER BY relname"
