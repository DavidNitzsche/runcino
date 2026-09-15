#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-no-storm-regression.sh · BA-01, ASAP-IMPLEMENTATION-SEQUENCE.md ·
# required test #7: "A source-level gate rejects reintroduction of
# prefetchAround or overlapping week fetches into Today launch/retry paths."
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
#
# David's real-device trace, 2026-09-15: a simultaneous batch of
# /api/v5/today, /api/v5/block, /api/v5/races, and /api/v5/plan-snapshot all
# timed out together, plus eight separate /api/v5/today?date=... calls and
# three /api/plan/week?date=... calls in one session. Root cause, confirmed
# by direct code reading: TodayHostV5's own launch `.task` was calling
# `blockSurface.load()` + `prefetchAround` + `fetchAndCacheWeek` on every
# single launch, and `goTo` (which `retryPending` also calls into) was firing
# an unconditional `prefetchAround` on every navigation to a date outside the
# current snapshot block — three independent eager-load paths, uncoordinated,
# each capable of firing again on its own trigger.
#
# The fix removed all of these call sites. This script is what stops them
# quietly coming back — a future edit that re-adds
# `await prefetchAround(...)` to "just warm the cache a little" inside the
# launch task or `goTo` would look completely reasonable in review and would
# silently reproduce the exact incident this fix exists to close. Per Rule 18
# ("a gate is not trusted until it has been made to fail"), this check IS its
# own test: run it against the pre-fix commit (or manually reintroduce either
# call) and confirm it fails before trusting it to guard anything.
#
# ── WHAT THIS CANNOT CATCH ──────────────────────────────────────────────────
# This is a text-pattern scan, not a data-flow analysis. It cannot see a
# `prefetchAround` call reintroduced through a renamed wrapper function, or a
# semantically-equivalent new fan-out helper written from scratch with a
# different name. It catches the literal regression (the exact call sites
# coming back), not every possible future variant of the same mistake.
#
# ── GUARD 3, ADDED 2026-09-15 (BA-01-9) ──────────────────────────────────────
# David's ruling on build 303's physical-device acceptance test failure named
# "the server deadline envelope below the phone's 12-second timeout" as a
# missing BA-01 requirement (ASAP-IMPLEMENTATION-SEQUENCE.md item 9). Found:
# `web-v2/app/api/v5/races/route.ts` awaited `resolveRaceOutlookBySlug`
# directly with only a `.catch(() => null)` — no time bound — while
# `web-v2/lib/plan/plan-snapshot.ts` wraps the SAME, single-flighted,
# occasionally-slow resolution in `withDeadline(..., RACE_PROJECTION_DEADLINE_MS)`.
# An unbounded caller can hold a response open until the PHONE's own timeout
# gives up, which is exactly the shape confirmed live: /api/v5/races timing
# out at 12060ms with zero server-side request_failures row (the server never
# decided anything — it was still waiting). This guard is server-side
# (TypeScript), not native, but lives in the same script per the explicit
# instruction to wire it into the release gate — one storm-regression gate,
# not two to keep in step.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOSTS_FILE="$ROOT/native-v2/Faff/Faff/ViewsV5/HostsV5.swift"
RACES_ROUTE_FILE="$ROOT/web-v2/app/api/v5/races/route.ts"

if [ ! -f "$HOSTS_FILE" ]; then
  echo "check-no-storm-regression: FAIL · $HOSTS_FILE not found — cannot be a clean bill of health, treat as a refusal" >&2
  exit 1
fi
if [ ! -f "$RACES_ROUTE_FILE" ]; then
  echo "check-no-storm-regression: FAIL · $RACES_ROUTE_FILE not found — cannot be a clean bill of health, treat as a refusal" >&2
  exit 1
fi

FAIL=0

# ── Guard 1: the launch .task must not call blockSurface.load(),
# prefetchAround, or fetchAndCacheWeek. Scoped to the specific .task block
# (TODAYPERSIST-1's own comment marks its start) rather than the whole file,
# since prefetchAround's own definition legitimately mentions its own name,
# and fetchAndCacheWeek is legitimately called elsewhere (goTo's own
# cache-miss fallback for an uncovered date — see BA01-1's own comment for
# why that ONE remaining call site is intentional, not a regression).
LAUNCH_TASK_START=$(grep -n "TODAYPERSIST-1 · disk-only, synchronous" "$HOSTS_FILE" | head -1 | cut -d: -f1)
LAUNCH_TASK_END=$(grep -n "Learn the real today the instant any payload actually carries it" "$HOSTS_FILE" | head -1 | cut -d: -f1)

if [ -z "$LAUNCH_TASK_START" ] || [ -z "$LAUNCH_TASK_END" ]; then
  echo "check-no-storm-regression: FAIL · could not locate the launch .task block by its own anchor comments — the anchors themselves may have moved; update this script's anchors rather than assume clean" >&2
  exit 1
fi

LAUNCH_TASK_BODY=$(sed -n "${LAUNCH_TASK_START},${LAUNCH_TASK_END}p" "$HOSTS_FILE")

if echo "$LAUNCH_TASK_BODY" | grep -qE "await blockSurface\.load\(\)"; then
  echo "check-no-storm-regression: FAIL · blockSurface.load() has been reintroduced into the launch .task — this is exactly the F166/BA-01 incident shape (Block loading eagerly and concurrently with Today on every launch)" >&2
  FAIL=1
fi
if echo "$LAUNCH_TASK_BODY" | grep -qE "await prefetchAround\("; then
  echo "check-no-storm-regression: FAIL · prefetchAround(...) has been reintroduced into the launch .task" >&2
  FAIL=1
fi
if echo "$LAUNCH_TASK_BODY" | grep -qE "await fetchAndCacheWeek\("; then
  echo "check-no-storm-regression: FAIL · fetchAndCacheWeek(...) has been reintroduced into the launch .task" >&2
  FAIL=1
fi

# ── Guard 2: `goTo` (and therefore `retryPending`, which calls into it) must
# never call `prefetchAround`. Confirmed zero remaining CALL sites as of the
# BA-01 fix (the function's own definition line legitimately still exists,
# kept as dead code pending cleanup — excluded here on purpose, this guards
# against a CALL reappearing, not the definition existing).
TOTAL_MENTIONS=$(grep -cE "prefetchAround\(" "$HOSTS_FILE" || true)
DEFINITION_MENTIONS=$(grep -cE "func prefetchAround\(" "$HOSTS_FILE" || true)
if [ "$TOTAL_MENTIONS" -gt "$DEFINITION_MENTIONS" ]; then
  echo "check-no-storm-regression: FAIL · prefetchAround(...) is called somewhere in HostsV5.swift ($TOTAL_MENTIONS mention(s), $DEFINITION_MENTIONS of them the definition itself) — it should have ZERO call sites after BA-01 (the function itself is dead code, kept only pending a follow-up cleanup; a real CALL to it anywhere is the regression this guards against)" >&2
  FAIL=1
fi

# ── Guard 3: /api/v5/races's call to `resolveRaceOutlookBySlug` must be
# wrapped in `withDeadline`, never awaited bare. A bare `await
# resolveRaceOutlookBySlug(...)` line (regardless of a trailing `.catch()`,
# which bounds ERRORS, not TIME) is the exact regression — it has no time
# bound at all, so a slow resolution blocks the whole response until the
# phone's own client timeout gives up.
RACES_CALL_LINE=$(grep -n "resolveRaceOutlookBySlug(" "$RACES_ROUTE_FILE" | head -1)
if [ -z "$RACES_CALL_LINE" ]; then
  echo "check-no-storm-regression: FAIL · could not find any resolveRaceOutlookBySlug( call in $RACES_ROUTE_FILE — the anchor this guard depends on has moved; update the guard rather than assume clean" >&2
  FAIL=1
elif echo "$RACES_CALL_LINE" | grep -qE "await resolveRaceOutlookBySlug\("; then
  echo "check-no-storm-regression: FAIL · $RACES_ROUTE_FILE awaits resolveRaceOutlookBySlug(...) directly, with no withDeadline(...) wrapper — this is the BA-01-9 regression: a slow resolution here has no time bound and can hold the whole /api/v5/races response open until the phone's own 12-13s client timeout gives up" >&2
  FAIL=1
elif ! echo "$RACES_CALL_LINE" | grep -qE "withDeadline\(resolveRaceOutlookBySlug\("; then
  echo "check-no-storm-regression: FAIL · $RACES_ROUTE_FILE's call to resolveRaceOutlookBySlug(...) is not wrapped in withDeadline(...) as expected — the call site's shape has changed in a way this guard does not recognise; update the guard rather than assume clean" >&2
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "check-no-storm-regression: OK · no launch-task, goTo/Retry prefetch-storm, or unbounded races-outlook regression found"
  exit 0
else
  exit 1
fi
