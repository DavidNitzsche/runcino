# Live-plan rebuild · dry-run preview

**Nothing has been written.** Every number below came from composing in memory
against a read-only connection. The live plan `pln_9a57561debb776e5` is
untouched.

Anchoring fix: `b113a787` — *a rebuild begins where its block began*.

---

## The eleven proofs

| # | Required | Verdict |
|---|---|---|
| 1 | Block remains 15 weeks, 2026-08-24 → 2026-12-06 | **PASS** — 15 weeks, all 15 week starts aligned, race day 2026-12-06 present |
| 2 | Completed workouts and historical prescriptions unchanged | **PASS** — all 7 past-dated rows carried verbatim |
| 3 | No completed history regenerated, moved or reinterpreted | **PASS** — `clipBeforeISO` untouched; sealed rows carried, not recomposed |
| 4 | Stated 3:00 CIM goal untouched | **PASS** — `statedGoalSec` 10800, `load_tier_reduced_by_goal: false` |
| 5 | Weekly-volume trajectory preserved unless justified | **CHANGED — justified, and one part needs your call.** See §3 |
| 6 | Peak week and longest run intentionally placed | **CHANGED** — peak 61.0→58.5, long 21.5→20.5. See §3 |
| 7 | Quality, long runs, races, recovery, rest sensibly spaced | **PASS** — see §2 |
| 8 | Corrected workout structures in future sessions | **PASS** — 96 future rows previewed |
| 9 | Corrected HR targets and race abort rules appear | **PASS** — 57 HR caps, 22 pass/abort rule sets |
| 10 | Race-day execution distinct from aspirational goal | **PASS** — goal 3:00:00 kept, execution separate |
| 11 | Plan invariants and cross-surface contracts pass | **PASS** — `validateComposedPlan`: no violations |

Two proofs report CHANGED rather than PASS. Neither is a failure; both are
decisions I am not willing to make on your behalf.

---

## 1 · What the anchoring fix did

Every rebuild path passed neither `startAnchor` nor `startDateISO`, so the
composer defaulted to Monday of the *current* week. Rebuilding today therefore
produced **14 weeks from 08-31** and re-phased the entire block. Worse,
`persistPlan` only writes dates its composed weeks cover — so the five sealed
rows of the dropped week, 08-24 through 08-30, **would not have been written
into the new plan at all.**

| | Span | Weeks | Aligned starts |
|---|---|---|---|
| live | 2026-08-24 → 2026-12-06 | 15 | — |
| before the fix | 2026-08-31 → 2026-12-06 | 14 | 0 of 15 |
| **after the fix** | **2026-08-24 → 2026-12-06** | **15** | **15 of 15** |

The `startDateISO` clamp was not loosened. Its "≥ today" rule is an *onboarding*
rule and correct as one — removing it would let onboarding schedule runs before
a runner existed. This is a fourth, separate question with its own answer in
`lib/plan/block-anchor.ts`, resolved once at the chokepoint every authoring path
passes rather than wired per route.

Its refusal branch carries no `anchorISO` field, so `.anchorISO` does not
compile until the caller branches, and each refusal is named separately —
including `read_failed` distinct from `no_active_plan` (Rule 11).

---

## 2 · The fifteen-week diff

`writ` is what would actually be written: week 0 keeps your sealed rows, so its
composed 46.0 is not applied.

| Week start | live mi | new mi | Δ | live long | new long | live flags | new flags |
|---|---|---|---|---|---|---|---|
| 2026-08-24 | 38.0 | 37.5 | −0.5 | 13.0 | *sealed* | — | — |
| 2026-08-31 | 45.0 | 50.0 | **+5.0** | 15.0 | 15.0 | — | — |
| 2026-09-07 | 28.9 | 24.4 | −4.5 | RACE | RACE | cutback | cutback |
| 2026-09-14 | 34.0 | 48.0 | **+14.0** | 12.0 | 16.5 | — | — |
| 2026-09-21 | 48.7 | 56.2 | **+7.5** | 15.5 | 18.0 | — | — |
| 2026-09-28 | 56.0 | 41.0 | **−15.0** | 19.0 | 14.0 | — | cutback |
| 2026-10-05 | 61.0 | 58.0 | −3.0 | 20.0 | 18.0 | **PEAK** | — |
| 2026-10-12 | 45.5 | 58.5 | **+13.0** | 15.0 | 19.5 | cutback | — |
| 2026-10-19 | 60.0 | 45.0 | **−15.0** | 19.5 | 16.0 | — | cutback |
| 2026-10-26 | 61.0 | 58.5 | −2.5 | 21.5 | 20.5 | — | — |
| 2026-11-02 | 45.6 | 45.6 | 0.0 | RACE | RACE | cutback | cutback |
| 2026-11-09 | 44.0 | 39.5 | −4.5 | 16.0 | 17.0 | — | cutback |
| 2026-11-16 | 48.0 | 46.0 | −2.0 | 19.0 | 19.0 | — | — |
| 2026-11-23 | 36.0 | 33.5 | −2.5 | 14.0 | 13.5 | — | — |
| 2026-11-30 | 43.7 | 44.2 | +0.5 | RACE | RACE | RACE WEEK | RACE WEEK |
| **total** | **695.4** | **685.9** | **−9.5** | | | | |

**Total volume is within 1.4%.** What changed is the *shape*: the new plan
starts higher and rides flatter, with a regular three-week cutback cadence
(weeks 2, 5, 8, 10-11) instead of the live plan's irregular 5-then-3 spacing.

Total long-run mileage goes **up**, 199.5 → 201.5, spread more evenly. The
September long runs move 12.0 → 16.5 and 15.5 → 18.0; the single 21.5 peak
becomes 20.5.

Races and tune-ups are unchanged: 09-13 10K, 09-26 10K, 11-08 half, 12-06 CIM.

### Structures, HR and abort rules

Of 96 future rows: **57** carry an HR cap (151 for easy and long, from the
re-anchored LTHR 168), **17** carry warm-up and cool-down, **22** carry
pass/abort rules — *"Pass: avgHr ≤ 164 on the work"*, *"HR over 173 and
climbing · finish easy, the stimulus is banked"*. Race rows carry
distance-scaled checkpoint aborts: mile 2 at 179 bpm for a 10K, mile 5 at 171
for the half, mile 10 at 163 for CIM.

One correction to something I nearly reported as a defect. My first spec
preview showed every race at 6:52/mi — 10K, half and marathon alike. **That was
my harness, not the engine.** `persistPlan` passes twelve arguments to
`buildWorkoutSpec` and I passed seven; without `prescribedRacePaceSec` the race
branch falls back to the stated goal pace. The pace column on race rows is
labelled as an artifact in the detail file. Race pacing is owned by
`race-row-refresh`, which runs inside authoring. HR caps, warm-up, cool-down
and the pass/abort rules read none of the missing arguments and are valid.

---

## 3 · Why the volume changed, and the one call that is yours

The composer is not being more conservative. **It is starting from a much
better read of you.**

| Authoring input | live · 2026-08-30 | rebuild · 2026-09-02 |
|---|---|---|
| ramp base | **34.7 mi/wk** | **44.0 mi/wk** |
| 4-week mean | 31.6 | 34.2 |
| sustained | 45.0 | 46.4 |
| estimated current VDOT | **44.1** | **47.8** |
| goal realism flag | **true** (flagged unrealistic) | **false** |

The live plan was authored while your base read 34.7 and your fitness read
44.1, so it had to climb steeply — 34.7 to a 61.0 peak, +76%. The rebuild opens
at 46 because your base genuinely is there now, and climbs +33%. The engine
states this itself:

> *"The base is in place: you are holding 95% of the 46.4 mi a week you have
> held, inside the range doctrine treats as a down week, so the block opens on
> quality rather than base."*

Its thesis names **DURABILITY** as your least-evidenced capacity, priority
`increase_long_run_demand`, confidence 0.51 — which is why long-run mileage
rises while peak weekly does not.

That is a coherent justification, and it is the answer to proof 5.

### The part I will not decide for you

The engine classifies you **advanced**, with a peak-weekly band of **65-90 mi**
and a peak-long band of **22-24 mi**. Your live plan peaks at 61.0 and 21.5.
**The rebuild peaks at 58.5 and 20.5 — further below both bands, from a base
9.3 mi/wk higher and a fitness read 3.7 VDOT better.**

Read against the standing statement at the top of `CLAUDE.md` — *the plan has
to push us more and more* — a fitter runner receiving a lower peak is the exact
signature Rule 9 tells us to distrust. It is not a cliff here; it is a ramp
shape. But the headroom between 58.5 and the bottom of your own doctrine band
is 6.5 miles, and the engine is choosing not to spend it.

Three honest options:

1. **Accept.** The thesis is durability, long-run volume rises, and peak weekly
   is not the limiter it identified.
2. **Rebuild, then push the peak deliberately** through the progression path,
   as evidence arrives.
3. **Hold the rebuild** until the peak-versus-tier-band question is settled as
   doctrine.

I recommend **(1) then (2)**: take the corrected structures, the anchored
calendar and the better fitness read now, and treat the 6.5 miles of unspent
headroom as the first real test of whether the upward path can fire — which is
the open question section 9 of the handback already names.

---

## 4 · Refusals, fallbacks and uncertainty during generation

Reported because you asked for them by name, not because they are alarming.

- **One placement compromise**, cited: an 18-mile long run stands one day after
  the 09-26 Dodgers 10K — 24.21 mi across the pair — accepted as a hard-workout
  pairing under `Research/00b` §"Recovery by Effort" (C race) and `Research/22`
  §"Multi-Race Year Planning". The live plan recorded no compromises, so this
  is new and it is a real scheduling tension worth your eye.
- **`lifted: false`** in the ramp base. The three-week return ladder is off
  because 0.70 × 46.4 = 32.5 is not greater than your 34.2 mean. You sit
  **1.7 mi** from that boundary — the same Rule 9 cliff recorded in `CLAUDE.md`,
  still live, still deciding a categorical outcome on a hair.
- **`trailingAvgWeeklyMi` 32.58** — the unfiltered injury-guard reader, correct
  by Rule 8's corollary (absorbed load, not capability) and deliberately not the
  same number as the 34.2 habit reading.
- **Two advisory dosing findings**, both `enforced: false`, both in taper weeks
  (11-16 and 11-23), under doctrine's taper percentage exemption.
- **`horizon_raise: null`**, **`travel_shaped` not recorded** — no travel
  windows declared.
- Confidence on the coaching thesis is **0.51**, which is low. The durability
  limiter driving the whole shape rests on a marginal belief.

---

## 5 · What I could not prove from a preview, stated rather than glossed

- **Persisted specs.** `DayPlan` carries no `workout_spec`; specs are built
  during persist. §2 previews them with the same builder, minus five arguments
  the composer holds internally. The non-race rows are sound; the race pace
  column is not.
- **Race-row repricing.** `race-row-refresh` runs inside authoring, after
  compose. Its output can only be verified on the stored plan.
- **Rendered surfaces.** Rule 13 requires rendering with real data. Today,
  Block, workout detail, race detail, watch payload and post-run can only be
  verified after the write.

---

## 6 · Before the write, if you approve

1. Merge and deploy `b113a787`, and **confirm the deploy by status** — the
   rebuild runs through `POST /api/cron/silent-rebuild` in production, so a
   merged-but-undeployed fix rebuilds with the old anchor (Rule 19).
2. Rebuild.
3. Recompute both seals. Plan history `df8b2ae4…`, runs `d8ad8b19…`. **If
   either moves, roll back.**
4. Verify the stored plan, not the generator.
5. Render Today, Block, workout detail, race detail, watch payload, post-run.
6. Run the production-derived cross-surface suite.

**Rollback** is one reversible statement: archive the new plan, clear
`archived_iso` on `pln_9a57561debb776e5`. Its 103 rows are retained and come
back unmodified. Completed runs pair to plan rows by date, not row id, so
nothing is orphaned either way.
