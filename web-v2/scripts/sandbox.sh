#!/usr/bin/env bash
# Faff local sandbox · David's consequence-free playground (2026-06-10).
#
# Runs the web app against a LOCAL Postgres (faff_sandbox) instead of
# prod, with open signup ON so users can be mass-created without the
# invite dance. Real env vars OVERRIDE .env.local in Next.js, so the
# prod DATABASE_URL in .env.local is safely shadowed — nothing here
# touches production.
#
#   First time:  bash scripts/sandbox-setup.sh   (creates + seeds the DB)
#   Every time:  bash scripts/sandbox.sh         (starts on :3100)
#
# Sandbox admin login (seeded by setup): admin@faff.local / sandbox-admin
# Email is intentionally unconfigured here — temp passwords show in the
# /admin UI instead of sending.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/usr/local/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH"
export DATABASE_URL="postgresql://localhost:5432/faff_sandbox"
export DATABASE_URL_RO="$DATABASE_URL"
export ALLOW_OPEN_SIGNUP="true"
# Blank = invalid per the validator → no dev-David fallback · signed-out
# flows behave like prod.
export DEV_USER_UUID=""
# No RESEND_API_KEY on purpose · emailConfigured() false · zero sends.
export RESEND_API_KEY=""

echo "Faff sandbox → http://localhost:3100  (DB: faff_sandbox · open signup ON)"
exec npm run dev -- -p 3100
