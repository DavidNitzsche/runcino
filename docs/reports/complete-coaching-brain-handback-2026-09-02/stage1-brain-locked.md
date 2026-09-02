# Stage 1 · the coaching brain, locked · 2026-09-02

Evidence record for the first stage of the five-stage directive. Stage 1 is
implemented, verified, committed, pushed, deployed, and proven against the
owner's real production data. Stages 2–5 build on this and are recorded
separately.

## What locked

| Belief | Canonical owner | Owner's value | Confidence · source | Refusal behaviour |
|---|---|---|---|---|
| Threshold capacity | `capacity-resolver.ts#resolveThresholdCapacity` | **7:10/mi**, VDOT 47.8 | 0.84 · direct, 3 corroborating sessions | typed refusal → fallback tiers, each labelled |
| High intensity | `resolveHighIntensityCapacity` | 6:41/mi | 0.50 · **vdot_fallback** | no direct reader exists in this app; never claims one, cannot be the thesis limiter |
| Easy ceiling | `resolveEasyCeiling` | 8:22/mi | 0.63 · direct | ceiling semantics, never a symmetric target |
| Durability (exponent) | `durability-anchor.ts#fitRaceExponent` | **1.0825** (raw 1.110) | 0.52 · race-derived, 5 races | `SINGLE_LONG_END_OBSERVATION` named |
| Marathon-specific | `prescription-resolver.ts#marathonPaceFromDurability` | **7:52/mi, band 7:40–8:08** | 0.84 · exponent carry | rehearsal cap only above a stated confidence floor |
| Training durability | `resolveTrainingDurability` | refused, 2 of 3 rehearsals | — | `insufficient_corroboration`, reported not spent |
| Race outlook | `race-outlook.ts` | CIM expected 3:19:41, execution 3:13:30 | staleness reported | typed `unavailable` |

## The five defects corrected, and what each did to the runner

1. **Representativeness was computed and not spent.** A 69 °F, 722-ft half entered the distance-time curve at full weight beside a February PR half. Now every race is priced by `assessRaceRepresentativeness` — AFC weight 1.00 → 0.31 and its time corrected 1:41:53 → 1:36:55; LA 1.00 → 0.55; Sombrero 0.35 → 0.08.
2. **One marathon fixed the exponent and nothing said so.** With two distinct distances the fit passes through the long end exactly, so the residual is zero by construction. Endpoint coverage now scores it: evidence 0.66 → 0.45, and the read names `SINGLE_LONG_END_OBSERVATION`.
3. **Marathon pace could not be earned.** `Research/02` §12.2/§12.4 grade a held marathon-pace rehearsal as a predictor with low false positives. The reader exists, refuses below doctrine's three sessions, and caps the exponent carry from the fast side only.
4. **The anchor was a point.** It now carries `marathonRangeSecPerMi`, from the population exponent to the runner's raw fit.
5. **Sparse threshold oscillation.** An uncorroborated session now earns one day's move cap however long the gap, and a cross-tier continuity walk holds every non-fully-corroborated belief within a day's cap of what the same resolver said yesterday.

**Owner's belief replay, 2026-06-01 → 09-01, 93 days:**

| | deployed before | Stage 1 |
|---|---|---|
| belief changes | 15 | 13 |
| largest daily step | 26 s/mi | **9 s/mi** |
| final belief | 430 s/mi | **430 s/mi (unchanged)** |

The June oscillation (456 → 430 → 455 → 430 in four days) is now a graded 456 → 452 → 447 → 442, every step evidence-bounded.

## An honest correction to the earlier audit's prediction

The 2026-09-02 marathon-anchor audit predicted these corrections would move the anchor **slower** (7:55 → 7:58–8:00), because it modelled representativeness alone. The deployed model also added endpoint coverage, which cuts the evidence score and shrinks the exponent further toward the population prior — and that dominates. The anchor moved **7:55 → 7:52**, faster.

That is the correction behaving correctly, not goal-chasing: with less confidence in one poorly-paced marathon, the belief moves toward the population, which happens to be kinder. Goal isolation is proven separately (§below) — the identical run with a 2:30, 3:00, 3:30 and no goal produces byte-identical capacity, exponent, expected improvement and expected race day.

## Production verification — the owner's live plan

Canonical path only: `gh workflow run snapshot-projections.yml` (runs 33594805619 and 33596624670), which is `reanchorActivePlan` → `recomputePacesForPlan` → `refreshRaceRowsForPlan`. No script wrote to production.

| | before | after |
|---|---|---|
| Sealed rows (before 2026-09-02) | 7, md5 `1f9bc33de7f4cbb10c6807304305e1af` | 7, md5 `1f9bc33de7f4cbb10c6807304305e1af` — **identical** |
| Stated goals | CIM 3:00:00, Malibu 1:30:00, Dodgers 0:45:00, LA 3:31:00 … | **identical** |
| Marathon-pace rehearsals (11-17, 11-24) | 475 s/mi | **472** |
| Interval sessions (10-01, 10-08, 10-15, 10-29, 11-03) | 407 / 403 | **401 / 397** |
| CIM race row | 451 | **443** |
| Run Malibu race row | 438 | **422** |
| Santa Monica race row | 429 | **416** |
| Race-week tune-up | 451 | **443** |
| Workouts repriced | — | **76**, stamped 2026-09-02T05:55:11Z |

**The first recomputation moved only the race rows**, which exposed a real defect: `shouldReanchorRacePrep` read the VDOT anchor delta and nothing else, so a block stayed on stale prices whenever a belief OTHER than threshold moved. `anchorsMovedFromStamp` now compares all six canonical anchors against the Rule 10 stamp the plan already carries. The second recomputation, on the deployed fix, repriced the 76 rows above. That is the difference between a brain that is right and a plan that follows it.

## Gates added, every one falsified

`falsification/` in this directory holds the mutation, the failing output, and the restored output for each:

| Invariant | Broken → |
|---|---|
| rehearsal bar below doctrine | doctrine gate names the constant against §12.2 |
| endpoint coverage ignored | `_durability_phase1` fails |
| rehearsal cap from the slow side | fails |
| rehearsal spent below the confidence floor | fails |
| rehearsal step-up rule removed | fails |
| sparse cap scales with days | fails |
| continuity cap disabled | fails |
| representativeness computed but not spent | fails (source-bound: a pure test cannot see a DB loader) |

Plus two doctrine claims that read their numbers out of `Research/02` at run time: `CONVENTION.marathon-rehearsal-predictor` and `CONVENTION.exponent-endpoint-coverage`.

## Phase 11 acceptance — nine archetypes, expectation written first

`lib/training/_brain_acceptance.test.ts`, pure, runs in CI with no credentials:

```
owner                 T 7:10 direct 0.78 · M 7:45 [7:40-7:50] personal, rests on one marathon
zero-run              every anchor user_prior at 0.15, nothing personal
typed-PR              user_prior, above population, below a measured read
sparse-history        direct but 0.68, never full confidence
returning             level held at 7:20, confidence down to 0.64
speed-strong          exponent 1.106 → M 7:28 [7:07-7:49], SLOWER than the table
durable/speed-limited exponent at the prior → M at least as fast as the table
no-HR                 vdot_fallback at 0.20, a belief without false precision
inconsistent          direct 0.72; an empty week is not read as lost fitness
```

Invariants for all nine: interval < threshold < marathon < easy ceiling ≤ shakeout, and high intensity never claims a direct source mode.

## Adaptation

Mutation stays off, proven three ways (RO checksum on the owner's plan identical across three runs, a new source scan, the existing boundary gates). The shadow-evidence epoch is at **3** (`brain-integration`): the belief-source pin caught the continuity walk during integration and forced the bump, so no pre-correction shadow record counts toward promotion. Multi-day evidence at the current epoch is zero days by construction — the restart is the point. Live upward Pace Adaptation authority is **not** activated; the promotion requirements are not met.

## Verification

tsc clean · prebuild 18/18 · **8401 tests passed, 0 failed, 13 skipped** · doctrine 325 citations · watch gate 195 cases · both Xcode targets build · Railway `da878fbe` SUCCESS.

## Rendered on the deployed build (Rule 13)

`renders/stage1-block-thesis-deployed-3bf794c2.png` — the phone app, pointed at
production, against the deployed brain. The Block screen's WHERE THIS GOES
section carries the Coaching Thesis, in the runner's own terms:

> Your races fade with distance faster than your speed predicts, so durability
> is where the work goes. Your threshold holds, and this week's long run is the
> session that builds it.
>
> This gets revisited when a new race result lands, or when a long race or a
> race-pace long run shows your pace holding with distance.

Every element of the thesis contract is present and correct on the screen: the
primary limiter (durability), the evidence behind it (the fitted exponent —
"races fade faster than your speed predicts"), what is deliberately held
constant (threshold), the session that addresses it this week (the long run),
and the review trigger. This is the belief layer reaching the runner as
coaching rather than as a number.

Today (`renders/`) shows the 2026-09-01 session read correctly: heart rate
across the work 162 bpm, pace across the work 7:02 — the work segments, not
whole-run averages.

## Remaining, carried into later stages

- Plan generation does not yet consume `thesisPlanDirective` — the seam is tested, the wire is Stage 2's.
- `lastLongClean` in `adaptive-ramp.ts` reads "no long run" as "clean long run" — real, deliberately unfixed because tightening it raises the bar on an upward path that has fired zero times in 309 intents.
- Migration 161 (adaptation shadow log) is queued and needs a per-statement go before `CANNOT_CONVERGE` cycles are recorded.
- `lib/fitness/fitness-model.ts` is structurally a second fitness read on Today (measured: Δ −0.10 VDOT, agrees today).
