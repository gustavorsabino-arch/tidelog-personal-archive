#!/usr/bin/env bash
# Regenerate the treasury breakdown HTML and copy it into the v2 repo for
# deploy. Source script lives in /tmp/claude/treasury-breakdown.ts and uses
# its own on-disk cache (/tmp/claude/treasury-cache.json) for Helius / EVM
# calls, so subsequent runs are free.
#
# Usage:
#   scripts/refresh-report.sh           # uses cache (instant if fresh)
#   scripts/refresh-report.sh --refresh # forces live fetch from chains
#
# After this, commit app/reports/treasury-breakdown.html and push.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SRC="/tmp/claude/treasury-breakdown.ts"
DEST="$REPO_ROOT/app/reports/treasury-breakdown.html"

if [ ! -f "$SRC" ]; then
  echo "error: $SRC not found. Set up the treasury report script first." >&2
  exit 1
fi

cd /tmp/claude
bun "$SRC" "$@" > "$DEST"
echo "wrote $DEST ($(wc -c < "$DEST") bytes)"
