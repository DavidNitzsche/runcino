#!/usr/bin/env bash
#
# check-deploy-status · answers "did main actually deploy" on demand, so it is
# never discovered opportunistically.
#
# NOT wired into web-v2/prebuild. This is the opposite direction from every
# other check-*.sh sibling: they run INSIDE the Railway build and stop a bad
# build from shipping. This one runs from an operator's own machine (it needs
# the `railway` CLI linked to the project) and answers the question a green
# prebuild cannot: whether the LAST push that claimed to be a fix actually
# reached production, or whether the pipeline has been silently failing since
# before that push ever landed.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS (F052, 2026-09-14)
#
# `main`'s prebuild chain failed 3 consecutive times (13:02, 13:17, 14:34
# local) on a pre-existing `check-coach-voice.sh` violation completely
# unrelated to any of the commits it was blocking. Nobody noticed until a
# push was independently checked against Railway's own deployment log,
# ~11 hours after the pipeline first broke. In that window 4 real commits —
# including F033's already-externally-confirmed fix — sat on `main`,
# undeployed, while every session that pushed them had no reason to believe
# otherwise: `git push` succeeding says the remote accepted the commit and
# nothing more (CLAUDE.md Rule 19's own words, written for exactly this).
#
# This script is the cheap, repeatable version of what caught it: check
# Railway directly, on demand, instead of waiting for someone to happen to
# look.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT CHECKS
#
#   1. The most recent deployment's status and commit SHA.
#   2. If it is not SUCCESS, walks backward through recent deployments to find
#      the last one that WAS, and reports every commit that has landed on
#      `main` since then and is still not live — by name, not just by count.
#   3. Exits non-zero when the most recent deployment did not succeed, so this
#      can be dropped into a manual check, a status report, or (later) its own
#      schedule without anyone having to read the output to know something is
#      wrong.
#
# WHAT IT CANNOT SEE (Rule 22 — say so, don't let a clean run overclaim)
#
#   · A deployment that is BUILDING right now reads as "not SUCCESS" the same
#     as a deployment that actually FAILED — this script does not wait or
#     poll. Re-run it once the build finishes for a real answer.
#   · Whether the runner's actual device has received what deployed — this is
#     Rule 19's "MERGED"/"DEPLOYED" facts, not its "SHIPPED" fact. A deploy
#     confirmed SUCCESS here still needs its own falsifier run against prod to
#     confirm behavior, same as always.
#   · Any environment other than the one `railway status` currently has
#     linked. Pass a different `-e`/`-s` to `railway` yourself if that's what
#     you need to check.
#
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if ! command -v railway >/dev/null 2>&1; then
  echo "check-deploy-status: SKIP · railway CLI not found on this machine" >&2
  exit 0
fi

cd "$(dirname "$0")/../web-v2"

JSON="$(railway deployment list --json --limit 20 2>/dev/null || true)"
if [ -z "$JSON" ]; then
  echo "check-deploy-status: FAIL · could not reach Railway (not linked, or no network) — this is a refusal, not a clean bill of health" >&2
  exit 1
fi

python3 - "$JSON" <<'PYEOF'
import json, sys, datetime

data = json.loads(sys.argv[1])
if not data:
    print("check-deploy-status: FAIL · Railway returned zero deployments — cannot be right, treat as a refusal")
    sys.exit(1)

latest = data[0]
status = latest.get("status")
sha = latest.get("meta", {}).get("commitHash") or latest.get("commitHash") or "unknown"
created = latest.get("createdAt", "unknown")

def age_str(iso):
    try:
        t = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        delta = datetime.datetime.now(datetime.timezone.utc) - t
        h = delta.total_seconds() / 3600
        return f"{h:.1f}h ago"
    except Exception:
        return "unknown age"

print(f"check-deploy-status · most recent deployment: {status} · commit {sha[:12]} · {created} ({age_str(created)})")

if status == "SUCCESS":
    print("check-deploy-status: OK · main is live at this commit")
    sys.exit(0)

if status == "BUILDING" or status == "QUEUED":
    print(f"check-deploy-status: PENDING · a build is in progress ({status}) — re-run once it finishes, this is not yet a verdict")
    sys.exit(1)

# status is FAILED, CRASHED, or something else non-SUCCESS: walk back to find
# the last real SUCCESS and report every commit stuck since then.
last_success = None
stuck_shas = [sha]
for d in data[1:]:
    s = d.get("status")
    csha = d.get("meta", {}).get("commitHash") or d.get("commitHash") or "unknown"
    if s == "SUCCESS":
        last_success = d
        break
    stuck_shas.append(csha)

print(f"check-deploy-status: FAIL · the last {len(stuck_shas)} deployment attempt(s) did not succeed")
if last_success:
    ls_sha = last_success.get("meta", {}).get("commitHash") or last_success.get("commitHash") or "unknown"
    ls_created = last_success.get("createdAt", "unknown")
    print(f"  last confirmed SUCCESS: commit {ls_sha[:12]} · {ls_created} ({age_str(ls_created)})")
    print(f"  commits attempted since then, none live: {', '.join(s[:12] for s in stuck_shas)}")
    print(f"  run: git log --oneline {ls_sha[:12]}..HEAD   to see what they actually are")
else:
    print("  no SUCCESS found in the last 20 deployments — widen the search (--limit) or check further back by hand")

sys.exit(1)
PYEOF
