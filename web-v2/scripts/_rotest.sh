#!/usr/bin/env bash
# Run vitest against the READ-ONLY production role.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
RO="$(grep '^DATABASE_URL_RO=' .env.local | cut -d= -f2- | tr -d '"')"
[ -n "$RO" ] || { echo "no DATABASE_URL_RO in .env.local" >&2; exit 1; }
DATABASE_URL="$RO" DATABASE_URL_RO="$RO" npx vitest run "$@"
