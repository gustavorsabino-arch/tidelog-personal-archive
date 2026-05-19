#!/usr/bin/env bash
# Apply pending Drizzle migrations to production RDS, then optionally run the
# orca-gains backfill.
#
# Uses credentials sourced from .env.local (PGPASSWORD_PROD); URL-encodes the
# password so values with special characters never break URL parsing.
#
# Usage:
#   scripts/migrate-prod.sh                    # migrations only, prompts to confirm
#   scripts/migrate-prod.sh --backfill         # migrations + orca-gains backfill
#   scripts/migrate-prod.sh --yes              # migrations only, no prompt
#   scripts/migrate-prod.sh --yes --backfill   # both, no prompt
#
# Exit codes:
#   0  success
#   1  missing .env.local or PGPASSWORD_PROD
#   2  user declined the confirmation prompt
#   3+ migration or backfill failure (forwarded from `bun run`)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"

ASSUME_YES=0
RUN_BACKFILL=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)        ASSUME_YES=1 ;;
    --backfill)      RUN_BACKFILL=1 ;;
    -h|--help)       sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PGPASSWORD_PROD:?PGPASSWORD_PROD not set in .env.local}"

# Production RDS coordinates — change here if rotated.
HOST="tidelog-db.crjxfhwlldui.us-east-1.rds.amazonaws.com"
PORT="5432"
DBNAME="tidelog"
USER="tidelog"

# URL-encode the password so special chars never mangle the URL.
ENCODED_PW=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$PGPASSWORD_PROD")
PROD_URL="postgres://${USER}:${ENCODED_PW}@${HOST}:${PORT}/${DBNAME}?sslmode=require"

echo "===> Target: ${HOST}:${PORT}/${DBNAME} as ${USER}"
echo "===> Steps: $([ $RUN_BACKFILL -eq 1 ] && echo 'migrate + backfill' || echo 'migrate only')"

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Proceed? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "aborted." >&2; exit 2 ;;
  esac
fi

cd "$PROJECT_ROOT"

echo
echo "===> [1/$([ $RUN_BACKFILL -eq 1 ] && echo 2 || echo 1)] Applying migrations..."
unset NODE_OPTIONS
MIGRATE_DATABASE_URL="$PROD_URL" bun run db:migrate

if [ "$RUN_BACKFILL" -eq 1 ]; then
  echo
  echo "===> [2/2] Running orca-gains backfill..."
  # DB_MODE=local = "use DATABASE_URL directly" (not IAM signing); not "localhost".
  # The backfill script will prompt with confirmDestructive because host is non-localhost.
  DB_MODE=local DATABASE_URL="$PROD_URL" bun run backfill:orca-gains
fi

echo
echo "===> done."
