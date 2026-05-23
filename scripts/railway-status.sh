#!/usr/bin/env bash
#
# Railway deploy watchdog. Polls the most recent deployment status for a
# Railway service and exits non-zero if the latest deploy FAILED or
# CRASHED. Designed to be wrapped by Monitor / cron / a quick manual check.
#
# Setup (one-time):
#   1. Create a Railway API token: https://railway.app/account/tokens
#   2. Find your project + service IDs from the Railway dashboard URL
#      (https://railway.app/project/<PROJECT_ID>/service/<SERVICE_ID>)
#   3. Add to your shell rc (or .asc.env-style file):
#        export RAILWAY_TOKEN="..."
#        export RAILWAY_PROJECT_ID="..."
#        export RAILWAY_SERVICE_ID="..."
#        export RAILWAY_ENVIRONMENT_ID="..."  # optional; defaults to production
#
# Run:
#   bash scripts/railway-status.sh                     # one-shot status check
#   bash scripts/railway-status.sh --watch             # poll every 30s until status settles
#
# Exit codes:
#   0  latest deploy SUCCESS
#   1  latest deploy FAILED / CRASHED / REMOVED
#   2  config missing (env vars unset)
#   3  API error / rate limited

set -euo pipefail

: "${RAILWAY_TOKEN:?RAILWAY_TOKEN env var not set — see header for setup}"
: "${RAILWAY_PROJECT_ID:?RAILWAY_PROJECT_ID env var not set}"
: "${RAILWAY_SERVICE_ID:?RAILWAY_SERVICE_ID env var not set}"
ENVIRONMENT_ID="${RAILWAY_ENVIRONMENT_ID:-}"

API="https://backboard.railway.app/graphql/v2"

query() {
  cat <<GQL
query LatestDeploy(\$projectId: String!, \$serviceId: String!) {
  deployments(
    first: 1
    input: { projectId: \$projectId, serviceId: \$serviceId${ENVIRONMENT_ID:+, environmentId: "$ENVIRONMENT_ID"} }
  ) {
    edges {
      node {
        id
        status
        createdAt
        meta
        staticUrl
      }
    }
  }
}
GQL
}

check_once() {
  local body
  body=$(jq -n \
    --arg q "$(query)" \
    --arg pid "$RAILWAY_PROJECT_ID" \
    --arg sid "$RAILWAY_SERVICE_ID" \
    '{query: $q, variables: {projectId: $pid, serviceId: $sid}}')

  local resp
  resp=$(curl -sS -X POST "$API" \
    -H "Authorization: Bearer $RAILWAY_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" || { echo "API error"; exit 3; })

  local status created url
  status=$(echo "$resp" | jq -r '.data.deployments.edges[0].node.status // empty')
  created=$(echo "$resp" | jq -r '.data.deployments.edges[0].node.createdAt // empty')
  url=$(echo "$resp" | jq -r '.data.deployments.edges[0].node.staticUrl // empty')

  if [ -z "$status" ]; then
    echo "✗ No deployments found (or token lacks access)."
    echo "$resp" | jq . >&2
    exit 3
  fi

  printf "Latest deploy: %s · created %s%s\n" "$status" "$created" "${url:+ · $url}"

  case "$status" in
    SUCCESS) return 0 ;;
    BUILDING|DEPLOYING|QUEUED|INITIALIZING|WAITING) return 10 ;;   # in-flight
    *) return 1 ;;                                                  # FAILED, CRASHED, REMOVED, etc.
  esac
}

if [ "${1:-}" = "--watch" ]; then
  echo "→ Polling Railway every 30s until deploy settles (Ctrl+C to stop)…"
  while :; do
    check_once || rc=$?
    rc=${rc:-0}
    if [ "$rc" -ne 10 ]; then exit "$rc"; fi
    sleep 30
  done
else
  check_once
fi
