#!/usr/bin/env bash
#
# check-coach-voice · RULE FOUR, enforced at build time.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS EXISTS
#
#   "Coach voice, not app voice. Short, direct, no hype, no exclamation marks,
#    no emoji, no em dashes."  — CLAUDE.md §Operating posture
#
#   "A missed run is stated, never judged."
#
# Rules one and three have machinery behind them. Rule one has `FaffValue` and
# check-modelled-mark.sh. Rule three has `Alert` vs `ErrorNote` and the
# `absentReason` / `isOutage` split. (Rule two's machinery was `gradeConvergence`
# and `ConvergenceList.minimumDomains`; both are gone as of 2026-09-02, when the
# runner ruled readiness out of training decisions and the convergence screen
# went with it.) Rule four had a paragraph in CLAUDE.md and a reviewer's eye,
# which is the weakest enforcement in the product and covers the largest
# surface: every sentence a runner can see.
#
# Two of the four checks below already existed as one-off assertions inside
# individual test files — `race-roles.test.ts` greps its own output for `[—!]`,
# `notifications-wire.test.ts` checks its own templates for an em dash. Both
# were right, and neither could see the file next door. This is that same idea
# with the whole user-facing surface in scope.
#
# FOUR GUARDS, exit 1 on any violation.
#
#   1 · NO EXCLAMATION MARK. There is no sentence this app says to a runner
#       that is improved by one.
#
#   2 · NO EMOJI. The design ships no icon font, no illustration and no image;
#       an emoji in a string is a graphic smuggled past that.
#
#   3 · NO EM DASH. The house punctuation is the middot (·) for a break and a
#       full stop for a sentence. A lone "—" as the UNREADABLE glyph is the one
#       exception — that is a value, not prose, and `FaffValue.unreadable`
#       owns it.
#
#   4 · NO HYPE, NO SCOLDING. A short list of phrases that are always one or
#       the other. Deliberately narrow: this catches the copy that slipped, it
#       does not try to grade tone.
#
#   5 · NO APP VOICE. The phrases software says when it has nothing to say:
#       "something went wrong", "please try again", "oops", "malformed",
#       "check back". Same narrowness as guard 4 — these are not borderline,
#       and a coach has never said any of them.
#
#   6 · NO EXCEPTION PRINTED AT A RUNNER. `setErr(e instanceof Error ?
#       e.message : String(e))` and its siblings put a JavaScript error
#       message into a state variable that a component then renders as
#       copy. Nineteen call sites across `components/faff-app` did exactly
#       that, and seven of them reached the screen — "Couldn't load today's
#       purpose. Failed to fetch". This is the only guard here that reads a
#       whole line rather than the literals in it, because the defect is the
#       plumbing, not the words.
#
# ── 2026-08-21 · guards 5 and 6, and why a green gate proved nothing ────────
#
# Guards 1-4 passed over 171 files at the moment they were written, and the
# copy underneath was not clean. What they cannot see is the whole of tone:
# a scold with none of the twenty blacklisted words in it, false cheer that
# says "solid" instead of "awesome", a refusal that reads as a failure. That
# is a reviewer's job and stays one. Guards 5 and 6 are the part of it that
# turned out to be mechanical after all — a fixed phrase list, and a shape.
#
# SCOPE is the surface a runner actually reads:
#   · native-v2/Faff/Faff/ViewsV5  + DesignV5   (the v5 phone)
#   · web-v2/lib/faff              (the composers behind it)
#   · web-v2/app/api/v5            (the routes that author copy)
#   · web-v2/lib/notifications/templates.ts     (lock-screen copy)
#   · web-v2/lib/coach             (the WEB command centre's composers)
#   · web-v2/components/faff-app   (the WEB views)
#   · web-v2/lib/plan              (the `why` on every workout · added 2026-09-01)
#   · web-v2/lib/watch             (what the wrist renders mid-run)
#   · web-v2/lib/execution         (the post-run grade)
#   · web-v2/lib/prescription      (the instruction attached to a session)
#   · web-v2/lib/race              (race plate, strategy, retrospective)
#   · web-v2/lib/today             (Today's own composed lines)
#
# ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
#
# It cannot grade tone. Guards 4 and 5 are fixed phrase lists, so a scold or a
# pat on the back written in words nobody thought to list passes. It cannot see
# copy authored outside the directories above, which is the failure it just
# spent a year having (see the 2026-09-01 note). And it cannot see a sentence
# assembled at run time from fragments that are individually clean.
#
# ── 2026-08-21 · the web surface was added ───────────────────────────────────
#
# The first four entries are the phone and its wire. The web audit found that
# rule four, like rule one, had no reach into the command centre at all:
# `lib/coach/health-actions.ts` authors every sentence in the Health page's
# WHAT TO DO panel, `lib/coach/readiness-brief.ts` authors the morning
# prescription, `lib/coach/heat-acclimatization.ts` authors the heat block,
# and `components/faff-app/**` authors the rest. None were scanned. The
# largest body of coach copy in the product was the part with no gate on it.
#
# Comment lines, `#Preview` titles, `fatalError`/`assert` messages and test
# files are developer-facing and are skipped. A line ending `// ok: <reason>`
# is exempt, same escape hatch as check-modelled-mark.sh — and an exemption
# with no reason after it is itself a finding at review time.
#
# Sibling of check-palette-sync.sh, check-doctrine.sh, check-wire-keys.sh and
# check-modelled-mark.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0

say() { printf '%s\n' "$*"; }

say "check-coach-voice · rule four"

# `/Volumes/WP` is not APFS, so an AppleDouble `._*` shadow sits beside every
# source file. They are binary resource forks and must never be scanned.
targets() {
  find "$ROOT/native-v2/Faff/Faff/ViewsV5" \
       "$ROOT/native-v2/Faff/Faff/DesignV5" \
       -name '*.swift' ! -name '._*' 2>/dev/null
  # 2026-09-01 · SCOPE WIDENED to close Rule 20's own named gap.
  #
  # Rule 20 records it verbatim: "Coach voice — no em dashes. Locked, with a
  # gate. The gate's scope excluded `lib/plan`, which authors the sentence
  # attached to every workout, so 1,804 rows carried them." The rule was
  # written down; the gate was never widened, and the composer went on
  # emitting them.
  #
  # Falsified before widening: `"Great work! You crushed it — keep going."`
  # placed in `lib/faff/goal-status.ts` FAILED and named the exclamation mark,
  # the em dash and the hype; the byte-identical string in
  # `lib/plan/block-preview.ts` PASSED, "189 user-facing source file(s) clean".
  #
  # The six directories added below all author sentences a runner reads:
  #   lib/plan         · the `why` line on every workout, block previews
  #   lib/watch        · what the wrist renders mid-run
  #   lib/execution    · the post-run grade a runner reads on Today
  #   lib/prescription · the pace/HR instruction attached to a session
  #   lib/race         · race plate, strategy and retrospective copy
  #   lib/today        · the Today surface's own composed lines
  # 2026-09-02 · `lib/safety` added. It is the canonical safety owner and it
  # AUTHORS the sentence a runner reads on an injury, an illness and a failed
  # health check — copy that used to live in `app/api/v5/today/route.ts`, which
  # is scanned. Copy moving out of a scanned directory into an unscanned one is
  # exactly how a gate quietly loses reach (the `lib/plan` hole Rule 20 names),
  # so the directory is added in the same change that moved the strings.
  find "$ROOT/web-v2/lib/faff" \
       "$ROOT/web-v2/app/api/v5" \
       "$ROOT/web-v2/lib/coach" \
       "$ROOT/web-v2/lib/safety" \
       "$ROOT/web-v2/lib/plan" \
       "$ROOT/web-v2/lib/watch" \
       "$ROOT/web-v2/lib/execution" \
       "$ROOT/web-v2/lib/prescription" \
       "$ROOT/web-v2/lib/race" \
       "$ROOT/web-v2/lib/today" \
       -name '*.ts' ! -name '._*' ! -name '*.test.ts' 2>/dev/null
  find "$ROOT/web-v2/components/faff-app" \
       \( -name '*.ts' -o -name '*.tsx' \) \
       ! -name '._*' ! -name '*.test.ts' ! -name '*.test.tsx' 2>/dev/null
  [ -f "$ROOT/web-v2/lib/notifications/templates.ts" ] \
    && printf '%s\n' "$ROOT/web-v2/lib/notifications/templates.ts"
  # 2026-08-30 · `native-v2/Faff/Faff/Components` is not in scope and should
  # not be: it is mostly v4 chrome. This ONE file is the exception. When the
  # route map's colour rule stopped being band adherence and became a pace
  # ramp, the sentence explaining it had to live beside the ramp itself —
  # `routeCaption` and `paceColumnCaption` are read by the run-detail route
  # card and the after-run mile table, so putting them in either view would
  # let the two drift into describing different rules. Named individually
  # rather than widening the directory, same as the `projection-trend.ts`
  # entry below: the next file to author copy has to make the same case.
  [ -f "$ROOT/native-v2/Faff/Faff/Components/RouteMapView.swift" ] \
    && printf '%s\n' "$ROOT/native-v2/Faff/Faff/Components/RouteMapView.swift"
  # 2026-08-30 · `lib/training` is not in scope and should not be: it is the
  # engine, and its strings are ids, kinds and doctrine labels. This ONE file
  # is the exception — `composeProjectionTrend` authors the Races trend's
  # footnotes, which a runner reads. It was pulled out of `app/api/v5/races`
  # so the flat-series guard could be tested without a database, and copy that
  # moves out of a scanned directory into an unscanned one is exactly how a
  # gate quietly loses reach. Named individually rather than widening the
  # directory, so the next file to author copy has to make the same case.
  [ -f "$ROOT/web-v2/lib/training/projection-trend.ts" ] \
    && printf '%s\n' "$ROOT/web-v2/lib/training/projection-trend.ts"
}

FILES="$(targets | sort -u | grep -v '/lib/faff/coach-lexicon\.ts$')"
COUNT="$(printf '%s\n' "$FILES" | sed '/^$/d' | wc -l | tr -d ' ')"

# ── THE LEXICON IS EXCLUDED FROM ITS OWN SCAN ────────────────────────────────
#
# `web-v2/lib/faff/coach-lexicon.ts` is the list of forbidden words. It sits in
# a scanned directory and every entry is a double-quoted literal, so scanning
# it would report the list as a violation of itself. The cost is named in that
# file's own Rule 22 block: real runner copy could hide there and nothing would
# catch it. There is none, and there must never be.

# ── LIVENESS · A FLOOR, NOT A ZERO CHECK (Rule 18 point 2) ───────────────────
#
# This used to be `if COUNT == 0`. That catches a `find` that returns nothing
# and nothing else — it cannot catch the far likelier rot, a directory renamed
# out from under one `find` while the other eight keep the count comfortably
# non-zero. Rule 18's own example in this repo is `check-modelled-mark.sh`,
# whose guards scanned zero files and reported clean.
#
# THE FLOOR IS SET FROM A COUNT TAKEN WITH `! -name '._*'` APPLIED. Every
# `find` above already excludes AppleDouble sidecars, and it matters: this
# volume is exFAT and carries a `._foo.ts` beside every source file, so a
# count taken without the exclusion is about DOUBLE what a clean CI checkout
# sees, and a floor set from the inflated number passes locally and fails on
# CI. Measured 2026-09-02, excluded: 301 files. The floor sits ~15% under, low
# enough that ordinary deletion does not trip it and high enough that losing a
# whole directory does.
MIN_FILES=255

if [ "$COUNT" -lt "$MIN_FILES" ]; then
  say "  scanned $COUNT user-facing source file(s), floor is $MIN_FILES." >&2
  say "  A directory has probably moved or been renamed. A gate that looks at" >&2
  say "  fewer files than it used to is not passing, it is blind." >&2
  exit 1
fi

# ── THE WORD LISTS COME OUT OF THE LEXICON, NOT OUT OF THIS FILE ─────────────
#
# They used to be typed inline here, and three other copies existed elsewhere
# that disagreed with this one and with each other (the audit is in the
# lexicon's header). Rule 18: a check that hardcodes both sides only proves the
# test agrees with itself. So the list has ONE home, in TypeScript where the
# composers and the golden corpus can import it, and this script parses that
# file's format contract at build time — the same posture `check-doctrine.sh`
# takes when it reads numbers out of a Research doc.
#
# `_coach_lexicon.test.ts` asserts this parse and the module agree term for
# term, so a format slip fails loudly instead of silently emptying the guard.
LEXICON="$ROOT/web-v2/lib/faff/coach-lexicon.ts"
if [ ! -f "$LEXICON" ]; then
  say "  lib/faff/coach-lexicon.ts is missing · the word lists live there" >&2
  exit 1
fi

# `{ band: 'hype', term: "nailed it", why: "..." },` → the term, for one band.
# A jargon entry without `always: true` is Layer-1-only and is NOT scanned
# file-wide; see the lexicon's own header for why that split exists.
# Comment lines are dropped FIRST. The lexicon's own header states the format
# contract by showing an example entry, and that example is a real-looking
# line — the parse picked it up and returned "nailed it" twice on the first
# run, which `_coach_lexicon.test.ts` caught immediately. A duplicate is
# harmless to the awk loop; a doc comment that ever showed a term nobody meant
# to enforce would not be.
lex_terms() {
  grep -vE '^[[:space:]]*(\*|//|/\*)' "$LEXICON" \
  | case "$1" in
      jargon) grep -E "band: 'jargon'" | grep -F 'always: true' ;;
      *)      grep -E "band: '$1'" ;;
    esac | sed -n 's/.*term: "\([^"]*\)".*/\1/p' | sed '/^$/d'
}

# ── THE JARGON GUARD RUNS ON A NARROWER SCOPE, AND HERE IS WHY ───────────────
#
# Guards 1-6 ask "would a coach ever type this", and the answer does not
# depend on which module the string is in. The jargon guard asks a LAYER
# question — `docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md` forbids Layer 3 in
# Layer 1 and expects mechanism-naming in Layer 2 — and the answer therefore
# does depend on where the string ends up.
#
# Run at the full scope it produced 69 findings, and reading them is what
# settled this: `UPDATE users SET vdot_last_reviewed = $2` (SQL),
# `Research/01-pace-zones-vdot.md §"Testing cadence"` (a doctrine citation),
# `[reanchor] plan=... VDOT unchanged` (a log line), and a long tail of
# `coach_intents.reason` strings that are an internal audit trail, not copy.
# A guard that reports sixty non-defects to catch nine real ones gets an
# allowlist bolted on within a week and then means nothing.
#
# So it runs on the surfaces that ARE Layer 1 and that ship: the v5 phone,
# the composers behind it, the routes that author its payload, and lock-screen
# copy. `lib/plan`, `lib/race`, `lib/watch`, `lib/execution` and
# `lib/prescription` are engine-side and are checked by guards 1-6 only.
#
# WHAT THIS CANNOT FAIL ON, stated because narrowing a scope is exactly how a
# gate loses its reach (Rule 22): a genuine VDOT leak authored inside
# `lib/plan` and rendered on Today passes here. `auditExplanation` in
# `lib/faff/explanation.ts` is the check that can see that one, because it
# reads the composed sentence rather than the literal — but only for copy that
# has been migrated onto the explanation contract, which today is Today's
# "why" and nothing else.
jargon_targets() {
  find "$ROOT/native-v2/Faff/Faff/ViewsV5" \
       "$ROOT/native-v2/Faff/Faff/DesignV5" \
       -name '*.swift' ! -name '._*' 2>/dev/null
  find "$ROOT/web-v2/lib/faff" \
       "$ROOT/web-v2/app/api/v5" \
       -name '*.ts' ! -name '._*' ! -name '*.test.ts' 2>/dev/null
  [ -f "$ROOT/web-v2/lib/notifications/templates.ts" ] \
    && printf '%s\n' "$ROOT/web-v2/lib/notifications/templates.ts"
}
JARGON_FILES="$(jargon_targets | sort -u | grep -v '/lib/faff/coach-lexicon\.ts$')"
JARGON_COUNT="$(printf '%s\n' "$JARGON_FILES" | sed '/^$/d' | wc -l | tr -d ' ')"
# Its own floor, for its own reason: this list is four `find`s where the main
# one is ten, so losing one of them costs proportionally more.
MIN_JARGON_FILES=62
if [ "$JARGON_COUNT" -lt "$MIN_JARGON_FILES" ]; then
  say "  the jargon guard scanned $JARGON_COUNT file(s), floor is $MIN_JARGON_FILES." >&2
  exit 1
fi

HYPE="$(lex_terms hype | paste -sd '|' -)"
SCOLD="$(lex_terms scolding | paste -sd '|' -)"
MACHO="$(lex_terms macho | paste -sd '|' -)"
APPV="$(lex_terms 'app-voice' | paste -sd '|' -)"
JARGON="$(lex_terms jargon | paste -sd '|' -)"

for pair in "hype:$HYPE" "scolding:$SCOLD" "macho:$MACHO" "app-voice:$APPV" "jargon:$JARGON"; do
  name="${pair%%:*}"; val="${pair#*:}"
  if [ -z "$val" ]; then
    say "  the $name band parsed EMPTY out of coach-lexicon.ts." >&2
    say "  Either the format contract in that file's header was broken, or the" >&2
    say "  band was deleted. Both switch a guard off silently; neither is OK." >&2
    exit 1
  fi
done

# ── the scanner ──────────────────────────────────────────────────────────────
#
# awk walks each line, drops the ones that are not user-facing, pulls every
# quoted literal out of what is left, strips interpolation and escapes from
# inside it, and tests the remaining prose. Findings go to stdout as
# `file|line|guard|detail`; the shell below formats and counts them.
FINDINGS="$(printf '%s\n' "$FILES" | sed '/^$/d' | while IFS= read -r f; do
  # Layer-1 surface? Then the jargon guard applies to this file too.
  if printf '%s\n' "$JARGON_FILES" | grep -Fqx "$f"; then DOJARGON=1; else DOJARGON=0; fi
  awk -v F="$f" -v R="$ROOT/" \
      -v HYPE="$HYPE" -v SCOLD="$SCOLD" -v MACHO="$MACHO" \
      -v APPV="$APPV" -v JARGON="$JARGON" -v DOJARGON="$DOJARGON" '
    function emit(guard, detail,   p) {
      p = F; sub(R, "", p)
      printf "%s|%d|%s|%s\n", p, FNR, guard, substr(detail, 1, 120)
    }

    # ── not user-facing ────────────────────────────────────────────────────
    /^[ \t]*\/\//      { next }   # // and /// comment lines
    /^[ \t]*\*/        { next }   # continuation of a /* block
    /^[ \t]*#/         { next }   # shebangs, directives
    /\/\/ *ok:/        { next }   # explicit exemption, with its reason
    /#Preview\(/       { next }   # Xcode preview titles · developer-facing
    /fatalError\(/     { next }
    /preconditionFailure\(/ { next }
    /assert\(/         { next }
    /console\.(log|warn|error)\(/ { next }
    /throw new Error\(/ { next }  # developer-facing; surfaced as 5xx, never copy

    {
      line = $0
      # Strip trailing line comments so a `// note — see below` cannot fire.
      if (match(line, /[ \t]\/\/[^"]*$/)) line = substr(line, 1, RSTART - 1)

      # ── 6 · an exception routed into runner-facing state ────────────────
      #
      # Line-level, not literal-level: there is no quoted string here to
      # check, which is exactly why guards 1-5 could never see it. A
      # component that stores `e.message` renders `e.message`, and the
      # runner reads whatever the browser or the fetch layer happened to
      # throw. The error is the SIGNAL that something failed; the sentence
      # is ours to write.
      if (line ~ /set(Err|Error|Message|Note)\(/ &&
          (line ~ /e\.message/ || line ~ /err\.message/ || line ~ /String\(e\)/))
        emit("exception as copy", line)

      s = line
      while (1) {
        # Find the next literal opened by " or backtick. Single quotes are
        # handled separately below because an apostrophe in Swift prose
        # ("Today\x27s session") would otherwise open a phantom literal.
        d = index(s, "\"")
        b = index(s, "`")
        if (d == 0 && b == 0) break
        if (d == 0 || (b != 0 && b < d)) { q = "`"; start = b } else { q = "\""; start = d }
        rest = substr(s, start + 1)
        close_at = index(rest, q)
        if (close_at == 0) break
        lit = substr(rest, 1, close_at - 1)
        s = substr(rest, close_at + 1)
        check(lit)
      }

      # TypeScript single-quoted strings. `.ts` AND `.tsx`, where a bare
      # apostrophe inside a single-quoted string is always escaped.
      #
      # ── the hole this closes ─────────────────────────────────────────
      #
      # This read `/\.ts$/` and therefore skipped every `.tsx` file in
      # scope. `components/faff-app` is twenty `.tsx` files and React copy
      # is single-quoted by convention, so the largest body of web copy in
      # the product was reported clean by a scanner that had not looked at
      # most of it. `friendlyAcceptError` in TodayView.tsx — four strings,
      # "malformed", "please reload", "Try again in a moment" — sat inside
      # the scope, in a scanned file, and could not be seen.
      #
      # A green gate is evidence about the gate.
      if (F ~ /\.tsx?$/) {
        s = line
        while (match(s, /\x27[^\x27]*\x27/)) {
          lit = substr(s, RSTART + 1, RLENGTH - 2)
          s = substr(s, RSTART + RLENGTH)
          check(lit)
        }
      }
    }

    function check(lit,   t, low) {
      t = lit
      # Interpolation is code, not copy: Swift \(...) and TS ${...}.
      while (match(t, /\\\([^)]*\)/)) t = substr(t, 1, RSTART - 1) substr(t, RSTART + RLENGTH)
      while (match(t, /\$\{[^}]*\}/)) t = substr(t, 1, RSTART - 1) substr(t, RSTART + RLENGTH)
      # \u{00b7}, \n, \" and friends are not prose either.
      while (match(t, /\\u\{[0-9A-Fa-f]+\}/)) t = substr(t, 1, RSTART - 1) substr(t, RSTART + RLENGTH)
      gsub(/\\[nrt"\x27\\]/, "", t)

      if (t == "") return

      # ── 1 · exclamation mark, after a letter or at the end of a word ────
      if (t ~ /[A-Za-z][!]/) emit("exclamation mark", lit)

      # ── 2 · emoji / pictographs ─────────────────────────────────────────
      # Byte-level: any UTF-8 sequence starting F0 9F (U+1F300–U+1FAFF) is a
      # pictograph, and E2 9C / E2 9D / E2 AD cover ✅ ❌ ⭐ and neighbours.
      if (t ~ /\360\237/ || t ~ /\342\234/ || t ~ /\342\235/ || t ~ /\342\255/ || t ~ /\357\270\217/)
        emit("emoji", lit)

      # ── 3 · em dash in prose ────────────────────────────────────────────
      # A literal that is ONLY the dash is the unreadable glyph, which is a
      # value rather than a sentence. Anything else is punctuation we do not
      # use: middot for a break, full stop for a sentence.
      if (t ~ /\342\200\224/ && t !~ /^[ ]*\342\200\224[ ]*$/) emit("em dash", lit)

      # ── 4-5-7 · the lexicon bands ───────────────────────────────────────
      #
      # Every list below is parsed out of `web-v2/lib/faff/coach-lexicon.ts`
      # by the shell above and handed in as a pipe-delimited variable. There
      # is no word list in this file any more, which is the point: the
      # composers, the golden corpus and this gate all read one list.
      low = tolower(t)
      split(HYPE, H, "|")
      for (i in H) if (H[i] != "" && index(low, H[i]) > 0) { emit("hype", lit); break }
      split(SCOLD, G, "|")
      for (i in G) if (G[i] != "" && index(low, G[i]) > 0) { emit("scolding", lit); break }

      # MACHO · new 2026-09-02. The register the voice brief calls punitive:
      # "bail if", "cook the back half", "get fancy", "bury yourself", "junk
      # mile", "hit the count", "system is firing", "went in the book". Every
      # one was live in shipped copy on the day the band was written, and
      # none of the four prior word lists in this repo contained any of them.
      split(MACHO, M, "|")
      for (i in M) if (M[i] != "" && index(low, M[i]) > 0) { emit("macho", lit); break }

      split(APPV, A, "|")
      for (i in A) if (A[i] != "" && index(low, A[i]) > 0) { emit("app voice", lit); break }

      # JARGON · the ALWAYS half only. VDOT, ACWR, TSB, source_mode, z-score:
      # proprietary tokens with no runner meaning at any layer. The rest of
      # the jargon band ("limiter", "readiness score") is a Layer-1 defect and
      # legitimate under a "Why?" affordance, so a file-wide literal scan
      # cannot judge it — `explanation.ts#auditExplanation` and
      # `_voice_live.audit.test.ts` do, over the composed sentence.
      #
      # PROSE ONLY. A literal with no space in it is an identifier, a module
      # path or a wire key — `@/lib/training/vdot`, `vdot_trend`,
      # `tsb_overreach` — and none of those is a sentence a runner reads.
      # Checking them produced 14 findings on the first run, every one an
      # import statement, which would have made the guard useless by making it
      # noisy. Guards 1-5 do not need this because no import path contains an
      # exclamation mark or the words "great job".
      if (DOJARGON == 1 && low ~ /[ ]/ && low !~ /^@?[a-z0-9_.\/-]+$/) {
        split(JARGON, J, "|")
        for (i in J) if (J[i] != "" && index(low, J[i]) > 0) { emit("engine jargon", lit); break }
      }
    }
  ' "$f"
done)"

if [ -n "$FINDINGS" ]; then
  say ""
  say "  Copy a runner can see, breaking coach voice:"
  say ""
  printf '%s\n' "$FINDINGS" | while IFS='|' read -r p l g d; do
    [ -n "$p" ] || continue
    printf '  ✗ %s · %s:%s\n' "$g" "$p" "$l"
    printf '      %s\n' "$d"
  done
  say ""
  say "RULE FOUR · short, direct, no hype, no exclamation marks, no emoji,"
  say "  no em dashes, and a missed run is stated, never judged."
  say "  Use · for a break and a full stop for a sentence. If a line is"
  say "  genuinely not runner-facing, end it with  // ok: <reason>."
  exit 1
fi

say "check-coach-voice OK · $COUNT user-facing source file(s) clean"
