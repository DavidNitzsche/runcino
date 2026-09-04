# Execution identity audit — why 2026-08-31 resolved as `legacy_type`

**Date** 2026-09-04 · **Branch** `ws3/execution-identity` · **Base** `origin/main` @ `5bd8a320`
**Scope** `lib/execution/day-resolver.ts` and the two write paths that feed it.
**Files changed** one new test (`web-v2/lib/execution/_identity_truth_table.test.ts`) and this
report. No source file was edited; `git diff origin/main -- web-v2/lib/execution/day-resolver.ts`
is empty.

The starting fact, handed to this audit: David's 2026-08-31 run resolved as
prescription `easy 4.5mi` → run `-41598809443969` (6.18 mi) → `match=legacy_type`. The
instruction was not to accept it as canonical merely because it went through the canonical
resolver. It was checked against production data, not against the code's own comments.

---

## 1 · Why the match is `legacy_type` and not `exact`

Production row, read 2026-09-04 (read-only, `runs` by id):

```
id                -41598809443969
source            apple_watch
data.type         easy
data.workoutType  easy
workoutTypeSource plan
data.planWorkoutId  NULL          ← the EXACT tier was never reachable
distanceMi        6.18            (prescribed 4.5 → +37.3%)
name / sportType  Run / Run
activityId        wko_F1BC81A2-9F57-402A-BB86-CAA8B2593CD3
ingestedAt        2026-09-04T17:05:15.363Z
```

`match=exact` requires `data.planWorkoutId` to equal a `plan_workouts.id` that exists on the
date **today**. The key is absent, so pass 1 could not fire and the row fell through to the
LEGACY tier, where it was admitted by `source='apple_watch'` + `data.type='easy'`
(PASSIVE-SYNC-TYPE-CONFIRM-1) + `workoutType='easy'` / `workoutTypeSource='plan'` + a single
easy prescription that date.

The tier is correct **given the row**. The row is the finding.

---

## 2 · Why `data.planWorkoutId` was absent

`activityId = wko_<HKWorkout.uuid>` is the slug shape minted by
`web-v2/app/api/ingest/workout/route.ts` — the passive HealthKit path. That route stamps
`workoutType` and `workoutTypeSource` (lines ~223-246) and **never** writes `planWorkoutId`.
The only writer of that key in the entire repo is
`web-v2/app/api/watch/workouts/complete/route.ts:710`, the app's own live tracker, and it has
only done so since `6e0ca1ae` (WORKOUT-EXECUTION-ID-1, 2026-09-03).

So the run reached the resolver through the one ingest path that structurally cannot produce
EXACT evidence. Nothing was lost or corrupted — the identifier was never minted.

**Coverage of the EXACT tier in production, measured:**

| | count |
|---|---|
| canonical `runs` rows (`NOT (data ? 'mergedIntoId')`) | **159** |
| of those, carrying `data.planWorkoutId` | **2** |

Two rows out of 159. The EXACT tier that `day-resolver.ts`'s header describes as the primary
evidence is, in this account's live data, essentially empty: **98.7% of every completion this
app has ever resolved rides the LEGACY tier.** That is not a defect — the stamp is a day old —
but it means the LEGACY tier's guards, not the EXACT tier's durability, are what actually
protect the runner today, and they should be read that way.

---

## 3 · EXECIDENT-1 · The passive path's "own type" is not the run's own type

**Severity: P1 · Open · Documented only, not fixed (another owner holds `day-resolver.ts`).**

`day-resolver.ts` states, in the comment that introduces the passive door:

> a passive sync now qualifies when its OWN self-reported `type` — not the borrowed
> `workoutType` stamp — independently agrees with the prescription

and `_day_resolver.test.ts` asserts the corollary:

> a Strava-sourced sync never qualifies here, own type or not

On the very row the fix was written for, both statements are false. The `runs.provenance`
column for `-41598809443969` reads:

```json
{"type":"strava_webhook","sportType":"strava","stravaRaw":"strava_webhook","kudosCount":"strava", …}
```

`data.type = 'easy'` is **Strava's value**, absorbed off the merged Strava sibling
(`19981296070`, source `strava_webhook`, `mergedIntoId = -41598809443969`) by
`lib/runs/canonical.ts:absorbFieldsIntoCanonical`, which copies every key not in `NEVER_COPY`.
`source` is in that set (line 377) — so the canonical row keeps its own `apple_watch` label.
`type` is not — so the canonical row wears Strava's classification under an Apple Watch source.

The Strava side of it is worse. `app/api/strava/webhook/route.ts:695`:

```ts
function stravaTypeToFaff(activity: any): string {
  const w = activity?.workout_type;
  if (w === 1) return 'race';
  if (w === 2) return 'long';
  if (w === 3) return 'workout';
  return 'easy';                    // ← workout_type === 0 · Strava's DEFAULT
}
```

`workout_type === 0` means the runner labelled nothing at all. It is rendered as the
affirmative string `'easy'`.

So the "independent confirmation" gating the passive door is:

1. **Strava's**, on a path whose own tests assert Strava never qualifies — laundered through
   the merge, because `source` is protected from absorption and `type` is not.
2. **An absence rendered as an assertion.** This is the Rule 11 collapse verbatim: "don't
   know" and "measured easy" are two facts, and `stravaTypeToFaff` returns one string for
   both. `ownTypeConfirms` deliberately refuses `null` and `'Run'` because "every run —
   related or unrelated — could carry either". `'easy'` derived from `workout_type = 0` is
   exactly that same fact wearing a different string.
3. **Unverifiable at the read.** The anchor is already recorded — `runs.provenance` says
   `type: strava_webhook` — and `resolveDateRangeExecutions` does not select the column, so
   the resolver cannot tell an absorbed value from a self-report. Rule 10: a persisted derived
   value carries its anchor or is recomputed. Here it carries the anchor in the next column
   over and nobody reads it.

**Data shape across the whole database.** Every non-generic `data.type` value in `runs` is the
literal string `'easy'`, on 29 canonical rows. There is no row anywhere carrying `'tempo'`,
`'intervals'`, `'threshold'` or `'long'` in that key. Three of the 29 carry a `type` that
*disagrees* with their own plan stamp (`type='easy'` while `workoutType='long'` ×2,
`'threshold'` ×1).

Two consequences follow:

- **The passive door is, in practice, an easy-day-only door.** It cannot confirm a quality
  prescription for lack of any run carrying a quality `type`. The 2026-09-03 friend's-run
  incident is closed on quality days for that reason and that reason alone.
- **On an easy day the door is open on Strava's default.** Today exactly one row in
  production is legacy-tier-eligible through the passive path (this one). Going forward every
  `apple_watch` canonical that merges with a Strava sibling and lands inside the ingest
  distance band arrives in the same shape. An unrelated easy run — the friend's-run scenario
  transplanted from a hill day to an easy day — is not distinguishable from the prescribed one
  by anything the resolver reads.

**Recommended posture (for the owner of `day-resolver.ts`, not applied here).** Three options,
in preference order:

1. Fix the source: `stravaTypeToFaff` should return `null` for `workout_type === 0` rather
   than `'easy'`. Absence is a third fact and it already has a representation. This is the
   Rule 11 fix and it removes the defect at the point it is created.
2. Read the anchor: add `r.provenance` to the resolver's run query and require
   `provenance.type` to be absent or a trusted source before `ownTypeConfirms` may fire.
3. Add `'type'` to `NEVER_COPY` in `lib/runs/canonical.ts`, so a canonical row's `type` is
   never a sibling's. Cheapest, but changes absorption behaviour for other readers and needs
   its own sweep.

Tracked in the new test file as an `it.fails` (`EXECIDENT-1 · the passive path cannot see
where data.type came from`), so it turns green the day the resolver selects `provenance` and
red again if the gap is closed a different way — rather than living only in this document.

---

## 4 · The LEGACY tier applies no distance bound of its own (boundary, not a defect)

`day-resolver.ts` pass 2 compares source, own type, `workoutTypeSource` and `workoutType`.
It never compares distances. The only distance bound protecting the tier is `[0.7×, 2.0×]`,
frozen into `data.workoutType` at ingest time by `lib/runs/plan-type-stamp.ts`
(`PLANNED_DISTANCE_FLOOR_MULT` / `PLANNED_DISTANCE_CEILING_MULT`, widened by OVERRUN-MATCH-1
on 2026-09-04 — the change that made this very run match).

That is a Rule 10 shape: a derived value persisted at write time, read back later as
authoritative, with no re-derivation. If the prescription's distance changes after the stamp
is written — a rebuild, a reschedule, an adaptation resizing the day — nothing re-checks the
band, and the stale stamp still admits the run. Stated as a passing row in the truth table
(`RESOLVER-APPLIES-NO-DISTANCE-BOUND`) so the fact is visible rather than implicit; explicitly
not endorsed.

Note also that `/api/ingest/workout`'s stamp query is `… AND pw.type NOT IN ('rest') LIMIT 1`
with **no `ORDER BY`** — an arbitrary pick on a two-a-day. The completion route was fixed for
this in `6e0ca1ae` (it now reads every non-rest prescription and picks the closest band fit);
the ingest route still has the original shape. Out of this workstream's scope, flagged.

---

## 5 · EXECIDENT-2 · A guard the header credits is not the guard that holds (P3)

`ownTypeConfirms` refuses the generic label twice:

```ts
if (norm === '' || norm === 'run') return false;          // credited in the header
return norm === normType(prescribedType).toLowerCase();   // what actually holds
```

Falsified both ways: removing **either** line alone leaves all four generic-label rows in the
truth table green, because no `plan_workouts.type` in production is `'run'` or `''` (measured:
`easy` 2107, `rest` 910, `long` 608, `threshold` 399, `tempo` 262, `interval` 214, `intervals`
74, `race` 56, `shakeout` 54, `strength` 44, `race_week_tuneup` 14). Removing **both** turns
all four red. The early return is therefore defence in depth, not the load-bearing guard the
comment presents it as — worth one sentence of correction in the header so the next reader
does not audit the wrong line. Rule 18's own lesson pointed at prose.

Adjacent, noted not diagnosed: `plan_workouts.type` carries both `'interval'` (214 rows) and
`'intervals'` (74) for one concept — Rule 16, one quantity one name. `normType` collapses
neither. Harmless at the resolver today (the stamp is copied verbatim from the prescription's
own type, so the two always agree, and no run carries either string in `data.type`), but it is
a live split in a column the LEGACY tier compares on.

---

## 6 · Could this path attach another runner's activity, or an unrelated supplemental?

**Another runner's activity: no, and it is scoped in two independent places.**
`resolveDateRangeExecutions` filters runs on `r.user_uuid = $1` and reads prescriptions
through `ownedDaysSql`, which filters `pw.user_uuid = $userParam`; the canonical-id gate is
`getCanonicalRunIds(userUuid, from, to)`. Asserted in the new test on SQL text and bound
parameters (`pool.query` is mocked, so this is not a runtime proof — stated as blind spot 4 in
the test header). Defence in depth beyond the scope: a foreign `planWorkoutId` names a
prescription that does not exist on this day, and pass 2 refuses to re-guess for a run that
has already declared what it executed (`if (r.matchedWorkoutId) return false`) — so even a
leaked row is inert. Verified: `runs` currently holds **one** distinct `user_uuid`, so this
path has never been exercised against a second account in production.

**An unrelated supplemental activity: yes, on an easy day — see §3.** On a quality day, no,
for the data-shape reason in §3 rather than by design. The six signals David's ruling names as
insufficient are all genuinely refused, and each is now a falsifiable row:

| Signal | Refused | Falsified by |
|---|---|---|
| Same calendar date | yes | pre-fix predicate → 28 of 59 tests red |
| Only run of the day | yes | same |
| Largest run of the day | yes | same |
| Similar / identical distance | yes | same |
| Workout name identical to `sub_label` | yes | resolver reads no name field at all |
| Workout type alone | yes | source gate + `workoutTypeSource !== 'plan'` |

---

## 7 · The gate that now covers this

`web-v2/lib/execution/_identity_truth_table.test.ts` — 59 tests, 58 passing, 1 `it.fails`
(EXECIDENT-1). Table-driven over 15 named invariants, plus six universal conservation
invariants applied to **every** row: supplemental-carries-no-claim, match-is-self-consistent,
one-run-one-prescription, matched-and-supplemental-disjoint, run-set-conservation, and
no-phantom-prescription. Plus a `lib/plan/seal.ts` block proving "never completes" and "never
seals" are both true (they are two claims and only the first had coverage), and a Rule 14
population-scope block.

**Falsification log (Rule 18).** Every edit made to `day-resolver.ts` locally, run, then
reverted; the file's md5 is unchanged (`649d1ec0bfe7aaec4f650a1d19ea1051`) and `git status`
shows no modification to it.

| # | Guard removed | Rows turned red |
|---|---|---|
| 1 | `if ((typeCounts.get(t) ?? 0) !== 1) continue` | 3 — both AMBIGUITY rows + the ambiguous seal row |
| 2 | `if (r.matchedWorkoutId) return false` | 3 — FOREIGN-LINK + its seal row + the scope row |
| 3 | `if (norm === '' \|\| norm === 'run') return false` | **0** → recorded as EXECIDENT-2 |
| 3b | `return norm === normType(prescribedType)…` → `true` | 1 — the DISAGREE row |
| 3c | both of the above | 5 — the whole GENERIC-LABEL group |
| 4 | source gate widened to any passive sync | 9 — every PASSIVE-PATH row + the perfect-Strava row |
| 5 | `claimed.add(best.runId)` in pass 1 | 5 — both MIRROR rows, both TREADMILL rows, the exact overrun |
| 6 | `return plannedType != null && …` → `true` | **0** — `workoutTypeSource !== 'plan'` catches first |
| 7 | whole pass-2 predicate → `!claimed.has(r.runId)` (the pre-fix rule) | **28 of 59** |

Runs 3 and 6 are why two `falsifiedBy` notes in the test file were rewritten before commit:
the guard I first named was not the guard that holds. A falsification that comes back clean is
the point of doing it.

**What this gate cannot fail on** is stated in the test file's own header (Rule 22): the write
side, `data.type` provenance, dedup correctness, runtime cross-user leakage, rendering
(Rule 13 is not satisfied by anything here), and grading prose.

---

## 8 · Open items for other owners

| Id | Owner | Item |
|---|---|---|
| EXECIDENT-1 | `day-resolver.ts` / `strava/webhook` | `stravaTypeToFaff` returns `'easy'` for Strava's unlabelled default; the value is absorbed onto `apple_watch` canonicals and read as an independent self-report. §3. |
| EXECIDENT-2 | `day-resolver.ts` | The header credits the `'run'`/`''` early return with a defence the type-equality check is actually providing. §5. |
| EXECIDENT-3 | `api/ingest/workout` | The `workoutType` stamp query is `LIMIT 1` with no `ORDER BY` — arbitrary on a two-a-day. The completion route was fixed for this in `6e0ca1ae`; this route was not. §4. |
| EXECIDENT-4 | `plan_workouts` | `'interval'` and `'intervals'` are one concept under two names, 214 / 74 rows. Rule 16. §5. |
