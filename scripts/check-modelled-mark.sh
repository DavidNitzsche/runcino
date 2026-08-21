#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# check-modelled-mark.sh · v5 iPhone · RULE ONE, enforced at build time.
#
#   "A modelled number must never look measured. This is the only real sin.
#    A projected finish, a pace derived from training rather than a race, a
#    projection after time off — all modelled. The amber tilde is the mark,
#    and it is a system rule rather than one screen's fix."
#        — docs/faff-iphone-design-contract.md §1
#
# A rule that lives in eighteen screens' worth of `if projected { "~" }` is a
# rule the nineteenth screen breaks. `FaffValue` makes the right thing easy —
# it has no untyped initialiser, so a number cannot reach a component without
# naming its basis. This script closes the two ways around it.
#
# SEVEN GUARDS, exit 1 on any violation.
#
# Guards 1-3 watch the PHONE. Guards 4-7 were added by the 2026-08-21
# four-rules audit, which found that the three original guards could not see
# the shapes that actually shipped:
#
#   · Today's pace band is `derivePaces()` off the runner's TYPED GOAL TIME,
#     and it shipped `modelled: false` for as long as it existed. Guard 1
#     greps the Swift views for field NAMES; the number arrived pre-formatted
#     from the server with its provenance already decided, so there was
#     nothing on the phone left to catch.
#   · `lib/plan/v5-block.ts` declared `function num(text, modelled = false)`
#     and no call site ever passed the second argument, so an entire screen's
#     provenance was decided by a default nobody wrote on purpose.
#   · `.measured(FaffFmt.milesUnit(shoe.mileage) ?? "0 mi")` printed a hard,
#     measured ZERO for a mileage we could not read — beside a progress track
#     that correctly drew nothing for the same nil.
#   · `formatEstTime` in the glance adapter writes its own `~` into a string,
#     which is guard 2's sin committed on the server where guard 2 cannot see.
#
# The through-line: rule one is decided at the composer, and the composer was
# never scanned.
#
#   1 · NO RAW MODELLED FIELD. A v5 view may not print a field the engine
#       marks projected as a bare String. The field names below are the ones
#       `GoalAssessment.basis == 'projected'` covers, plus the projection and
#       trajectory fields. Reaching them means going through V5Number.
#
#   2 · NO HAND-DRAWN TILDE. The mark is `Theme.V5.modelledMark`, rendered by
#       `FaffValueText` as its own amber run. A literal "~" glued into a string
#       can be copied, truncated, or formatted away, and — worse — can be
#       written by a caller who has no idea whether the number is modelled.
#
#   3 · NO HEX IN A V5 VIEW. Not rule one, but the same class of problem and
#       the same place to catch it: a v5 screen paints from the token layer or
#       it does not paint. check-palette-sync.sh locks the tokens; this locks
#       the call sites.
#
#   4 · NO FALLBACK CONSTANT INSIDE A MEASURED VALUE. `?? "0 mi"`, `?? ""`,
#       `?? '—'` — a number we could not read, printed as one we did. Nil is
#       `.unreadable` (fault red, no value beside it) and NULL on the wire;
#       a dash we typed ourselves is a measured value shaped like a dash.
#
#   5 · NO MODELLED SOURCE SHIPPING `modelled: false`. A projection, a
#       goal-derived pace band, a zone-model HR ceiling, a composite score, a
#       forecast. Named sources, checked at the composer where the flag is set.
#
#   6 · NO HAND-DRAWN TILDE IN A COMPOSER. Guard 2 on the server side, where
#       the v5 wire carries `modelled` and there is no excuse for a literal.
#
#   7 · `modelled` MAY NOT HAVE A DEFAULT. A default is how an entire screen's
#       provenance gets decided by nobody. Same contract `FaffValue` enforces
#       on the phone by having no untyped initialiser.
#
# Scope for 1-3 is `native-v2/Faff/Faff/ViewsV5` and `DesignV5`, because those
# are the v5 surface. The legacy views are on their way out and are not
# scanned — when the last one goes, so does this sentence. Scope for 4-7 is
# `COMPOSERS` below: the server files that decide `modelled` in the first
# place, which nothing was watching until 2026-08-21.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V5_VIEWS="$ROOT/native-v2/Faff/Faff/ViewsV5"
V5_KIT="$ROOT/native-v2/Faff/Faff/DesignV5"
FAIL=0

say()  { printf '%s\n' "$*"; }
bad()  { printf '  ✗ %s\n' "$*"; FAIL=1; }

# `/Volumes/WP` is not APFS, so an AppleDouble `._*` shadow sits beside every
# source file. They are binary resource forks and must never be scanned.
sources() {
  find "$@" -name '*.swift' ! -name '._*' 2>/dev/null
}

[ -d "$V5_VIEWS" ] || mkdir -p "$V5_VIEWS"

# ── 1 · a modelled field may not be printed raw ──────────────────────────────
#
# Every one of these is PROJECTED by the engine's own admission. `basis` is the
# literal string 'projected' on GoalAssessment and covers the first four.
# 2026-08-21 · the trajectory's VDOT fields joined this list. They are already
# decoded into ToolkitPayloads and no v5 view prints them yet, which is the
# cheapest moment to close the door: every one is an output of
# `projectFitnessTrajectory`, whose gain rate is a MODEL (bound by
# ADAPTATION.vdot-gain-rate to Research/01's reassessment band, not measured on
# this runner). A VDOT the plan is "projected to deliver" printed as a bare
# number is rule one broken in the plainest possible way.
MODELLED_FIELDS='safeTargetSec|stretchTargetSec|reportAgainstSec|weeksToReach|projectionSec|projectedSec|currentEquivalentSec|requiredVdot|projectedVdot|projectedGainVdot|plannedTargetVdot|projectedRaceDayVdot'

say "check-modelled-mark · rule one"

while IFS= read -r f; do
  [ -n "$f" ] || continue
  # A modelled field inside a Text(...) or a string interpolation, without a
  # FaffValue anywhere on the line, is the sin.
  hits=$(grep -nE "(Text\(|\\\\\()[^)]*($MODELLED_FIELDS)" "$f" \
         | grep -vE 'FaffValue|V5Number|\.value|// *ok:' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "modelled field printed raw · ${f#$ROOT/}:${h%%:*}"
      printf '      %s\n' "$(printf '%s' "$h" | cut -d: -f2- | sed 's/^[0-9]*://' | head -c 140)"
    done <<< "$hits"
  fi
done < <(sources "$V5_VIEWS" "$V5_KIT")

# ── 2 · the mark is not hand-drawn ───────────────────────────────────────────
#
# ValuesV5.swift renders it and is the one file allowed to name it.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in */ValuesV5.swift) continue;; esac
  hits=$(grep -nE '"[^"]*~[^"]*"' "$f" | grep -vE '^\s*[0-9]+:\s*//|// *ok:' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "hand-drawn tilde · ${f#$ROOT/}:${h%%:*} — use FaffValue.modelled and let FaffValueText draw the mark"
    done <<< "$hits"
  fi
done < <(sources "$V5_VIEWS" "$V5_KIT")

# ── 3 · a v5 view paints from the token layer ────────────────────────────────
#
# ThemeV5/TokensV5 hold the palette; a call site may not restate it. The kit's
# own token files are exempt because they ARE the layer.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in */TokensV5.swift|*/ThemeV5.swift) continue;; esac
  hits=$(grep -nE 'Color\(hex:|Color\(red:|#[0-9A-Fa-f]{6}\b' "$f" \
         | grep -vE '^\s*[0-9]+:\s*//|^[0-9]+:\s*//|// *ok:' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "hex at a call site · ${f#$ROOT/}:${h%%:*} — paint from V5.*"
    done <<< "$hits"
  fi
done < <(sources "$V5_VIEWS" "$V5_KIT")

# ─────────────────────────────────────────────────────────────────────────────
# THE SERVER HALF · guards 4-7
#
# `V5Number { text, modelled }` is stamped in the composer, so the composer is
# where rule one is actually decided. These scan it.
# ─────────────────────────────────────────────────────────────────────────────

# An ARRAY, not a space-joined string: `$ROOT` is `/Volumes/WP/06 Claude
# Code/…` on this machine and word-splitting a joined string silently scanned
# nothing at all. The first version of these guards passed on planted
# violations for exactly that reason.
COMPOSERS=(
  "$ROOT/web-v2/lib/faff"
  "$ROOT/web-v2/app/api/v5"
  "$ROOT/web-v2/lib/plan/v5-block.ts"
)

composer_sources() {
  local p
  for p in "${COMPOSERS[@]}"; do
    if [ -d "$p" ]; then
      find "$p" -name '*.ts' ! -name '._*' ! -name '*.test.ts' 2>/dev/null
    elif [ -f "$p" ]; then
      printf '%s\n' "$p"
    fi
  done | sort -u
}

NCOMPOSERS=$(composer_sources | wc -l | tr -d ' ')
if [ "$NCOMPOSERS" = "0" ]; then
  bad "no composer sources found under web-v2 — guards 4-7 would pass vacuously"
fi

# ── carried exemptions ───────────────────────────────────────────────────────
#
# `file:line` entries the guards below skip, each with a reason. An exemption
# is a FINDING that has not been fixed yet, not a rule that does not apply —
# the script prints every one it carried at the end so it cannot go quiet, and
# a stale entry (the line no longer matching) fails the build in its own right.
#
# Same posture as the doctrine registry's `exempt` maps: do not loosen the
# guard, name the violation.
EXEMPT_SPEC=(
  "native-v2/Faff/Faff/ViewsV5/LiveRunTreadmillV5.swift:665|\
.measured(FaffFmt.bpm(...) ?? \"—\") renders an unreadable heart rate in \
primary ink instead of fault red. Found by the four-rules audit 2026-08-21; \
LiveRunTreadmillV5.swift is owned by another workstream and was not edited. \
The same file also renders belt-derived PACE and DISTANCE as .measured when \
the screen's own copy says nothing measured them — same fix, same owner."
)

exempt_reason() {  # $1 = "path:line" → prints the reason, or nothing
  local e key
  for e in "${EXEMPT_SPEC[@]}"; do
    key="${e%%|*}"
    [ "$key" = "$1" ] && { printf '%s' "${e#*|}"; return 0; }
  done
  return 1
}

CARRIED=""
note_exempt() {  # $1 = "path:line"
  CARRIED="${CARRIED}  · $1
      $(exempt_reason "$1")
"
}

# ── 4 · a fallback constant may not ride in as a measured value ──────────────
#
# `?? "0 mi"` / `?? '—'` inside something that claims `measured` is a number we
# could not read, printed as one we did. `FaffValue`'s optional overload and
# `.unreadable` exist precisely so nil becomes a dash in fault red instead of a
# confident zero.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  # `[^)]*` could not cross the closing paren of an inner call, so
  # `.measured(FaffFmt.milesUnit(x) ?? "0 mi")` — the real bug this guard was
  # written for — slipped straight through it.
  hits=$(grep -nE '\.measured\(.*\?\?[[:space:]]*"' "$f" | grep -vE '// *ok:' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      loc="${f#$ROOT/}:${h%%:*}"
      if exempt_reason "$loc" >/dev/null; then note_exempt "$loc"; continue; fi
      bad "fallback constant shipped as measured · $loc — pass the optional through; nil is .unreadable, not zero"
    done <<< "$hits"
  fi
done < <(sources "$V5_VIEWS" "$V5_KIT")

while IFS= read -r f; do
  [ -n "$f" ] || continue
  hits=$(grep -nE "num\([^;]*\?\?[[:space:]]*['\`\"][^;]*,[[:space:]]*false[[:space:]]*\)" "$f" | grep -vE '// *ok:' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "fallback constant shipped as measured · ${f#$ROOT/}:${h%%:*} — an unreadable value is not a measured one"
    done <<< "$hits"
  fi
done < <(composer_sources)

# ── 5 · a modelled SOURCE may not ship modelled:false ────────────────────────
#
# The names below are model outputs by their own definition: a projection, a
# goal-derived pace, a zone-model ceiling, a composite score, a forecast. If
# one of them is on the same line as an explicit `false`, the composer is
# asserting a hard read of a model.
MODELLED_SOURCES='derivePaces|paceBandStat|hrCapStat|safeTarget|stretchTarget|weeksToReach|projectionSec|projectedSec|currentEquivalentSec|requiredVdot|assessGoal|readiness\.score|forecastTemp|tempF'

while IFS= read -r f; do
  [ -n "$f" ] || continue
  hits=$(grep -nE "($MODELLED_SOURCES)[^;]*(modelled:[[:space:]]*false|,[[:space:]]*false[[:space:]]*\))" "$f" \
         | grep -vE '// *ok:|^\s*[0-9]+:\s*(//|\*)' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "modelled source shipped as measured · ${f#$ROOT/}:${h%%:*}"
      printf '      %s\n' "$(printf '%s' "$h" | cut -d: -f2- | sed 's/^[0-9]*://' | head -c 140)"
    done <<< "$hits"
  fi
done < <(composer_sources)

# ── 6 · the mark is not hand-drawn on the server either ──────────────────────
#
# Guard 2 forbids a literal `~` in a v5 view. The v5 WIRE carries `modelled`,
# so a composer feeding it has the same obligation and the same alternative.
#
# `lib/faff/glance-adapter.ts` is exempt with a reason: it composes the v4
# Poster (`lib/faff/types.ts`), whose `Stat`/`MiniTile` have NO provenance
# field at all, so its `~${minutes} min` is the only honesty available there.
# Removing it would make that surface less honest, not more. Delete this
# exemption when types.ts grows a provenance carrier — and if it never does,
# that is itself the finding.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in */glance-adapter.ts) continue;; esac
  hits=$(grep -nE "(['\`\"])~" "$f" | grep -vE '// *ok:|^\s*[0-9]+:\s*(//|\*)' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "hand-drawn tilde in a composer · ${f#$ROOT/}:${h%%:*} — set modelled:true and let FaffValueText draw the mark"
    done <<< "$hits"
  fi
done < <(composer_sources)

# ── 7 · `modelled` may not have a default ────────────────────────────────────
#
# A default is how an entire screen's provenance gets decided by nobody. Every
# call site names the basis, or the compiler asks — the same contract
# `FaffValue` enforces on the phone by having no untyped initialiser.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  hits=$(grep -nE 'modelled[?]?[[:space:]]*(:[[:space:]]*boolean)?[[:space:]]*=[[:space:]]*(true|false)[[:space:]]*[,)]' "$f" \
         | grep -vE '// *ok:|^\s*[0-9]+:\s*(//|\*)' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      bad "\`modelled\` carries a default · ${f#$ROOT/}:${h%%:*} — make it required so every call site names a basis"
    done <<< "$hits"
  fi
done < <(composer_sources)

# An exemption that no longer matches a real violation is dead weight, and
# dead exemptions are how a gate quietly stops meaning anything.
for e in "${EXEMPT_SPEC[@]}"; do
  key="${e%%|*}"
  case "$CARRIED" in *"$key"*) ;; *)
    bad "stale exemption · $key no longer matches a violation — delete it from EXEMPT_SPEC" ;;
  esac
done

if [ "$FAIL" -ne 0 ]; then
  say ""
  say "RULE ONE · a modelled number must never look measured."
  say "  Build the value with FaffValue.modelled(...) / FaffValue.from(text:modelled:)"
  say "  and render it with FaffValueText. The amber tilde is drawn by the type,"
  say "  never typed into a string."
  exit 1
fi

n=$(sources "$V5_VIEWS" "$V5_KIT" | wc -l | tr -d ' ')
if [ -n "$CARRIED" ]; then
  say ""
  say "  carried exemptions (each is an UNFIXED finding, not a permission):"
  printf '%s' "$CARRIED"
  say ""
fi
say "check-modelled-mark OK · $n v5 source file(s) + $NCOMPOSERS composer(s) clean"
