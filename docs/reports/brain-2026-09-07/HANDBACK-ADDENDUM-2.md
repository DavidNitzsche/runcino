# Handback addendum 2 — two live-reported bugs closed, status check-in

Follows `HANDBACK-FINAL.md` (round 14, committed `1f585ef72`) in this same
directory. That document is still the standing inventory of the large open
items — organic PUSH's full 12-point proof, belief-owner consolidation,
facet re-derivation, the Pa:HR matrix, native calorie-resync preview, the
migration packet, the remaining native/Watch verification checklist. Nothing
below re-litigates it; this is what changed since it was written, in
response to the two things David reported live on his phone.

## What David reported

1. A stale "HOLD NOTICE" (dated Sept 13) still showing, and a flapping
   "Can't reach faff" banner. Investigated live — the banner was a real,
   transient network hiccup, resolved by Retry; no code defect found.
2. "This decision card should go in the block section though I think. It's
   weird to have it on TODAY." — a Decisions card for a non-today-dated
   proposal was rendering on Today instead of Block.
3. Two observations on the Santa Monica 10K race day screen: (a) "race
   should have my finish time estimation. Right now I don't know what total
   time this is", (b) "I can't select a specific day in any of the future
   weeks. The current week works but not future weeks."

## What shipped this session, deployed and verified

**DECISIONPLACEMENT-1** (David's item 2) — a shared loader
(`lib/faff/v5-proposals.ts#loadV5PendingProposals`) now answers `todayISO`
itself (Rule 11: null only on a total read failure, never fabricated).
Today filters to `dateISO === todayISO`; Block filters to everything else.
Native: `DecisionsSectionV5.swift` is a shared component both `TodayBeforeV5`
and `BlockV5` host at their own root (a `V5SheetHost` measures its
container's real screen frame via `GeometryReader`, so it cannot be nested
inside a small section). Shipped as TestFlight 288, commit `d02f5769f`.

**CALCELLWEEK-1, completed** (David's item 3b) — the round-13 fix taught
`HostsV5.calendarWeeks` (a fallback path) to carry `dateISO` on every row
outside the current week, but never touched
`TodayBeforeLiveV5.resolvedCalendarWeeks` — the mapping that is actually
live whenever the block fetch succeeds, which is almost always. That path
never passed `dateISO` into `TodayCalendarDay`, so `onPickDay(day.dateISO
?? day.id)` fell through to `day.id` (a plan_workout row id with no date
embedded in it), the id-to-date resolver could not place it for any week
outside the current one, and tapping a future-week row silently closed the
calendar sheet and did nothing. Fixed by carrying `dateISO` through that
mapping too.

Verified live against the walk-substrate (a real copy of David's own
production data, not a fixture — Rule 13): before the fix, tapping "Mon 14"
under the WK4 section closed the sheet and left Today unchanged; after,
it lands on that day's own real content (Easy · 4.5 mi).

**FINISHEST-1** (David's item 3a) — `plan-snapshot.ts` now resolves a
"Projected finish" stat on a race day's card, through the exact same
`resolveRaceOutlookBySlug` + `raceProjectionFromOutlook` every other race
surface (Races list, Race detail) already calls — Rule 16, one resolver,
so this can never disagree with either. Matched from a `plan_workouts` race
row to a `races` slug via `meta->>'date'`, batched once per block read, not
per day. Verified live: the Santa Monica 10K day now reads "Projected
finish 42:05–43:49" beside its pace band, where before there was nothing
answering "how long is this race."

The first push of FINISHEST-1 broke the Railway build — a bare
`.catch(() => ...)` on the slug lookup and another on the outlook
resolution tripped the swallow-scan and coercion-scan gates (Rule 11 /
Rule 18). Fixed per the gates' own prescribed remedies rather than by
loosening either: the slug query now goes through `rowsOrEmpty` (logs
instead of swallowing), and the outlook catch is registered in
`COERCION_ARGUED` with an honest reason (a thrown resolution and a
genuinely-absent outlook both land on `raceProjectionFromOutlook`'s own
`null` branch, so they're the same outcome for the one consumer, and this
stat is decorative — failing it closed beats erroring the whole block's
plan-snapshot read for every day, not just race days).

Also landed in the same commit: the already-verified **ROUNDDURATION-1**
(a snapshot day's own duration line used `Int(sec/60)` truncation while the
hero panel's kicker rounded — one quantity, two answers on one screen) and
the `DecisionsSectionV5`/`BlockV5` completion pieces that had not yet been
committed from earlier in this session.

**Commits, both pushed to `origin/main` and Railway-confirmed `SUCCESS`:**
- `c73df0356` — the CALCELLWEEK-1 completion + FINISHEST-1 feature.
- `b2fa49599` — the gate-compliance fix for FINISHEST-1's two swallow sites.

The native side (`TodayBeforeLiveV5.swift`, `PlanSnapshotDayView.swift`,
`HostsV5.swift`, `TodayBeforeV5.swift`) is merged to `main` and builds clean
(`xcodebuild … Debug -destination 'id=<sim>' build` → BUILD SUCCEEDED) but
is **not yet shipped to TestFlight** — per the standing rule, a TestFlight
build needs your explicit go, not just an approved fix. Say the word and
I'll cut it.

## One new, small finding along the way — not yet fixed

While verifying CALCELLWEEK-1 by jumping to a future week via the calendar
sheet, the WEEK STRIP for the destination day mislabels every weekday
letter by one column — landing on Monday the 14th, the strip read "M 13, T
14, W 15…" instead of "M 14, T 15, W 16…" (the CONTENT shown was correct —
Monday the 14th's real Easy · 4.5 mi — only the strip's own letter/number
pairing for a calendar-jumped day is off by one). This lives in
`HostsV5.snapshotWeekStripDays`, the local-snapshot week-strip rebuild used
when browsing to a date outside the model's currently-held week. Cosmetic,
does not affect what content renders, not blocking either of David's two
requests — flagged here rather than fixed blind, since I did not trace the
exact off-by-one before this session's scope closed out.

## Standing, unchanged from HANDBACK-FINAL.md

Everything else in that document is exactly as it stood: organic PUSH's
full 12-point proof (1/12 genuinely closed end-to-end, 10/12 blocked on one
real stale-production-data condition — a decision, not an engineering gap),
the plan-rebuild composer defect spun off separately, belief-owner
consolidation (9/12), facet re-derivation, the Pa:HR matrix, native
calorie-resync dry-run preview, the remaining native/Watch verification
checklist, and the migration packet (166–169 + two backfills) awaiting your
explicit per-statement approval before anything touches production DDL.

None of those were touched this session — the two live-reported bugs took
priority, per your message, and closing them out honestly (including
un-breaking the build my own first attempt at FINISHEST-1 caused) was the
whole of this session's work.
