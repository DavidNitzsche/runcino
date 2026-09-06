#!/usr/bin/env bash
#
# scripts/check-background-ingest-voice.sh · BACKGROUND HOUSEKEEPING DOES NOT
# GET TO TELL THE RUNNER HIS SCREEN IS STALE.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT IS FOR
#
# `API.authedSend` posts `.faffReachabilityLost` on any transport failure, and
# `RootTabView` draws the global "can't reach faff" banner for six seconds when
# it does. That is the right behaviour for a read the runner is waiting on. It
# is the wrong behaviour for a HealthKit upload he never asked for.
#
# Measured on the owner's phone, TestFlight 282 (REQUESTSTORM-2, 2026-09-05):
# one foreground import posted 21 `/api/ingest/health` chunks plus 5
# `/api/strength` sessions. Twenty-six background writes, every one of them a
# chance to flash the banner over a screen that was perfectly current — which
# is what he saw and reported as "See the banner but then it went away."
#
# The rule this gate enforces: every request to a BACKGROUND INGEST endpoint
# passes `announcesReachability: false`. The failure is still thrown, is still
# recorded in `RequestDiagnosticsLog`, and still counts toward
# `StuckConnectionMonitor` — Rule 11, three facts stay three facts. Only the
# runner-facing global claim is withheld.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS CANNOT FAIL ON (Rule 22). Five things, stated so nobody reads green
# here as "the banner is now correct":
#
# · WHETHER THE BANNER IS RIGHT ANYWHERE ELSE. It only inspects the endpoints
#   in INGEST_PATHS. A foreground read that should be silent, or a background
#   job on some other endpoint, is invisible to it.
# · A CALL THAT DOES NOT GO THROUGH `authedSend`. A raw
#   `URLSession.shared.data(for:)` never posts the banner at all, so it passes
#   here while bypassing every other contract that function owns.
# · THE ENDPOINT LIST GOING STALE. A new background ingest route added under a
#   name not in INGEST_PATHS is simply not looked at. This is the most likely
#   way this gate rots, and there is no way for a text scanner to notice.
# · WHETHER THE SUPPRESSION IS HONEST. It checks that the argument is passed,
#   not that the error is still thrown and logged. A future edit that swallows
#   the error entirely satisfies this gate and violates Rule 11.
# · RUNTIME. It reads source. It never sends a request.
#
# ─────────────────────────────────────────────────────────────────────────────
# FALSIFYING IT (Rule 18). Both directions have been run; verbatim output is in
# the handback:
#
#   · drop `announcesReachability: false` from the health-chunk POST
#     → guard 1 names the file and line, exit 1
#   · point ROOT at a tree with no Swift in it
#     → guard 0 fails on zero files scanned rather than reporting clean
#
set -uo pipefail
cd "$(dirname "$0")/.."

ROOT="native-v2/Faff/Faff"
fail=0

# The endpoints that are BACKGROUND HOUSEKEEPING: the phone pushes them on its
# own schedule, for data the runner is not looking at, and a failure is
# retried on the next import.
INGEST_PATHS=(
  "api/ingest/health"
  "api/ingest/workout"
  "api/strength"
)

# ── guard 0 · LIVENESS ───────────────────────────────────────────────────────
# A scanner that reports clean because it read nothing is the worst outcome
# available, because it also reports confidence.
if [ ! -d "$ROOT" ]; then
  echo "check-background-ingest-voice: FAIL · $ROOT does not exist."
  echo "  This gate is scanning nothing and must not pass."
  exit 1
fi

swift_files=$(find "$ROOT" -name '*.swift' -type f | wc -l | tr -d ' ')
if [ "$swift_files" -eq 0 ]; then
  echo "check-background-ingest-voice: FAIL · read 0 Swift files under $ROOT."
  exit 1
fi

# ── guard 1 · every request BUILT for an ingest endpoint declares its voice ──
#
# Scoped to the URL-CONSTRUCTION SITE, not the file. A file may hold dozens of
# unrelated authedSend calls (API.swift holds 35), and blaming all of them for
# one ingest route in the same file is a gate nobody can act on. So: find each
# line that builds a URL naming an ingest endpoint, then look forward within
# the same function for the send that carries it.
#
# WINDOW is how far forward a request build may sit from its send. 60 lines
# covers every current site with room to spare; a send further away than that
# is reported as UNCHECKED rather than passed, because a scanner that quietly
# skips what it cannot read is how a gate reports clean on nothing.
WINDOW=60
sites=0
checked=0
unchecked=0

for f in $(find "$ROOT" -name '*.swift' -type f | sort); do
  for p in "${INGEST_PATHS[@]}"; do
    while IFS= read -r hit; do
      [ -z "$hit" ] && continue
      lineno="${hit%%:*}"
      text="${hit#*:}"
      # Only URL-construction lines. A doc comment naming the route, or a
      # response-log string, is not a request.
      case "$text" in
        *appendingPathComponent*|*URL\(string:*|*URLComponents*|*baseURL*) ;;
        *) continue ;;
      esac
      # A commented-out line is not a request either.
      trimmed=$(printf '%s' "$text" | sed 's/^[[:space:]]*//')
      case "$trimmed" in
        //*|\**) continue ;;
      esac
      sites=$((sites + 1))

      window=$(sed -n "${lineno},$((lineno + WINDOW))p" "$f")
      send=$(printf '%s\n' "$window" | grep -n 'authedSend(' | grep -v 'func authedSend' | head -1 || true)
      if [ -z "$send" ]; then
        echo "check-background-ingest-voice: UNCHECKED · $f:$lineno builds $p"
        echo "  but no authedSend within $WINDOW lines. Read it by hand."
        unchecked=$((unchecked + 1))
        continue
      fi
      checked=$((checked + 1))
      case "$send" in
        *announcesReachability*) ;;
        *)
          sendline=$((lineno + ${send%%:*} - 1))
          echo ""
          echo "check-background-ingest-voice: FAIL · $f:$sendline"
          echo "  request built at line $lineno for $p"
          echo "  $(printf '%s' "${send#*:}" | sed 's/^[[:space:]]*//')"
          echo ""
          echo "  This is a BACKGROUND INGEST write and it does not say whether"
          echo "  it may raise the global \"can't reach faff\" banner. Pass"
          echo "  announcesReachability: false — the error still throws and is"
          echo "  still recorded in RequestDiagnosticsLog; only the"
          echo "  runner-facing claim about the screen is withheld."
          fail=1
          ;;
      esac
    done < <(grep -n -- "$p" "$f" 2>/dev/null || true)
  done
done

echo "check-background-ingest-voice: $sites ingest request site(s), $checked checked, $unchecked unchecked, across $swift_files Swift files"

if [ "$sites" -eq 0 ]; then
  echo "check-background-ingest-voice: FAIL · found 0 request sites for any of:"
  printf '    %s\n' "${INGEST_PATHS[@]}"
  echo "  Either the endpoints were renamed or the predicate has stopped"
  echo "  matching. Reporting clean on zero sites is the worst outcome"
  echo "  available (Rule 18)."
  exit 1
fi
if [ "$checked" -eq 0 ]; then
  echo "check-background-ingest-voice: FAIL · $sites site(s) found but 0 had a"
  echo "  reachable authedSend. The predicate has stopped matching."
  exit 1
fi

# ── guard 2 · the parameter still exists and still gates the post ────────────
# Rule 18 · an exemption must never be able to switch the assertion off. If
# `announcesReachability` is deleted from authedSend, every call site above
# becomes a compile error — but if it is kept and merely stops gating the
# notification post, nothing else would notice.
API="$ROOT/API.swift"
if ! grep -q 'announcesReachability: Bool = true' "$API"; then
  echo "check-background-ingest-voice: FAIL · authedSend no longer declares"
  echo "  'announcesReachability: Bool = true' in $API."
  fail=1
fi
if ! grep -q 'if announcesReachability {' "$API"; then
  echo "check-background-ingest-voice: FAIL · $API posts .faffReachabilityLost"
  echo "  without gating it on announcesReachability. The parameter is now"
  echo "  decoration, which is worse than not having it (Rule 20)."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "check-background-ingest-voice: OK · $checked authedSend call site(s) checked, all declare their voice"
fi
exit "$fail"
