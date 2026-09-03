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

## SESSION OWNERSHIP  ·  coordination update, David 2026-09-03 (see also `## OPEN · the week strip is still clunky` below for the pre-existing week-strip session)

David has opened two additional focused sessions — **pre-run** and **post-run**
— to increase parallel progress without moving anyone off the critical path
below. Three UI-touching sessions now run alongside this programme-lead
session; ownership is split so no two can write competing answers to the same
question.

**Pre-run session owns:** workout presentation below the week strip · workout-
detail information hierarchy · pre-run coaching language · segment preview ·
run sheet/lobby · phone/watch readiness presentation · the transition from
planned workout to active recording · pre-run loading/empty/stale/error
states. **Does not own:** week-strip paging, top-bar nav, selected-date state,
week caching, workout prescription, pace/HR calculation, plan generation,
adaptation decisions, post-run interpretation.

**Post-run session owns:** completed-run detail · post-run information
hierarchy · post-run graphics/charts · intended-vs-completed presentation ·
structured segment presentation · matched-workout presentation · data-quality
and reconciliation presentation · rendering canonical stimulus and adaptation
decisions after a run (`PR-1` through `PR-20` above are this session's
inventory). **Does not own:** evidence admission rules, stimulus grading
rules, fitness beliefs, plan generation, adaptation decisions, race
projection, workout prescription, week-strip navigation.

**Existing week-strip session continues to own:** Today/Upcoming top bar ·
safe-area behaviour · horizontal week paging · selected-date and visible-
workout state · week loading/caching · stale-response protection · plan-
version invalidation in navigation · calendar navigation performance. The
status-bar scrim fix (`DAYPANEL-SCRIM-1`, orphaned local commit `2cce812f`,
never pushed) belongs here — not reintroduced from this session without a new
instruction.

**This session (programme-lead) continues to own:** canonical coaching
contracts · plan generation and baseline correction · live-plan rebuild ·
pace, HR, race, evidence and load ownership · canonical stimulus grades · the
canonical Adaptation Engine · the rescheduling decision contract (`RS-1`
through `RS-8` above — the CONTRACT and mutation path; `RS-4`/`RS-7`'s UI
entry points hand to pre-run once the contract is ready) · production writes ·
cross-surface consistency · integration into `main` · CI, deployment,
TestFlight and final verification.

**Overlap check against this session's own in-flight work, done 2026-09-03:**
Decision 1 (race-week typing), Decision 3/SEP-1 (easy-days separation) and the
canonical-shadow-evaluation wiring all touched `web-v2/lib/plan/**` and
`web-v2/lib/adaptation/**` only — no Swift, no `native-v2/**`, no post-run or
pre-run surface. No competing UI was created and none needs to be handed back.

**Integration rules for handbacks from the two new sessions:** inspect the
actual diff · identify overlap with current `main` · rebase or cherry-pick
their commits (never merge a branch wholesale without review) · reject
duplicate decision logic · ensure all UI consumes canonical contracts rather
than re-deriving them · run the complete `verify-commit.sh` chain · render the
integrated experience (Rule 13) · update this document · include accepted
work in the next TestFlight build.

**Shared-file protocol:** the session owning the canonical state or contract
makes the shared change; the other session consumes it through an interface.
Where that cannot be cleanly separated, one session stops editing the file and
returns its required change as an integration note instead of resolving the
conflict manually — never let concurrent manual conflict resolution silently
combine two state models.

**The critical path is unchanged and still programme-lead's:**
`correct baseline → safe live rebuild → persisted verification → canonical
Adaptation Engine → historical replay → live shadow → owner-visible proposals
→ integrated TestFlight release`. The intended final product flow the three
UI sessions serve: `select the correct workout → understand it before running
→ execute and record it correctly → understand what happened afterward → turn
that evidence into the right next prescription`.

---

## ONE CURRENT TRUTH  ·  resolved 2026-09-03, correcting the handback's contradiction

David: *"One reporting correction: the handback ends by saying the rebuild
waits on progression work, while section 9 says the progression work has
landed. Resolve the actual repository status and report one current truth."*

Both sentences were individually true and, read together, misleading. Here is
the one statement that replaces both:

**The progression ENGINE CODE is complete, audited, and on `main`.**
S1.1/S1.2/S1.4 (marathon-specific progression, long-run progression, the
marathon-pace contract) landed via `feat/race-specific-progression` before
tonight's audit even started; the audit verified it against his real account,
found and fixed five further defects on top of it (the dose-fade window, the
Daniels cap escape it exposed, the duplicate `rehearses` label, ten missing
doctrine claims, two dead tests), and falsified every gate sixteen ways. This
part is DONE, not pending.

**The LIVE PLAN on his phone has NOT been rebuilt with any of it.**
`pln_9a57561debb776e5`, his active plan, was authored 2026-08-31 — before
every engine fix that landed tonight. "The rebuild waits on progression work"
meant *waited on the engine work being finished before it is safe to spend a
rebuild on it*, which is now true in the past tense: the engine work finished,
so the rebuild is now the very next unblocked step, not still-blocked.

**What actually changed on his live plan tonight, without a rebuild:** three
targeted READ-TIME fixes that correct how the EXISTING persisted plan is
labelled and served, none of which required re-authoring anything —
RACEWEEK-1 (Santa Monica/Dodgers/Run Malibu weeks stopped reading "QUALITY"),
WKSTRIP-RACE-1 (the week-strip swipe race, shipped as TestFlight build 251),
and the recovery-block-is-peak flag fix (production-verified, four archived
plans affected, his active plan was not one of them). None of these are the
progression rebuild. All three are live now.

**Also landed tonight, unrelated to progression:** the production write
barrier now judges the actual connection issuing a statement rather than
`process.env.DATABASE_URL` (closes a real gap the visual-walk-substrate build
exposed); Migration 163 (`plan_reschedules`) is applied to production, schema
only, zero rows, verified ten ways before execution — see
`docs/migrations/163-plan-reschedules-evidence-2026-09-03.md`.

**Status, kept current rather than left at first-write:**
1. Race-week TYPED coaching distinctions — **DONE**, `8e0180d8`, see the
   section below.
2. Easy-days-after-intervals typed validator rule — in progress (verify-commit
   running as of last check).
3. VW-3 (the debug-session token path) — **DONE and merged to `main`**
   (`f2a13335`). Real root cause found, not guessed: instrumented
   reproduction proved there was never a Keychain/auth race — every
   `authorize(_:)` call found the token, zero exceptions across 100+ requests.
   The actual blocker was the Notifications/HealthKit system permission
   dialogs stacking on a fresh install, which SpringBoard owns and neither
   `simctl launch` nor an agent's taps can dismiss — the exact same wall this
   session hit twice tonight. Fixed by skipping both prompts on a
   `-faffToken` QA launch specifically (`FaffApp.isQATokenLaunch`), never
   touching the real sign-in/`TokenStore` path. Proven with a real screenshot
   of his actual Today screen (INTERVALS, 6.5 mi, hill repeats) rendered
   through the walk substrate, zero permission dialogs, 54/54 requests
   authenticated.
4. The canonical Adaptation Engine wired into live SHADOW evaluation — in
   progress.
5. The full preflight, gating the rebuild — still blocked on 2 above landing.
6. The rebuild itself, and persisted-plan verification across every surface —
   blocked on 5.
7. Ranked Sunday options, generated against the REBUILT plan (David reports
   the phone currently offers only "Skip" — the "Move to Friday/Saturday"
   options that should sit beside it exist only in a design-preview fixture,
   `TodayBeforeSamplesPreRunV5.options(for:)`, and `RescheduleV5.swift` — a
   real, substantial screen — is built but not wired into any reachable
   navigation path yet). Blocked on 6.

**Do not describe the app as complete** until the rebuilt plan is live, every
production surface is verified against it, TestFlight is distributed with the
decisions below, and the canonical engine is producing trustworthy shadow or
owner-visible decisions. None of those five conditions are met yet.

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
| **S1.6 continued · RUNNERLANG-2** | **Merged 2026-09-03** | The words changed and **the repetition did not move at all**. Freshly composed marathon block after RUNNERLANG-1: the replacement printed **33 times on 105 rows**, `Off.` 28, `Sleep, mobility, fuel.` 27, the medium-long-run purpose 11. Nothing could tell, because nothing counted. Now: a sentence true of the KIND of row is said **once per block** (15 of them) and a generic easy day says what makes it different, from a fixed table keyed on decisions the composer already made. Worst per-week repetition **33 → 0** across 11 blocks / 541 rows. Gated by `check-sentence-repetition.sh` in `prebuild`, falsified four ways. Also closed: `check-coach-voice.sh` **excludes** `runner-instruction.ts`, and RUNNERLANG-2 had put two new copy tables in it — a role line rewritten with an em dash, an exclamation mark and hype left the gate reporting "324 files clean" |
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

**2 · RESOLVED 2026-09-03.** David ruled in full: ordinary interval/threshold
sessions need "at least ONE" easy/rest day, same as `Q32` always said — the
validator's old **2** for intervals was the number that was wrong. He also gave
the complete typed rule for long runs (under ~16mi fully easy → 1; 16-18mi → 1-2
by the run's own authored intensity; 18-plus or any marathon-pace-carrying long
→ 2, regardless of distance) and confirmed back-to-back demanding sessions stay
gated behind the designed-race-weekend grant, never a general exception.
Implemented in `requiredSeparationDays()` (`lib/plan/validate.ts` §9, SEP-1) and
mirrored in `reschedule.ts`'s `requiredRecoveryDaysAfter`; both now agree.
**Consequence for the live case:** Saturday 2026-09-05 now DOES clear Thursday's
intervals gap (one intervening day, one required) — see
`_reschedule_contract.test.ts`'s updated Q32 tests. The 16-18mi/18-plus/
marathon-pace band's fuller "normally TWO" target is computed and reported
(`SEPARATION_BAND_SHORTFALL`, advisory) but not yet fatal — `scheduleQuality` in
`generate.ts` does not yet place quality against the long run's own
classification, and making it fatal was falsified against real composer output
before landing (see the fix commit's message). Promoting it to fatal is a
composer follow-up, not yet done.

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
| **S1.1** | Marathon-specific progression | 18 of 33 MP miles (55%) fall in the last three weeks; the 6-10-weeks-out window gets **4 MP miles in one session** against doctrine's 10-14 every 2-3 weeks | **DONE.** Landed via `feat/race-specific-progression`; audited and hardened 2026-09-03. MP in the last three weeks **55% → 22%**; the 6-10-week window **4 mi in one session → 8 mi at 49 days** | 1 | **Done** |
| **S1.2** | Long-run progression | Exactly one run reaches 20+ (20.5), a mile under his demonstrated 21.5, in a block whose thesis is `DURABILITY` | **DONE.** Runs at 20+ went **one (20.5) → two (20.0 and 21.5)**; longest is now **21.5**, his own demonstrated ceiling rather than a mile under it. Big Sur is excluded BY NAME — `demonstratedLongMi` carries `NOT IN (SELECT date FROM races)`, so a raced marathon cannot raise a training-long ceiling. Taper longs 16 at −2 wk / 10 at −1 wk per Q18 | 1 | **Done** |
| **S1.3** | Dodgers weekend evidence | Grant claims *"You have run 29.4mi across two days before"* — that pair is a **2.61 mi shakeout + the 26.81 mi Big Sur Marathon**. Every other large pair in his history is big-first-small-second. He has **never** run long after a hard effort | Keep the session; represent it honestly as an owner-authorised, evidence-informed **novel** demand. Volume supported by prior weekends; the hard-short-first ordering stated as novel | 1 | **VERIFIED against production reads 2026-09-03** — see below |
| **S1.4** | The four marathon paces | Training MP 7:52, projection-derived 7:47, CIM execution 7:23, goal 6:52 — all live, he rehearses 29 s/mi slower than he is told to race | **DONE.** `lib/training/marathon-pace-contract.ts` names **six** quantities, one resolver each, and `stated_goal_clamped_to_range_edge` is deleted. **The active execution target is 7:46, not 7:23** — Q7 rules it is the projection-derived number; 7:23 survives as the conditional upside with five criteria attached. MP progresses 7:52 → 7:46 across the block and holds through the taper; the block's last rehearsal is 7:46, so the seam gap is 0 | 1 | **Done** |
| **S1.5** | Monthly / sustained load | External review claims ~30% growth in rolling 28-day load and a 7-week stretch at ~52.9 against a best sustained 5 weeks at ~42.6 | **VERIFIED 2026-09-03 · BOTH CLAIMS TRUE, NO CORRECTION WARRANTED** — `docs/reports/s1-5-sustained-load-audit-2026-09-03.md`. Growth +30.4% composed / +32.1% written; 7-week best 52.90 against a history best-5 of 42.56. Coherent on every axis: rolling-7 peak 60.1 = 52.3 x 1.15 exactly, cutbacks 22-29% every 2-3 weeks, worst ACWR 1.20 against a 1.5 red line, longest run 21.5 = his demonstrated best. The +30% decomposes as 1.148 peak (doctrine spent ONCE) x 1.136 density, and the density term is the removal of chaos — 8 of his 36 history weeks are under 25 mi, including a 0.00 and a 4.16. **The live defect is DELIVERY, not load** — see below | 1 | **Verified against production reads** |
| **S1.6** | Runner-facing language | *"Conversational."* and *"Z2 HR cap."* appeared **33 times each** in a composed block; one terrain sentence 11 times (Rule 17) | **DONE 2026-09-03.** RUNNERLANG-1 substituted the words and left the repetition exactly where it was — 33 stayed 33. This pass says each sentence **once per week**: worst per-week repetition across an 11-block corpus **33 → 0**, gated by `scripts/check-sentence-repetition.sh` in `prebuild`, falsified four ways (disabling the pass → 340 findings). Roles come from `easyDayRole`, a pure function of four booleans the composer already resolved — no prose brain. **Runs at AUTHORING, so his live block keeps its 35x until P0-3 re-authors it.** | 1 | **Done** |


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


## THE PLAN ON HIS PHONE IS THE ONE THAT IS WRONG  ·  measured 2026-09-03

The S1.5 audit's most useful finding is not about load at all. `ROLLING7-1` is
merged, and **the plan on his phone predates it**. `pln_9a57561debb776e5`,
authored 2026-08-31, carries:

- peak rolling-7 of **61.5 against a 60.1 ceiling** — 1.176x his demonstrated
  peak, where the ceiling is 1.15x
- a **1.23 long-run spike** on 2026-10-04
- `load_progression_contract` and `tier_band_anchor` both **null**, so nothing on
  the phone can be measured against a ceiling at all

Composed on current `main` the same runner comes out at exactly 60.1 — the fix
works, it is merged, and he is not running it. **A recompute reprices; it does
not re-lay-out.** Only a re-author delivers this, which is P0-3.

The cost of the correction, composed both ways on the real runner: **1.3 mi off
two easy days across fifteen weeks.** That is the whole price of being inside the
ceiling.

Falsified per Rule 18: removing `enforceRollingSevenCeiling` fails all six cases
and regresses the Rule 9 continuity walk to 1.5 mi of output per 0.1 mi of input.

### One trap worth naming

`NOT (data ? 'mergedIntoId')` and `absorbed_into_canonical_at IS NULL` currently
return **identical** answers for this runner — 156 rows, 1166.54 mi — because the
six stale-stamped canonical rows are gone. The wrong predicate gives the right
answer today. That is the trap, not the absolution: `CANONICAL_ROW_SQL` stays the
only definition (Rule 14).


## WILL THE ADAPTATION ENGINE FIRE?  ·  measured, 2026-09-03

His question: *"From what I've skimmed it seems like things are making me run
less and slower? If that's the case now on today's fitness, fine. But we have to
ensure the adaption engine will fire."*

Answered by replaying his real history through the canonical engine with no
lookahead — 40 decision points, 120 records, belief carried forward only by the
engine's own accepted proposals. The no-lookahead property is a COMPILE ERROR,
not a discipline: sealed collections have no array surface, and the axis is
outcome-versus-artifact rather than past-versus-future, because a plan authored
31 August repricing a June week is the leak a date fence waves through.

### The distribution

| | PROGRESS | HOLD | REGRESS | REFUSE |
|---|---:|---:|---:|---:|
| **All levers** | **0** | 102 | 4 | 14 |
| Threshold pace | 0 | 40 | 0 | 0 |
| Weekly volume | 0 | 38 | 2 | 0 |
| Long run | 0 | 24 | 2 | 14 |

**The "less" half of his read is largely fixed and the "slower" half is not.**
REGRESS has gone 20 → 4 since the earlier audit. PROGRESS is still exactly zero.

### Is the bar a wall?

No — and that is the important part, because a wall would mean the engine cannot
push at all. Swept in favourability against a neutral point, every lever crosses
from pull-back to push within ONE sweep step:

```
WEEKLY_VOLUME   pushes from 0.955 · pulls back from 0.95
LONG_RUN        pushes from 0.95  · pulls back from 0.945
THRESHOLD_PACE  pushes from +1 s/mi · pulls back from −1
```

**No unjustified up-versus-down asymmetry exists.** He never reached the bar.
How close: his best-ever three-week window ran **139% / 97% / 90%**, short by 4.8
points on one week — **2.1 miles**, 39.7 run against a 41.8 bar.

### Three real defects, now being fixed

1. **The volume lever enforces conditions its contract does not state.** Crediting
   every non-cutback week at exactly 95% — the stated criterion, met perfectly —
   produces **0 of 13** PROGRESS verdicts. The code also demands every key session
   ≥SUBSTANTIAL and every long run ≥95%. That is a Rule 21 violation on its face,
   and it contradicts the progression doctrine: duration progresses from
   load-tolerance evidence, so gating a VOLUME increase on quality-session grades
   makes capacity evidence the judge of a load-tolerance question.
2. **The long-run lever is blocked by DATA and reports it as behaviour.** **40 of
   40** readings failed because both long runs' thirds were never comparable — not
   once in nine months. A segmentation problem counted as "he never earned it":
   the exact Rule 11 collapse, where "I could not read this" wears the face of
   "he did not do it".
3. **A threshold gate that cannot resolve.** `agree >= 2 && agree >= 2*disagree`
   can never pass at one faster session against one slower — which is exactly
   where he sat on 2026-09-02. And 34 of 40 readings had no qualifying session in
   the window at all.

### What this does NOT say

The canonical engine is **still unwired** from the live path, and a gate forbids
any importer under `web-v2/lib|app`. Everything above is measured on an engine
that does not yet run. The legacy `lib/plan/adapt.ts` — the path that actually
produced five downgrades and zero upgrades — still carries a test-coverage ratio
of **4.4 to 1 against the push**, now pinned as a defect ratchet rather than
blessed as a ceiling. The canonical suite has inverted that bias (0.24 and 2.00);
the live one has not.

Rule 21's question is now one SQL query, because every adaptation records what it
did and in which direction, with direction DERIVED from the action rather than
passed in, and a switch with no default so a new kind is a compile error.


## STAGE 1 · what the progression audit found on top

S1.1, S1.2 and S1.4 had ALREADY LANDED via `feat/race-specific-progression`
when the audit started — this file said `Ready` for all three, which was stale.
Verified against the real account read-only, never a fixture:

| | before Stage 1 | now |
|---|---|---|
| MP miles in the last three weeks | 18 of 33 (**55%**) | 5 of ~22.6 (**22%**) |
| `Research/04` §4.4's 6-10-week window | **4 mi in one session** | 8 mi at 49 days |
| Runs at 20+ | one (20.5) | **two — 20.0 and 21.5** |
| Longest run | 20.5, a mile under his demonstrated 21.5 | **21.5**, his own ceiling |
| MP across the block | flat | 7:52 → 7:46, held through the taper |

### Five further defects, found and fixed

1. **The block's largest marathon session was its smallest.** `peak_stimulus`
   carries an `[8,10]` band and composed at **6** — smaller than the development
   rung three weeks earlier, pace going up while volume went down. The dose fade
   measured against a `[42,70]` window while the peak sits at `[24,42]`, outside
   it on all but one day, so the fade ran to completion and the band was inert.
   Fixed by measuring the UNION `[28,70]`, which removes a cliff (42 d → 8 mi,
   41 d → 6 mi) rather than relocating one. Corpus effect: **30 of 4,886
   archetypes change, all 30 UPWARD**, mean +3.15 mi.
2. **A Daniels cap escape the fade had been hiding.** The upward move immediately
   produced `8.5 mi at M on 39.7 mi/wk` — 21.41% against the 20% ceiling. **Bound
   the cap, did not loosen it.** Zero enforced breaches now. This is Rule 21's
   standing instruction working as intended: spend the headroom, and when
   spending it hits a real ceiling, the ceiling wins.
3. **Two producers of `rehearses`** (Rule 16). On his live block that stamped
   `forecast_development` on the Run Malibu rung, which has no prescribed pace at
   all, and on a runner with no band headroom it labelled every rung a forecast
   while printing "develops by **0 s/mi**".
4. **Ten doctrine claims where there were none**, including **three cited by name
   in prose that did not exist** — among them the claim named as what pins the
   contract's pace band to `race-outlook`'s. The two numbers were genuinely
   unpinned while a comment said they were not. Rule 20, exactly.
5. **Two dead tests.** One guarded by `if (peak && !development)` on a calendar
   that always grows a development rung — the body never ran. And nothing
   asserted the ladder reaches Q8's `later` rung at all: every committed
   assertion was a ceiling, none a floor (Rule 22).

Falsified sixteen ways, each break named by its gate and restored.

### One thing found and deliberately not fixed — his call

A marathon-pace block can be most of the long run it sits inside:
`marathon/beginner` composes **4.5 mi at MP inside a 6.5 mi long run (69%)**. It
passes every cap because Daniels bounds the session against WEEKLY mileage, not
against the run it lives in. Pre-dates this change, and the bound would be
doctrine-derived (§4.4's "Easy warmup 2-4 mi") and would apply to everyone —
which is why it was not taken unilaterally while the simplification doctrine
defers generalised beginner safeguards.

### And one thing that is correct but worth knowing

**His block never reaches the ladder's `later` rung (7:40)**, because Run Malibu
takes the peak-stimulus slot and a race rung holds the pace. Correct for his
calendar. It means his authored progression is **one pace step plus a hold**, not
three.


## VW-3 · THE QA TOKEN PATH DOES NOT WORK, AND IT BLOCKS RULE 13

Found 2026-09-03 while trying to complete the visual walk properly.

`FaffApp.seedQATokenIfAsked()` exists exactly for this — a DEBUG launch argument
that puts a session token in the Keychain so the app can be driven without a
password:

    xcrun simctl launch <udid> run.faff.app -faffToken <token>

**It does not hold.** Observed on a locally-built signed Debug binary against the
walk substrate: the app gets far enough to run its first-launch permission flow
(so the argument IS read and `faff.onboarded` IS set), then every API request
arrives at the server with **no Authorization header**, 401s, and
`.faffSessionExpired` fires — which calls `TokenStore.shared.clear()` and bounces
to the sign-in gate. One 401 destroys the seeded session.

Proven not to be a server problem: the same token, same server, same moment —

    no token   → 401
    bad token  → 401
    walk token → 200, real content (state before_run, Intervals 6.5 mi)

**Why this matters more than it looks.** Rule 13 says a fix to something the
runner sees is verified by RENDERING it with real data. `-faffToken` is the ONLY
way to do that without typing a password, which is not something an agent may do.
So while this is broken, **every phone-side display fix is unverifiable by
anyone but the owner** — and two are already sitting on `main` waiting on it
(VW-1's status-bar scrim and PICKERTRUTH-1's gated RUN sheet sentence).

Likely suspects, in order: the Keychain write failing on a locally-built
simulator binary (there is a standing note that unsigned sim builds break
Keychain auth, and ad-hoc `CODE_SIGN_IDENTITY="-"` did not fix it); or the
seeding racing the first hydration request, so a request goes out before the
token lands, 401s, and clears the token it was about to use. The second would
also explain why the permission flow ran but the session did not survive it.

**Worth fixing before anything else on the phone**, because it is the gate on
verifying everything else. A one-line diagnostic would separate the two
hypotheses: log the result of the Keychain write in `seedQATokenIfAsked`.

### The substrate itself is done and works

`web-v2/scripts/walk-substrate.sh` + `walk-server.sh`, documented in
`docs/VISUAL_WALK_SUBSTRATE.md`. It reuses the adaptation harness's copier rather
than adding a second one, refuses any non-loopback target before reading the
credential, and mints an ordinary `sessions` row — **no auth bypass was added to
application code**. Fifteen phone endpoints answer 200 with his real data.

**And it found a real safety hole on the way:** the production write barrier
judges its target from `process.env.DATABASE_URL` rather than from the connection
the statement is issued on. With `DATABASE_URL` pointing at loopback, the barrier
would have PERMITTED a write on a production client. Filed to fence the barrier
per connection.


## THE UPWARD BAR, AFTER THE FIX  ·  and the zero is honest

```
before   PROGRESS 0 · HOLD 102 · REGRESS 4 · REFUSE 14
after    PROGRESS 0 · HOLD  63 · REGRESS 4 · REFUSE 53
```

**PROGRESS stays zero and that is now a defensible answer rather than a
suspicious one.** He never completed three consecutive non-cutback weeks at 95%:
best run was **2**, best worst-week **90.2%**. What moved is the line between
"the coach decided" and "the engine could not judge" — **39 records that read as
coaching decisions were missing evaluations** and now say so.

**My brief to the agent was wrong on one point and it did not paper over it.**
The contract DOES declare both extra conditions; Q21 names key sessions and long
runs explicitly. What was undeclared was how they were READ:

- **No window on the long-run criterion.** Weeks were windowed to three, long runs
  were read whole — so a long run from 2026-07-05, a week he did not run, was
  cited against the 2026-08-31 decision **eight weeks later**. Q21's own word is
  "*relevant*".
- **The complement of "counts as evidence" was spent as counter-evidence.** The
  grade set's own doc comment says DIFFERENT is excluded because it is evidence
  about a different lever; the code then treated everything outside the set as
  contradictory. Five June sessions blocked a volume step on that. PARTIAL still
  blocks, per Q38 — "not enough of the intended session" is a load fact.
- **Rule 8 applied per week rather than per finding** — the taper weeks were
  dropped but the sessions inside them were still graded.
- **A vacuous pass**: zero bad key sessions satisfied the bar even when nothing
  had established anything. Now a refusal — but ONLY when key sessions ran. The
  first draft refused on an empty window too, and the symmetry gate caught it
  with the exact sentence this work exists to remove: *"the upward path is
  unreachable on its own criterion, which is a wall."* A base block on easy
  running alone must still be able to earn a step.
- **Rule 9, found while measuring:** `completed/prescribed >= 0.95` rejects a week
  completed at EXACTLY the bar for **267 of 1,999** prescriptions. His best
  worst-week is 48 thousandths away from it.

### The long-run blockage was a reader bug, not a watch problem

**29 of his 146 split-carrying runs record pace only as a clock string** —
`"8:19"` — on rows that also carry a full set of per-mile heart rates, and the
harness read three numeric spellings and not the fourth. Parsing it takes
comparable long runs from **4 of 15 to 8 of 15**, and the remaining seven divide
honestly: six genuine refusals where the prescription really does vary pace, and
one week he did not run. `L4-durability-readable` goes NO → **YES**.

### The 1-1 threshold case is a correct HOLD

Kept, with the citation: the binding clause at one-faster-one-slower is the
corroboration bar, not the ratio, and Q20's opening sentence is that a single
session never moves the anchor. Loosening the ratio would move the anchor on one
session while looking like a rule about direction. **The other half was real** —
34 of 40 readings had no qualifying session at all and the lever called each a
HOLD while its own confidence line said none was available. That is a REFUSE now,
matching what the other two levers already return on the same fact, so the old
HOLD was a Rule 16 defect as well.

### And the falsifier had never worked

`npm run test:falsify`'s documented command exited "No test files found" —
`vitest.config.ts` includes only `*.test.ts`, and a CLI file argument FILTERS
that include rather than adding to it. Every falsification anyone believed they
had run through it had run nothing. Fixed with its own config.

**Still unwired.** None of this reaches the phone: the mutation guard is
untouched.


## OPEN · the week strip is still clunky, per David 2026-09-03 — do not close this again without him confirming

**Do not treat this as fixed.** `WeekStripV5` (`native-v2/Faff/Faff/DesignV5/ChartsV5.swift`)
already carries a real `TabView(.page)` rewrite (`42474f49`), landed BEFORE TestFlight build
250 — so it is in his currently-installed build, and he is calling it clunky on the CURRENT
shipped version, not an old one. That commit's own header records this is at minimum the
sixth round of the same complaint:

> David, sixth round: "I told you so many times to look back and how the old design did it.
> that was right."

and an earlier round, quoted in the same file:

> David: "the week strip doesnt actually slide or move... we need things to move and to be
> slick."

He raised it again 2026-09-03, explicitly asking NOT to derail the active work to chase it
right now: *"It's also the week strip is really clunky and hard to use. Not smooth. I don't
want to derail the larger thing right now but it's an issue in the app."*

**What NOT to do next time this is picked up:** guess at a fix and ship it. Per Rule 13, a
feel/motion complaint like this cannot be verified by reading the code — the TabView port
was already "verified" once by its own commit title and he is still unhappy with it live.
It needs an actual device session (or, at minimum, the walk substrate + simulator once VW-3
is fixed) where the swipe is driven and watched, ideally with him present or with a screen
recording, before touching the implementation again. Candidates worth checking rather than
assuming: the fixed `.frame(height: 80)` with no real content measurement, the three-page
recentre-on-every-swipe logic (a snap-back transaction on every single page change, which
could read as micro-stutter even with animations disabled), and whether `onPageWeek`'s
network round-trip stalls the NEXT swipe rather than just the content underneath it.

**FIXED 2026-09-03, `14c567fa` — WKSTRIP-RACE-1.** David gave the exact
symptom: *"the swipe sometimes starts to change and then comes back."* That
sentence located the bug precisely once cross-referenced against the two files'
actual reactive/async semantics — no guessing was needed:

`WeekStripV5`'s recentre-to-center-page snap fired on a FIXED CLOCK (the next
MainActor tick, unconditionally), while `TodayHostV5.goTo`'s week-fetch takes
one of two paths with genuinely different completion timing. On a cache hit
(`V5Surface.present` — the common case, since the host prefetches +/-7 days on
every arrival) `model = known` is the FIRST synchronous statement, so content
usually lands before the recentre fires — the "sometimes" it didn't revert. On a
cache miss (`V5Surface.rebind`) there is no such statement: `model` does not
update until the real network round trip completes, well after the recentre had
already snapped back — so the strip visibly showed the swiped-to week's ghost
numbers, then reverted to the OLD week's real ones. That is "started to change
and then came back," exactly.

Fix: `onPageWeek` is now `async`, and the recentre awaits it before firing —
tied to what it actually depends on instead of to the clock. A new
`stepWeekAndWait` on the host awaits the SPECIFIC `navigationTask` `goTo` just
assigned (read synchronously right after the call, so an overlapping swipe can
never make it await the wrong one), and a guard skips a stale recentre if a
second swipe has already moved `page` again mid-await. The existing "single
flight, cancelled and replaced" task discipline — already hardened through
several earlier rounds of this exact defect class — is untouched; this only
adds the await on top of it.

**Verification status, stated plainly (Rule 13):** verified by tracing the
actual causal chain through both files' real code, which is a demonstrated
mechanism rather than a guess — but NOT watched live on a rendered swipe. The
simulator's system Health-access confirmation dialog would not dismiss under
repeated automated taps this session (many coordinates tried, clock visibly
advancing, nothing registering) — the same VW-3 obstacle already logged above,
surfacing on a different dialog than before. Compiles clean, all four call
sites type-check. If this still isn't right when you feel it live, that
mismatch — a reasoned fix compiling clean vs. an actual device confirming it —
is exactly what VW-3 needs to close before the next UI-motion complaint.


## DECISION 1 · RACE-WEEK TYPED DISTINCTIONS — LANDED 2026-09-03 (`8e0180d8`)

`lib/plan/race-week-role.ts` resolves `goal | tuneup | controlled | none` from
the goal-only `is_race_week` column plus each race day's actual priority,
reusing `weekContainsRace` (Rule 16 — one predicate, not a second copy).

**Six call sites changed**, not the two RACEWEEK-1 named:

1. `v5-block.ts#libraryPhaseKey` — now typed on the resolved role; only
   `goal` reaches `race_week`. Formalises what RACEWEEK-1 left informal.
2. `coaching-thesis.ts#assessWeekAgainstThesis` — **the real defect**. A
   graded race always read as family `'race'`, matching no limiter family, so
   a week whose only quality WAS a race read `WEEK_HOLDS_NO_KEY_SESSION` —
   "no key session this week" — over a week the runner raced. This is Rule 21
   by name: an intentionally-substituted workout read as an absence. Fixed so
   a race taking the long-run slot (Run Malibu) addresses durability AND the
   limiter's non-long capacity; a race that doesn't (Dodgers) addresses only
   the non-long side. On his live Dodgers week specifically, this flips a
   HIGH_INTENSITY-limiter runner from "no key session" to "week addresses the
   limiter" — reachable today, since that week's `is_cutback=false` doesn't
   pre-empt the check the way Santa Monica's and Run Malibu's do.
3-5. `dose-guard.ts`, `generate.ts#applyDosingCaps`, `validate.ts`'s FATAL
   dosing gate — three more undeclared copies of "does this week contain a
   race," inconsistent with each other (the write-path guard and the fatal
   validator disagreed, which the agent caught mid-fix: widening only one
   broke `_designed_race_weekend.test.ts` on the Dodgers trimmer). All three
   now call `weekContainsRace`. Full 38-test suite plus the 11,598-archetype
   dosing sweep pass.
6. `adapt.ts`'s guards — AUDITED, not changed. Already scoped to the literal
   goal-only column, so they were never blanket-excluding a B/C week. Recorded
   as a finding, not a fix.

**Verified against his live account:** Santa Monica (B, cutback=true),
Dodgers (C, cutback=false), Run Malibu (B, cutback=true), CIM (A) — the CIM
path is confirmed byte-identical (still short-circuits on `WEEK_IS_NON_NORMAL`
regardless of limiter).

---

## P1 · Known open items outside the critical path

| ID | Area | Item | Status |
|---|---|---|---|
| P1-1 | Post-run | Strides section requires an app release | Implemented, awaiting release |
| P1-2 | Plan / phone | `TrainingPlanDay` has no `notes` field, so the Dodgers pairing purpose reaches Today's `why` line but **not** the week view | Discovered |
| P1-3 | Plan / phone | Block screen shows nothing until the plan is re-authored (`block_strategy.answers` postdates the live plan). Compiles; **not rendered** | Blocked on P0-3 |
| P1-4 | Watch | Swift grading verified only by a TypeScript port | Discovered |
| P1-9 | Watch | ~~Watch does not draw `raceHr`~~ — **CLOSED**, verified 2026-09-03. `WatchRouterV5.raceHrReference` is wired into the lobby as the session qualifier (`WatchRouterV5.swift:1675`), and the watch model decodes the field. HR-SEMANTICS-2 landed it | Closed |
| P1-10 | Phone | ~~`HRAlerter` unwired~~ — **CLOSED**, verified 2026-09-03. `FaffApp.swift:161` starts it and `WatchSync.swift:194` applies today's ceiling from the SAME `hrCeilingBpm` the wrist guardrail uses, so there is no second derivation. `nil` DISARMS rather than leaving yesterday's easy-day number watching a threshold session. The "has never fired for anyone" line in that file is the past-tense bug description, not a live state | Closed |
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

**Owner (2026-09-03 coordination update):** the **post-run session** owns this
whole inventory as UI/presentation work. Programme-lead retains everything
each row *depends on* — canonical decision record, phase identity, authored
spec, canonical run set, evidence admission, adaptation decisions (P0-6) — the
post-run session consumes those through their existing interfaces and does not
re-derive them.

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

**Owner (2026-09-03 coordination update):** split down the server/iPhone line
already in the table. **Programme-lead** keeps RS-1 (the contract + mutation
path), RS-3 (candidate generation/ranking) and RS-5 (atomic apply) — these are
the rescheduling decision contract named in the SESSION OWNERSHIP section
above. **Pre-run session** owns RS-2, RS-4, RS-6, RS-7 and RS-8 — the
constraint-capture UI, per-option display, undo control, entry points and
post-approval summary — consuming RS-1/RS-3/RS-5 through their interface
rather than re-deriving ranking or mutation logic. This item was previously
blocked on the live rebuild in this session; the split does not change that —
pre-run's UI work can proceed against the RS-1/RS-3 contract shape without
waiting on the rebuild, but RS-5's actual writes stay gated on it.

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
- **2026-09-03 addendum, per SESSION OWNERSHIP above:** three UI-touching
  sessions now run in parallel (pre-run, post-run, week-strip), each on its
  own branch/worktree, none merging to `main` directly. This session
  integrates their handbacks under the same rules as any agent's, plus: no
  UI may re-derive a canonical value it can consume through an existing
  interface, and a shared-file conflict is resolved by one session yielding
  the file (never by manually combining two state models).
- **Treadmill incline/speed display** (David, 2026-09-03, hill-repeat workout
  card screenshot — HR target shown, no incline/speed): split ownership. The
  DATA question — does `workout_spec` carry a treadmill-equivalent incline/
  speed target for a hill session at all — is programme-lead's (workout
  prescription). The RENDERING of that field on the workout card is pre-run
  session's (workout-detail information hierarchy). Not yet investigated on
  either side as of this entry; recorded so neither session assumes the other
  has it.
