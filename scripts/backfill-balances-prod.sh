#!/usr/bin/env bash
# Run scripts/backfill-balances.ts against production RDS.
#
# Pattern matches migrate-prod.sh / add-csv-wallets-prod.sh: sources
# .env.local, URL-encodes PGPASSWORD_PROD, sets DB_MODE=local +
# DATABASE_URL=$PROD_URL so the Drizzle client targets prod RDS.
#
# Resilience baked into the TS script:
#   - Per-wallet try/catch (one wallet erroring does not abort the run)
#   - Auto-skip wallets that already have pre-2026-04-21 snapshot rows
#     (safe to re-run; failed wallets can be retried via --wallet=<addr>)
#   - End-of-run summary lists every failed wallet + reason
#
# Usage:
#   scripts/backfill-balances-prod.sh                    # full sweep, prompts
#   scripts/backfill-balances-prod.sh --yes              # full sweep, no prompt
#   scripts/backfill-balances-prod.sh --wallet=<addr>    # single wallet
#   scripts/backfill-balances-prod.sh --dry-run          # no writes
#   scripts/backfill-balances-prod.sh --force            # re-process even if backfilled
#
# Any flag not handled here is passed through to the TS script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"

ASSUME_YES=0
PASSTHROUGH=()
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) PASSTHROUGH+=("$arg") ;;
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
: "${HELIUS_API_KEY:?HELIUS_API_KEY not set in .env.local}"

HOST="tidelog-db.crjxfhwlldui.us-east-1.rds.amazonaws.com"
PORT="5432"
DBNAME="tidelog"
USER="tidelog"

# URL-encode the password so special chars don't mangle the URL (project memory:
# PGPASSWORD_PROD has characters that break naive grep/sed extraction).
ENCODED_PW=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$PGPASSWORD_PROD")
PROD_URL="postgres://${USER}:${ENCODED_PW}@${HOST}:${PORT}/${DBNAME}?sslmode=require"

echo "===> Target: ${HOST}:${PORT}/${DBNAME} as ${USER}"
echo "===> Action: backfill app.balance_snapshot via Helius gTFA"
echo "===> Script args: ${PASSTHROUGH[*]:-(none)}"

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Proceed? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "aborted." >&2; exit 2 ;;
  esac
fi

cd "$PROJECT_ROOT"
# Conditional array expansion handles empty PASSTHROUGH under `set -u` —
# without this, `"${PASSTHROUGH[@]}"` errors out as "unbound variable" when
# the user passes no extra args.
DB_MODE=local DATABASE_URL="$PROD_URL" bun scripts/backfill-balances.ts ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
