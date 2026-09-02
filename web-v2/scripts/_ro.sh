#!/usr/bin/env bash
# Run a tsx script against the READ-ONLY production role.
# Never exports the writable DATABASE_URL.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
RO="$(grep '^DATABASE_URL_RO=' .env.local | cut -d= -f2- | tr -d '"')"
[ -n "$RO" ] || { echo "no DATABASE_URL_RO in .env.local" >&2; exit 1; }
DATABASE_URL="$RO" DATABASE_URL_RO="$RO" exec npx tsx "$@"
