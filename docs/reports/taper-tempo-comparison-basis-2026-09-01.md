# Taper-tempo comparison basis — what `classifyAdaptation` actually scored against

**Investigation date:** 2026-09-01 · **Account:** `0645f40c-951d-4ccc-b86e-9979cd26c795` (AFC half marathon, 2026-08-16)
**Status:** read-only. No code changed. No data written.

## The question

David asked whether the 08-04 and 08-06 tempo "under-execution" findings compared
the runner's actual mileage against the plan's own **contemporaneous, already-taper-reduced**
ask, or against a **stale/generic full-build number** the taper had moved past.

## Direct answer

**Neither, exactly — and the real answer is more specific than either hypothesis.**

For 08-04 and 08-06, the number `classifyAdaptation` scored against (8.0 mi tempo
@ 419 s/mi) **was not reduced for taper, because the plan itself had not reduced
it.** The plan that actually served this runner kept the tempo sessions at full
pre-taper size (8.0 mi @ 419) all the way through 08-06 — taper week 9 only cut
the *easy* days (8→6 mi) and the *long run* (16→12 mi). So scoring 08-04/08-06
against 8.0 mi is scoring against the runner's real, live, contemporaneous ask.
**This is a true under-execution finding for those two dates, not a
comparison-basis bug.**

But the investigation surfaced a real, separate, more serious bug while
confirming that: for **07-30**, the "tempo 5.0 mi, not run" line in the original
report does not correspond to anything ever actually prescribed to this runner
on that date. The plan that really served him that day called for an **easy 7.5
mi run — not a quality session at all.** The "5.0 mi tempo" the model scored
against 07-30 came from a plan version that was live for **21 minutes**, back on
**2026-06-07**, and was reverted before it ever reached the runner. That is not
a windowing problem and not an intent-vs-taper problem — it's the reader
resolving to the wrong plan version entirely. See "Root cause" below.

## Code path traced

`classifyAdaptation` (`web-v2/lib/adaptation/adaptation-model.ts:628`) is pure —
it consumes `AdaptationInput.keySessionExecutions`, doesn't touch the database,
and does not choose what counts as "prescribed." That choice is made one layer
down:

- `web-v2/lib/adaptation/load.ts:loadAdaptationInput` — assembles the input.
  Window is `ADAPTATION_WINDOW_DAYS = 42` days ending "today" (`web-v2/lib/adaptation/load.ts:62`).
  It calls `loadKeySessionExecutions(userUuid, fromISO, todayISO, vdot)` (`load.ts:171`).
- `web-v2/lib/execution/load.ts:loadKeySessionExecutions` — for each date in the
  window, pulls the "owned" `plan_workouts` row via `ownedDaysSql()`
  (`lib/plan/owned-days.ts`), filters to `is_quality = true`, reconstructs the
  planned stimulus from `workout_spec`/`distance_mi`/`pace_target_s_per_mi` via
  `plannedStimulus()` (`lib/execution/reconstruct.ts:262`), and compares it
  against the actual run via `interpretExecution()`.
- `web-v2/lib/plan/owned-days.ts:ownedDaysSql` — this is the part that decides
  **which plan version's row wins** for a given calendar date, when (as is
  always true here) multiple `training_plans` rows cover the same date because
  the plan was rebuilt/regenerated over time. The tiebreak is:

  ```sql
  ORDER BY pw.date_iso, (tp.archived_iso IS NULL) DESC, tp.authored_iso DESC
  ```

  i.e.: prefer the currently-active plan if it covers the date; otherwise take
  the row from whichever plan (active or archived) has the **latest
  `authored_iso`**.

So: **David's first hypothesis is the mechanically correct one** — the model
does read the live `plan_workouts` row for that specific date, not a hardcoded
catalogue default and not a fixed weekly target. It is not comparing against a
"generic tempo expectation regardless of what the plan actually prescribed."
The defect is in *which plan version's row* the tiebreak picks, not in whether
it looks at `plan_workouts` at all.

## Database evidence

### The plan that actually served this runner

```
id: pln_ca91f252bba50c74
mode: race-prep · goal_iso: 2026-08-16 (AFC)
authored_iso: 2026-06-03 19:23:35 UTC
archived_iso: 2026-08-17 18:04:54 UTC
archive_reason: race_completed
adaptation_log: adapted in place on 2026-07-01, 2026-07-03, 2026-07-06, 2026-07-31
```

This plan was authored 2026-06-03 and stayed the account's live plan
continuously until it was archived the day *after* the AFC race, with
`archive_reason = 'race_completed'` — exactly the event you'd expect to close
out a training block. It was adapted in place four times over the block. This
is, as close as the schema records it, the plan the runner actually trained
under for the entire July–August build/taper/race window.

Its own phase table (`plan_phases`/`plan_weeks` for this plan id) labels the
block explicitly:

| week_idx | week_start | phase | is_race_week |
|---|---|---|---|
| 7 | 2026-07-20 | RACE-SPECIFIC | f |
| 8 | 2026-07-27 | RACE-SPECIFIC | f |
| 9 | 2026-08-03 | TAPER | f |
| 10 | 2026-08-10 | TAPER | t |

Its actual `plan_workouts` rows for the window in question:

| date | type | is_quality | distance_mi | pace_target_s/mi | phase |
|---|---|---|---|---|---|
| 07-21 | tempo | t | 8 | 419 | RACE-SPECIFIC |
| 07-23 | **intervals** | t | **7.5** | **389** | RACE-SPECIFIC |
| 07-28 | tempo | t | 8 | 419 | RACE-SPECIFIC |
| 07-30 | **easy** | **f** | **7.5** | — | RACE-SPECIFIC |
| 08-04 | tempo | t | 8 | 419 | **TAPER** |
| 08-06 | tempo | t | 8 | 419 | **TAPER** |
| 08-11 | race_week_tuneup | t | 5.5 | 412 | TAPER (race week) |
| 08-16 | race | t | 13.1 | 412 | TAPER (race week) |

### What `ownedDaysSql` actually resolves today, for the same dates

```sql
SELECT DISTINCT ON (pw.date_iso) ...
 WHERE pw.user_uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795'
   AND pw.date_iso >= '2026-07-06' AND pw.date_iso < '2026-08-17'
 ORDER BY pw.date_iso, (tp.archived_iso IS NULL) DESC, tp.authored_iso DESC
```

Every single date in the entire 42-day window resolves to **one plan**:

```
id: pln_c0ff77ee065b8fe4
authored_iso: 2026-06-07 04:02:50.866 UTC
archived_iso: 2026-06-07 04:23:17.454 UTC   ← 21 minutes later
archive_reason: (none)
adaptation_log: [] (never adapted)
```

`pln_c0ff77ee065b8fe4`'s own `authored_state` shows it was a legitimate,
fully-composed 11-week regeneration (citations, phase table, `is_mid_block:
true`, a `horizon_raise` toward a later CIM marathon) — not test/garbage data.
It existed, live, for 21 minutes on 2026-06-07 and was then archived with no
reason recorded, while `pln_ca91f252bba50c74` (authored four days earlier,
06-03) continued uninterrupted through to race day. Because
`training_plans_active_uq` allows only one non-archived plan per runner at a
time, `pln_ca91f252bba50c74` must have been briefly archived and then
un-archived within that same 21-minute window for both facts to be true
simultaneously — exactly the "undo" mechanism `owned-days.ts`'s own header
comment describes (`POST /api/plan/undo` un-archiving an older plan). Whatever
the trigger, the practical result is: **`pln_c0ff77ee065b8fe4` was never the
plan the runner trained against on any of these dates**, but because it was
authored *after* `pln_ca91f252bba50c74` (2026-06-07 vs. 2026-06-03) and the
`(archived_iso IS NULL) DESC` tiebreak stops discriminating once **both**
candidates are eventually archived (which happened once AFC completed on
08-17 and archived the real plan too), `authored_iso DESC` alone decides — and
a plan that was live for 21 minutes beats one that was live for two and a half
months and adapted four times.

`pln_c0ff77ee065b8fe4`'s rows for the dates in question:

| date | type | is_quality | distance_mi | pace_target_s/mi |
|---|---|---|---|---|
| 07-21 | tempo | t | 8 | 419 |
| 07-23 | tempo | t | **4** | **419** |
| 07-28 | tempo | t | 8 | 419 |
| 07-30 | tempo | t | **5** | 419 |
| 08-04 | tempo | t | 8 | 419 |
| 08-06 | tempo | t | 8 | 419 |
| 08-16 | race | t | 13.1 | 407 |

These are exactly the "prescribed" numbers in the original report's table.

## Per-session verdict

| date | report's "prescribed" (from `pln_c0ff77ee065b8fe4`, wrong plan) | real, contemporaneous ask (from `pln_ca91f252bba50c74`) | verdict |
|---|---|---|---|
| 07-21 tempo | 8.0 mi @ 419 | tempo 8.0 mi @ 419 | **Matches by coincidence.** Comparison basis happens to be correct. Genuine full-build ask, correctly scored. |
| 07-23 tempo | 4.0 mi @ 419 | **intervals** 7.5 mi @ 389 | **Wrong.** Wrong session type, wrong distance (nearly double), wrong pace domain. Scored as "read as full" on a 5.1 mi actual against a 4.0 mi target (127%); against the real 7.5 mi interval prescription, 5.1 mi is 68% — likely a partial, not a full, read. Not asked about directly but caught in this audit; flagged below. |
| 07-28 tempo | 8.0 mi @ 419 | tempo 8.0 mi @ 419 | **Matches by coincidence.** Pre-taper, RACE-SPECIFIC phase. Genuine full-build ask, correctly scored. |
| 07-30 tempo | 5.0 mi @ 419 | **easy** 7.5 mi, non-quality | **Wrong, and not a taper question at all.** This date was never a key/quality session in the plan the runner actually trained under. It should not have been among the "7 key sessions" scored in this window at all. The "not run" verdict is not "the runner skipped a reduced-for-taper tempo" — it's "the model invented a tempo session out of a plan version that was reverted before it ever reached him." |
| 08-04 tempo | 8.0 mi @ 419 | tempo 8.0 mi @ 419, **TAPER week 9** | **Matches, and this is the important one.** The taper phase (week 9) had NOT reduced the tempo session as of 08-04 — only the surrounding easy days (8→6 mi) and the upcoming long run (16→12 mi) had shrunk. The 8.0 mi ask was genuinely, contemporaneously live. Runner ran 4.8 mi = ~60%. **True partial-execution finding, correctly sourced (by coincidence of the wrong-plan bug not mattering here).** |
| 08-06 tempo | 8.0 mi @ 419 | tempo 8.0 mi @ 419, TAPER week 9 | **Matches, same as 08-04.** Genuinely live full ask, not yet taper-reduced at the session level. Runner ran 4.9 mi = ~61%. **True partial-execution finding.** |
| 08-16 race | 13.1 mi @ 407 | race 13.1 mi @ 412 | Matches (pace target off by 5 s/mi, immaterial — `replacedByRace` routes this to the `REPLACED` state regardless of the target). Correctly read as replaced-by-race. |

## Root cause classification

**This is not the intent/comparison bug David hypothesized** (comparing a
correctly-taper-reduced live ask against a stale full-build reference). For the
two dates he specifically asked about — 08-04 and 08-06 — the live plan had
**not yet reduced the tempo ask at all**; the number scored against really was
the runner's live, current, undiminished prescription. If anything, this
argues the opposite of his hypothesis: the taper's own volume reduction hadn't
reached the quality sessions yet by 08-04/08-06, so grading them at full size
was doctrinally consistent with what "TAPER week 9" in this plan actually
asked for.

**It is also not a pure windowing problem** (comparing against the right
number, but the window shouldn't have included the date) — 07-28, 08-04, and
08-06 are correctly inside/outside their respective phases per the plan's own
labels, and the numbers used for them are right regardless of which plan
version supplied them.

**What it actually is, found while checking the boundary dates as asked:** a
**wrong-plan-version-selection bug** in `ownedDaysSql`'s tiebreak
(`web-v2/lib/plan/owned-days.ts`). The `(archived_iso IS NULL) DESC,
authored_iso DESC` ordering is explicitly designed (per that file's own
2026-08-25 header note) to prefer the plan that is *currently* active, and
falls back to "most recently authored" only to pick among archived versions.
That fallback assumes "most recently authored" approximates "most
authoritative retroactively" — true for an ordinary rebuild, false when a
later-authored regeneration was itself short-lived and undone. Once the
runner's *real* long-lived plan is also archived (which happens for any block
once the race completes), a 21-minute, reverted, never-served regeneration
with a later `authored_iso` timestamp permanently outranks it for every date
they both cover. This reproduced across the **entire 42-day scoring window**
used by `classifyAdaptation` for this account, not just the four dates in
question — every date from 07-06 through 08-16 currently resolves through the
reverted `pln_c0ff77ee065b8fe4`, not the plan that was actually run against.

It happens to not change the *numbers* for 5 of the 7 key sessions in this
window (07-21, 07-28, 08-04, 08-06, 08-16), because the reverted plan and the
real plan agree on those particular dates. It materially breaks 07-30 (invents
a tempo session that never existed) and 07-23 (wrong type/distance/pace,
though the "full" verdict happens not to flip).

## What this means for the follow-up brief

- The taper-vs-full-ask question, as posed, resolves cleanly: **08-04/08-06 are
  correctly scored against a genuinely live, un-reduced tempo ask.** No fix
  needed there specific to taper-intent.
- **07-30 needs to be dropped from the "under-executed" narrative entirely** —
  it was never a key session in the plan the runner trained under. That's a
  fact independent of the intent/comparison split already decided for
  `classifyAdaptation`'s execution dimension.
- A **new, distinct defect** exists in `ownedDaysSql` (`web-v2/lib/plan/owned-days.ts`):
  its authored-vs-active tiebreak can resolve to a plan version that was
  authored later but never actually served the runner, once both candidates
  are archived. This affects every consumer of `ownedDaysSql` /
  `loadKeySessionExecutions`, not just `classifyAdaptation` —
  `web-v2/lib/coach/fitness-evidence.ts`, `web-v2/lib/coach/race-replacement.ts`,
  `web-v2/lib/coach/threshold-pattern.ts`, and `web-v2/lib/plan/adaptive-ramp.ts`
  all call one of these. This was not fixed in this pass (out of scope per the
  read-only investigation brief) and is flagged separately.

## What was not done

- `classifyAdaptation`, `loadKeySessionExecutions`, and `ownedDaysSql` were not
  modified. The execution-dimension intent/comparison split remains David's
  separately-scoped, replay-gated follow-up as decided.
- All database access was read-only (`faff_readonly` role via
  `DATABASE_URL_RO`). No writes were made.
