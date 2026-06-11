#!/usr/bin/env bash
# Faff sandbox setup · run ONCE (re-run = wipe + rebuild, it asks first).
#
# 1. Creates local DB `faff_sandbox` (Postgres 17 via Homebrew).
# 2. Clones the PROD SCHEMA (structure only · read-only dump · no runner
#    data leaves prod).
# 3. Copies the GLOBAL reference tables the engine needs (workout_library,
#    learn_articles, course_library, niggle_recovery, sick_recovery) —
#    shared training knowledge, not user data.
# 4. Seeds a sandbox admin: admin@faff.local / sandbox-admin (is_admin,
#    onboarding complete) so /admin approve flows are testable.
#
# Prod credentials are read from web-v2/.env.local (the RO role for the
# dumps). Local DB runs on the default localhost:5432.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/usr/local/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH"
command -v pg_dump >/dev/null || { echo "postgresql@18 not installed (brew install postgresql@18)"; exit 1; }

RO_URL=$(grep '^DATABASE_URL_RO=' .env.local | cut -d= -f2-)
[ -n "$RO_URL" ] || { echo "DATABASE_URL_RO missing from .env.local"; exit 1; }

# Local server up?
pg_isready -h localhost -p 5432 >/dev/null 2>&1 || {
  echo "starting postgresql@18 via brew services…"
  brew services start postgresql@18
  for i in $(seq 1 20); do pg_isready -h localhost -p 5432 >/dev/null 2>&1 && break; sleep 1; done
}

if psql -h localhost -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw faff_sandbox; then
  read -r -p "faff_sandbox exists — wipe and rebuild? [y/N] " yn
  [ "${yn:-n}" = "y" ] || { echo "kept existing sandbox."; exit 0; }
  dropdb -h localhost faff_sandbox
fi
createdb -h localhost faff_sandbox

echo "→ cloning prod schema (structure only)…"
# --no-owner/--no-privileges: prod roles don't exist locally.
pg_dump "$RO_URL" --schema-only --no-owner --no-privileges \
  | psql -h localhost -q faff_sandbox

echo "→ copying global reference tables…"
# \copy streams, not pg_dump — the RO role can SELECT tables but not
# sequences, and --data-only insists on sequence state. setval afterward
# keeps local inserts from colliding with copied ids.
# (sick_recovery excluded · despite the name it FKs into sick_episodes —
#  per-user data, not global reference.)
for t in workout_library learn_articles course_library niggle_recovery; do
  if psql "$RO_URL" -c "\\copy $t TO STDOUT" 2>/dev/null \
      | psql -h localhost -q faff_sandbox -c "\\copy $t FROM STDIN"; then
    psql -h localhost -q faff_sandbox -c \
      "SELECT setval(pg_get_serial_sequence('$t','id'), COALESCE((SELECT MAX(id) FROM $t), 1))" \
      >/dev/null 2>&1 || true
    echo "   $t ✓"
  else
    echo "   (skipped $t)"
  fi
done

echo "→ seeding sandbox admin (admin@faff.local / sandbox-admin)…"
HASH=$(node -e "console.log(require('bcryptjs').hashSync('sandbox-admin', 10))")
psql -h localhost -q faff_sandbox <<SQL
INSERT INTO users (email, name, password_hash, email_verified_at, status, onboarding_complete, is_admin)
VALUES ('admin@faff.local', 'Sandbox Admin', '$HASH', NOW(), 'active', TRUE, TRUE);
INSERT INTO profile (user_id, user_uuid, full_name)
SELECT id::text, id, 'Sandbox Admin' FROM users WHERE email = 'admin@faff.local';
SQL

echo
echo "Sandbox ready. Start it:  bash scripts/sandbox.sh  → http://localhost:3100"
echo "Admin login: admin@faff.local / sandbox-admin · open signup is ON for everyone else."
