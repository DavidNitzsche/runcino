#!/bin/bash
# probe-run-ro.sh · run vitest with DATABASE_URL bound to the READ-ONLY role.
# vitest.setup.ts never overrides an already-set var, so this wins.
set -euo pipefail
cd "$(dirname "$0")/.."
DATABASE_URL="$(grep '^DATABASE_URL_RO=' .env.local | cut -d= -f2-)"
export DATABASE_URL
exec npx vitest run "$@"
