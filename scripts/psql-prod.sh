#!/usr/bin/env bash
# Connect to production RDS via psql using credentials sourced from .env.local.
#
# Avoids manual quote-stripping of $PGPASSWORD_PROD that breaks on values with
# special characters. Uses `set -a; source; set +a` so whatever quoting style
# is in .env.local (single, double, none, escaped) is respected.
#
# Usage:
#   scripts/psql-prod.sh -c "SELECT 1;"
#   scripts/psql-prod.sh -c "\\d app.transaction_gain"
#   scripts/psql-prod.sh -f path/to/some.sql
#   scripts/psql-prod.sh                          # interactive shell
#
# Exits non-zero if .env.local is missing or PGPASSWORD_PROD is unset.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${PGPASSWORD_PROD:?PGPASSWORD_PROD not set in .env.local}"

# Production RDS — change here if host/db/user is ever rotated
HOST="tidelog-db.crjxfhwlldui.us-east-1.rds.amazonaws.com"
PORT="5432"
DBNAME="tidelog"
USER="tidelog"

PGPASSWORD="$PGPASSWORD_PROD" psql \
  "host=$HOST port=$PORT dbname=$DBNAME user=$USER sslmode=require" \
  "$@"
