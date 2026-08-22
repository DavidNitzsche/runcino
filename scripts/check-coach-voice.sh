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
# Rules one, two and three all have machinery behind them. Rule one has
# `FaffValue` and check-modelled-mark.sh. Rule two has `gradeConvergence` and
# `ConvergenceList.minimumDomains`. Rule three has `Alert` vs `ErrorNote` and
# the `absentReason` / `isOutage` split. Rule four had a paragraph in CLAUDE.md
# and a reviewer's eye, which is the weakest enforcement in the product and
# covers the largest surface: every sentence a runner can see.
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
  find "$ROOT/web-v2/lib/faff" \
       "$ROOT/web-v2/app/api/v5" \
       "$ROOT/web-v2/lib/coach" \
       -name '*.ts' ! -name '._*' ! -name '*.test.ts' 2>/dev/null
  find "$ROOT/web-v2/components/faff-app" \
       \( -name '*.ts' -o -name '*.tsx' \) \
       ! -name '._*' ! -name '*.test.ts' ! -name '*.test.tsx' 2>/dev/null
  [ -f "$ROOT/web-v2/lib/notifications/templates.ts" ] \
    && printf '%s\n' "$ROOT/web-v2/lib/notifications/templates.ts"
}

FILES="$(targets | sort -u)"
COUNT="$(printf '%s\n' "$FILES" | sed '/^$/d' | wc -l | tr -d ' ')"

if [ "$COUNT" = "0" ]; then
  say "  no user-facing sources found under native-v2/ or web-v2/ — nothing to check" >&2
  exit 1
fi

# ── the scanner ──────────────────────────────────────────────────────────────
#
# awk walks each line, drops the ones that are not user-facing, pulls every
# quoted literal out of what is left, strips interpolation and escapes from
# inside it, and tests the remaining prose. Findings go to stdout as
# `file|line|guard|detail`; the shell below formats and counts them.
FINDINGS="$(printf '%s\n' "$FILES" | sed '/^$/d' | while IFS= read -r f; do
  awk -v F="$f" -v R="$ROOT/" '
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

      # ── 4 · hype and scolding ───────────────────────────────────────────
      low = tolower(t)
      # 2026-08-21 · the second row is what the first row missed. The audit
      # found praise that used none of the twenty obvious words and read
      # exactly the same: "Solid work in the long run", "good sign", "Good
      # rep", "exactly right", "Plan called for it, you delivered", "keep
      # doing what you are doing". A pat on the back is a pat on the back
      # whichever adjective carries it. (No apostrophes in this program:
      # the whole awk script is inside a single-quoted shell string.)
      split("amazing|awesome|incredible|epic|fantastic|superb|crushed it|crushing it|smashed it|nailed it|great job|well done|congrats|congratulations|keep it up|you got this|way to go|beast mode|woohoo|hooray|so proud|proud of you|solid work|solid effort|solid execution|good sign|strong sign|good rep|nice work|exactly right|you delivered|keep doing what|well played|exactly the setup", H, "|")
      for (i in H) if (H[i] != "" && index(low, H[i]) > 0) { emit("hype", lit); break }
      split("you failed|you should have|you did not bother|you didn\x27t bother|no excuses|not good enough|disappointing|you keep missing|unacceptable|be honest with yourself|stop making excuses|you let|slacking", G, "|")
      for (i in G) if (G[i] != "" && index(low, G[i]) > 0) { emit("scolding", lit); break }

      # ── 5 · app voice ───────────────────────────────────────────────────
      # What software says when it has nothing to say. None of these are
      # borderline and none of them are things a coach has ever said.
      # "malformed" and "check back" earn their place the same way: one
      # names the request/response model at a runner, the other tells them
      # to come back and service the screen.
      split("something went wrong|please try again|try again in a moment|oops|malformed|check back|no data available|an error occurred|unable to load|failed to load|please reload|invalid input", A, "|")
      for (i in A) if (A[i] != "" && index(low, A[i]) > 0) { emit("app voice", lit); break }
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
