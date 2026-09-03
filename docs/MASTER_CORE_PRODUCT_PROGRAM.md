# Master core-product programme

**Living document.** The single task list for the core faff.run product. Updated
as work lands, not at the end.

**Status vocabulary** — a task is never complete because code exists:
`Discovered` · `Ready` · `In progress` · `Implemented` · `Verified locally` ·
`Verified against production reads` · `Persisted` · `Rendered` · `Released` ·
`Blocked` · `Deferred intentionally`

**Polish priority order** (`RUNNER_EXPERIENCE_CONTRACT.md` Q60) — governs what
gets attention when time is short:
1. Correct prescription · 2. Correct capture · 3. Correct interpretation ·
4. Correct adaptation · 5. Clear explanation · 6. Race and post-run depth ·
7. Additional visual polish.
*"A beautiful sentence attached to the wrong workout or wrong adaptation is not
success."*

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

## EXECUTION AUTHORIZATION  ·  2026-09-03

Full autonomous authority granted, superseding the earlier no-write hold, within
these bounds.

**Authorized:** merge verified work · push · deploy verified server changes ·
**one canonical rebuild of the live plan** when every preflight passes · verify
the persisted result · roll back on any invariant failure · build the canonical
Adaptation Engine · historical replay · live shadow · owner-visible proposals ·
**build, validate and DISTRIBUTE a TestFlight release** to the existing internal
tester account · fix in-scope reversible defects found along the way.

**Not authorized:** modifying completed activities or sealed prescriptions ·
repairing the truncated 09-02 run without separate evidence-backed approval ·
simulator or test workouts on his account · fabricated evidence · changing stated
race goals · **applying adaptation proposals on his behalf** · another user's
data · unrelated bulk migrations · destructive cleanup without snapshot and
explicit authorization · public App Store release or external testers.

### Sequencing, ruled

```
Verified baseline rebuild
  → persisted-plan verification
    → ranked rescheduling analysis
      → runner decision
```

Sunday 2026-09-06 is **not** moved automatically. Options are computed against
the **rebuilt** plan and left for him. If the rebuild changes that Sunday, show
the previous workout, the rebuilt workout, every proposed scheduling change, what
would move, and each option's training value and tradeoff. **His absence is never
read as missed training, reduced readiness, or adaptation evidence.**

### Preflight failure, ruled

No write · diagnose the exact cause · fix only when understood, in scope,
reversible and testable · **strengthen regression protection** · **re-run the
complete preflight from the beginning** · confirm the corrected revision is on
`origin/main`, CI green, and that exact revision deployed. *"Do not repeatedly
patch and write against partially verified states."*

Stop and wait if: the failure exposes an unresolved coaching decision · the cause
cannot be explained · the fix would alter completed history or another user's
data · it needs a destructive or unauthorized production action · **rollback
cannot be proved** · or correcting the gate would weaken protection without clear
evidence.

### Release states — a merged change is NOT a released one

Track every app-side item as exactly one of: **build-ready · uploaded ·
processed · distributed · installed · device-verified.**

**Watch compatibility is a hard gate.** He may run while away. State whether the
watch component changed and whether his installed watch build stays compatible
with production. **Never make an already-scheduled workout unusable without a
verified compatible path.** If the watch build is not sufficiently verified for
live recording, **distribute the phone build and preserve compatibility with the
installed watch build**, and name any feature he should avoid until both devices
update. **Do not force-install.**

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

## P1 · Workout rescheduling  (added 2026-09-03)

**Runner-initiated. Explicitly NOT travel detection or missed-training
automation, both of which are deferred.** The system never detects travel, never
assumes reduced readiness, never silently alters the plan. The runner says:

> *"I cannot complete this workout on its scheduled day. Show me the best way to
> preserve its training value with the least disruption to the rest of the
> plan."*

**Live acceptance case:** the long run on **Sunday 2026-09-06, 15.0 mi** — he is
away that weekend.

**Rescheduling is not adaptation.** Adaptation changes training because
demonstrated capacity changed. Rescheduling changes calendar placement because
the runner supplied a constraint. **Separate typed decisions, owners, records and
mutation paths.** A reschedule must never update fitness beliefs or count as
evidence the plan was too demanding.

| ID | Item | Depends on | App release | Status |
|---|---|---|---|---|
| RS-1 | Canonical rescheduling boundary — its own module and mutation path, distinct from the adaptation seam | — | server | Ready |
| RS-2 | Constraint capture: unavailable dates, or dates he CAN run. **Never assume a preference when availability is unknown** — ask, or show the viable choices | RS-1 | iPhone | Ready |
| RS-3 | Candidate generation + ranking: move earlier · later · swap with easy/rest · shift a small sequence · keep the long run and move the following quality · split the stimulus only where it still serves the purpose · **shorten or replace only as a last resort** | RS-1 | server | Ready |
| RS-4 | Per-option display: new date · moved · unchanged · long-run distance and purpose · separation from surrounding hard sessions · rolling-load change · effect on next long run, race, cutback, taper · training value preserved · tradeoffs · **why the coach ranks it there** | RS-3 | iPhone | Ready |
| RS-5 | Atomic, idempotent, validated, reversible application. **Nothing writes until he approves** | RS-3 | server | Ready |
| RS-6 | Undo | RS-5 | iPhone | Ready |
| RS-7 | UI entry points on workout detail and the plan surface — *"Move workout" · "Can't do this day" · "Find the best day"*, in plain language, no load terminology | RS-4 | iPhone | Ready |
| RS-8 | Post-approval summary: what moved · why · what is unchanged · any instruction for the rearranged days | RS-5 | iPhone | Ready |

**Preservation order:** the long run's intended stimulus → adequate separation
from hard sessions → the important surrounding quality work → training
continuity → weekly or rolling load → the remainder of the block. *"Do not
sacrifice another key workout unless no viable arrangement exists. If a tradeoff
is unavoidable, name it clearly."*

**Calendar weeks are not physiologically sacred.** Moving a Sunday long run to
Monday must not be rejected merely because mileage crosses a Monday-Sunday
reporting boundary. **Evaluate rolling workload and recovery spacing.**

**A reschedule must not:** modify completed or sealed history · change the stated
race goal · reprice capacity · count as negative fitness evidence · trigger a
base restart, pullback or adaptation · create accidental consecutive hard
sessions · break the taper or race calendar · duplicate or lose a workout · leave
notes, pace, HR, segments or explanations attached to the wrong date · silently
reduce the workout · rewrite the entire block when a local move suffices.

**The preferred option makes the smallest coherent change**, not merely the move
to the nearest empty date. The surrounding training is evaluated as **one
transaction** — moving Sunday to Monday may require Tuesday's quality to move,
and that session should be **preserved rather than deleted**.

**Required proof:** the actual surrounding schedule · the candidates · the ranked
recommendation · the complete diff · invariant results · rendered UI · **no write
during recommendation** · a test proving rescheduling does not invoke adaptation
· a test proving a manually unavailable day is **not** read as failed training ·
a test proving undo works.

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
