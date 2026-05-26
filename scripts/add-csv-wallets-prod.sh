#!/usr/bin/env bash
# Insert the 21 CSV-only Opco wallets into production RDS.
#
# Same pattern as scripts/migrate-prod.sh: sources .env.local, URL-encodes
# PGPASSWORD_PROD so special chars don't mangle the URL, then runs the bun
# script with DB_MODE=local + a DATABASE_URL pointed at prod.
#
# Usage:
#   scripts/add-csv-wallets-prod.sh           # prompts for confirmation
#   scripts/add-csv-wallets-prod.sh --yes     # no prompt
#
# Exit codes:
#   0  success
#   1  missing .env.local or PGPASSWORD_PROD
#   2  user declined confirmation
#   3+ insert failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
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

HOST="tidelog-db.crjxfhwlldui.us-east-1.rds.amazonaws.com"
PORT="5432"
DBNAME="tidelog"
USER="tidelog"

ENCODED_PW=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$PGPASSWORD_PROD")
PROD_URL="postgres://${USER}:${ENCODED_PW}@${HOST}:${PORT}/${DBNAME}?sslmode=require"

echo "===> Target: ${HOST}:${PORT}/${DBNAME} as ${USER}"
echo "===> Action: insert 21 CSV-only Opco wallets (16 standard + 5 hidden)"

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Proceed? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "aborted." >&2; exit 2 ;;
  esac
fi

cd "$PROJECT_ROOT"
DB_MODE=local DATABASE_URL="$PROD_URL" bun scripts/add-csv-wallets.ts
