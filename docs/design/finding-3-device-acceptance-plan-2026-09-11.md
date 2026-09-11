# Finding 3 — device acceptance test plan

**2026-09-11.** Steps for a later pass to run on David's physical phone (or a
simulator with real account data — see the render-evidence section of the
implementation report for what was and was not verified this session). Per
Rule 13, this plan is written so it can be executed and FAIL if the fix is
wrong — it names what to look at, not just what to click.

Every scenario needs the runner stepped OFF today onto the date in question
(swipe the week strip, or tap a day, then read the panel that opens — not the
live Today screen). "Read `panel.dateLine`" means: confirm the header actually
names the date under test, so a false pass can't come from accidentally still
looking at today.

## Setup

You need five real dates on the test account, each seeded with a different
outcome. Use `web-v2/scripts/walk-substrate.sh` (or a raw DB write through the
`runs`/`day_actions`/`plan_reschedules` tables) rather than a client fixture —
per Rule 13, a display fix verified against a sample fixture proves nothing
about the real code path.

| Date under test | What to seed |
|---|---|
| D1 — a genuinely missed day | A non-rest prescription (e.g. a threshold session) on a past date, with NO run at all that day, no skip row, no reschedule row, and at least `MISSED_GRACE_HOURS` (6h) past that date's local midnight. |
| D2 — a moved day | A prescription on a past OR future date, then a real Move-a-Run decision applied against it (via the new entry point under test, or directly through `POST /api/plan/reschedule`) landing on a different date. |
| D3 — a skipped day | A prescription on a past date, with `POST /api/today/skip` (`{"date": "<D3>"}`) called against it. |
| D4 — a completed day | A prescription on a past date with a real matching run (EXACT tier — `planWorkoutId` stamped, or LEGACY tier — type-matched, sole prescription of that type that day). |
| D5 — a supplemental/ambiguous day | A prescription on a past date with NO matching run, but a real, unrelated run recorded that same calendar date (e.g. a different distance/type that fails `day-resolver.ts`'s EXACT/LEGACY tests) — or a WATCHMATCH-1 ambiguity refusal (two same-type prescriptions that day, one activity whose distance plausibly fits both). |

## D1 — Missed

1. Step to D1's date.
2. **Week strip**: the dot for D1 shows the FAULT-red badge (`exclamationmark`
   glyph) — distinct in colour and shape from an upcoming day (no badge) and
   a completed day (no badge, full-opacity rail only).
3. **Past-day hero**: headline reads "Missed"; body states the prescription
   did not happen — no live pace band, no HR ceiling, no "start run" framing
   anywhere on the card.
4. **A real choice is offered**, not a passive label: a "Move this workout"
   row (opens the real Move-a-Run sheet, not a stub) and a "Mark this day
   skipped" row.
5. VoiceOver: swipe to the D1 strip cell; it should speak the day, its
   session kind, and the word "missed" — never silently reuse "done" or say
   nothing.
6. Tap "Mark this day skipped." Confirm the card immediately reads
   "Skipped" (re-fetch, not a hand-rolled local flip) and the week-strip dot
   changes to the amber `minus.circle.fill` badge. This is D3's shape reached
   from D1 — confirms the write path, not just the seeded case.

## D2 — Moved

1. Before moving anything: step to D2's ORIGINAL date and confirm it renders
   as an ordinary live/past prescription (not yet moved).
2. Use the new Move-a-Run entry point (the "Move this workout" row from a
   past/unresolved day, or the entry point on an upcoming day) to move D2 to
   a new date. Confirm the ranked options screen (`RescheduleSheetV5`) opens
   — this IS the fully-built engine, now reachable without
   `-faffReschedule`.
3. Approve a move. Step back to D2's ORIGINAL date.
4. **Past-day hero**: headline reads "Moved"; body names the date it moved
   to. It must NOT read "Missed" — this is the exact defect
   `plan_workouts.type` being rewritten to `'rest'` on the origin date would
   cause if `day-resolution.ts`'s moved-check didn't run ahead of the
   prescription lookup (see that file's own comment).
5. **Week strip**: origin date shows the signal-orange `arrow.turn.up.right`
   badge; the NEW date shows the day's prescription normally (not marked
   "moved" — it is just where the session now lives).
6. Undo the move (the existing Undo control inside the reschedule flow, or
   via `POST /api/plan/reschedule {"action":"undo","decision_id":...}`).
   Confirm the origin date reverts to its original resolution (missed, if
   grace has elapsed; otherwise a live prescription) and the new date's
   prescription disappears.

## D3 — Skipped

1. Step to D3.
2. **Week strip**: amber `minus.circle.fill` badge.
3. **Past-day hero**: headline "Skipped"; body: "Marked skipped. A real
   choice, not a passive gap." — coach voice, no judgment, no exclamation
   marks.
4. An "Undo skip" row is present. Tap it; confirm the card re-resolves (to
   "Missed" if grace has elapsed and nothing else explains the day, otherwise
   back to a live prescription) and the week-strip badge changes accordingly.

## D4 — Completed

1. Step to D4.
2. **Week strip**: no resolution badge; full-opacity rail (unchanged from
   today's behaviour) — confirms `completed` correctly draws nothing extra
   (Rule 17 — the runner already reads "done" once, in the rail itself).
3. **Past-day hero**: this should NOT hit `PastDayResolutionHeroV5` at all —
   it renders through the existing `after_run`/postRun recap path. Confirm
   the recap is accurate for that date (this is the pre-existing, unchanged
   behaviour — the acceptance step here is a NEGATIVE check, that the new
   code did not regress this path).

## D5 — Supplemental / ambiguous

1. Step to D5.
2. **Week strip**: amber `questionmark` badge — visually distinct from D3's
   `minus.circle.fill`, even though both draw the same amber accent (badge
   SHAPE carries the distinction, not colour alone — verify with VoiceOver
   as well as by eye).
3. **Past-day hero**: headline "Needs a look"; body names that an activity
   exists but does not satisfy the prescription (singular or plural phrasing
   depending on how many stray runs exist that date).
4. Confirm the same "Move this workout" / "Mark this day skipped" choices are
   offered — an ambiguous day gets the same real actions a missed day does,
   not a dead end.
5. **Cross-check against the ambiguity-refusal mechanism**: if this scenario
   was seeded via a genuine WATCHMATCH-1 two-candidate ambiguity (rather than
   a plain unrelated run), confirm via `read_db`/a direct query that
   `coach_intents` carries a `plan_match_ambiguous` row for this date+source,
   and confirm separately that `GET /api/coach/intents` does NOT surface that
   row's raw JSON anywhere the runner can read it (WATCHMATCH-1's own fixed
   leak) — this pass should not regress that fix while wiring the day-level
   surface on top of it.

## Cross-cutting checks (run once, using whichever seeded dates are available)

- **Grace period**: pick a date that turned over into "past" fewer than 6
  hours ago (relative to the runner's own device timezone) with a matching
  prescription and no run yet. Confirm it renders as a LIVE, ordinary
  prescription — no missed/supplemental badge — and confirm it flips to
  "Missed" once 6 hours have actually elapsed (or fake the clock/back-date
  the prescription's date for a controlled repro).
- **Late sync self-heals**: seed a D1-shaped missed day, confirm "Missed"
  renders, then write a real matching run for that date (simulating a
  delayed watch sync) and reload. Confirm the day flips to "Completed" with
  no manual reset needed anywhere — this is the whole point of computing the
  resolution live rather than persisting it.
- **Contrast**: `web-v2` and `native-v2` docs cite a computed contrast ratio
  for each badge's ink-vs-fill; re-measure on device against the actual six
  gradient backgrounds under real ambient light, not just the computed sRGB
  numbers cited in the implementation report.
- **No content printed twice** (Rule 17): confirm the past-day hero states
  the resolution ONCE — not once in the headline and again, differently
  worded, in a stats row somewhere else on the same card.
