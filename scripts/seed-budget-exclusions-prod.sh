#!/usr/bin/env bash
# Run scripts/seed-budget-exclusions.ts against production RDS.
#
# Same pattern as scripts/add-csv-wallets-prod.sh: sources .env.local,
# URL-encodes PGPASSWORD_PROD, runs the bun script with DB_MODE=local +
# a DATABASE_URL pointed at prod.
#
# Usage:
#   scripts/seed-budget-exclusions-prod.sh <xlsx-path>           # prompts
#   scripts/seed-budget-exclusions-prod.sh <xlsx-path> --yes     # no prompt
#   scripts/seed-budget-exclusions-prod.sh <xlsx-path> --dry     # dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"

XLSX_PATH=""
ASSUME_YES=0
EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --dry)    EXTRA_ARGS+=("--dry") ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *)
      if [ -z "$XLSX_PATH" ]; then
        XLSX_PATH="$arg"
      else
        echo "unknown arg: $arg" >&2; exit 1
      fi
      ;;
  esac
done

if [ -z "$XLSX_PATH" ]; then
  echo "usage: scripts/seed-budget-exclusions-prod.sh <xlsx-path> [--yes] [--dry]" >&2
  exit 1
fi

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
echo "===> Action: seed budget exclusions from ${XLSX_PATH}"

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Proceed? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "aborted." >&2; exit 2 ;;
  esac
fi

cd "$PROJECT_ROOT"
DB_MODE=local DATABASE_URL="$PROD_URL" bun scripts/seed-budget-exclusions.ts "$XLSX_PATH" "${EXTRA_ARGS[@]:-}"
