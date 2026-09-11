#!/usr/bin/env bash
# scripts/check-build-ledger.sh · Rule 18 falsifier for the TestFlight build ledger
# ─────────────────────────────────────────────────────────────────────────────
# Exercises web-v2/scripts/_build_ledger.mjs against a SCRATCH ledger
# (BUILD_LEDGER_PATH under mktemp) for every offline command — record,
# sha-for, latest, list, contains — so this never touches the real committed
# docs/testflight-builds.jsonl. `verify` is exercised twice: once against a
# SCRATCH ledger with deliberately WRONG data (must FAIL and name why), and
# once against the real ledger's real build-290 entry (must find it clean) —
# the live App Store Connect calls this makes are read-only GETs, the same
# operation `web-v2/scripts/_asc_max_build.mjs` already performs routinely as
# a sanctioned diagnostic (CLAUDE.md "Operational tasks · self-execute": read-
# only admin/diagnostic endpoints the agent built run without asking first).
#
# WHAT THIS CANNOT FAIL ON (Rule 22): it cannot verify the SHA field itself
# against ASC, because ASC's API has no git-SHA field to compare against —
# `verify`'s own docstring says this and this test does not pretend otherwise.
# It also cannot exercise `verify` against a network outage in this run
# (that path is exercised via the "no ASC_ENV_PATH" case only, not a
# simulated timeout).
#
# Usage: bash scripts/check-build-ledger.sh
# Exit 0 = every case behaved as asserted. Exit 1 = at least one did not.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/.." && pwd))"
LEDGER="$(mktemp -d /tmp/faff-ledger-test.XXXXXX)/testflight-builds.jsonl"
export BUILD_LEDGER_PATH="$LEDGER"
trap 'rm -rf "$(dirname "$LEDGER")"' EXIT

PASS=0
FAIL=0
assert() {
  local desc="$1" ok="$2"
  if [ "$ok" = "1" ]; then echo "  PASS · $desc"; PASS=$((PASS + 1))
  else echo "  FAIL · $desc"; FAIL=$((FAIL + 1)); fi
}
node() { command node "$ROOT/web-v2/scripts/_build_ledger.mjs" "$@"; }

# Real, distinct commits from this repo so `record`/`contains` exercise real
# `git cat-file -e` / `merge-base --is-ancestor` paths, not fabricated hex.
SHA_HEAD="$(git rev-parse HEAD)"
SHA_PARENT="$(git rev-parse HEAD~1)"
SHA_GRANDPARENT="$(git rev-parse HEAD~2 2>/dev/null || echo "$SHA_PARENT")"
# The OLDEST commit reachable from HEAD — used to trigger the "predates the
# upload by a wide margin" plausibility warning (CASE 12). Found by walking
# history rather than a fixed hardcoded SHA, so this keeps working regardless
# of how long the repo's history is; paired against "now" as the uploaded_at,
# the gap is however old the repo is, always comfortably past the 14-day
# tolerance for a "live" entry.
SHA_OLD="$(git rev-list --max-parents=0 HEAD | tail -1)"

echo "── CASE 1 · sha-for on an empty ledger is a clean 'not found', not a crash ──"
if node sha-for 290 >/tmp/faff-ledger-t1.$$ 2>&1; then
  assert "sha-for on empty ledger exits non-zero" 0
else
  assert "sha-for on empty ledger exits non-zero" 1
  if grep -q "no ledger entry" /tmp/faff-ledger-t1.$$; then
    assert "  (message names the 'no ledger entry' reason)" 1
  else
    assert "  (message names the 'no ledger entry' reason)" 0
  fi
fi
rm -f /tmp/faff-ledger-t1.$$

echo "── CASE 2 · record then sha-for round-trips the exact SHA ─────────────────"
node record --build 501 --sha "$SHA_HEAD" --branch test --note "falsifier CASE 2" >/dev/null
got="$(node sha-for 501 2>/dev/null)"
assert "sha-for returns exactly what was recorded" "$([ "$got" = "$SHA_HEAD" ] && echo 1 || echo 0)"

echo "── CASE 3 · record refuses a build number that isn't a positive integer ───"
if node record --build notanumber --sha "$SHA_HEAD" >/dev/null 2>&1; then
  assert "record refuses a non-integer build number" 0
else
  assert "record refuses a non-integer build number" 1
fi

echo "── CASE 4 · record refuses a SHA that does not resolve in this repo ───────"
if node record --build 502 --sha 0000000000000000000000000000000000dead >/dev/null 2>&1; then
  assert "record refuses an unresolvable SHA" 0
else
  assert "record refuses an unresolvable SHA" 1
fi

echo "── CASE 5 · latest returns the HIGHEST build number, not the last appended ─"
node record --build 495 --sha "$SHA_PARENT" --note "recorded AFTER 501 but a LOWER number, out of order on purpose" >/dev/null
latest_json="$(node latest 2>/dev/null)"
latest_build="$(command node -e "console.log(JSON.parse(process.argv[1]).build)" "$latest_json" 2>/dev/null)"
assert "latest picks build 501 (max), not build 495 (last appended)" "$([ "$latest_build" = "501" ] && echo 1 || echo 0)"

echo "── CASE 6 · a malformed line is skipped and reported, not treated as empty ─"
printf '%s\n' 'not even json' >> "$LEDGER"
node record --build 503 --sha "$SHA_GRANDPARENT" --note "after a corrupt line" >/dev/null
if node sha-for 501 >/tmp/faff-ledger-t6.$$ 2>&1; then
  ok=1
else
  ok=0
fi
assert "a bad line elsewhere in the file does not break lookups of good entries" "$ok"
rm -f /tmp/faff-ledger-t6.$$

echo "── CASE 7 · contains: TRUE when the ref is really an ancestor of the build's SHA ──"
# build 501 = SHA_HEAD; HEAD~1 is trivially its ancestor.
if node contains --build 501 --ref "$SHA_PARENT" >/dev/null 2>&1; then
  assert "contains reports YES for a real ancestor" 1
else
  assert "contains reports YES for a real ancestor" 0
fi

echo "── CASE 8 · contains: FALSE when the ref is NOT an ancestor (descendant, not ancestor) ──"
# build 495 = SHA_PARENT (HEAD~1). HEAD is a DESCENDANT of HEAD~1, not an
# ancestor of it, so "does build 495 contain HEAD" must be NO.
if node contains --build 495 --ref "$SHA_HEAD" >/dev/null 2>&1; then
  assert "contains correctly reports NO for a non-ancestor (a descendant)" 0
else
  assert "contains correctly reports NO for a non-ancestor (a descendant)" 1
fi

echo ""
echo "── CASE 9 · verify CATCHES drift: a phantom build number ASC has never seen ──"
node record --build 999999 --sha "$SHA_HEAD" --recorded reconstructed --note "deliberately phantom for CASE 9" >/dev/null
if node verify 999999 >/tmp/faff-ledger-t9.$$ 2>&1; then
  cat /tmp/faff-ledger-t9.$$
  assert "verify FAILS (non-zero) for a build ASC has never heard of" 0
else
  rc9=$?
  if [ "$rc9" = "3" ]; then
    echo "  (verify exited UNRUNNABLE — no ASC credentials reachable here; skipping this case's assertion)"
  else
    assert "verify FAILS (non-zero) for a build ASC has never heard of" 1
    if grep -qi "no build numbered" /tmp/faff-ledger-t9.$$; then
      assert "  (message identifies the phantom build)" 1
    else
      assert "  (message identifies the phantom build)" 0
    fi
  fi
fi
rm -f /tmp/faff-ledger-t9.$$

echo ""
echo "── CASE 10 · verify PASSES clean against the REAL committed ledger's real build-290 entry ──"
real_out="$(BUILD_LEDGER_PATH="$ROOT/docs/testflight-builds.jsonl" node verify 290 2>&1)"
real_rc=$?
if [ "$real_rc" = "3" ]; then
  echo "  (verify exited UNRUNNABLE — no ASC credentials reachable here; skipping this case's assertion)"
  echo "$real_out" | sed 's/^/    /'
elif [ "$real_rc" = "0" ]; then
  assert "verify against the real ledger's build-290 entry is clean" 1
else
  echo "$real_out" | sed 's/^/    /'
  assert "verify against the real ledger's build-290 entry is clean" 0
fi

echo ""
echo "── CASE 11 · the SHA-NOT-VERIFIED disclosure is on EVERY invocation, pass or fail ──"
# The independent review's Defect 3: `verify` disclosed "ASC has no git-SHA
# field" only inside the CLEAN (OK) branch. A build with real findings (a
# phantom build number, say) printed no disclosure at all — the one case
# where a reader most needs to be reminded the sha itself was never checked.
# CASE 9 above already produced a FAILING verify (phantom build 999999); CASE
# 10 already produced a PASSING one (real build 290). Re-check both outputs
# here for the mandatory line rather than re-running the network calls.
if [ "${real_rc:-}" = "3" ]; then
  echo "  (verify exited UNRUNNABLE earlier — no ASC credentials reachable here; skipping CASE 11)"
else
  node record --build 999998 --sha "$SHA_HEAD" --recorded reconstructed --note "CASE 11 phantom, disclosure-on-failure check" >/dev/null
  fail_out="$(node verify 999998 2>&1)"
  fail_rc=$?
  if [ "$fail_rc" = "3" ]; then
    echo "  (verify exited UNRUNNABLE — no ASC credentials reachable here; skipping this case's assertion)"
  else
    assert "verify on a FAILING (phantom-build) case still exits non-zero" "$([ "$fail_rc" != "0" ] && echo 1 || echo 0)"
    printf '%s' "$fail_out" | grep -q "SHA NOT INDEPENDENTLY VERIFIED"
    assert "  disclosure line is present even though this run FAILS (was previously OK-branch-only)" "$([ "$?" = "0" ] && echo 1 || echo 0)"
  fi

  pass_out="$(BUILD_LEDGER_PATH="$ROOT/docs/testflight-builds.jsonl" node verify 290 2>&1)"
  pass_rc=$?
  if [ "$pass_rc" = "3" ]; then
    echo "  (verify exited UNRUNNABLE — no ASC credentials reachable here; skipping this case's assertion)"
  else
    printf '%s' "$pass_out" | grep -q "SHA NOT INDEPENDENTLY VERIFIED"
    assert "disclosure line is ALSO present on a clean/PASSING run (unmissable either way)" "$([ "$?" = "0" ] && echo 1 || echo 0)"
  fi
fi

echo ""
echo "── CASE 12 · indirect SHA plausibility: a WARNING, distinct from PASS/FAIL ─"
# ASC genuinely has no git-SHA field (the review confirmed this is a real,
# disclosed limitation, not a hidden lie) — this does not try to make verify
# CONFIRM a sha. It checks the one indirect signal that IS available: does the
# recorded sha's own commit timestamp fall in a sane window next to the
# recorded upload time. Neither branch below is a PASS/FAIL finding; both are
# WARNING-only, and the exit code must not move because of them.
if [ "${real_rc:-}" = "3" ] || [ -z "$SHA_OLD" ]; then
  echo "  (skipping CASE 12 — no ASC credentials reachable here, or no root commit found)"
else
  # Each sub-case below gets its OWN fresh, single-entry scratch ledger. The
  # shared $LEDGER used everywhere else in this file already carries CASE 9's
  # phantom build 999999 (and others) by this point, and verify's ledger-vs-
  # ASC-max cross-check compares the LEDGER'S OWN highest build against ASC's
  # — reusing the shared, already-polluted ledger here would make 12b's "must
  # still report OK" assertion fail for a reason that has nothing to do with
  # the plausibility check this case exists to test.

  # 12a · commit dated AFTER the recorded upload — a build cannot ship code
  # that does not exist yet. Force this deterministically with an
  # impossibly-early --uploaded-at, rather than hoping for a race.
  LEDGER_12A="$(mktemp -d /tmp/faff-ledger-test.XXXXXX)/testflight-builds.jsonl"
  BUILD_LEDGER_PATH="$LEDGER_12A" node record --build 999997 --sha "$SHA_HEAD" --recorded reconstructed --uploaded-at "2000-01-01T00:00:00Z" --note "CASE 12a future-commit-vs-upload" >/dev/null
  future_out="$(BUILD_LEDGER_PATH="$LEDGER_12A" node verify 999997 2>&1)"
  printf '%s' "$future_out" | grep -qi "dated AFTER the recorded upload"
  assert "12a: a commit dated AFTER its recorded upload is flagged as a WARNING" "$([ "$?" = "0" ] && echo 1 || echo 0)"
  printf '%s' "$future_out" | grep -qE '^\s*-\s.*dated AFTER'
  assert "  (the future-dated-commit signal is a WARNING line, not listed among the numbered PASS/FAIL findings)" "$([ "$?" != "0" ] && echo 1 || echo 0)"
  rm -rf "$(dirname "$LEDGER_12A")"

  # 12b · commit predates the upload by far more than the "live" tolerance —
  # reproduces the review's EXACT scenario: correct build number, correct
  # uploaded_at (copied from the real build-290 entry so ASC's own record
  # agrees and this stays a clean/OK run), WRONG sha (the repo's own root
  # commit, ~months old). Must still report OK — ASC cannot confirm a sha —
  # but must ALSO surface the plausibility warning and the mandatory
  # disclosure, so a reader is never left thinking a clean run means the sha
  # was checked. Deliberately its own ledger containing ONLY this one entry,
  # so the ledger-vs-ASC-max cross-check has nothing else to object to.
  real_290_uploaded_at="$(command node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    for (const l of lines) { const o = JSON.parse(l); if (o.build === 290) { console.log(o.uploaded_at); process.exit(0); } }
  ' "$ROOT/docs/testflight-builds.jsonl" 2>/dev/null)"
  if [ -z "$real_290_uploaded_at" ]; then
    echo "  (skipping 12b — could not read the real build-290 uploaded_at)"
  else
    LEDGER_12B="$(mktemp -d /tmp/faff-ledger-test.XXXXXX)/testflight-builds.jsonl"
    BUILD_LEDGER_PATH="$LEDGER_12B" node record --build 290 --sha "$SHA_OLD" --recorded live --uploaded-at "$real_290_uploaded_at" --note "CASE 12b — Defect 3's exact repro: correct build+uploaded_at, WRONG sha" >/dev/null
    repro_out="$(BUILD_LEDGER_PATH="$LEDGER_12B" node verify 290 2>&1)"
    repro_rc=$?
    assert "12b (Defect 3's own repro): correct build+uploaded_at with a WRONG sha still reports OK (ASC genuinely cannot confirm the sha — this is disclosed, not silently hidden)" "$([ "$repro_rc" = "0" ] && echo 1 || echo 0)"
    printf '%s' "$repro_out" | grep -q "SHA NOT INDEPENDENTLY VERIFIED"
    assert "  the disclosure is unmissable on this exact repro" "$([ "$?" = "0" ] && echo 1 || echo 0)"
    printf '%s' "$repro_out" | grep -qi "predates the recorded upload"
    assert "  a WRONG sha old enough to be implausible is flagged as a WARNING" "$([ "$?" = "0" ] && echo 1 || echo 0)"
    rm -rf "$(dirname "$LEDGER_12B")"
  fi

  # 12c · NEGATIVE CONTROL — a sha recorded close in time to its own upload
  # (the real build-290 entry, unmodified) must NOT trip the plausibility
  # warning. Without this, 12a/12b could pass by a matcher that always fires.
  clean_out="$(BUILD_LEDGER_PATH="$ROOT/docs/testflight-builds.jsonl" node verify 290 2>&1)"
  printf '%s' "$clean_out" | grep -qi "plausibility:"
  assert "NEGATIVE CONTROL: the real, correctly-paired build-290 entry triggers NO plausibility warning" "$([ "$?" != "0" ] && echo 1 || echo 0)"
fi

echo ""
echo "─────────────────────────────────────────────────────────────────────────"
TOTAL=$((PASS + FAIL))
if [ "$TOTAL" = "0" ]; then
  echo "UNRUNNABLE — zero assertions executed. This is the worst outcome (Rule 18)."
  exit 3
fi
echo "BUILD-LEDGER-GATE: $PASS/$TOTAL passed"
[ "$FAIL" = "0" ] && exit 0 || exit 1
