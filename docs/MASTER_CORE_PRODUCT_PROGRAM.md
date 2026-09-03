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

## LANDED  ·  2026-09-03

All verified CLEAN through the full 20-gate shipping chain before merge.

| Work | Status | Headline |
|---|---|---|
| **S1.3 Dodgers evidence** | **Deployed** | Volume and ordering are now separately branded unions that share no member, so the false substitution cannot type-check. Volume with races excluded is **27.85 mi** (was 29.42, which was a 2.61 shakeout + the Big Sur **marathon**). Ordering computed, not asserted: 11 pairs open with a hard effort and **the furthest he has ever run the morning after one is 9.01 mi** — NOVEL. Volume gates the grant; **ordering is narrated, never gated**, because gating on novelty would overturn his ruling by the back door |
| **S1.6 Runner language** | **Deployed** | `conversational` **13,184 → 0** · `Z2 HR cap` **4,334 → 0** · terrain sentence **11 → 1** per block. *"Easy enough to talk in full sentences. If the heart rate drifts up, slow down even when the pace still looks right."* The **number** stays on the HR row and out of prose (Rule 10 — a stamped ceiling goes stale; his moved 162→168 mid-block) |
| **PR post-run** | **Deployed** (needs app release to be visible) | **His 2026-09-02 run could not be opened at all** — a `#` in the run id became a URL fragment, so the phone requested a run that does not exist and drew *"That run is not in your log any more"* over the exact run he complained about. Every watch-completed run has that id shape. Also: coach card was ninth, the recording-honesty sentence was **last** beneath everything it qualifies, all six strides were shown a pace target they were never given, and `coverage` shipped on every response decoded by nobody |
| **P1-5 Write barrier** | **Deployed** | Two halves, because the incident had two. **`vitest.setup.ts` loads the production READ-WRITE url into every test process, and 78 test files reach the pool** — every one was a single `pool.query('UPDATE …')` from repeating the incident. 16 scripts fenced, including one that defaulted its base URL to `https://www.faff.run` and minted a real session, and two that ran `UPDATE training_plans SET archived_iso` on his account **while auditing it**. Falsification is decisive: with the barrier removed the INSERT **reached the real production host** and bounced only off wrong credentials |
| **S1.5 Load audit** | **Merged** | Both reviewer numbers TRUE, both inferences FALSE. Found the real defect: demonstrated peak measured **rolling-7**, ceiling enforced on the **calendar week** — the block's true rolling-7 peak is 62.0 against its own 60.1 ceiling |

---

## BLOCKED ON THE OWNER  ·  three items

**1 · Migration 163 (`plan_reschedules`) is not applied.** Rescheduling is built,
verified and merged, but its decision table does not exist. DDL requires his
explicit per-statement go — the one thing the execution authorization does not
cover. **Apply refuses rather than making an unrecorded change**, which is the
correct behaviour, so nothing is broken; the feature simply cannot complete an
approval until the table exists.

**2 · A doctrine divergence between his ruling and the validator.** `Q32` says
**≥1** easy day after intervals; `validate.ts` §9 requires **2**. The
rescheduling engine mirrors the validator, because a proposal built against the
other number would be rejected at the boundary. **Consequence for the live case:
Saturday 2026-09-05 — which the contract offers tentatively — does not actually
clear Thursday's intervals gap.** One of the two numbers should move; that is
his call, not mine.

**3 · Three other paths can already move a workout** — `/api/today/reschedule`,
`move_day`, and `PATCH /api/plan/workout` — and **none of them ranks, explains,
or records lineage**. Rule 16: one quantity, one owner. They should be
consolidated onto the canonical boundary or sealed.

---

## VERIFICATION GAP FOUND  ·  the watch gate had never run

`check-watch.sh` **could not pass under `verify-commit` on any commit**: the
isolated worktree is created with `git clean -fdx`, which deletes the gitignored
`native-v2/Secrets.xcconfig` that `xcodegen` requires. Every watch-touching
commit this programme verified reported the gate as `N/A` or failed it for an
environmental reason.

It passed for the first time on the rescheduling merge (129s) because that
worktree happened to retain the file. **This is the same class as Rule 19 and as
today's three deploy failures: the chain that proves a commit was not the chain
that ships it.** Recorded rather than patched, because the fix touches how
`verify-commit` builds its worktree and that script is load-bearing for
everything else in flight.

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
| **S1.3** | Dodgers weekend evidence | Grant claims *"You have run 29.4mi across two days before"* — that pair is a **2.61 mi shakeout + the 26.81 mi Big Sur Marathon**. Every other large pair in his history is big-first-small-second. He has **never** run long after a hard effort | Keep the session; represent it honestly as an owner-authorised, evidence-informed **novel** demand. Volume supported by prior weekends; the hard-short-first ordering stated as novel | 1 | **VERIFIED against production reads 2026-09-03** — see below |
| **S1.4** | The four marathon paces | Training MP 7:52, projection-derived 7:47, CIM execution 7:23, goal 6:52 — all live, he rehearses 29 s/mi slower than he is told to race | A typed contract naming all five quantities, plus a defensible week-by-week progression from current sustainable marathon effort toward 7:23 — or change the progression, the target, or both | 1 | Ready |
| **S1.5** | Monthly / sustained load | External review claims ~30% growth in rolling 28-day load and a 7-week stretch at ~52.9 against a best sustained 5 weeks at ~42.6. **Unverified** | Measure from canonical populations. Document if false; if true, judge coherence against cutbacks, rolling-7-day peak, long-run history, density and his aggressive preference. No new arbitrary limiter; any correction smooth and deterministic | 1 | Ready |
| **S1.6** | Runner-facing language | *"Conversational."* and *"Z2 HR cap."* appear **37 times**; the downhill instruction **12 times** (Rule 17) | Direct instructions: how the effort should feel, the actual HR ceiling, what to prioritise, what to do when pace and effort disagree, how to execute the end. Derived from canonical decisions, not a separate prose brain | 1 | Ready |


### S1.3 · verified, with the numbers

`EVIDENCE-HONESTY-1` had already landed in `lib/plan/designed-race-weekend.ts`;
the master list was stale, not the code. Verified by RENDERING the grant from
production reads rather than by reading the header that claims it (Rule 13),
via `web-v2/scripts/p0-proof/dodgers-grant-sentence.ts` — read-only, 149
eligible days.

The old sentence's evidence, measured independently and confirmed false in
shape: the heaviest two-day total in his history IS 29.4 mi, on 2026-04-25 +
2026-04-26 — and that pair **contains a race**. It is the 2.61 mi shakeout plus
the Big Sur Marathon, which is the opposite arrangement to the one the weekend
prescribes.

What the resolvers now return:

| Claim | Value |
|---|---|
| `pairVolume` | DEMONSTRATED · **27.85 mi**, 2026-02-15/16, races excluded — 20.00 first, 7.85 second |
| `pairOrdering` | **NOVEL** · 11 hard-first pairs seen; furthest he has gone the day after a hard one is **9.01 mi** |

The two claims are typed separately and cannot be substituted, so the volume
number can no longer be spent as though it settled the arrangement. Note that
the citable pair is itself big-first-small-second — which is precisely why the
ordering sentence has to be, and is, said separately.

Heaviest two-day totals with races excluded: 27.9 / 27.5 / 22.6 / 21.7 / 21.1.
The weekend asks for 23.21, so the gate clears on evidence rather than on the
race-contaminated number.

Rendered sentence, at the doctrine-compliant shape (17 mi second day, 3 recovery
days — the composer is refused by name at 18 mi and at 2 recovery days, both
refusals confirmed):

> A controlled 10K, then volume on tired legs. 23.21mi across the weekend sits
> inside the 27.85mi you have already run across two days of training, on
> 2026-02-15. Running long the morning after a hard effort is new for you. The
> furthest you have gone the day after a hard one is 9.01mi. You asked for this
> weekend knowing it is aggressive, and I have kept it. […] is prescribed as a
> controlled effort, not a race. The 17mi that follows is easy the whole way and
> inside the 18mi you already run long, and 3 easy days follow it. Nothing
> changes that long run on its own. If you run […] materially harder than it is
> prescribed, I will say so and leave the call to you.

**What this proof cannot fail on** (Rule 22): it proves the SENTENCE, not the
placement. It says nothing about whether the weekend should be prescribed at
all — only that the evidence offered for it is honestly stated.


## VISUAL WALK  ·  2026-09-03, and what it is and is not worth

The owner asked for a visual walk: *"The app is also so buggy and clunky. It
would be worth visually walking the app after pushing it to work though a lot of
the visual issues and dead ends. No placeholder, etc."*

**Read the confidence labels on these findings.** The walk ran against the
CURRENT simulator binary (built 2026-09-03 01:31) but the app had **no valid
session**, so every screen it drew came from its own 12-hour cache. Rule 13 says
a display fix is verified by rendering with real data; a cache render is not
that. The findings below are therefore split by what the evidence actually
supports, and the substrate that would let the rest be settled is being built
(`feat/visual-walk-substrate`).

The walk was run against a dev server pinned to the READ-ONLY role, and every
write path was probed and refused with a genuine permission denial — INSERT /
UPDATE / DELETE on `runs`, UPDATE on `plan_workouts`, INSERT on `coach_intents`.
That is P1-5's requirement met by construction rather than by care: the
verification client was structurally incapable of writing his account. Two
earlier probes in the same session refused for the WRONG reason (a missing env
var, then a column type error) and were redone — a refusal that proves nothing
is the failure Rule 18 exists to catch, and it happens on the way to a real one.

### CONFIRMED · structural, data-independent

| ID | Finding |
|---|---|
| **VW-1** | **Content scrolls under the status bar with nothing behind it.** Body text collides with the clock and the Dynamic Island — observed directly, twice, at two scroll positions. `AppBar` is rendered INSIDE the `ScrollView`, so it scrolls away and leaves the status bar sitting on raw content. Structural and app-wide: **all seven** `AppBar` screens (`CourseImportV5`, `RaceDetailV5`, `RunDetailV5`, `RunLogV5`, `SettingsV5`, `ShoesV5`, `TodayBeforeV5`) carry no `safeAreaInset`, sticky header, or scrim. The shell already publishes the real device inset as `\.v5TopInset` and `PanelV5` consumes it, so the mechanism exists and these screens simply do not use it. |

### OBSERVED · needs the substrate before it is called a defect

| ID | Finding |
|---|---|
| **VW-2** | **The run detail appeared to have no way out** — no back chevron, no Done, no tab bar, and the OS edge-swipe did nothing. `RunDetailHostV5` (`HostsV5.swift:1880`) DOES pass `onBack: { dismiss() }`, and `AppBar` draws the chevron whenever `onBack` is non-nil, so on the source as written this should not happen. The only call sites that omit `onBack` are in `ScreensCatalogV5`, which serves FIXTURES — and the screen showed 2026-09-01 / 8.5 mi / Asics Megablast 62.7 mi, where the fixture is 2026-08-11 / 6.34 mi. So it was not the catalog. Unresolved, and worth resolving: a detail screen with no exit is the worst class of the dead ends he named. |

### THE COACHING FINDING, which outranks both

On the 2026-09-01 interval session the app rendered: work pace **7:02/mi against
7:10 asked** — faster than prescribed — with the spread across reps **4 s/mi
tighter** than the comparable session and **3 s/mi faster by the last rep**
where the previous one was 10 s/mi slower by the last rep. Every axis better.

The coach's verdict, in full: *"This sits outside what your current threshold
range predicts. It is noted, and the next session like it will settle whether
the number moves."* Then: **"The plan is unchanged."**

That is Rule 21 rendered on his phone. A session executed better than prescribed
on pace, on evenness and on finish, and the response is a note. It is the same
disposition the 309-intent audit measured as zero upward adaptations, seen from
the runner's side rather than from the database's — and it is the direct answer
to *"we have to ensure the adaption engine will fire."* It belongs to P0-6 and
the replay harness, not to the visual pass.


## OPEN DECISION FOR THE OWNER · does a tune-up race week behave like a race week?

Raised by RACEWEEK-1 (fixed 2026-09-03) and deliberately NOT decided here.

`plan_weeks.is_race_week` holds the GOAL race's week alone. That is the
composer's intent — tune-up races live in their own set — and the column is not
wrong. What was wrong is that readers spelled it "is race week" and answered a
different question with it. Measured on the ACTIVE plan:

| Week | Race | `is_race_week` |
|---|---|---|
| 2026-09-07 | Santa Monica 10k · 2026-09-13 | **FALSE** |
| 2026-09-21 | Dodgers · 2026-09-26 | **FALSE** |
| 2026-11-02 | Run Malibu · 2026-11-08 | **FALSE** |
| 2026-11-30 | CIM · 2026-12-06 | TRUE |

Three of four, and the nearest **ten days out**. The Block screen announced
**"QUALITY"** over the week he races. The LABEL is fixed — `weekContainsRace`
resolves from the week's own `type: 'race'` days, so his live block now reads
correctly with no persisted row rewritten.

**What is not fixed, on purpose.** Two readers still consult the column directly
and should keep doing so until he rules:

1. `libraryPhaseKey` pulls the workout library into `race_week` mode on the goal
   race only. Should a B race do that too?
2. The adaptation guards in `adapt.ts` exclude race weeks from quality counting
   and from ramp checks. A tune-up race week is currently counted as ordinary
   training.

Both are coaching-behaviour changes with real blast radius, and Rule 21 cuts
both ways here: treating every B race as a race week is another way to make the
plan easier. Not a labelling fix's call to make.

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
