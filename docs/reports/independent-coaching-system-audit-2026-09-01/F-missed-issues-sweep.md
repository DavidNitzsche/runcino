# Agent F · what the previous reviews missed

**Audited commit: `7cac80f0` (main tip).**
Note on setup: the isolated worktree was created from the **stale**
`claude/build-runcino-app-OIRJr` line (`f43fb7a7`), which has no `web-v2/` or
`native-v2/` at all. I detected this before reading any code and reset the
worktree to `7cac80f0`. Everything below is against `7cac80f0`. No commits, no
pushes, no writes outside the worktree; all production access was
`faff_readonly`.

Excluded by assignment (other auditors own them): capacity resolvers, the
adaptation engine's internals, race-projection consolidation, HR semantics.

---

## THE HEADLINE

**Four gates that are supposed to be the enforcement behind CLAUDE.md's own
rules were made to pass while the violation they exist to stop was live in the
tree.** All four were falsified in this worktree and restored:

1. `ACTIVEPLAN-1` only inspects SQL that mentions `training_plans`, so the
   version of Rule 14's own bug that omits the join is invisible — and one
   such query is live and **wrong for three of seven production users today**
   (F-29).
2. `check-swallowed-failure.sh` reported **OK** with a brand-new swallowed
   database read inside `lib/plan/generate.ts` (F-2).
3. `check-coach-voice.sh` reported **"189 user-facing source file(s) clean"**
   with `"Great work! You crushed it — keep going."` sitting in
   `lib/plan/block-preview.ts` (F-3).
4. `check-coercion.sh` prints **"coercion OK"** while itemising seven live Rule 11
   collapses it calls "NOT exemptions", one of which silently disables the
   3-hour long-run time cap (F-4).

Two defects the runner can feel today, both verified against live production
rows: **the watch grades a tempo session at ±8 s/mi while the phone prints
±20 s/mi** (F-1), and **the easy-pace band the coach grades against is read
from an archived plan** for three of seven users (F-29).

---

# Index, ranked by user impact

| # | Finding | Sev | One line |
|---|---|---|---|
| 1 | F-1 | P0 | Watch grades tempo at ±8 s/mi, phone prints ±20. 21 live plan rows; the comment claiming parity is false. |
| 2 | F-29 | P0 | The easy-pace band the coach grades against is read from an **archived** plan — wrong for 3 of 7 production users, one by 40 s/mi. `ACTIVEPLAN-1` cannot see the query shape. |
| 3 | F-21 | P1 | Every cron runs twice a day; `readiness-snapshot` overwrites the on-time morning score with an afternoon one. |
| 4 | F-2 | P1 | `check-swallowed-failure.sh` passes a swallow SWAP — a new swallowed read in `generate.ts` is green if a peripheral one is tidied. Demonstrated. |
| 5 | F-3 | P1 | `check-coach-voice.sh` still does not scan `lib/plan`. Rule 20's own named gap. Demonstrated. |
| 6 | F-4 / F-33 | P1 | `check-coercion.sh` prints OK over seven live Rule 11 collapses; one disables the 3-hour long-run cap. The flag meant to force them can never fire. |
| 7 | F-22 / F-23 | P1 | Four jobs — including the one that sends every push — can never raise a staleness alert, and 90 alerts have gone unacknowledged in 82 days. |
| 8 | F-5 / F-6 | P1 | The execution grader prices "established pace" off the raw VDOT cascade (22-46 s/mi off) and reads a stale cron snapshot through six hand-copied queries. |
| 9 | F-30 / F-31 / F-32 | P1 | Rule 19's own quoted false invariant is still in `lthr-reanchor.ts`; `lib/adaptation/**` matches no CI path filter; 665 lines run nightly with no runnable test. |
| 10 | F-12 / F-13 / F-14 | P1/P2 | Three definitions of the easy HR ceiling, three unordered pickers for "today's row", four incompatible completion graders — none disclosed. |

Everything below is grouped P0 → P3, then the gate-falsification table, then the
cron / flags / CI sections.

---

# P0

## F-1 · Tempo pace tolerance: watch grades at ±8 s/mi, phone quotes ±20 s/mi. 21 live plan rows.

**Watch** — `web-v2/lib/watch/build-workout.ts:1706-1715`, via
`classifySession` (`:636-670`), which reads `workout_spec.kind` **first**:
`case 'threshold': case 'tempo': return 'threshold'` → tolerance **8**.

**Phone** — `web-v2/app/api/v5/today/route.ts:1514-1518`:

```ts
// Same tolerance the watch applies, so the band the phone quotes is the band
// the wrist grades against.
const cardTolerance =
  prescriptionType === 'threshold' || prescriptionType === 'intervals' ? 8
  : prescriptionType === 'race' ? 12 : 20;
```

`prescriptionType` comes from `strictPrescriptionType`
(`web-v2/lib/training/prescriptions.ts:120-132`), which maps `'tempo' → 'tempo'`
and `'fartlek'|'progression' → 'tempo'`. None of those equals `'threshold'` or
`'intervals'`, so a tempo day falls to the `: 20` arm. **The comment above the
line is false.**

**Verified in production** (owner `0645f40c…`, active CIM block):

```
 type             | spec_kind | count
 tempo            | tempo     |     6     ← his active block
 (all active plans)  tempo/tempo    14
 (all active plans)  tempo/threshold 7     ← phone reads `type`→tempo→20, watch reads kind→threshold→8
```

**21 rows across live plans.** Concrete: target 7:10/mi. Phone Today card and
panel stat both print `~6:50-7:30/mi`. Watch prints `7:02–7:18/mi`, and
`PaceDrift.swift:44-48` sets `hardDrift = max(15, 8+5) = 15`. A runner holding
**7:26/mi reads "on target" on the phone he planned off and gets amber plus a
sustained-drift haptic on the wrist**; at 7:29 the wrist goes red. Same session,
same second, two answers under one label — Rule 16.

Rule 20 corollary, same defect: `lib/training/spec-card.ts:164-179`'s docblock
asserts "`cardTolerance` in `/api/v5/today` (± 8 s/mi) is the same width the
watch grades execution against." True for threshold/intervals, false for tempo,
and nothing gates it.

**Fix shape:** one exported `sessionToleranceSec()` both surfaces call, plus a
test that fails when either stops calling it — the pattern
`lib/training/race-projection.ts` already set. Three edits will not hold.

---

# P1

## F-2 · `check-swallowed-failure.sh` cannot see a swallow SWAP. Demonstrated.

`web-v2/lib/audit/swallowed-failure-registry.ts:211` — `EMPTIED_BASELINE = 374`
is a **count with no per-site identity**. `_swallow_scan.test.ts:330-350`
asserts `emptied.length <= 374` and `>= 374`, so the number is exact — but
nothing binds a site to a file, a symbol, or a severity.

**Falsification performed in this worktree:**

| Step | Change | Gate result |
|---|---|---|
| A | Added one `.catch(() => ({rows: []}))` in `lib/plan/generate.ts` alone | **FAIL** — "375 sites … baseline is 374" |
| B | Same addition, *plus* removed one `.catch` from `lib/strava/connection-status.ts:151` | **PASS** — "swallowed-failure OK · empty-result baseline 374" |

So a single change may introduce a swallowed database read **into the plan
engine** and remain green, provided it tidies an unrelated peripheral one. That
is Rule 22 exactly — the gate checks the count, never the distribution — and it
is the gate CLAUDE.md Rule 11 names as its own enforcement.

For scale, the current 374 are concentrated where the runner reads:
`lib/plan/adapt.ts` 21, **`lib/watch/build-workout.ts` 15**,
**`app/api/v5/today/route.ts` 13**, `lib/coach/readiness-brief.ts` 11,
`lib/training/goal-projection.ts` 11, `app/api/cron/plan-drift/route.ts` 10,
`lib/plan/generate.ts` 10.

**Fix shape:** key the ratchet on `file::symbol` identities (the way
`coercion-registry.ts` already does), not on a scalar; and weight or separate
engine sites from peripheral ones.

## F-3 · `check-coach-voice.sh` still does not scan `lib/plan`. Rule 20's own named gap, still open.

CLAUDE.md Rule 20 records this verbatim: *"Coach voice — no em dashes… The
gate's scope excluded `lib/plan`, which authors the sentence attached to every
workout, so 1,804 rows carried them."*

`scripts/check-coach-voice.sh:105-138` — the `targets()` function. Scope is
`native-v2/…/ViewsV5`, `…/DesignV5`, `web-v2/lib/faff`, `web-v2/app/api/v5`,
`web-v2/lib/coach`, `web-v2/components/faff-app`,
`lib/notifications/templates.ts`, and two individually-named files. **`lib/plan`
is not there**, and neither are `lib/prescription`, `lib/watch`, `lib/execution`,
`lib/adaptation`, `lib/postrun-siege`, `lib/today`, `lib/race`.

**Falsification performed:**

| Where | Planted string | Gate |
|---|---|---|
| `lib/faff/goal-status.ts` (in scope) | `"Great work! You crushed it — keep going."` | **FAIL** — names exclamation mark, em dash and hype |
| `lib/plan/block-preview.ts` (out of scope) | identical string | **PASS** — "189 user-facing source file(s) clean" |

`block-preview.ts` authors runner-facing copy — line 192 is
`'PROVISIONAL — phase shape only …'`. And `lib/plan/generate.ts:5127` and
`:7016` author the long-run and MLR `why` sentences with em dashes in them.

**Production:** 1,801 of 4,021 `plan_workouts` rows for the owner carry an em
dash in `notes` — matching Rule 20's "1,804". His *active* block is down to 1,
so the data was cleaned; **the gap that produced it was not**, and the composer
still emits them.

## F-4 · `check-coercion.sh` prints "OK" while itemising seven live Rule 11 collapses, one of which disables a safety cap.

Every prebuild run prints:

```
COERCION · 7 known collapse(s) awaiting an owner (HANDED_BACK_FAILS=false):
    · lib/plan/adapt.ts::runnerIsCompromised::catch
    · lib/plan/adapt.ts::detectTrainingGap::catch
    · lib/plan/adapt.ts::detectVolumeOvershoot::catch
    · lib/coach/readiness.ts::scoreReadiness::pillars
    · lib/plan/generate.ts::composeForUserInternal::easyPaceSecPerMi
    · lib/plan/progression-pass.ts::resolveShape::dayBudgetMi
    · lib/plan/adapt.ts::chooseRescheduleDate::weeklyFrequency
  These are NOT exemptions. Route them, fix them, delete the entry…
```

…and then exits **0** with `coercion OK`. I verified all seven sites still
exist, so none is stale — they are simply unowned and the build ships.

The sharpest one, traced: **`lib/plan/generate.ts:4544`**

```ts
if (longCat !== 'ultra' && easyPaceSecPerMi != null && easyPaceSecPerMi > 0) {
  const timeCapMi = Math.floor(((LONG_RUN_MAX_HOURS * 3600) / easyPaceSecPerMi) * 2) / 2;
  if (timeCapMi >= 3) longMi = Math.min(longMi, timeCapMi);
}
```

`easyPaceSecPerMi` unreadable → the **3-hour long-run time cap does not
apply at all**, silently. For a 12:00/mi runner the cap binds at 15 mi; without
it a distance-driven 20-miler is a four-hour long run. Rule 11's own sentence:
*"a missing input must never silently disable a safety mechanism."*

The gate is correct to name these. It should not be reporting green.

**Note the gate itself is otherwise sound** — I falsified it with a planted
`recentQualityPerWeek > 0 ? recentQualityPerWeek : undefined` in
`lib/plan/pace-zones.ts` and it named the site, the line and the classifier.

## F-5 · The execution grader prices "established pace" off the raw VDOT cascade, 22-46 s/mi away from what the plan actually prescribes — and prints the wrong number at the runner.

`web-v2/lib/execution/reconstruct.ts:557-568`:

```ts
export function establishedPaceFor(domain: IntensityDomain, vdot: number | null): number | null {
  const t = tPaceFromVdot(vdot);
  ...
  case 'repetition': return t - 30;
  case 'interval':   return t - 18;
  case 'easy':       return t + 100;
```

The prescription side does not use these offsets. Rep pace is
`rPaceFromVdot` (Daniels' Mile column), interval is `iPaceFromVdot`, and the
easy **ceiling** is `easyBandFromTPace(t).lo = t + 80`
(`lib/training/vdot.ts:332-337`, doctrine-gated by
`PACE.easy-band-off-threshold`).

Measured by running the real functions (probe run in-worktree, then deleted):

```
VDOT 40: R table 7:07 vs exec t-30 7:53  → exec is 46 s/mi slower
VDOT 50: R table 5:50 vs exec t-30 6:24  → 34 s/mi slower
VDOT 65: R table 4:37 vs exec t-30 4:59  → 22 s/mi slower
VDOT 50: I table 6:25 vs exec t-18 6:36  → 11 s/mi slower
all:     easy ceiling t+80 vs exec t+100 → 20 s/mi slower
```

**Every offset errs in the same direction: the grader believes the runner's
established pace is SLOWER than the pace he was prescribed.** That biases
`failedAtKnownPace` (`lib/execution/interpret.ts:237-240`,
`actual <= established + 5`) toward TRUE, so a session that came apart at a pace
well *inside* the prescription still reads as **HIGH fitness evidence**.

It is also printed. `lib/coach/fitness-evidence.ts:165-178`:

> "…That pace has been comfortable before, at **{established}**/mi."

At VDOT 50 that sentence would tell a runner his rep pace has been comfortable
at 6:24/mi when his plan prescribes 5:50/mi.

**Also `ctx.vdot` is not the canonical capacity** — see F-6.

## F-6 · Six hand-copied `currentVdot` readers, all of them reading a cron snapshot with no freshness bound.

`lib/adaptation/load.ts:63`, `lib/coach/fitness-evidence.ts:191`,
`lib/coach/race-replacement.ts:209`, `lib/coach/threshold-pattern.ts:245`
(their own headers name two more, in `lib/plan/simulator.ts` and
`lib/race/result-chain.ts`). All six are:

```sql
SELECT vdot::text FROM projection_snapshots
 WHERE user_uuid = $1 AND vdot IS NOT NULL
 ORDER BY snapshot_date DESC LIMIT 1
```

Three problems, all verified against production:

1. **No recency bound.** `bestRecentVdot` has a whole fade/expiry apparatus
   (`FADE_PER_14D`, `VDOT_FULL_VALUE_DAYS = 56`, `VDOT_EXPIRY_DAYS = 84`). Reading a
   *snapshot* bypasses all of it: the row was faded as of its own date, not
   today's. If the cron misses days the value is under-faded by exactly that
   many days, silently. **This is not theoretical** — the owner's snapshot
   history has real gaps of 7, 9 and 15 days (2026-03-31 → 2026-05-30), and
   only 101 of 155 days in the span carry a snapshot.
2. **The query does not name its population** (Rule 14). Production has
   **three rows per `snapshot_date` per user** (one per `race_slug`, two with
   `race_slug` NULL). `ORDER BY snapshot_date DESC LIMIT 1` has no tie-break, so
   which of the three is returned is up to the planner. They currently agree, so
   this is latent rather than live.
3. **Three of the four in-tree copies wrap it in `.catch(() => ({rows: []}))`** —
   a failed read becomes "no VDOT", which becomes `establishedPaceFor → null`,
   which suppresses the finding. Rule 11.

The self-justification in each header ("house rule: where a reader does not
exist, each caller carries its own one-line copy") is exactly the reasoning
Rule 16 exists to refuse. One `resolveCurrentVdotSnapshot()` with an explicit
staleness posture would replace all six.

## F-7 · Four of nine coach-log finding types have never fired for any runner, ever.

Production, all 7 users, all 356 `coach_intents`:

```
coach_log_week_close        16 rows / 7 users
coach_log_goal_answer        1 / 1
coach_log_lthr_reanchor      1 / 1
coach_log_phase              1 / 1
coach_log_race_replacement   1 / 1
coach_log_fitness_evidence   0        ← the establishedPaceFor consumer, F-5
coach_log_easy_discipline    0
coach_log_threshold_pattern  0
coach_log_first              0
```

These are the coach's *diagnostic voice* — the "here is what I noticed"
mechanisms. Rule 21's standard is explicit: *compute what the runner would have
had to do to trigger it, then check whether any week they have actually run
would have.* Three of the four silent ones read execution data the owner
generates every week. **Wired, tested and inert**, again, and it means the
divergence in F-5 has never been visible to anyone — which is why it survived.

Same query re-confirms Rule 21's zero: no `upgrade`/`bump`/`accelerate` reason
exists in any of the 356 rows.

---

# P2

## F-8 · `check-automatic-mutations.sh` derives plan-writers at FILE granularity, so a new writer inside an already-declared file is free.

**Falsification performed:**

| Where | Planted | Gate |
|---|---|---|
| New file `lib/plan/_falsify-writer.ts` with `UPDATE plan_workouts SET pace_target_s_per_mi …` | | **FAIL** — names the file |
| Same statement appended to `lib/plan/reanchor-plan.ts` (already declared) | | **PASS** |

The registry's five questions (`idempotent`, `onPartialFailure`, `runnerSees`,
`changes`, `trigger`) are answered per-*entry*. A second writer added inside a
declared file inherits answers that are now false for it — and `reanchor-plan.ts`
and `adapt.ts` are precisely the files most likely to grow one.

## F-9 · Rule 15's corpus gap is only 0.76% closed.

`HIST-1` added `history?: ArcHistory` to the `Arc` type
(`lib/plan/sim-matrix.ts:74-102`), which is real progress. But its own comment
states the design: *"Absent on every arc the cross-product yields, which is what
keeps the existing corpus byte-identical."*

I instrumented `matrix()` and counted:

```
CORPUS total 11687   withHistory 89 (0.76%)   withProbe 25
byMode      goal 5915 / justRun 2889 / race 2883
histByMode  goal   77 / justRun    9 / race      3
```

So **11,598 archetypes still run with `hist === null`**, which is the exact
number Rule 15 was written about, and `race` mode is covered by three arcs.
`resolveRampBase`, `easyDayMedianMi`, `recentQualityPerWeek` and `isMidBlock` are
now reachable, but only along a 89-case thread; no interaction with distance ×
frequency × experience × weeks is tested. A green sweep still says almost
nothing about those four mechanisms. State coverage as "89 arcs reach the
history path", never as "11,687 archetypes pass".

## F-10 · 81 scratch probe scripts are committed at `web-v2/` root; 77 read `DATABASE_URL` and 3 issue production WRITES.

`git ls-files` returns 81 files matching `web-v2/_*`. Three write:

- `web-v2/_backfill_jul9_write.mjs`
- `web-v2/_diag_elev_fix_jun18.mjs`
- `web-v2/_diag_jun9_fix.mjs` — a bare `UPDATE runs SET data = jsonb_set(…)`
  against one hard-coded row id, connecting on `process.env.DATABASE_URL` (the
  **write** URL) with `rejectUnauthorized: false`.

They are one `node web-v2/_diag_jun9_fix.mjs` away from mutating the runner's
data, they carry no guard, no dry-run, and no `--confirm`. They also sit inside
the Next.js project root. This matches the standing "~84 loose root probes"
note; it has not moved.

## F-11 · `training_plans.authored_state` is full-replaced by a cron from a snapshot read outside its own transaction (Rule 6).

`web-v2/lib/plan/reanchor-plan.ts:659` — `UPDATE training_plans SET
authored_state = $1 WHERE id = $2`, where `$1 = {...st, …}` and `st` was read at
**line 371**, via `pool.query`, *outside* the `mutatePlan` transaction that
performs the write.

Four other writers of that same column all use merge semantics and cite Rule 6
by name — including `reanchor-plan.ts:445` itself, twenty lines from its own
header sentence *"`authored_state` has several writers with different field
coverage"*: `recompute-paces.ts:641`, `pace-drop-event.ts:78` and `:113`.

Runner-visible failure: he dismisses the "your paces moved" card;
`acknowledgePaceZoneEvent` sets `pace_zone_event.acknowledgedAt`; if that commits
inside the read→write window during a `snapshot-projections` pass, the full
replace writes back the pre-acknowledgement object and **the dismissed card comes
back on his phone**. `pace_recompute` audit stamps in the same window are erased.

Nothing polices this column — the Rule 6 machinery covers `runs.data` and
`plan_workouts.workout_spec` only.

**Verified clean, for contrast:** `plan_workouts.workout_spec` genuinely has one
shared guard and every one of its six writers uses it — `adapt.ts:2432`,
`progression-pass.ts:821`, `recompute-paces.ts:631`, `reanchor-plan.ts:623`,
`race-role-apply.ts:144/170/239/259`, `admin/backfill-workout-spec:258`, all via
`preserveProgressionSql`, with `_progression_spec.test.ts:236` asserting it.
That is the pattern `authored_state` should copy.

## F-12 · The easy/long HR ceiling has three definitions; the phone's is the only one that ignores the plan.

| Site | Formula |
|---|---|
| Authoring · `lib/plan/spec-builder.ts:389-399` | `MAX(aerobicCeilingBpm(lthr), round(maxHr × 0.78))` → written to `workout_spec.hr_cap_bpm` |
| Watch · `lib/watch/build-workout.ts:1437-1460` | `spec.hr_cap_bpm` first, else `aerobicCeilingBpm(lthr)` or `maxHr × 0.78` (no MAX) |
| Phone · `app/api/v5/today/route.ts:1739-1746` | `computeZones({lthr}).z2.upper` — **LTHR only, spec never read** |

LTHR 162, HRmax 190 → row stamped **148**; watch says "under 148" and flips red
there; phone panel says **"HR ceiling ~145 bpm"**. `route.ts:1738`'s comment
"Same gate as the wrist now" copied the *gate* (easy/long only), not the
*source*. Fourth copy of the same physiology: `lib/coach/easy-discipline.ts:100`
exports `EASY_HRMAX_CEILING_PCT = 0.78` while two other files hand-write `0.78`.

## F-13 · Three unordered pickers for "today's plan row"; only the watch picks correctly.

`lib/watch/build-workout.ts:1522-1540` orders by type priority then
`distance_mi DESC`, with a comment explaining that a day can carry two rows
after a reschedule. The phone, in one request, uses three readers with **no
`ORDER BY`**:

- `lib/coach/glance-state.ts:366-377` — unordered, `new Map(...)` → last row
  wins. Drives the 56pt hero and `prescriptionType`.
- `app/api/v5/today/route.ts:1449-1452` — `LIMIT 1`, no order. Drives the whole
  card structure.
- `app/api/v5/today/route.ts:815-819` — same. Drives the after-run grading row.

Reschedule a tempo onto a day holding a rest placeholder and the three can
disagree with each other and with the wrist, within one response. Rule 14.

## F-14 · Grading tolerances: "did he hit it" has four incompatible answers and none is shown.

| Constant | Value | Site |
|---|---|---|
| `completionThresholdMi` | **60%** of prescribed distance | `lib/plan/adapt.ts:457-459` |
| `EQUIVALENT_WORK_TOLERANCE` | **±25%** of work minutes | `lib/execution/interpret.ts:139` |
| `PARTIAL_FLOOR` | **40%** of work minutes | `lib/execution/interpret.ts:143` |
| display "material gap" | `max(0.25 mi, 10%)` | `lib/faff/v5-today.ts:1319` **and** `lib/watch/build-workout.ts:1314` — identical, the one correctly-shared case |

8 mi threshold, 5.0 mi run (62.5%): `adapt.ts` counts it **done** and the plan
proceeds; `interpretExecution` records **`PARTIAL_*`**; the phone shows an
uncoloured "asked 8 mi · 5.00" row. Three verdicts, one run.

HR-cap grading is the same shape with **0 vs +5 bpm of grace**: phone row
(`v5-today.ts:1417`) and watch row (`build-workout.ts:1334`) tone at
`avg > cap`; the recap coaches a **long** run at `avg > cap`
(`lib/coach/run-recap.ts:879`) but an **easy** run only at `avg > cap + 5`
(`:1013`). Easy run, cap 145, avg 148 → `TodayAfterV5.swift:215` draws an amber
"Heart · under 145 · 148" and `:218`, three lines below, says nothing about heart
rate at all. Same breach on a long run gets a full sentence.

## F-15 · On a marathon-pace block the watch fabricates an LTHR work-HR target the plan deliberately refused to set.

`lib/plan/spec-builder.ts:1441-1462` sets `hr_target_bpm: null` for `@ MP` with
the comment *"inventing an MP heart rate would be asserting physiology no
doctrine in this repo states."* `lib/watch/build-workout.ts:1791-1816` then does
`rawHrTarget = isQualityWorkout ? (specHrBpm ?? lthr ?? null)` — and `kind:
'tempo'` makes `isQualityWorkout` true — so a 10-12 mile MP rehearsal ships the
runner's **threshold** HR to the wrist. A deliberate absence overridden by a
fallback that cannot tell it from missing data: Rule 11.

Currently harmless only by accident — `hrTargetBpm` is decoded in
`WatchWorkoutModels.swift:190,272` and **read by nothing**. Which is also its own
finding: the entire `specHrBpm`/`maxHrFallback`/`×1.05` cascade is computed,
shipped and dropped, so the watch shows **no HR guidance at all** on
threshold/interval days while the phone shows `~160–168 bpm (Z4)`.

## F-16 · Repetition on the live Today screen (Rule 17).

- **Pace band printed twice**, two inches apart, by two formatters that can
  drift: `app/api/v5/today/route.ts:1711-1717` (`fmtBand`, no space before
  `/mi`) → `TodayBeforeV5.swift:416-419`; and `lib/training/spec-card.ts:467-469`
  (`fmtPaceBand`, space before `/mi`) → `TodayBeforeV5.swift:488-491`. They read
  the same phase.
- **Distance printed three times** on an easy day: `lib/faff/v5-today.ts:1810`
  (28pt dose), `:1136` (group note), `:985` (step main). This is a recurrence in
  the file that already records David saying *"REST DAY three times on one
  screen"* at `:1129-1133` — that patch fixed the `rest` case only.
- **Easy pace rendered as a band on the panel and a point on the step**, and the
  band form contradicts `docs/PRODUCT_DECISIONS.md` 2026-08-31 ("easy pace is a
  ceiling, not a band"), which `spec-card.ts:461-465` honours and
  `route.ts:1711-1720` does not.
- **Per-row boilerplate still ships on the wire.** `spec-card.ts:506/511/532/549`
  writes the same note on every step; `v5-today.ts:1084-1096` de-duplicates it
  *in one renderer*. `prescriptionLike.steps[].note` still carries N copies, so
  any other consumer reproduces the downhill-instruction bug verbatim.

## F-17 · A live plan row repeats its own instruction twice in one sentence.

Production, owner's active block, `2026-10-25`, `type=long`:

> "…Course drops 304 ft. **Run at least 60% of this on downhill-similar
> terrain** · Research/11 §net-downhill adjustments. **Run the race-pace section
> on terrain that descends like your course.** Quads will feel this more than the
> pace suggests…"

Two renderings of one instruction inside one `notes` field, plus the em dash
F-3 covers. Composed at `lib/plan/generate.ts:5127` and the terrain-note
appender.

---

# P3

## F-18 · `projection_snapshots` writes 3 rows per user per day with no unique key.

Verified: `2026-09-01` carries three rows for the owner (`race_slug='cim'` plus
two NULL). Harmless today because the `vdot` agrees across all three; it is the
population every `currentVdot` copy in F-6 reads with no tie-break.

## F-19 · `hr_cap_bpm = 168` (= LTHR) on a race row.

Owner's active plan, `2026-11-08`, `type=race`: `hr_cap_bpm` 168, which is his
threshold HR, not an aerobic ceiling. The four `145` rows in the same plan are
all **past** dates and correctly frozen, so this is not general Rule 10
staleness — the race branch specifically is worth a second look by whoever owns
race prescription. Low confidence; I did not trace the race branch to
conclusion.

## F-20 · Complexity — the five most likely sources of the next coaching defect

| Rank | File | Lines | Numeric thresholds | Why |
|---|---|---|---|---|
| 1 | `lib/plan/generate.ts` | 14,236 | **354** | Every Rule 9 cliff found to date lived here. Also carries three of the seven unowned coercions and the em-dash composers. |
| 2 | `lib/plan/adapt.ts` | 5,319 | 82 | 21 swallowed reads (the highest in the tree), four unowned coercions, and the `completionThresholdMi = 60%` that disagrees with two other completion graders. |
| 3 | `lib/watch/build-workout.ts` | 2,473 | 51 | Sole author of every wrist-side number, 15 swallowed reads, and the source side of F-1, F-12, F-15. Diverges from the phone on tolerance, HR ceiling, HR target and row selection. |
| 4 | `app/api/v5/today/route.ts` | 1,974 | 20 | 13 swallowed reads, three unordered row pickers in one handler, and three comments asserting watch parity that is false. |
| 5 | `lib/execution/reconstruct.ts` + `interpret.ts` | ~700 | — | The grading layer, priced off a second fitness anchor (F-5) with three undisclosed tolerances (F-14) and no production firings to have exposed either (F-7). |

---

# Gate falsification results

Eight gates broken on purpose in this worktree, then restored. `git status` was
verified clean after each.

| Gate | Falsifier planted | Result |
|---|---|---|
| `check-coercion.sh` | `recentQualityPerWeek > 0 ? recentQualityPerWeek : undefined` in `lib/plan/pace-zones.ts` | **PASS** — named file, line, classifier |
| `check-normal-window.sh` | Unfiltered 28-day `AVG(distanceMi)` habit reader in `lib/coach/threshold-pattern.ts` | **PASS** — named it, cited the corollary |
| `check-doctrine.sh` | `VDOT_EXPIRY_DAYS` 84 → 140 | **PASS** — read 84 out of the doc at run time and named the claim |
| `check-goal-immutability.sh` | Retired imperative re-added to `goal-outlook-copy.ts` | **PASS** |
| `check-client-graph.sh` | `'use client'` RouteMap importing `lib/plan/reanchor-plan` | **PASS** — printed full transitive paths to `pg`/`async_hooks` |
| `check-swallowed-failure.sh` | (a) one new swallow in `lib/plan/generate.ts` | **PASS** — 375 vs 374 |
| " | (b) same swallow **plus** one removed from `lib/strava/connection-status.ts` | **FAILED TO FAIL** (F-2) |
| `check-coach-voice.sh` | (a) hype + `!` + em dash in `lib/faff/goal-status.ts` | **PASS** |
| " | (b) identical string in `lib/plan/block-preview.ts` | **FAILED TO FAIL** (F-3) |
| `check-automatic-mutations.sh` | (a) new file writing `plan_workouts` | **PASS** |
| " | (b) same statement inside declared `lib/plan/reanchor-plan.ts` | **FAILED TO FAIL** (F-8) |
| `_active_plan_scan.test.ts` (ACTIVEPLAN-1) | `SELECT COUNT(*) FROM plan_workouts WHERE user_uuid = $1 AND is_quality` over a rolling 7 days — Rule 14's own bug verbatim | **FAILED TO FAIL** (F-29) |

Liveness: every gate run printed a nonzero scan count
(`check-coach-voice` 189 files, `check-swallowed-failure` 598 files /
1,228 db call sites, `check-coercion` 33 exemptions / 133 ratchet /
181 peripheral, `check-doctrine` 662 tests). No gate reported clean on zero
files. Baseline **staleness** checked separately: all seven `HANDED_BACK`
coercion sites and all seven `active-plan-exemptions.ts` targets still exist, so
no allowlist entry is currently stale.

The full `npm run prebuild` chain (17 scripts) passes on `7cac80f0` in 5m19s.

---

# What I could not verify

- **Whether Railway carries the env vars these findings turn on.** Several
  flags default silently when unset and I cannot read Railway.
- **Whether the em-dash composers in `generate.ts:5127/:7016` are reachable on
  every rebuild** — one em-dash row is live in the active block, 1,801 across all
  plans, but I did not enumerate the branch conditions.
- **The race-row `hr_cap_bpm = 168`** (F-19) — flagged, not traced to conclusion.

---

# Cron, retention and Rule 23

## What is genuinely FIXED — state it, because it is real

- **Rule 23's founding instance is closed.** `plan-drift` no longer assumes
  `run-adaptations` re-anchored LTHR; it ensures it itself as the first statement
  of the per-user loop and raises `cron_precondition` if the ensure fails
  (`app/api/cron/plan-drift/route.ts:177-193`). `run-adaptations` moved its own
  re-anchor to the front of its loop too (`:106-110`). There is no path from the
  top of either loop to a plan writer that skips the ensure.
- **Punctuality is fixed.** The in-process 5-minute heartbeat
  (`web-v2/instrumentation.ts`) lands jobs ~2 minutes after their slot, against
  the 5-12 hour lateness that motivated Rule 23.
- Every cron route has a workflow and every scheduled workflow has an owner. No
  dead routes.

## F-21 · P1 — Every cron runs TWICE a day, and one of them decides the runner's readiness score.

The tick's design says the two triggers cooperate: "whichever arrives first
satisfies the slot and the other reads 'not due' and skips"
(`lib/ops/cron-ledger.ts:44-47`). **That is true only for callers routed through
the tick.** The per-job GitHub workflows POST each route directly and never call
`isDue`.

Production `ops_alerts` where `kind='cron_ok'`, 2026-09-01 — query run directly:

```
cron/run-adaptations       03:02:42   08:26:33
cron/plan-drift            04:02:36   09:02:36   09:10:50   13:52:02
cron/enrich-weather        07:02:34   12:39:05
cron/snapshot-projections  07:02:36   12:41:41
cron/promote-courses       07:02:36   12:44:12
cron/strava-sync           08:02:35   13:29:40
cron/readiness-snapshot    08:02:36   13:30:02
cron/max-hr-ratchet        08:02:35   13:36:25
cron/dedupe-runs           10:02:35   14:31:17
```

Corroborated independently: `adaptation_shadow_log` holds 14 rows for 7 users on
2026-09-01 — exactly two per user, where
`lib/adaptation/shadow-log-retention.ts:19` documents the rate as one per active
plan per day.

**The runner-visible harm is `readiness-snapshot`.**
`lib/coach/readiness-snapshot.ts:69-81` is a full `ON CONFLICT
(user_uuid, snapshot_date) DO UPDATE SET score, band, pillars, streaks,
computed_at = NOW()`. `lib/audit/automatic-mutation-registry.ts:324` already
flags it as *"structurally idempotent, not semantically"*, and the cron-ledger
argued that due-gating fixes it. **It does not, because the second trigger never
asks the ledger.** Owner's rows:

```
2026-09-01  score 70  computed 13:30:00 UTC   (the on-time 08:02 result was overwritten)
2026-08-31  score 70  computed 16:10:04 UTC   (09:10 PT — AFTER his morning run)
2026-08-30  score 66  computed 2026-08-31 04:19:04
2026-08-28  score 63  computed 20:12:09 UTC
2026-08-27  score 65  computed 19:04:26 UTC
```

Readiness is a morning-state reading (sleep, RHR, HRV). Which number the runner
sees is decided by GitHub Actions' queue depth, and on 2026-08-31 the day's
training was folded into the day's readiness. Rule 16, and Rule 23 clause 2 —
lateness is not harmless here.

Secondary: `promote-courses` is `idempotent: false` on a crashed run
(registry:350-363), and its ledger entry justifies inclusion by claiming
due-gating means it runs "at most once a day." Production: 07:02 and 12:44. The
stated justification is falsified.

## F-22 · P1 — Four jobs can never raise a staleness alert, including the one that sends every push notification.

`app/api/cron/tick/route.ts` §1 evaluates staleness by iterating `CRON_JOBS`
only. `notifications`, `strava-push-poll`, `keep-warm` and
`prune-adaptation-shadow-log` are in `EXCLUDED_FROM_TICK`, which the health loop
does not iterate. So no `cron_ok` row is ever written for the first three, and no
`cron_stale` row can **ever** be written for any of the four.

Each exclusion reason argues **idempotence** — the right question for "should the
tick drive it", the wrong question for "should anything notice it stopped."
`_cron_ledger.test.ts:250` only checks the reason string is longer than 60
characters.

- **`notifications`** drains `notifications_pending` and sends every push. If its
  workflow stops, the runner simply stops getting notifications and nothing
  raises. `notifications_log` has multi-day holes (2026-08-18, then 08-24, then
  08-31) that the system cannot distinguish from quiet days — Rule 11.
- **`strava-push-poll`** writes to the runner's public Strava feed. Unwatched.
- **`prune-adaptation-shadow-log`** now stamps a heartbeat (`route.ts:44`) — but
  production holds **zero** `cron_ok` rows for it across two elapsed 05:00 slots,
  and because it is not in `CRON_JOBS`, `allLastSuccess()` discards the row and
  `staleness()` never runs on it. **The heartbeat it writes is read by nothing.**
  Half a fix, and a read-only DB cannot tell whether the stamping change is even
  deployed (Rule 19).

## F-23 · P1 — The alert surface all of this terminates in has never been read.

`ops_alerts` by ack state: **zero alerts acknowledged in 82 days**, against 90
unacked rows including **73 `error`-severity `webhook_failure`** and 9
`cron_stale`. The only consumer is `recentUnackedAlerts()` →
`/api/admin/ops-alerts` → `app/admin/page.tsx`, a pull surface. The only push leg
(`lib/ops/alerts.ts:46-48`) is gated on `OPS_SLACK_WEBHOOK_URL` and returns early
if unset.

Replacing "found by running `gh run list` by hand" with "found by opening
`/admin` by hand" is the same class of failure Rule 23 was written about.

Structural corollary: `cron_stale` can only be written **by the tick**. If the
container dies, the in-process heartbeat dies with it and the only remaining leg
is the GitHub tick — the clock the design exists to stop trusting, measured at
~10% delivery. The detector is not independent of the thing it detects.

**Highest-value single check for a human: is `OPS_SLACK_WEBHOOK_URL` set in
Railway production?** That decides whether F-23 reads "nobody looks" or "nothing
tells anyone."

## F-24 · P2 — The scheduler's primary leg depends on an unwatched, ~10%-reliable job.

`web-v2/instrumentation.ts` §"WHY IN-PROCESS" states: *"`keep-warm` exists
precisely to hold this container awake, so the assumption it rests on is one the
app already made."* `keep-warm` is driven **only** by GitHub Actions, is in
`EXCLUDED_FROM_TICK`, writes no heartbeat, and has no staleness watch — the same
clock `tick/route.ts` measured delivering 8 of 75 ticks on 2026-08-30. Rule 23's
first clause applied to the scheduler itself. (Unverified: whether Railway
app-sleeping is actually enabled. If it is not, this drops to P3 and the honest
fix is to delete the sentence — Rule 20 corollary.)

## F-25 · P2 — `run-adaptations`' declared ordering edge cannot order anything within a day.

`cron-ledger.ts` gives `run-adaptations` `slotsUtcHour: [3]` and
`requires: ['readiness-snapshot', 'snapshot-projections']`, whose slots are `[8]`
and `[7]`. At 03:00 on day D, `mostRecentSlot` for `readiness-snapshot` is
**D-1 08:00**, already satisfied. The edge never blocks, and adaptations always
consume readiness ~19 hours old. The edge advertises a guarantee that does not
exist. Bounded harm (`readiness-brief.ts:934` notes the table is a day behind and
`detectReadinessPullback` reads convergence series instead), but it is Rule 20's
shape.

## F-26 · P2 — `plan_workouts` has no retention; 89% of rows belong to archived plans.

```
plan_workouts   4,639 rows   heap 69 MB   idx 30 MB   total 99 MB
  4,123 rows (89%) belong to 51 ARCHIVED plans; 516 to the 7 active ones
  ~17 KB of disk per row against 1,615 KB of total live content across all rows
```

The only `DELETE FROM plan_workouts` in the app is a user action
(`app/api/today/reschedule/route.ts:179,213,226`). `clearActivePlansFor`
archives and leaves the rows — the same omission Rule 14 already documents as the
source of the 47-plan-versions defect. `plan_weeks` and `plan_phases` show the
same shape. Aggravated by F-21: the daily pace rewrite now happens twice.
`pg_stat_user_tables.n_live_tup` reads 103 against an actual 4,639, with
`last_autovacuum` and `last_autoanalyze` both NULL.

## F-27 · P3 — Only one cron-written table has retention, and `ops_alerts` now holds four different lifetimes.

`adaptation_shadow_log` is the sole table with a retention policy (180 days +
400 rows/user). Nothing threatens anything at 7 users, but two notes:

- The 400-row cap was sized on "one row per active plan per day"; the actual rate
  is 2/day (F-21), so the margin the file argues for is gone.
- `ops_alerts` now carries the cron ledger (`cron_ok`), alerts, census rows **and
  account-deletion tombstones** (`app/api/account/delete/route.ts:199-206`), with
  no `kind`-aware retention. The obvious future response to growth — "prune older
  than N days" — would delete the deletion receipts and reset every job's
  last-success to `never`, making all nine due at once. Cheap to flag now.

## F-28 · P3 — Doc rot in exactly the files that produced the original incident.

1. `app/api/cron/run-adaptations/route.ts:22-34` states the ordering constraint
   against `refresh-briefings` and tells the reader to check
   `.github/workflows/refresh-briefings.yml`. **Both the route and the workflow
   were deleted.** This same header was corrected once before, on 2026-08-17, for
   the same defect — its own text reads *"Every ordering claim it made was
   false."* It is false again.
2. `.github/workflows/snapshot-projections.yml:20` — same dead reference.
3. `web-v2/docs/CRON_AUDIT.md` — dated 2026-05-30, says "Six cron routes ship."
   There are 15. Lists `refresh-briefings` as live and `run-adaptations` at 07:15
   (it is 03:00). It is the only document with that name.
4. `web-v2/scripts/adaptation-stability-report.ts:645-651` asserts the prune
   route "never calls `recordCronSuccess()` at all." It does, at line 44 — the
   report will emit a false explanation the moment anyone runs it.
5. `lib/audit/automatic-mutation-registry.ts:188` lists a table
   `pace_zone_events` among what `snapshot-projections` changes. **No such table
   exists** — the data lives in `training_plans.authored_state->'pace_zone_event'`.
   Nothing validates `changes[]` against the live schema.
6. `instrumentation.ts:39` and `tick/route.ts` both name
   `.github/workflows/cron-tick.yml`; the file is `tick.yml`.

---

# The second live defect · Rule 14, firing in production right now

## F-29 · P0/P1 — `ACTIVEPLAN-1` only inspects SQL that mentions `training_plans`, so the version of the bug that omits the join is invisible. **Three of seven production users are hitting it today.**

### The hole

`web-v2/lib/audit/_active_plan_scan.test.ts:60`:

```ts
if (!/plan_workouts/i.test(sql)) continue;
if (!/training_plans/i.test(sql)) continue;   // ← everything else is skipped
```

Its own header states the rule as *"a reader that joins plan_workouts to
training_plans says WHICH plan."* But `plan_workouts` **has its own `user_uuid`
column** (column 19 of the table, confirmed against production), so the natural
way to write this query does not join `training_plans` at all — and that shape is
skipped before any guard runs.

**Falsification performed.** I appended to `lib/coach/race-replacement.ts` the
exact defect Rule 14 documents:

```sql
SELECT COUNT(*)::text AS n FROM plan_workouts pw
 WHERE pw.user_uuid = $1 AND pw.is_quality = true
   AND pw.date_iso >= (CURRENT_DATE - INTERVAL '7 days')::text
```

That is the "59 quality sessions in one week across 47 plan versions" query,
verbatim in shape. **`ACTIVEPLAN-1` passed — 4 tests, 0 failures.** Then
restored.

I then instrumented the scanner's own predicate and swept the tree: of 192
statements mentioning `plan_workouts`, **6 are user-scoped, unpinned, and
invisible to the gate**. Four are INSERTs and one is a harness UPDATE — no read
population, so harmless. The sixth is a live reader, and it is broken.

### The live defect

`web-v2/lib/coach/easy-discipline.ts:756-763`:

```sql
SELECT (workout_spec->>'hr_cap_bpm')::int              AS hr_cap_bpm,
       (workout_spec->>'pace_target_s_per_mi_lo')::int AS lo,
       (workout_spec->>'pace_target_s_per_mi_hi')::int AS hi
  FROM plan_workouts
 WHERE user_uuid = $1 AND type IN ('easy','recovery') AND workout_spec IS NOT NULL
 ORDER BY date_iso DESC
 LIMIT 1
```

No `plan_id`, no `training_plans`, no `archived_iso`. It reads **every plan
version the runner has ever had** and takes whichever easy row carries the
furthest-future `date_iso`. Two defects in one statement:

1. **Rule 14** — the population is all 51 of the owner's archived plans plus the
   active one.
2. The comment above it says *"newest easy spec wins"*, but `ORDER BY date_iso
   DESC` picks the **furthest-future scheduled day**, not the most recently
   authored spec. An archived long-horizon block outranks a freshly authored
   short one by construction.

This band is what the easy-discipline finding grades against — the coach line
that tells the runner how many of his last N easy days ran faster than
prescribed.

### Production, all seven users, run read-only

```
user            picked_plan_is_archived  picked_lo  active_lo
0645f40c (owner)          f                 502        502
606bcc38                  t                 543        583   ← 40 s/mi apart
9298919a                  f                 556        556
b04e35e9                  f                 722        722
bcefea06                  f                 583        583
d2f504ac                  t                 722        722
fb21cb09                  t                 643        643
```

**Three of seven users have the query selecting an archived plan's spec.** For
`606bcc38` the numbers actually differ: the surface grades his easy days against
**543 s/mi (9:03/mi), from a plan that no longer exists**, while his active plan
prescribes **583 s/mi (9:43/mi)**. A runner executing his current plan exactly as
written would be told he is running his easy days 40 s/mi too fast. The other two
coincide only by luck.

The owner is currently safe only by accident — his CIM block runs to 2026-12-03,
further out than any archived plan. The moment his block is rebuilt to a shorter
horizon (a post-race recovery block, a mid-block rebuild), an archived plan wins
and his easy band silently becomes historical fiction.

### Why nobody noticed

`coach_log_easy_discipline` has fired **zero** times for any of the seven users
across all 356 `coach_intents` (F-7). The defect has been sitting in the one
surface that consumes it, and that surface has never spoken.

### Fix shape

Widen the scanner's second gate: any `plan_workouts` statement that is
user-scoped and does not pin a plan is a finding, join or no join. Then fix the
query — the correct read is the active plan's *nearest upcoming* easy row, not
the calendar's last one.

---

# Flags, stale invariants, and CI reach

## F-30 · P1 — `lthr-reanchor.ts` still asserts the exact false sentence Rule 19 quotes it for. Verified false at HEAD.

`web-v2/lib/training/lthr-reanchor.ts:79-82`:

> "This module is PURE and imports no database at any depth, so a client bundle
> can read `LTHR_RETEST_CADENCE_DAYS` from it…"

Line 85 imports `lthrFromRace` from `@/lib/training/lthr`; `lib/training/lthr.ts:180`
is `const { pool } = await import('@/lib/db/pool');`. **The claim is false right
now.** I traced the edge myself.

Seventeen lines below the false sentence, the same file says:

> "THE DEFINITION MOVED BECAUSE THE PURITY CLAIM ABOVE WAS NOT TRUE… Every
> Railway deploy of `main` failed from `9a0c6314` onward while `tsc` and all
> twelve prebuild gates passed."

Both sentences are in the file at once. CLAUDE.md Rule 19 names this file and
this sentence as its canonical example of the failure — *"It was false, it was
false for a day, and no check could tell."* It is still there. `check-client-graph.sh`
only fires when a `'use client'` file happens to reach this module; it does not
gate the module's own stated invariant. The next person who trusts line 79 and
imports a constant from here re-runs the outage.

Rule 20's corollary is the whole fix: gate the claim or delete the sentence.

## F-31 · P1 — `web-v2/lib/adaptation/**` matches no CI path filter. ~81% of the test suite runs in no automated context.

Verified directly against `.github/workflows/`:

- `surface-sweep.yml` paths: `web-v2/lib/faff/**`, `lib/coach/run-recap.ts`,
  `lib/runs/run-shape.ts`, `app/api/v5/**`.
- `plan-engine-bench.yml` paths: `web-v2/lib/plan/**`, `lib/coach/readiness**`,
  `lib/coach/runner-calibration**`, `lib/training/vdot.ts`,
  `lib/training/projection-snapshots.ts`.
- The only workflow mentioning `lib/adaptation` at all is
  `prune-adaptation-shadow-log.yml` — a cron, not a test run.
- No workflow runs `npm test`.

397 test files live under `web-v2/lib`; roughly **76** are reachable from any
automated runner (prebuild's 14, plus the two path-filtered suites). So
`_adaptation_engine.test.ts` (63 KB), `_pace_replay_corpus.test.ts` (48 KB),
`_duration_volume_density_replay_corpus.test.ts` (36 KB) and
`_adaptation_model.test.ts` (23 KB) **never run automatically**, nor do 131 of
136 `lib/plan` test files, nor `lib/training/**` beyond two named files.

This is Rule 15 raised one level: the corpora exist, they are cited as evidence,
and no automated process reaches them.

Compounding it — **F-32**.

## F-32 · P1 — 665 lines of brand-new code run nightly for every user, defended only by a test that cannot execute without a hand-set env var.

`web-v2/lib/adaptation/shadow-compare.ts` (665 lines, live since 2026-09-01) is
called unconditionally from `app/api/cron/run-adaptations/route.ts:132-135`,
inside the per-user loop. Its only test,
`_shadow_compare.audit.test.ts:56`, is `describe.skipIf(!RO)` for the entire
file, and `DATABASE_URL_RO` is set by no workflow — `build-check.yml:66-72`
explicitly states *"A build must not need live credentials."*
`_pace_replay_corpus.test.ts:24-33` says outright that it does not call
`runPaceShadowCompareCycle`.

The file's own header claims *"Three independent layers prove this, not just
assert it"*, and layer 1 is that RO-gated test. It is a manual, once-run
verification described in the present tense as a proof (Rule 20).

Same shape, worse: `web-v2/lib/training/coaching-thesis.ts` — **420 lines, zero
callers**, and its only test is likewise one RO-gated `describe`.

There is no flag on any of this. **Answering the brief's shadow-mode question
directly: the shadow path is not gated at all and is permanently on.** The
header states the disablement mechanism is a `to_regclass` probe, i.e. turning
it off requires a `DROP TABLE` (which needs David's per-statement DDL go) or a
redeploy. It roughly doubles the cron's per-user work against
`export const maxDuration = 120`.

## F-33 · P1 — `HANDED_BACK_FAILS` is a flag whose `true` branch is dead code — the exemption sits above the only assertion.

`web-v2/lib/audit/coercion-registry.ts:301` — `export const HANDED_BACK_FAILS = false;`
`web-v2/lib/audit/_coercion_scan.test.ts:367-373`:

```ts
it('fails the build once HANDED_BACK_FAILS is flipped', () => {
  if (!HANDED_BACK_FAILS) return;      // ← above the only assertion
```

This is the exact anti-pattern CLAUDE.md Rule 18 names by example
(`PACE.interval-offset` carried `if (exempt(...)) return;` on the line above its
only assertion). The assertion has never run and cannot be falsified. It is the
mechanism holding F-4's seven live collapses open. Two more of the seven, traced
to HEAD:

- `lib/plan/adapt.ts:2852-2853` — `mileageByDay(...).catch(() => new Map())`: a
  failed volume read silently disables the whole layoff/comeback detector.
- `lib/plan/adapt.ts:4483-4484` — `observableCoverageDays(...).catch(() => 0)`:
  collapses the chronic-volume floor, and the comment two lines above warns this
  makes the shave fire *more* readily.

## F-34 · P2 — `hrCapEasy`'s HRmax branch is structurally unreachable, so the live easy cap is 80% of HRmax where doctrine says 78%.

`web-v2/lib/plan/spec-builder.ts:389-399`: `Math.max(lthrCap, maxHrCap)` where
`lthrCap ≈ 0.895 × LTHR` and `maxHrCap = 0.78 × HRmax`. The app derives
`LTHR = 0.90 × HRmax`, so `lthrCap ≈ 0.805 × HRmax` and the `max` always
resolves to it. A two-branch decision with one reachable branch — and the
effective ceiling is **2 percentage points of HRmax looser than the cited
number**, written into `workout_spec.hr_cap_bpm` on every generated workout. It
is recorded as `EASY.cap-not-looser-than-daniels · max-of-two-ceilings`; see
F-35 for why nobody reads that.

## F-35 · P2 — Both "recorded violation" reports are suppressed in every build, including three that self-describe as runner-facing.

`scripts/check-doctrine.sh:114` runs `vitest run lib/doctrine --silent`. The gate
prints `doctrine OK · 323 citations resolve`. The suppressed line
(`lib/doctrine/_doctrine_gate.test.ts:118`) is
**`=== DOCTRINE · 323 claims · 12 recorded violations ===`**, three of which
self-describe as *"REAL VIOLATION, RUNNER-FACING, NOT FIXED HERE"* —
`CONVENTION.simulator-projection-band` at 5K/10K/half, where a 5K band of ±0.38%
stands against doctrine's ±1.5% floor (an A-goal and a C-goal ten seconds
apart). None of this reaches a build log or `build-check.yml`.

`_coercion_scan.test.ts:358`'s `console.warn` prints under neither default nor
`--silent`, only under `--disable-console-intercept` — verified by running it
three ways. It is honoured only by accident: `check-coercion.sh` re-derives the
list in shell and prints it itself.

## F-36 · P2 — Four gate stages report OK while checking nothing when vitest is absent.

`check-coercion.sh:260`, `check-doctrine.sh:111`,
`check-generated-content.sh:123`, `check-swallowed-failure.sh:175` all carry
`*_SKIP_VITEST` switches. Defaults are correct. The hazard is the other branch:
`check-generated-content.sh:133-136` — if `web-v2/node_modules/.bin/vitest` is
not executable it prints a caveat and then **`exit 0` with "generated-content OK
· 38 authored columns, every one with a named reader."** Railway builds with
`npm install` (`railway.json:5`) and vitest is a devDependency; any environment
that omits devDeps turns four gates into registry-shape checks that still
announce confidence. Rule 18 point 2, verbatim. The newer gates
(`check-normal-window`, `check-client-graph`, `check-automatic-mutations`,
`check-goal-immutability`) use `npx vitest` and hard-fail instead — the two
postures disagree and the older one is wrong.

## F-37 · P2 — `NODE_ENV` is one unasserted variable between production and an auth bypass to the owner's account.

`web-v2/lib/auth/session.ts:293-300`:

```ts
function resolveDevFallback(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const dev = process.env.DEV_USER_UUID;   // returns this uuid for an UNAUTHENTICATED request
```

`.env.example:80-82` publishes `DEV_USER_UUID=0645f40c-951d-4ccc-b86e-9979cd26c795`
— the owner's real uuid. The same variable decides `secure:` on the session
cookie in five routes. `next start` sets `NODE_ENV`, so this is fail-closed
today, but nothing asserts it at boot and per Rule 20 an unasserted invariant is
a hypothesis. Related, P3: `session.ts:258-264` lets a *thrown* session lookup
fall through to the same fallback — "DB read failed" collapsed into "no session".

## F-38 · P2 — Three more FALSE header invariants in files touched since 2026-08-30.

| File:line | Claim | Reality |
|---|---|---|
| `lib/adaptation/_adaptation_engine.audit.test.ts:6-8` | *"nothing in this repo calls `resolveAdaptationProposals` on a live path"* | `shadow-compare.ts:315` does, reached from the nightly cron. This is the one file whose job is to state what is and is not live. |
| `lib/adaptation/load.ts:1043-1069` | *"migration 160 … NOT RUN — pending David's per-statement go"* | `db/migrations/160_adaptation_shadow_log.sql:5-8` says *"APPLIED with his explicit go"*; the prune route and its workflow exist. (Its narrower claim at `:1068` is still true.) |
| `lib/faff/fitness-read.ts:8-11` | *"`lib/fitness/fitness-model.ts` … has been correct, tested and unreachable"* — present tense | `app/api/v5/today/route.ts:63` imports `resolveFitness` from it on the live phone route. `route.ts:343-345` states the same fact correctly, in the past tense. A reader trusting `fitness-read.ts:10` would conclude the module is deletable. |

## F-39 · P2 — Five env vars name one quantity, and `.env.example` documents six variables nothing reads while omitting every critical one.

Origin resolution (Rule 16 at the config layer):
`lib/auth/access-requests.ts:30` and `lib/watch/build-workout.ts:47` use
`NEXT_PUBLIC_BASE_URL ?? 'https://www.faff.run'`;
`app/api/auth/strava/route.ts:132-134` and its callback use
`NEXT_PUBLIC_APP_ORIGIN || APP_ORIGIN || PUBLIC_URL`;
`app/api/cron/tick/route.ts:111` uses `CRON_TICK_BASE_URL`. Set only
`NEXT_PUBLIC_APP_ORIGIN` and the first two silently fall to a hardcoded literal
— right in prod, wrong in any staging or preview.

`.env.example` documents but nothing reads: `ADMIN_OPERATIONAL_TOKEN` (whose
comment claims it gates admin endpoints — it gates nothing),
`STRAVA_REFRESH_TOKEN`, `STRAVA_ATHLETE_ID`, `APPLE_TEAM_ID`,
`APPLE_REDIRECT_URI`, `DEFAULT_USER_ID` (removed 2026-05-30). Read in code but
undocumented: `CRON_SECRET` (28 reads — every cron 503s without it),
`ADMIN_BOOTSTRAP_TOKEN`, `ALLOW_OPEN_SIGNUP`, `RESEND_*`, all `APNS_*`,
`OPS_SLACK_WEBHOOK_URL`, `OPS_ALERTS_DISABLED`, `OPS_SENTRY_DSN`, four
`STRAVA_*`, `ADMIN_EMAIL`, and all five origin vars above.

## F-40 · P2 — A gate produces 651 runner-facing findings and declines to fail on any of them.

`web-v2/lib/faff/surface-sweep-matrix.ts:284-291` — three `firm: false` rules.
Prebuild prints `FIRM findings: 0 across 0 kinds` / `OBSERVATIONS (design
decisions, not gated): 651 across 4 kinds`. Two of the three are doctrine
violations elsewhere in this same codebase:

- **`UNREADABLE_FOR_ABSENT`** (36 cells) — *"a past race with no logged result
  ships a null value stamped measured, which the phone paints as fault-red
  'could not read'."* That is Rule 11 rendered on the phone, filed as an
  ungated design decision.
- **`ELAPSED_VS_MOVING`** (132 cells) — *"panel prints 525 s/mi of elapsed clock
  beside a 450 s/mi pace."* The identical proposition is a **hard law** in
  `lib/conservation/laws.ts` ("a pace equals its own surface's time over its own
  distance"). One gate fails on it; this one counts it.

## F-41 · P3 — `MODULE_ORPHANS` review (the brief's specific question): the registry is well maintained; four entries are dead code, not pending wiring.

The ratchet worked on the 2026-08-31/09-01 churn — `pace-hr-compatibility.ts`,
`adaptation-engine.ts` and `load-adaptation-engine.ts` were each added as
orphans and then **correctly removed** when the wiring landed. A `COERCION_ARGUED`
exemption that went stale within four minutes has already been deleted. No
laundering found.

Genuinely dead, by the registry's own admission, and worth deleting rather than
carrying:

- `lib/plan/core.ts` — the extraction landed, no builder switched over;
  `parseGoalSeconds` and `daysBetween` still live in both it and `generate.ts`.
- `lib/strava/streams.ts` — superseded by `4e7986ac`; "confirm, then delete" not done.
- `components/profile/InlineGapEditor.tsx` + `ProfileGapInput.tsx` — "both halves
  are orphaned, so the COACH NEEDS card is served by neither."
- `lib/faff/state-tokens.ts` — "a single source of truth, which nothing sources from."

`lib/training/coaching-thesis.ts` is an honest pending-wiring entry, but its
stated justification ("the question was asked and the answer is written and
tested") overstates the last word — see F-32.

## F-42 · P3 — Comments citing files that do not exist.

| Citation | Cited in | Reality |
|---|---|---|
| `lib/audit/normal-window-exemptions.ts` | `lib/training/normal-window.ts:146` | the file is `normal-window-registry.ts` — a broken pointer inside Rule 8's canonical module |
| `lib/plan/drift-cron.ts` | `lib/plan/drift-monitor.ts:28` | no such file; the writes are in `app/api/cron/plan-drift/route.ts` |
| `lib/plan/citation.ts` | `lib/doctrine/_doctrine_lint.test.ts:422` | no such file — and this is the **stated justification for a 12+ entry allowlist** of unresolvable doctrine anchors. Rule 18 point 4: the argued reason is unverifiable. |
| `docs/2026-05-19-sim-sweep.md` | `lib/doctrine/registry.ts:16444` **and `CLAUDE.md`'s own branching section** | missing from the repo |

## Negative results — checked and clean

- No `.bak`, `.orig` or `_scratch_*` files under `web-v2`.
- No gate script references a nonexistent path (all 25 `scripts/check-*.sh`
  scanned; four apparent hits were prose line-wraps and paths containing spaces).
- All 16 `*.audit.test.ts` files are consistently `DATABASE_URL_RO`-gated and
  override `DATABASE_URL` before the pool is constructed — none can write to
  production.
- `._*` AppleDouble sidecars are excluded by `vitest.config.ts:36`,
  `module-graph.ts`'s walker and `findUncalledRoutes` — they are not inflating
  any count checked here.
- `prescriptionFloorSec` / `roundTargetSec` duplicated between
  `lib/race/effective-race-target.ts` and `lib/training/achievable-target.ts` is
  **acceptable**: byte-identical bodies, argued in-comment, and
  `GOAL.prescribed-race-pace-ceiling` drives both entry points and asserts they
  clamp to the same band edge. This is the pattern Rule 16 wants when an import
  is impossible.
- `plan_workouts.workout_spec`'s Rule 6 guard is real and universally applied
  (see F-11).
