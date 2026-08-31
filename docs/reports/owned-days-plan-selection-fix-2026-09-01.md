# `ownedDaysSql` reverted-plan fix — Rule 14, the sibling of ACTIVEPLAN-1

**Date:** 2026-09-01 · **Files changed:** `web-v2/lib/plan/owned-days.ts`,
`web-v2/lib/plan/_plan_undo.test.ts`, `web-v2/lib/plan/_owned_days_reign.audit.test.ts`
**Status:** fixed, verified against real production data across every account
in the database, committed.

## The bug, reproduced first (Rule 18)

`ownedDaysSql()`'s tiebreak for "which plan version owns calendar day D" was:

```sql
ORDER BY pw.date_iso, (tp.archived_iso IS NULL) DESC, tp.authored_iso DESC
```

Ran this verbatim against account `0645f40c-951d-4ccc-b86e-9979cd26c795` for
the window `[2026-07-20, 2026-08-17)` before touching any code:

```
2026-07-21 tempo true 8  419  pln_c0ff77ee065b8fe4
2026-07-23 tempo true 4  419  pln_c0ff77ee065b8fe4   ← wrong: real session is intervals 7.5mi @389
2026-07-28 tempo true 8  419  pln_c0ff77ee065b8fe4
2026-07-30 tempo true 5  419  pln_c0ff77ee065b8fe4   ← wrong: real day is a non-quality easy 7.5mi
2026-08-04 tempo true 8  419  pln_c0ff77ee065b8fe4
2026-08-06 tempo true 8  419  pln_c0ff77ee065b8fe4
2026-08-16 race  true 13.1 407 pln_c0ff77ee065b8fe4  ← close but wrong plan/pace (412 real)
```

Every single date resolves to `pln_c0ff77ee065b8fe4` — a plan authored
2026-06-07 and archived 21 minutes later, which never served a single day to
the runner — instead of `pln_ca91f252bba50c74`, the account's real plan
(authored 2026-06-03, adapted in place four times, live for two and a half
months, archived only when the AFC race it was built for completed). Matches
`docs/reports/taper-tempo-comparison-basis-2026-09-01.md` exactly.

## Root cause

`authored_iso DESC` was standing in for "most authoritative," and that
approximation breaks the moment a later-authored plan was itself short-lived
and reverted, once BOTH candidates for a date are eventually archived (which
happens for any block once its race completes). This is Rule 14's shape
("a query names the population it reads") one level down from ACTIVEPLAN-1:
that gate already ensures a query scopes to *a* plan rather than every
version ever written; this bug shows that even a query that correctly picks
*one* plan per date can pick the *wrong one*, because "most recently
authored" and "actually served this date" are different questions once
history includes a reverted regeneration.

## The fix

`ownedDaysSql()` now asks the real question directly: does this plan's reign
as the account's active plan — `[authored_iso, archived_iso)` if superseded,
or `[authored_iso, +∞)` while still active — actually contain calendar day D?

```sql
-- REIGN_CONTAINS_DATE, computed against explicit UTC boundaries:
(
  tp.authored_iso < ((pw.date_iso::date + interval '1 day') AT TIME ZONE 'UTC')
  AND (tp.archived_iso IS NULL OR tp.archived_iso > ((pw.date_iso::date) AT TIME ZONE 'UTC'))
)

ORDER BY pw.date_iso,
         REIGN_CONTAINS_DATE DESC,
         CASE WHEN REIGN_CONTAINS_DATE THEN COALESCE(tp.archived_iso, now()) END DESC NULLS LAST,
         (tp.archived_iso IS NULL) DESC,
         tp.authored_iso DESC
```

Three tiers, in priority order:

1. **Exactly one candidate's reign contains D** → it wins outright.
2. **More than one candidate's reign contains D** (only plausible in a brief
   undo/re-archive transition — `training_plans_active_uq` forbids two
   simultaneously-active plans, but a transaction can pass through a moment
   where two *archived* plans' reigns both cover D) → prefer the one with the
   latest `COALESCE(archived_iso, now())` — whichever was active most
   recently. This also reproduces "prefer the active plan" for the ordinary
   case, since an always-active plan's `now()` sorts above any past
   `archived_iso`, with no separate first clause needed.
3. **No candidate's reign contains D** — a genuine gap in plan-ownership
   history. Falls back to the pre-2026-09-01 ordering rather than guessing,
   and is called out explicitly below as a data-integrity finding.

### A real defect caught in my own first draft, before it shipped

My first draft defined the reign's upper bound as `COALESCE(archived_iso,
now())` — i.e. truncating even the *active* plan's reign at the current
instant. That is wrong: it would make a plan authored today fail to "contain"
next Tuesday's already-scheduled workout, because `now()` is earlier than
next Tuesday. Caught by re-running the full-account sweep unbounded (past
*and* future dates) and finding 428 of 674 total plan-day rows across the
database reading as "no reign contains this date" — almost all of them
future days the currently active plan legitimately owns. Corrected to leave
the active plan's reign open-ended (`archived_iso IS NULL OR archived_iso >
...`), which dropped the false-gap count to 26, all genuine historical
data-integrity artifacts (see below). `now()` only appears in the tier-2
tiebreak value now, never as a bound on the reign itself.

## Verification: the 7 report dates, before and after

| date | field | before (wrong) | after (fixed) |
|---|---|---|---|
| 07-21 tempo | plan / type / dist / pace | `pln_c0ff77ee065b8fe4` tempo 8 @419 | `pln_ca91f252bba50c74` tempo 8 @419 — unchanged, was already coincidentally correct |
| 07-23 | type / dist / pace | tempo 4 @419 | **intervals 7.5 @389** |
| 07-28 tempo | plan / type / dist / pace | `pln_c0ff77ee065b8fe4` tempo 8 @419 | `pln_ca91f252bba50c74` tempo 8 @419 — unchanged |
| 07-30 | quality / type / dist | quality tempo 5.0 | **non-quality easy 7.5** |
| 08-04 tempo | plan / type / dist / pace | `pln_c0ff77ee065b8fe4` tempo 8 @419 | `pln_ca91f252bba50c74` tempo 8 @419 — unchanged |
| 08-06 tempo | plan / type / dist / pace | `pln_c0ff77ee065b8fe4` tempo 8 @419 | `pln_ca91f252bba50c74` tempo 8 @419 — unchanged |
| 08-16 race | plan / pace | `pln_c0ff77ee065b8fe4` @407 | `pln_ca91f252bba50c74` @412 |

The 5 dates the investigation report already flagged as "matches by
coincidence" (07-21, 07-28, 08-04, 08-06, 08-16) are unchanged — same values,
now for the right, documented reason instead of by luck. 07-23 and 07-30 are
now correct: 07-23 is genuinely an intervals session at a different pace
domain (the old value's "full execution" verdict against 5.1mi actual could
have been wrong in either direction — this was flagged but not scored in the
original report). 07-30 is dropped from the "under-executed" narrative
entirely, per the investigation's own conclusion — it was never a key/quality
session in the plan the runner trained under.

The whole 42-day `classifyAdaptation`/`loadAdaptationInput` window
(`2026-07-06` through `2026-08-16`) now resolves to exactly one plan
(`pln_ca91f252bba50c74`) with zero gaps — confirmed by direct query and
pinned in the new regression test.

## Other-accounts sweep

Every `training_plans` row in the database with a reign under one hour
(the "short-lived, possibly-reverted" signature) — 32 rows total, 31 of them
in the owner's own account's May–June onboarding churn, one on a second
account:

```
d2f504ac-8549-40fe-b3af-cae011c594fa · pln_99e17c2876701c76 · 1.8 min reign
```

That account's SECOND plan (`pln_0c75f856a3849c32`) is still the live,
active plan — the exact undo-and-immediately-superseded shape never got a
chance to matter there, because there's no *later* archived plan to lose the
`authored_iso` tiebreak to. Confirmed: **zero date changes** on that account
before/after the fix.

Ran a full before/after diff of every resolved `(date, plan_id)` pair for
every distinct `user_uuid` with any `training_plans` row (7 accounts, 674
total plan-days, no date bounds — the widest possible sweep):

| account | total dates | changed | reign-gap dates |
|---|---|---|---|
| `0645f40c…` (owner) | 210 | **92** | 4 |
| `606bcc38…` | 119 | **5** | 4 |
| `9298919a…` | 98 | 0 | 10 |
| `b04e35e9…` | 91 | 0 | 0 |
| `bcefea06…` | 105 | 0 | 0 |
| `d2f504ac…` | 21 | 0 | 4 |
| `fb21cb09…` | 30 | 0 | 4 |
| **total** | **674** | **97** | **26** |

**A second, independent real bug found on account `606bcc38…`:** dates
2026-08-03 through 2026-08-07 were resolving to the account's *new* plan
(`pln_c773986632a66584`, authored 2026-08-08) instead of the plan that was
actually active on those days (`pln_921083d889147c49`, live 2026-06-12 through
2026-08-08). The old tiebreak's `(archived_iso IS NULL) DESC` clause
unconditionally preferred the active plan even for dates that predate its own
`authored_iso` — a plan authored 08-08 that happened to carry backfilled rows
for the current week was outranking the plan that actually governed those
days. The reign-containment fix catches this too: the new plan's reign starts
at its own `authored_iso`, so it no longer claims days before it existed.

### The 26 reign-gap dates — a real data-integrity finding, not a fix defect

All 26 are explained and none are within any live consumer's actual query
window:

- **20 of 26** predate the covering account's own onboarding by days
  (`9298919a`, `d2f504ac`, `fb21cb09`, and the owner's `05-11`/`05-12`) — plan
  rows written retroactively for the current calendar week at signup time,
  where no plan's `authored_iso` actually precedes those dates. Pre-existing
  history, not live training data.
- **The owner's `06-30`/`07-02`** fall inside a ~4-week window
  (2026-05-13 → 2026-06-07) of rapid onboarding-era plan churn — dozens of
  plans each live for single-digit minutes, each writing a forward-looking
  multi-week horizon. None of those short-lived plans' reigns reach `06-30`
  or `07-02` (all archived weeks before those dates arrived), and the real
  plan (`pln_ca91f252bba50c74`) has no `plan_workouts` row for those two
  specific dates at all (confirmed: `MIN(date_iso)=2026-06-01`,
  `MAX(date_iso)=2026-08-16`, but no row for `06-30`/`07-02` — plausibly
  restructured out by one of its four in-place adaptations).
- **`606bcc38`'s `10-05`–`10-08`** and **`fb21cb09`'s `09-14`/`09-15`**: the
  currently-active plan on each account has no `plan_workouts` row that far
  out yet, while an earlier, now-archived, shorter-reigned plan does (from a
  longer originally-authored horizon). No live plan owns those far-future
  rows currently.

None of these fall inside `ADAPTATION_WINDOW_DAYS = 42` measured back from
any account's real "today," so no live consumer currently reads through this
branch. Flagging per the task brief rather than silently trusting the
fallback: **worth a follow-up look at why `pln_ca91f252bba50c74` is missing
rows for two mid-block dates**, separately from this fix.

## Downstream consumers — regression run

All four consumers named in the brief go through `ownedDaysSql` (three of
them transitively via `loadKeySessionExecutions`):

- `web-v2/lib/execution/load.ts` — direct caller.
- `web-v2/lib/coach/fitness-evidence.ts`, `race-replacement.ts`,
  `threshold-pattern.ts` — all call `loadKeySessionExecutions`, confirmed by
  grep (none hand-roll their own `plan_workouts` join).
- `web-v2/lib/plan/adaptive-ramp.ts` and `web-v2/lib/evidence/load-activity-evidence.ts`
  also call `ownedDaysSql` directly.

Ran the full relevant suite after the fix:

```
lib/plan/owned-days.ts
lib/plan/_owned_days_reign.audit.test.ts   (new — 3 tests, against real prod data)
lib/plan/_plan_undo.test.ts                (updated — describe block 5)
lib/audit/_active_plan_scan.test.ts        (ACTIVEPLAN-1 gate, unaffected)
lib/coach/fitness-evidence.test.ts
lib/coach/race-replacement.test.ts
lib/coach/threshold-pattern.test.ts
lib/execution/_reconstruct.test.ts
lib/execution/_interpret.test.ts
lib/plan/adaptive-ramp.test.ts
lib/evidence/_activity_evidence.test.ts
lib/evidence/_reexamination.test.ts
```

**11 files, 205 tests, all passing.** `tsc --noEmit` clean.

One pre-existing, unrelated failure was found and confirmed NOT caused by
this change: `lib/evidence/_activity_evidence.audit.test.ts` (2 of 4 tests
fail on splits-classification assertions unrelated to plan ownership).
Verified by stashing this change and re-running — identical 2 failures
before and after. Not touched, not in scope.

`lib/plan/_plan_undo.test.ts` describe block 5 needed updating: it asserted
on the literal old `ORDER BY` string. Rewrote its assertions to check the
new clause shape and ordering (reign-tiebreak precedes the pre-2026-09-01
fallback clauses within the `ORDER BY`), preserving the original test's
semantic intent (active plan still wins over a reverted one post-undo) rather
than just deleting the check.

## New regression test

`web-v2/lib/plan/_owned_days_reign.audit.test.ts` — modeled on the
established `.audit.test.ts` convention already in this codebase
(`lib/evidence/_activity_evidence.audit.test.ts`): needs `DATABASE_URL_RO`,
skips without it, not part of the CI gate chain, reads production data
read-only via the RO role. Three tests:

1. **Falsifier** (Rule 18) — proves the OLD tiebreak, reproduced verbatim
   inline, really does resolve all 7 report dates to the reverted ghost plan.
2. Proves the live `ownedDaysSql()` resolves all 7 report dates to the real
   plan, with the exact type/quality/distance/pace the investigation report
   recorded.
3. Proves the whole 42-day adaptation window resolves to exactly one plan
   with zero gaps.

`lib/plan/_plan_undo.test.ts`'s block 5 is the CI-safe structural sibling —
it pins the emitted SQL's clause shape without touching a database, so a
regression to the naive `authored_iso DESC` ordering fails even where no DB
is reachable.

## Does this change live behavior?

**Yes, for the owner's account specifically, and it should.** This is a
read-path fix, and every consumer named above reads through it live:

- **`fitness-evidence.ts`, `race-replacement.ts`, `threshold-pattern.ts`,
  `adaptive-ramp.ts`** — any coach-log finding, adaptation verdict, or
  progression decision that touched dates `07-23` or `07-30` for account
  `0645f40c…` was reading the wrong session type/distance/quality flag for
  those two dates specifically, plus the wrong (though numerically identical)
  plan-id provenance for the other 5. Anything downstream that keyed off
  `07-23` being a **tempo 4.0mi** session (instead of the real **intervals
  7.5mi @389**) or `07-30` counting as a **quality session at all** (instead
  of non-quality easy) was wrong and will now read correctly.
- **Account `606bcc38…`** gets a real, independent correction on 5 dates
  (`08-03`–`08-07`): those days now correctly attribute to the plan that was
  actually active then, not the plan authored the following week.
- **Every other account** (`9298919a`, `b04e35e9`, `bcefea06`, `d2f504ac`,
  `fb21cb09`) — zero date changes. No behavior shift.

This is a correction, not a new capability — the runner's actual training
history did not change, only which stored `plan_workouts` row the readers now
correctly attribute to each date. Any surface currently displaying a
finding derived from the wrong 07-23/07-30 data (or account `606bcc38`'s
08-03–08-07) should update to reflect the corrected picture on next read;
nothing was denormalized or cached beyond the query itself, so no cache
invalidation or backfill is needed.

## Known open item: a concurrent, uncommitted, differently-shaped attempt at this same fix

While this fix was in progress, three untracked, uncommitted files appeared
in this shared checkout, written by a different, concurrent process working
the identical brief (same report, same account, same dates, independently
derived): `web-v2/lib/plan/_owned_days_reign.test.ts`,
`web-v2/lib/plan/_probe_owned_days_reign_2026-09-01.test.ts`. That process's
draft reign definition truncates the *active* plan's upper bound at
`COALESCE(archived_iso, now())` — the same flaw this report's "real defect
caught in my own first draft" section describes and rejects, which breaks
every currently-scheduled future day. It was left untouched (not deleted,
not modified) per this session's instruction not to touch files it does not
own in a shared checkout, and was NOT staged or committed as part of this
fix. **Flagging for David:** if that other session commits its version of
`owned-days.ts`, it would reintroduce the future-day truncation bug this
report's verification caught and fixed — worth checking before merging
whichever lands second.

## Files changed

- `web-v2/lib/plan/owned-days.ts` — the fix.
- `web-v2/lib/plan/_plan_undo.test.ts` — updated describe block 5 to match
  the new `ORDER BY` shape.
- `web-v2/lib/plan/_owned_days_reign.audit.test.ts` — new regression test.
