#!/usr/bin/env bash
# scripts/adaptation-real-replay/run.sh · replay the canonical Adaptation
# Engine against the owner's real training history.
#
# Reads `real-history.snapshot.json` and nothing else. It opens no database
# connection, so the production write barrier in `web-v2/lib/verify/` has
# nothing to refuse — which is the posture, not an accident: a proof that could
# write is not a proof anybody should run.
#
# Optional: REPLAY_LEDGER_OUT=<path> writes the full ledger as JSON.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$(cd "$HERE/../../web-v2" && pwd)"

cd "$WEB"
exec ./node_modules/.bin/vitest run --config "$HERE/vitest.config.ts" "$@"
