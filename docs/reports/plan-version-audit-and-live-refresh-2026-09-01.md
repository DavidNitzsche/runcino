# Plan-version-fix downstream audit, and a live-row check — 2026-09-01

**Scope:** two related pieces of work. Part A is read-only investigation of
whether the `ownedDaysSql` reign fix
(`docs/reports/owned-days-plan-selection-fix-2026-09-01.md`) actually changed
any downstream evidence, decision, or persisted record — not just whether it
was logically correct. Part B is a real, narrowly-scoped audit of the owner's
live plan rows, using only the already-authorized recompute path
(`recomputePacesForPlan`/`reanchorActivePlan`) if anything needed it. Neither
part touches `lib/adaptation/*`, `lib/plan/generate.ts`,
`spec-builder.ts`/`spec-card.ts`/`expand-spec.ts`, or Adaptation Engine shadow
proposals. No files were edited. No writes were made to the database from this
session — Part B found nothing that needed the recompute path invoked.

Accounts: owner `0645f40c-951d-4ccc-b86e-9979cd26c795`, second account
`606bcc38-298b-48a1-9e9a-090509b213c9` (`606bcc38…` in the original report).

---

## Part A — did the query fix actually change any evidence or decision?

Method: for each named consumer, determined its lookback window and asked
whether that window, at any point during the bug-live period (roughly
2026-08-16, when the AFC-race archival first made the account's real plan
"fully archived" alongside the ghost, through the fix landing at
2026-08-31T23:32Z), ever overlapped the two corrected owner dates
(2026-07-23, 2026-07-30) or the second account's corrected window
(2026-08-03–08-07). Where a window overlapped, rendered the actual before/after
read using the real pure functions against real data (Rule 13), not assumed.

### `fitness-evidence.ts`, `threshold-pattern.ts`, `race-replacement.ts` — UNCHANGED

All three use a 4-day lookback (`FITNESS_EVIDENCE_LOOKBACK_DAYS` /
`THRESHOLD_PATTERN_LOOKBACK_DAYS` / `RACE_REPLACEMENT_LOOKBACK_DAYS = 4`) from
the real "today" at cron time. The bug only manifests once the account's real
plan is archived (~08-16); by then 07-23 and 07-30 are 2+ weeks stale and
outside any 4-day window forever after. These consumers' windows never touched
the corrupted dates for either account.

Confirmed empirically, not just by window arithmetic:

- `coach_log_race_replacement` fired exactly once for the owner, for
  `2026-08-16` (the AFC race itself) — correct, unaffected.
- Zero `coach_memory_*` rows exist for either account, ever. `threshold-pattern.ts`
  has never promoted a pattern for anyone in this database, so there is
  nothing it could have gotten wrong.
- No coach_intents row for either account references 07-23, 07-30, or the
  second account's 08-03–08-07 dates through any of these three reasons.

### `adaptive-ramp.ts` — UNCHANGED

`QUALITY_LOOKBACK_DAYS = 14`, from the real "today." The earliest the bug
could fire is 08-16; 14 days back from 08-16 is 08-02 — already past 07-30.
This consumer's window never reached the corrupted dates at any point in the
bug-live period. Confirmed: `coach_intents.reason = 'plan_adapt_bump'` is
still 0 rows in the whole database (matches Rule 21's independent finding,
unrelated to this fix).

### `lib/adaptation/load.ts` (`loadAdaptationInput` / `classifyAdaptation` / `readAdaptation`) — CHANGED, rendered concretely

`ADAPTATION_WINDOW_DAYS = 42`. From any "today" between 08-16 and 08-31, this
window's lower bound is 07-05 through 07-20 — it contained BOTH 07-23 and
07-30 for the owner throughout the entire bug-live period.

Rendered the real before/after read by calling the actual exported pure
functions (`plannedStimulus`, `actualStimulus`, `executionContext`,
`interpretExecution`, `earnsProgressionCredit`) against the real run rows and
both the old (ghost-plan) and new (real-plan) `plan_workouts` rows for these
two dates:

**2026-07-23** — actual run: one treadmill session, 5.06 mi total, 9 phases.

| | OLD (ghost plan: tempo, 4 mi @419) | NEW (real plan: intervals, 7.5 mi @389, 4×1mi) |
|---|---|---|
| state | `PARTIAL_PRODUCTIVE` | `PARTIAL_PRODUCTIVE` |
| stimulusCompletion | **1.0** | **0.722** |
| earnsProgression | **true** | **false** |
| evidence.execution | `full` | `partial` |
| evidence.fitness | `moderate` | `low` |

The work-phase distance (2.89 mi) graded as *more than the whole session
asked for* against the wrong (2 mi tempo) target, and as *72% of the session*
against the correct (4 mi interval-work) target. **Progression credit flips
true→false.** The bug had been over-crediting this date, not under-crediting
it.

**2026-07-30** — no run exists on this date at all (checked ±0 with no
fallback needed — nothing in `runs` matches this calendar day for the owner).

| | OLD (ghost plan: tempo, 5 mi, `is_quality=true`) | NEW (real plan: easy, 7.5 mi, `is_quality=false`) |
|---|---|---|
| Appears as a key session at all? | **yes** | **no** |
| state | `MISSED` | — (excluded before reaching the classifier) |

Under the bug, this date was wrongly counted as a missed *quality* session
(the plan never actually asked for quality that day). Under the fix it is
correctly absent from the key-session set entirely — the `WHERE
owned.is_quality = true` filter drops it now that the real plan's `easy` row
resolves for that date.

**Net effect on the 42-day execution dimension:** mixed, not one-directional —
07-23 lost a false positive-progression credit; 07-30 lost a false missed-quality
penalty. Both are corrections toward the truth, in opposite raw directions.

**Did any persisted decision actually change?** Checked directly: zero
`coach_intents` rows for the owner since 2026-08-01 carry reason
`plan_adapt_bump`, `plan_adapt_downgrade`, `plan_adapt_reschedule`,
`readiness_pullback`, `progression_gate`, or `mark_upgrade`. `readAdaptation`
is called live (uncached) from `app/api/coach/read/route.ts` and from
`lib/plan/adapt.ts`'s `detectProgressionGate`, and both recompute fresh on
every call — there is no cached/stored verdict anywhere to be stale. So while
the *computed* verdict would have differed on request during the exposure
window, **nothing was ever persisted from it**, and every read from this point
forward is already correct because the underlying query is fixed. There is
nothing to backfill or correct.

The third caller, `lib/adaptation/load-adaptation-engine.ts` (the Adaptation
Engine's shadow-mode `actual_load_absorption`/`representative_execution`
split), is explicitly out of scope for this task — noted only informationally:
its inputs were affected by the same window during the same period, but it
writes no live mutation (per its own header, "still nothing wired into any
live path"), so this is not a live-behavior concern.

### Second account (606bcc38…), 2026-08-03–08-07 — CHANGED metadata, ZERO behavioral impact

Confirmed the corrected window resolves to a different real plan than the
buggy read claimed (as the original fix report found), with genuinely
different session metadata on 08-04 (OLD: tempo 7 mi @503 s/mi from the wrong,
later-authored plan; NEW: tempo 8 mi @480 s/mi from the plan that was
actually active that week) and different framing on the surrounding days
(OLD: rest/rest/easy/easy; NEW: easy+strength/rest/easy+strength/rest).

But: **zero runs exist anywhere in `runs` for this account across the entire
08-02–08-08 window** — matching the account's own coach-log entry for that
week, "A zero week went in the book." With no actual run to compare against:

- `loadKeySessionExecutions`' one `is_quality=true` day in the window
  (08-04) reads `MISSED` under both the old and new plan attribution — the
  distance/pace difference never gets compared against anything.
- `readConsistency`'s weekly ratio (`lib/adaptation/adaptation-model.ts`) is
  `actual / planned = 0 / 17 = 0` under OLD and `0 / 22 = 0` under NEW —
  identical, because dividing zero actual by any nonzero planned mileage gives
  zero either way.

Confirmed by direct computation, not assumption: **every consumer produces
byte-identical output for this account's affected window, old or new.** The
wrong plan attribution was real but inert here, because nothing was run to
grade against it.

### Extra consumer found beyond the four named: `load-activity-evidence.ts` → `capacity-resolver.ts`

`classifyRecentActivities` also calls `ownedDaysSql` directly and feeds
`resolveThresholdCapacity`'s reexamination pressure (`REEXAMINATION_WINDOW_DAYS
= 28`, in `lib/evidence/reexamination.ts`) — the canonical threshold-capacity
resolver CLAUDE.md names as load-bearing — and the Adaptation Engine's shadow
path (out of scope, noted only).

This is the most notable finding of Part A: `intentForPlanType('tempo')`
resolves to `'THRESHOLD'`; `intentForPlanType('intervals')` resolves to
`'INTERVALS'`. So during the exposure window (07-23 stayed inside the 28-day
reexamination window from 08-16 through roughly 08-20), the ghost plan's
mislabeling caused the owner's 07-23 treadmill effort to be classified as
**THRESHOLD-intent evidence** when the runner actually ran an INTERVALS
session — a real contamination of a canonical capacity resolver's input, not
just a display bug.

Checked for actual consequence: `resolveThresholdCapacity`'s reexamination
pressure requires `CORROBORATION_MIN_OBSERVATIONS` before it can move a
belief off a single date, and the owner's persisted `projection_snapshots.vdot`
sat flat at **44.1 for the entire exposure window** (08-10 through 08-30,
unbroken), moving only on 08-31 — coincident with the LTHR reanchor and fresh
plan authoring that morning, not with any reexamination-triggered move.
**No persisted capacity estimate moved because of this contamination.** Flagged
here because it is real and worth knowing, not because it caused a measured
defect.

### Adjacent finding — NOT caused by this fix, flagged separately

While reading `lib/plan/adapt.ts` to trace `capacity-resolver.ts` I found two
separate `plan_adapt_drop_missed` coach_intents rows for the SECOND account,
same calendar date (2026-08-04), different distances (8 mi and 7 mi) — one
written before the account's plan regeneration, one after. Checked the
source: `detectMissedKeyWorkout` scopes its query to `tp.archived_iso IS NULL`
only — it does **not** go through `ownedDaysSql` at all, so this is a
pre-existing, separate multi-plan-regeneration duplicate-detection issue, not
something this fix touched or could have fixed. Out of scope for this task
(touches `lib/plan/adapt.ts`); flagged as a background task rather than
attempted here.

---

## Part B — live plan-row audit (owner's account)

Owner's single active plan: `pln_9a57561debb776e5` (race-prep, CIM goal),
authored `2026-08-31T03:40:26Z` — about 20 hours before this audit ran.

### What I found before touching anything

- `profile.lthr = 168` — correct, set `2026-08-31T02:40:47Z` from the AFC
  half-marathon result (`lthr_method: "race_half · Americas Finest City ·
  2026-08-16"`).
- `training_plans.authored_state.pace_recompute` already carried a stamp:

  ```
  at: 2026-08-31T21:48:43.840Z
  source: prescription_wire_1_promotion
  vdot: 47.9
  anchors: threshold 430, interval 407, repetition 371,
           easy_ceiling 502, shakeout_ceiling 532, marathon 475
  lthr_bpm: 168, max_hr_bpm: 183
  workouts_updated: 77
  ```

  `recomputePacesForPlan` had already been invoked, roughly two hours before
  this audit, presumably as part of tonight's PRESCRIPTION-WIRE-1 wiring by a
  concurrent session. This meant Part B was primarily verification of that
  work, not a fresh correction.

### Verification performed

- **Row inventory:** 103 total `plan_workouts` rows on the active plan; 83
  are pace-bearing (not `rest`/`cross`/`strength`/`race`/`race_week_tuneup`);
  6 of those are sealed (a non-merged run exists on that date: 08-24, 08-26,
  08-27, 08-28, 08-30, and today 08-31); 77 are unsealed. **77 matches
  `workouts_updated: 77` in the stamp exactly** — every unsealed row was
  touched by the last recompute, none were skipped or missed.
- **Anchor consistency:** every unsealed row's `pace_target_s_per_mi` and
  `workout_spec` traces cleanly to the stamped anchor set (threshold 430,
  interval 407, repetition 371, easy ceiling 502–542, shakeout 532, marathon
  475). A handful of rows show composite values (threshold 445, intervals
  403) for structured multi-pace ladder sessions ("9×1km @ ST pace",
  "2×90s @ 5K…4×15s @ mile") — inspected their internal `steps[]`/
  `rep_pace_s_per_mi` fields directly and confirmed those use the *same*
  407/371 anchors per-segment; the outer value is a correctly-derived blend,
  not a stray stale number.
- **Failed/unknown reanchor status:** none found. No `ReanchorDeferral` or
  refusal trail visible from a read-only DB check (those log to console, not
  a table), but the `workouts_updated` count matching the unsealed-row count
  exactly is strong evidence the run completed cleanly with no partial
  failure — a partial failure would have left a workouts_updated count lower
  than 77.
- **Legacy midpoint easy pace (523–563/9:03-style):** not found anywhere.
  Every easy/long/shakeout row carries a genuine lo/hi ceiling band (502–542
  s/mi for easy/long, 502–532 for shakeout) — the ceiling framing, not a
  fixed midpoint.
- **Exact recovery-jog pace:** not applicable — this plan has **zero**
  `type = 'recovery'` rows at all (confirmed by direct query), so there is
  nothing carrying a frozen recovery number to find.
- **HR/grading-band consistency, spot-checked beyond the one already-verified
  workout:** pulled every distinct HR rule set present across the plan (6
  variants — the standard work pass≤164/bail>173 pair, a finish-only bail
  variant, and three race-day mile-checkpoint variants for the goal
  marathon). All 6 are internally coherent (no orphaned pass with no bail, no
  mismatched threshold pair). `lthr_bpm` is `168` on **every** row that
  carries one — no split between old and new LTHR anywhere in the live rows.
- **HR cap staleness check:** found `hr_cap_bpm` values of both 145 (the old,
  pre-reanchor LTHR-162-based cap) and 151 (the corrected LTHR-168-based cap)
  coexisting in the table — checked which rows carry which, and **145
  appears exclusively on the 5 sealed/already-run days before the reanchor
  (08-26–08-30)**; every unsealed day, with no exception, carries 151. This
  is the doctrine-correct shape (Rule 15 immutability for completed days),
  not staleness.
- **Nothing has drifted since the last recompute:** checked for any new
  `coach_intents` or new `runs` timestamped after `2026-08-31T21:48:43Z` — none
  exist as of this audit (~23:53Z, roughly two hours later). The plan is
  still current against the evidence as of right now.

### Conclusion

**Nothing was stale. No correction was needed, so `recomputePacesForPlan` /
`reanchorActivePlan` were not invoked** — the concurrent session's own
`prescription_wire_1_promotion` recompute (2026-08-31T21:48:43Z) already
brought every future, unsealed row onto the canonical anchors, correctly,
completely, with no rows skipped and no legacy values surviving anywhere they
shouldn't. Invoking the recompute path again on an already-correct,
evidence-unchanged plan would have been a no-op write with no benefit, so I
did not perform one. This session made **zero writes** to the database.

### Historical/sealed rows — confirmed untouched

Verified directly: the 6 sealed rows (08-24, 08-26–08-28, 08-30, 08-31) still
carry their as-prescribed values from when they were run, including the old
145 bpm cap where applicable. Since this session made no writes at all, this
is trivially true, but confirmed by direct query rather than assumed.

### Phone and watch payload — verified by code path, not by an on-device render

Traced both live read paths:

- `app/api/v5/today/route.ts` reads `pace_target_s_per_mi` and `workout_spec`
  directly from `plan_workouts` on every request (line ~815–838) — no
  denormalized or cached copy of these fields.
- `app/api/watch/today/route.ts` → `lib/watch/build-workout.ts`'s
  `buildWatchToday` does the same (line ~1527–1528) — same columns, same
  table, no separate cache.

Both surfaces are therefore guaranteed to reflect exactly the DB state
audited above on their next request; there is no intermediate cache that
could hold a stale copy of these specific fields for either surface.

**Honest limitation, per Rule 13:** I did not capture an actual on-device
screenshot or a live authenticated API response — this session has no
production bearer token or simulator access to the owner's own account. What
I verified is DB state plus a direct trace of the read path with no caching
layer in between, which is strong but is not the same as rendering the actual
screen. If a literal on-device render is wanted, it needs a session with the
owner's live auth or simulator access.

---

## Summary

- **Part A:** the `ownedDaysSql` fix genuinely changed what one consumer
  (`lib/adaptation/load.ts`'s 42-day adaptation read) would compute for the
  owner's 07-23 and 07-30 sessions, and genuinely changed what a second
  consumer (`capacity-resolver.ts`'s threshold reexamination) would classify
  07-23 as — both rendered concretely against real data. Neither change ever
  reached a persisted decision: zero adaptation mutations exist in the
  historical record for the owner in the exposure window, and the owner's
  VDOT snapshot stayed flat throughout it. The four originally-named narrow
  consumers (fitness-evidence, threshold-pattern, race-replacement,
  adaptive-ramp) never touched the corrupted dates at all, confirmed both by
  window arithmetic and by direct query. The second account's misattributed
  week produced zero behavioral difference anywhere, because nothing was run
  in that week to grade. One unrelated pre-existing issue (duplicate
  drop-missed notes on plan regeneration) was found and flagged separately,
  not caused by this fix.
- **Part B:** the owner's live plan was already fully and correctly
  recomputed by a concurrent session's own invocation of the authorized path,
  roughly two hours before this audit. Verified thoroughly against every item
  in the checklist (anchors, reanchor status, legacy midpoint pace,
  recovery-jog pace, grading-band consistency, HR semantics) and found no
  staleness. No correction was made because none was needed.
