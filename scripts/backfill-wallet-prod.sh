#!/usr/bin/env bash
# Run a per-wallet backfill (txs + balances) against production RDS.
#
# Sources .env.local for PGPASSWORD_PROD, builds the PROD_URL the same way
# scripts/migrate-prod.sh does, bumps Helius rate limits for Pro-tier
# throughput, and runs fetchTransactionsJob({ full: true, walletAddr })
# followed by fetchBalancesJob({ walletAddr }). On combined success, clears
# needs_backfill and stamps last_full_backfill_at via direct UPDATE.
#
# Usage:
#   scripts/backfill-wallet-prod.sh <address>           # prompts to confirm
#   scripts/backfill-wallet-prod.sh <address> --yes     # no prompt

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"

ASSUME_YES=0
WALLET_ADDR=""
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *)
      if [ -z "$WALLET_ADDR" ]; then
        WALLET_ADDR="$arg"
      else
        echo "unknown arg: $arg" >&2; exit 1
      fi
      ;;
  esac
done

if [ -z "$WALLET_ADDR" ]; then
  echo "usage: scripts/backfill-wallet-prod.sh <address> [--yes]" >&2
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
echo "===> Action: full backfill (txs + balances) for ${WALLET_ADDR}"
echo "===> Helius rate limit override: HELIUS_RPS=40 HELIUS_ENHANCED_RPS=20"

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Proceed? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "aborted." >&2; exit 2 ;;
  esac
fi

cd "$PROJECT_ROOT"

# Run tx job + balance job + clear needs_backfill via one bun -e script.
DB_MODE=local DATABASE_URL="$PROD_URL" HELIUS_RPS=40 HELIUS_ENHANCED_RPS=20 \
  bun -e "
import { fetchTransactionsJob } from '@/lib/cron/fetch-transactions'
import { fetchBalancesJob } from '@/lib/cron/fetch-balances'
import { db } from '@/lib/db'
import { wallet } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const addr = '$WALLET_ADDR'
console.log('[backfill] tx job for', addr)
const txResult = await fetchTransactionsJob({ full: true, walletAddr: addr })
console.log('[backfill] tx job done:', JSON.stringify(txResult))
console.log('[backfill] balance job for', addr)
const balResult = await fetchBalancesJob({ walletAddr: addr })
console.log('[backfill] balance job done:', JSON.stringify(balResult))
await db.update(wallet)
  .set({ needsBackfill: false, lastFullBackfillAt: new Date(), updatedAt: new Date() })
  .where(eq(wallet.address, addr))
console.log('[backfill] cleared needs_backfill for', addr)
process.exit(0)
"
