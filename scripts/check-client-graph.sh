#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-client-graph.sh · nothing a browser downloads may reach the database
#                         (2026-08-30)
#
# Thirteenth sibling of check-palette-sync.sh / check-doctrine.sh /
# check-swallowed-failure.sh / check-automatic-mutations.sh, wired the same way
# (web-v2 prebuild → Railway build).
#
#   check-doctrine           stops a bad NUMBER reaching a runner's legs.
#   check-generated-content  stops a good SENTENCE never reaching their eyes.
#   check-swallowed-failure  stops a FAILED READ being served as a FACT.
#   check-automatic-mutations stops a JOB CHANGING TRAINING without saying so.
#   this one                 stops a DEPLOY DYING SILENTLY on Railway.
#
# ── THE INCIDENT ────────────────────────────────────────────────────────────
#
# `main` did not deploy for a full day. Five merged commits — a marathon
# block's worth of engine fixes and the LTHR re-anchor the runner's HR caps are
# computed from — were never live, and nobody knew.
#
#     components/faff-app/Shell.tsx           'use client'
#       → views/ProfileView.tsx:18            imports one CONSTANT
#         → lib/training/lthr-reanchor.ts:90  imports lthrFromRace
#           → lib/training/lthr.ts:180        await import('@/lib/db/pool')
#             → pg → fs · dns · net · tls
#
# WHY NOTHING CAUGHT IT. `tsc --noEmit` passed. All twelve prebuild gates
# passed. The break was in `next build`, which runs AFTER them — so the only
# thing that could see it was Railway, hours later, in a place nobody watches.
# Nothing in the gate set checked that the client graph stays free of
# server-only modules, so ANY `'use client'` file could import the database.
#
# And `lthr-reanchor.ts` asserted IN ITS OWN HEADER that it "imports no
# database at any depth". That was the intent; it was false; no check could
# tell. A claim in a comment that nothing verifies is exactly the shape Rule 18
# exists to stop. This gate is that claim made executable, for all 76 client
# entry points at once.
#
# ── THREE GUARDS, exit 1 on any violation ───────────────────────────────────
#
#   1 · SOURCE   · client-graph.ts parses, exports its entry points, and its
#       SHAPE      liveness floors are present and non-zero. Every exemption
#                  carries an entry, a target and an argued reason. Pure sed
#                  and grep, so it runs on a cold container with no TypeScript
#                  toolchain — the same posture as check-doctrine.sh.
#
#   2 · GATE     · the gate test still exists and still declares its guards as
#       PRESENT    `describe()` blocks. Checked as `describe('GUARD n `, never
#                  as a bare word: check-automatic-mutations' tamper-check used
#                  to be `grep -q "GUARD 0"`, which any COMMENT satisfies —
#                  including the one left behind when the suite is deleted.
#
#   3 · FULL     · the vitest gate: the transitive closure of every
#       GATE       `'use client'` entry point, dynamic imports followed,
#                  type-only imports correctly NOT followed, plus liveness
#                  floors, plus planted defects the gate must fail, plus the
#                  negative controls that keep it from crying wolf.
#
# ── IF THE GATE FIRES ───────────────────────────────────────────────────────
#
# It prints the PATH, not just the file — `Shell.tsx → ProfileView.tsx →
# lthr-reanchor.ts → lthr.ts → db/pool`. Read it right to left and move the
# thing the client actually needs into a leaf module with no database at any
# depth. `lib/training/lthr-cadence.ts` is the worked example: one constant,
# one doctrine citation, nothing else.
#
# Do NOT add an exemption to make this pass. An exemption ships a broken build.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/web-v2/lib/audit/client-graph.ts"
GATE="$ROOT/web-v2/lib/audit/_client_graph.test.ts"
GRAPH="$ROOT/web-v2/lib/audit/module-graph.ts"
fail=0

say() { printf '%s\n' "$*"; }
bad() { printf '  FAIL · %s\n' "$*"; fail=1; }

say "check-client-graph · nothing a browser downloads may reach the database"

# ── GUARD 1 · source shape ──────────────────────────────────────────────────
say "guard 1 · source shape"

if [ ! -f "$SRC" ]; then
  bad "analyser missing: $SRC"
else
  for sym in analyseClientGraph formatViolation hasUseClientDirective \
             SERVER_ONLY_PACKAGES SERVER_ONLY_BUILTINS SERVER_ONLY_DIRS \
             CLIENT_GRAPH_FLOORS CLIENT_GRAPH_EXEMPTIONS; do
    grep -qE "export (const|function|interface|type) $sym\b" "$SRC" \
      || bad "analyser lost '$sym'"
  done

  # A floor of zero is a scan that reads nothing and reports clean — the worst
  # outcome available, because it also reports confidence. `grep -c` into a
  # variable, never into a pipeline: pipefail plus an early-exiting consumer
  # has turned a MATCH into a failure in this repo before.
  for floor in clientEntries filesScanned serverSeeds edgesResolved; do
    # `[0-9][0-9]*`, not `[0-9]\+` — BSD sed on the developer's Mac does not
    # know `\+` and returns empty, which would have made this guard fire on
    # macOS and pass on Railway's GNU sed. Portable both ways or it is not a gate.
    val=$(sed -n "s/^[[:space:]]*$floor: \([0-9][0-9]*\),.*/\1/p" "$SRC" | head -1)
    if [ -z "$val" ]; then
      bad "liveness floor '$floor' missing · a scanner that reads nothing must not report clean"
    elif [ "$val" -le 0 ]; then
      bad "liveness floor '$floor' is $val · a floor of zero is not a floor"
    fi
  done

  # The four builtins the incident's build actually died on.
  for b in "'fs'" "'net'" "'dns'" "'tls'"; do
    grep -q "$b" "$SRC" || bad "server-only builtin list lost $b"
  done
  grep -q "'pg'" "$SRC" || bad "server-only package list lost 'pg'"
  grep -q "web-v2/lib/db/" "$SRC" || bad "server-only dir list lost web-v2/lib/db/"

  # Every exemption is a ratchet entry: entry, target, argued reason, one per
  # line. Counts must agree, or an entry is missing a field.
  entries=$(grep -cE "^\s+entry: '[^']+'," "$SRC" || true)
  reaches=$(grep -cE "^\s+reaches: '[^']+'," "$SRC" || true)
  reasons=$(grep -cE "^\s+reason: '[^']+'," "$SRC" || true)
  if [ "$entries" != "$reaches" ] || [ "$entries" != "$reasons" ]; then
    bad "$entries exemption entries, $reaches targets, $reasons reasons · each needs all three"
  fi
  if [ "$entries" != "0" ]; then
    say "  note · $entries exemption(s) on the ratchet — each must shrink, never grow"
  fi

  [ "$fail" = "0" ] && say "  ok · analyser exports its entry points, floors non-zero, ratchet well-formed"
fi

# ── GUARD 1b · the shared resolver still follows the edges that matter ──────
if [ ! -f "$GRAPH" ]; then
  bad "module-graph.ts missing: $GRAPH"
else
  for sym in parseImportEdges stripComments walkSourceFiles; do
    grep -qE "export function $sym\b" "$GRAPH" || bad "module-graph lost '$sym'"
  done
  # Following dynamic imports is the whole reason the incident was invisible.
  grep -q "DYNAMIC_IMPORT_RE" "$GRAPH" \
    || bad "module-graph lost DYNAMIC_IMPORT_RE · a static-only walk reports the incident clean"
fi

# ── GUARD 2 · the gate still exists, with its guards ────────────────────────
say "guard 2 · gate present"
if [ ! -f "$GATE" ]; then
  bad "gate missing: $GATE · this check cannot be satisfied by deleting it"
else
  for n in 0 1 2 3 4; do
    grep -qE "describe\(['\"]GUARD $n " "$GATE" || bad "gate lost the 'GUARD $n' describe block"
  done
  # The planted defect is the reason guard 1's silence means anything.
  grep -q "INCIDENT" "$GATE" || bad "gate lost its positive control (the planted incident chain)"
  grep -q "viaDynamicImport" "$GATE" || bad "gate lost its dynamic-import assertion"
  [ "$fail" = "0" ] && say "  ok · gate present with its five guards and its planted defect"
fi

# ── GUARD 3 · run it ────────────────────────────────────────────────────────
say "guard 3 · full gate"
if [ ! -d "$ROOT/web-v2/node_modules" ]; then
  say "  skip · no node_modules (cold container) · guards 1 and 2 stand"
else
  if ( cd "$ROOT/web-v2" && npx vitest run lib/audit/_client_graph.test.ts >/tmp/_clientgraph.log 2>&1 ); then
    say "  ok · $(grep -oE 'Tests  [0-9]+ passed' /tmp/_clientgraph.log | tail -1)"
  else
    bad "vitest gate failed · output follows"
    tail -60 /tmp/_clientgraph.log
  fi
fi

if [ "$fail" != "0" ]; then
  say ""
  say "FAILED · read the header of this file before changing anything."
  say "A client → server-only path does not fail the build here for style."
  say "It fails the Railway build, silently, hours later. That is the point."
  exit 1
fi
say "PASS"
