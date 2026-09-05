# Consolidated handback · overnight 2026-09-04 into 2026-09-05

**Starting commit:** `a8392d08`
**Ending commit:** `bc24447e1`
**TestFlight:** build **279**, shipped from `95a7134e`, contains STUCKCONN-2

Nothing was written to the live training plan. No live adaptation was promoted.
`AUTOMATIC_ADAPTATION_AUTHORITY` is still `false`.

---

## 1 · The mileage question · direct answer

> If I run more mileage than prescribed during a week, does that update the
> planned mileage for the following week or later weeks?

### Before: no. Three independent paths point down, none points up.

| Stage | What happened |
|---|---|
| ingest → execution identity | Worked. EXACT/LEGACY tiers resolve. |
| weekly execution total | Computed in exactly one place: `overshootFires`, `completedMi > baseline × 1.25`. |
| evidence grading | Grades a **session**. No weekly-volume grade exists. |
| **capacity belief** | **DEAD END. No demonstrated-volume belief existed anywhere.** |
| adaptation proposal | `volume_overshoot` → **shave the next 7 days by 17%**. The only response to extra mileage. |
| upward lever | `tryAdaptiveBump` returns `null` on its first line, behind the owner's own 2026-09-02 seal. |
| even unsealed | Extra mileage reaches the ramp only via ACWR, and `acwrHeadroom = acwr < 1.3` is a **ceiling**. More mileage raises ACWR and turns the gate **off**. |

None of the five ramp signals (`acwrHeadroom`, `lastQualityOnPace`,
`lastLongClean`, `belowTierUpper`, `noBumpRecent`) reads "he ran more than
prescribed."

**Nine thresholds on this path: eight suppress or cap an increase, one triggers
a decrease, zero trigger an increase.**

### A fifth dead end the agent found that I had missed

`lib/plan/load-progression-contract.ts` is the single owner of "how much load"
and its own header promises `demonstratedLoadAfterEachWeek`, *"recomputed from
completed weeks, which is what moves every number above."* **Nothing recomputed
it.** One caller in the whole app, at authoring. The envelope was struck once
and no completed week ever moved it. Rule 20 exactly: a header asserting an
invariant that nothing verifies.

Also: `weekly-volume.ts` reads completion as a **boolean** (`meetsCompletionBar`
at 0.95). A week at 95%, 100% and 140% are the same input.

### Now: the path exists, in shadow

`web-v2/lib/adaptation/volume-evidence/` — pure, no DB, no clock. Six surplus
kinds classified; five admission conditions; a demonstrated-volume belief; a
responder that re-resolves the existing load contract and raises future
**unsealed ordinary** weeks; cutbacks, tapers, recovery and race weeks
preserved; volume and intensity never advanced together (it calls
`detectSimultaneousStressAddition`, not a second implementation); a six-way
split on the downward side so a low week is not one fact.

**Replayed against his real 2026 history:**

- 7 ordinary weeks had a prescription to measure against. **0 cleared the bar.**
- **Closest miss: 2026-06-15 — ran 47.3 against 45.5 prescribed. Bar 2.3 mi, he
  ran 1.9. Short by 0.4 mi.**
- Three weeks exceeded by more and **Rule 8 refused them**, which is the guard
  working: 2026-08-17 (+11.4) and 2026-08-24 (+11.7) sat inside the authored
  recovery block, and 2026-06-01 (+4.5) was a cutback week.
- **No week would have moved the belief. No future week would have changed.**
- Rule 14, measured: **76 merged run-days carrying 946.9 mi** sit in that
  window. Without the canonical predicate they would have manufactured a surplus
  in most weeks.

The bar is a bar and not a wall — it is reachable, and on his 2026 it was never
reached. **The seam is still shut, so this is an advisory that changes nothing
he sees.**

---

## 2 · What is on main, held, and deployed

**On `main` (merged tonight):** Move-a-Run, corpus reach + ten promotion
dimensions, arbitration reading C with a real ceiling and a persisted deferral
queue, dose-responsive future workouts, the mileage-responsive path, the ship
chain fixes, and every report.

**Held, deliberately:** `wire-adjudication` (`5e0cf42d`). See §7.

**Deployed:** the current `main` IS deployed. But two intermediate deploys
FAILED and I did not notice at the time, which is Rule 19 and I broke it twice
tonight:

    d783937f1  committed 00:16:18  ->  deploy 00:16:44  FAILED
    6c1ce04f2  committed 00:37:02  ->  deploy 00:37:28  FAILED
    62aa5206f  committed 01:03:55  ->  deploy 01:04:20  SUCCESS

The correlation is exact. For roughly forty-eight minutes `main` was not
deployed while I believed it was, because I read the pre-push hook's line
"next build green. Railway is building the same tree" as confirmation. **It is
not. It says a build STARTED.** Rule 19 says to check the deployment status, not
the push result, and the hook's sentence is the precise thing that rule warns
against trusting.

I could not retrieve the build logs for either failure (`railway logs` returns
nothing for them). The tree that succeeded at 01:04 is a strict superset of both
failed ones, so a persistent code fault is unlikely, but I am not asserting
"transient" without evidence I do not have.

---

## 3 · Agents and responsibility

| Branch | Responsibility | Outcome |
|---|---|---|
| `move-a-run` | Move-a-Run as a product surface | merged |
| `corpus-reach` | corpus reach, promotion dimensions | merged |
| `defer-persist` | reading C ceiling, deferral persistence, counterfactual | merged |
| `dose-responsive` | dose-responsive future workouts | merged |
| `mileage-responsive` | the mileage path | merged |
| `wire-adjudication` | wiring `checkPromotion` | **held** |

Every agent's central claim was verified against the code before merging, and
two were sent back or corrected.

---

## 4 · Defects found in work completed during this session

These are mine unless stated.

1. **My one-at-a-time baseline was the previous week**, so any week after a
   planned cutback read as a spike. Misreported 4 of 13 weeks on the live block
   (2026-10-26 read +30.4% when it is +0.7%).
2. **My fix repeated the mistake.** It filtered `isRaceWeek` out of the
   baseline, and that conflates "tapers for a race" with "contains a race" —
   removing his biggest week (09-21, 55.2 mi) inflated the next step from +7.8%
   to +27.1%. A maximum is already immune to a dip; the filter was a second
   mechanism doing the same job worse.
3. **My `taperIntegrity` gate could not fail.** I wrote it to replace a literal
   `true`, and it required `t.stacked != null` while `detectStackedStress`
   returns null for any ordinary taper week. **I falsified it, watched it fail
   by name, and it still could not fire in production**, because my
   falsification used a fixture production never produces. That is the sharpest
   lesson of the night.
4. **I merged a branch that turned a gate red on main** (`fc9257d2`), and did
   not notice because `_cannot_mutate.test.ts` is not in the prebuild chain and
   I ran only prebuild. Green on the gate chain is not green on the tests.
5. **I reported a ship-chain defect from a stale checkout.** I said v2's mutex
   was `$ROOT`-scoped; it was already machine-wide. I had read the root
   checkout, several commits behind main. The same mistake as the truncated
   history window, in a different costume.
6. **A test caught my own wrong expectation** on 2026-10-05, which is correctly
   not flagged.
7. Agent-side, found and fixed: a `finish_mi` misreading that would have
   reported the M dose as one block rather than the session total; a Rule 9
   cliff in the dose evaluator's first draft; a per-day rather than per-week
   surplus sum; a migration whose total unique index would have blocked
   re-queueing an expired deferral.

---

## 5 · Migrations

`165_canonical_adaptation_deferrals.sql` — **corrected** (its unique index was
total; now partial on `expired_at IS NULL`), verified additive only, and
**applied to a local scratch database (`faff_deferral_scratch`) and nothing
else. Production is untouched.** No deferral has ever been persisted there.

---

## 6 · Policy assumptions and uncalibrated heuristics

- `heuristicRankScore` — **ordinal, uncalibrated. It does not predict
  physiological adaptation.** Named and labelled POLICY_ASSUMPTION everywhere.
- The step bands (10% / 25%) classify comparability; they do not assert an
  injury threshold. `Research/00a` explicitly declines to support a 10% weekly
  cap.
- Five demand-model coefficients (stacking uplift, adaptation uplift, recovery
  debt, injury uplift, niggle uplift) are chosen, not measured.
- **The ceiling is now real, not right.**

---

## 7 · Held back, and exactly why

**`wire-adjudication` is not merged.** Read-only replay against all 7 active
production plans: **0 of 7 would promote.** His CIM block blocks at 2026-09-21;
the other six block purely for having no demonstrated history, which is correct
Rule 11 semantics and would still brick plan authoring for every account but
his. A fatal block must not merge until a blocked plan produces a visible,
actionable failure rather than silent plan-drift — which is the owner's own
requirement and is not yet built.

**Weekly demand is not read by `checkPromotion`**, on purpose, per
`PLAN_SIMPLIFICATION_DOCTRINE`.

**`dose-responsive.ts` has no caller**, registered as an argued orphan: where a
gate is re-taken and who supplies the readings is a product decision.

**Move-a-Run's weekly-demand reading was reverted intact.** `weekly-demand.ts`
reaches `lib/adaptation/canonical/plan-load.ts` and `lib/adaptation/**` is a
forbidden directory for the rescheduling surface; that ratchet may shrink and
never grow.

---

## 8 · Outstanding physical tests

Everything in `PHYSICAL-CHECKLIST.md` part B. The one that matters is **B1, the
STUCKCONN-2 morning test**, and the incident is **not closed** until a real
overnight background/foreground cycle passes on his phone.

Move-a-Run, adapted mileage and conditional dose changes are **not testable on a
device**: two are unwired by design and one is server-side data into an existing
surface with no screenshot taken. Rule 13 is not satisfied for any of them and
that is stated rather than glossed.

---

## 9 · Merge work that was mine to do, and what caught me

Four branches were cut from `a8392d08`, before I changed
`detectSimultaneousStressAddition` from a single previous week to the prefix of
prior weeks. Git merged three of them textually while their call sites still
used the old shape, and `tsc` caught every one. The corpus bridge's earning gate
was quietly asking the runner to complete a planned CUTBACK, which is the same
defect in a third costume, and it now requires the largest week the block asks
before this one.

Two gates caught mechanical resolutions of mine:

- The Rule 22 bias gate failed when the dose corpus pushed the progression
  ladder's ratio from 2.00 to 2.50, because `HOLD` is now a verdict word in a
  THIRD mechanism. Scoping alone would have made the gate quieter rather than
  more correct, so the dose mechanism got its own pair, measured at **0.54: 24
  push-side files against 13 pull-back.** Its upward path is better covered than
  its downward one.
- An oracle then caught THAT, because it hardcoded one exclusion path and my new
  one made it fail with `expected 15 to be 9`. It now reads the pair's declared
  scope, and widening that declaration to `lib/` fails it with `expected 15 to
  be 34`.
- The orphan gate caught my additive merge of the registry: I kept both sides
  mechanically and re-added a `weekly-demand.ts` exemption that had become stale
  the moment `defer-persist` gave that module a caller.

## 10 · Test and gate results, on the final tree

    npx tsc --noEmit          clean
    npm run prebuild          exit 0 · all 22 gates
    npx vitest run            10,682 passed · 1 expected fail · 31 skipped
                              9 failed, all pre-existing (see below)

Read-only production replay, re-run on the final tree: **0 of 7 active plans
would promote.** The CIM block carries exactly ONE finding, 2026-09-21, which is
the same week every other line of reasoning converged on. The other six are
blocked solely for having no demonstrated history.

## 11 · The CIM verdict, in one table

| Sequence | Verdict | Gated |
|---|---|---|
| 9/21 · 55.2 mi | **HOLD today, PUSH on evidence** | **yes, 2026-09-20** |
| 10/5 · 59.5 mi | PUSH | conditional on 9/21 |
| 10/26 · 60.0 mi | PUSH on volume and long run | stacking gated, 2026-10-25 |
| 11/1 · 21.5 long | PUSH, keep | no |
| Malibu + 11/15 | PUSH | no |
| 11/22 · 5 mi @ M | **HOLD on an explicit absence** | reaches 6 mi on evidence |
| 11/29 primer | HOLD | no |
| Race week | HOLD | no |

Full reasoning in `CIM-DECISION-TRACE.md`. Corrections carried there: there is
no fast finish on 11/1; the largest CONTINUOUS marathon-pace dose is 5 miles but
the block already TOTALS eight on 10/18; and prescribed CIM race pace is
7:46/mi, not the 3:00 goal pace, so the engine is pacing from evidence.

## 12 · Known-failing, pre-existing

Nine failures in two post-run live-audit files. **Verified pre-existing** by
running them against unmodified `origin/main` in a detached worktree, where they
fail identically. Not introduced tonight, and not fixed tonight.
