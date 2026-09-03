# Master core-product programme

**Living document.** The single task list for the core faff.run product. Updated
as work lands, not at the end.

**Status vocabulary** — a task is never complete because code exists:
`Discovered` · `Ready` · `In progress` · `Implemented` · `Verified locally` ·
`Verified against production reads` · `Persisted` · `Rendered` · `Released` ·
`Blocked` · `Deferred intentionally`

**Prioritisation order when choosing the next task:**
1. Anything that can prescribe incorrect training
2. Anything that can corrupt, truncate or misattribute a run
3. Anything that can mutate the plan incorrectly
4. Anything that creates disagreement across surfaces
5. Anything that stops the runner understanding the workout or adaptation
6. High-impact race and post-run functionality
7. Visual polish
8. Generalised future-platform work

---

## Stage 0 · Record and deployment state — VERIFIED 2026-09-03

Resolved from the repository, CI and the deployment provider, not from the
handback.

| Fact | Value |
|---|---|
| `origin/main` | `8104c9b2` (local HEAD in sync) |
| `build-check` at that revision | **success** |
| `test-full` at that revision | **FAILURE** — see S0-1 |
| Deployment at that revision | **success** |
| Last CLEAN `verify-commit` | `48c0be14` |
| Live plan | `pln_9a57561debb776e5`, 103 rows, untouched |
| Plan-history seal | `df8b2ae4…` unchanged |
| Completed-runs seal | `d8ad8b19…` unchanged |

**Contradiction resolved.** The handback described section 8 as both partial and
complete. The complete state is correct: `_declared_level_inert.test.ts` passes
16/16, and the section-8 text was updated at `5d91e923`. The earlier "7 of 8
red" statement described a genuine intermediate state and is retained in the
narrative as history, not as current status.

| ID | Task | Status |
|---|---|---|
| **S0-1** | `test-full` red at the deployed revision: `_format_lint` flagged a hand-rolled `Math.round(x*10)/10` in `load-progression-contract.ts`. Migrated to the canonical `roundTo()` in `lib/format/run.ts` rather than allowlisted. | **Implemented, verifying** |
| **S0-2** | **CI/deploy gate parity.** `build-check` gates the deploy; `test-full` does not. A red whole-suite run coexisted with a successful deployment. Decide whether `test-full` should gate, or state explicitly why not. | Discovered |

---

## THE CENTRAL PRODUCT REQUIREMENT

`docs/PROGRESSIVE_BASELINE_DOCTRINE.md`, locked 2026-09-03.

> The baseline plan must be **intrinsically progressive** and capable of making
> the runner faster. Adaptation must **personalize** that progression based on
> what the runner actually demonstrates.

**Acceptance criterion for every plan task below:** *a plan that merely repeats
today's capability fails even if every number is internally consistent.* Internal
consistency is necessary, not sufficient.

The eight-condition machine-evaluable definition of an **earned** peak week is in
that doctrine and is a hard dependency of P0-6.

---

## P0 · The critical path

Nothing may displace this.

| ID | Task | Depends on | Owner | Status |
|---|---|---|---|---|
| P0-1 | Correct the baseline plan (S1.1-S1.6 below) | S0-1 | plan engine | In progress |
| P0-2 | Final no-write preview, internally falsified | P0-1 | — | Ready |
| P0-3 | Live rebuild through the production endpoint | P0-2 gates all pass | — | Blocked on P0-2 |
| P0-4 | Verify the **persisted** plan on every surface | P0-3 | — | Blocked |
| P0-5 | Lock the baseline contract + golden snapshots | P0-4 | — | Blocked |
| P0-6 | One canonical Adaptation Engine — **spec now complete**: `docs/ADAPTATION_ENGINE_CONTRACT.md` (per-lever contracts, cadence, reach, arbitration, admissibility, grading) | P0-5 | adaptation | **Ready when P0-5 lands** |
| P0-7 | Historical replay without lookahead | P0-6 | adaptation | Blocked |
| P0-8 | Live shadow evaluation | P0-7 | adaptation | Blocked |
| P0-9 | Owner-approval mode, if earned | P0-8 meets criteria | adaptation | Blocked |
| P0-10 | Cross-surface agreement on one decision | P0-6 | — | Blocked |

### Stage 1 · Baseline plan corrections

| ID | Product area | Current behaviour | Desired | Priority | Status |
|---|---|---|---|---|---|
| **S1.1** | Marathon-specific progression | 18 of 33 MP miles (55%) fall in the last three weeks; the 6-10-weeks-out window gets **4 MP miles in one session** against doctrine's 10-14 every 2-3 weeks | Race-specific phase re-authored so meaningful MP work happens in its window and progresses into the taper; each session persists purpose, pace, why-this-week, what supports it, what it prepares, and whether it rehearses current capability or projected execution | 1 | Ready |
| **S1.2** | Long-run progression | Exactly one run reaches 20+ (20.5), a mile under his demonstrated 21.5, in a block whose thesis is `DURABILITY` | Number and placement of 20+ runs derived from evidence; longest run 20.5 / 21 / 21.5 with the reason persisted. Big Sur is a race and is not evidence of training-long capacity | 1 | Ready |
| **S1.3** | Dodgers weekend evidence | Grant claims *"You have run 29.4mi across two days before"* — that pair is a **2.61 mi shakeout + the 26.81 mi Big Sur Marathon**. Every other large pair in his history is big-first-small-second. He has **never** run long after a hard effort | Keep the session; represent it honestly as an owner-authorised, evidence-informed **novel** demand. Volume supported by prior weekends; the hard-short-first ordering stated as novel | 1 | Ready |
| **S1.4** | The four marathon paces | Training MP 7:52, projection-derived 7:47, CIM execution 7:23, goal 6:52 — all live, he rehearses 29 s/mi slower than he is told to race | A typed contract naming all five quantities, plus a defensible week-by-week progression from current sustainable marathon effort toward 7:23 — or change the progression, the target, or both | 1 | Ready |
| **S1.5** | Monthly / sustained load | External review claims ~30% growth in rolling 28-day load and a 7-week stretch at ~52.9 against a best sustained 5 weeks at ~42.6. **Unverified** | Measure from canonical populations. Document if false; if true, judge coherence against cutbacks, rolling-7-day peak, long-run history, density and his aggressive preference. No new arbitrary limiter; any correction smooth and deterministic | 1 | Ready |
| **S1.6** | Runner-facing language | *"Conversational."* and *"Z2 HR cap."* appear **37 times**; the downhill instruction **12 times** (Rule 17) | Direct instructions: how the effort should feel, the actual HR ceiling, what to prioritise, what to do when pace and effort disagree, how to execute the end. Derived from canonical decisions, not a separate prose brain | 1 | Ready |

---

## P1 · Known open items outside the critical path

| ID | Area | Item | Status |
|---|---|---|---|
| P1-1 | Post-run | Strides section requires an app release | Implemented, awaiting release |
| P1-2 | Plan / phone | `TrainingPlanDay` has no `notes` field, so the Dodgers pairing purpose reaches Today's `why` line but **not** the week view | Discovered |
| P1-3 | Plan / phone | Block screen shows nothing until the plan is re-authored (`block_strategy.answers` postdates the live plan). Compiles; **not rendered** | Blocked on P0-3 |
| P1-4 | Watch | Swift grading verified only by a TypeScript port | Discovered |
| P1-5 | Data integrity | **Production write barrier** — verification tooling must be structurally incapable of writing his account. Owner ruled this required after the simulator incident | Discovered |
| P1-6 | Naming | `demonstratedLongMi` still means two things — 21.5 (365d, races excluded) on `ComposePlanInput`, 18 (28d habit) in the grant, now renamed `recentHabitLongMi` there. Crossing line `generate.ts:10681` | Partially resolved |
| P1-7 | Race page | Coherent race page per the P1 inventory | Discovered |
| P1-8 | Post-run | Full post-run experience per the P1 inventory | Discovered |

---

## P1 · Post-run experience  (references supplied 2026-09-03)

**Reference material:** `docs/0901/post-run-strava-references/` (7 screenshots)
and `docs/0901/post-run-experience-review-and-brief-2026-09-02.md` (849 lines).
Used for **hierarchy, density, progressive disclosure, charts and mobile
readability** — not for branding or social features.

The page must answer, within seconds: what workout did I complete · did I
execute its intended structure · how did each important segment go · what did
the system learn · did that evidence change the plan · how does this move me
toward the race goal.

| ID | Item | Depends on | App release | Status |
|---|---|---|---|---|
| PR-1 | Activity identity + headline stats block | — | iPhone | Discovered |
| PR-2 | Coach card near the top (the "intelligence" slot), coaching-specific | canonical decision record | iPhone | Discovered |
| PR-3 | **Workout analysis before generic charts** — work segments evaluated separately from warm-up, recoveries, cool-down, against the intended target | phase identity | iPhone | Discovered |
| PR-4 | Intended vs completed structure comparison | authored spec | iPhone | Discovered |
| PR-5 | Interval-by-interval results | phase identity | iPhone | Discovered |
| PR-6 | **Complete splits including partial miles** — the reference ends in a 0.4 mi split; the owner's 09-02 run was truncated by 0.43 mi | capture fix | iPhone | Discovered |
| PR-7 | **Strides preserved as strides** | phase identity | iPhone | Implemented, awaiting release |
| PR-8 | Pace chart | — | iPhone | Discovered |
| PR-9 | HR chart + zone summary | HR data present | iPhone | Discovered |
| PR-10 | Elevation chart | — | iPhone | Discovered |
| PR-11 | Pace/HR overlay where readable | PR-8, PR-9 | iPhone | Discovered |
| PR-12 | Grade-adjusted pace where supported | course adjustment owner | iPhone | Discovered |
| PR-13 | Route / map where available | — | iPhone | Discovered |
| PR-14 | Conditions, only when trustworthy | weather provenance | iPhone | Discovered |
| PR-15 | Matched-run / matched-workout comparison | canonical run set | iPhone | Discovered |
| PR-16 | Execution consistency + late-session behaviour | phase identity | iPhone | Discovered |
| PR-17 | Workout purpose · stimulus achieved · evidence contributed | canonical decision | iPhone | Discovered |
| PR-18 | Beliefs changed or held · **adaptation proposed or refused** | **P0-6** | iPhone | Blocked on adaptation |
| PR-19 | Effect on future training | P0-6 | iPhone | Blocked |
| PR-20 | Data-quality warnings · capture reconciliation · honest handling of missing HR/GPS/phases/truncation | Rule 11 | iPhone | Discovered |

**Rules for this surface:** never let a whole-run average misrepresent an
interval session; never invent HR, weather, zone, route or physiological
conclusions; keep **facts, coaching interpretations and plan consequences
visually distinct**; progressive disclosure rather than everything above the
fold.

---

## P1 · Race page

Must not show several incompatible values under the word "projection". Distinguish
stored facts, live external data, model outputs and coaching decisions.

| ID | Item | Depends on | Status |
|---|---|---|---|
| RP-1 | Identity: name, date, distance, location, priority, days remaining | — | Partially exists |
| RP-2 | **Goal vs current projection vs prescribed execution target, visually distinct** | **S1.4** | Blocked on S1.4 |
| RP-3 | How remaining training could move the outlook | S1.4 | Blocked |
| RP-4 | Course profile / elevation where reliable | course source-of-truth | Partially exists |
| RP-5 | Course-adjusted pacing | canonical giveback coefficient (0.50) | Partially exists |
| RP-6 | Mile / segment pacing plan | RP-2 | Exists, verify |
| RP-7 | Effort and HR guidance | race-hr-guidance | Exists |
| RP-8 | Conservative opening guidance · late-race decision points · abort rules | — | Exists, verify |
| RP-9 | Weather only when trustworthy and temporally appropriate | provenance | Discovered |
| RP-10 | Tune-up relationship · race-week sessions · taper state | plan | Discovered |
| RP-11 | Completed race-specific workouts + evidence behind the outlook | S1.1 | Blocked on S1.1 |
| RP-12 | How the outlook has changed over time | projection history | Discovered |
| RP-13 | Post-race result and retrospective | — | Exists |

**Sequencing decision (mine):** RP-2 and RP-3 are held until S1.4 lands, because
the four-marathon-pace contract defines exactly the quantities this page must
keep apart. Building the page first would bake in the ambiguity it exists to
remove.

---

## Deferred intentionally

General onboarding · cold-start coaching · first-plan personalisation for
arbitrary users · readiness scoring · HRV/sleep/RHR plan changes · illness
automation · injury automation · travel reshaping · missed-training automation ·
generalised beginner safeguards · broad multi-athlete personalisation.

Their authority is removed from the core plan. Reusable future work is recorded
here only; no speculative frameworks are being designed for them.

---

## Delegation rules in force

- No two agents may implement competing answers to pace, load, race, plan,
  evidence or adaptation authority.
- Every agent: read-only production, no writes, no rebuild, own branch, no merge
  to main, `verify-commit.sh` before hand-back.
- I independently inspect every conclusion, verify the changes, reconcile
  cross-surface consequences, and decide acceptance. Final judgement is not
  delegated.
