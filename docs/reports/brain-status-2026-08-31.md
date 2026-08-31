# faff.run — Coaching Brain Status Report

**2026-08-31. External-review-ready status report on the coaching brain as it
actually exists in the repository today** — not the design intent, the built
reality. Every claim below traces to a file read, a grep, or a command run
today.

**A methodological note that shapes this whole report.** This audit was run
in the shared working checkout while at least one other concurrent session
was actively mid-edit on exactly the files this report cares most about
(`spec-builder.ts`, `recompute-paces.ts`, `reanchor-plan.ts`,
`prescription-resolver.ts`, `adaptation-engine.ts`, plus a brand-new
untracked file, `load-prescription-anchors.ts`). The first pass of this
report read those files off disk and conflated that in-progress, uncommitted
work with committed reality — a real mistake, caught and corrected before
publishing by diffing every load-bearing claim against `git show
aa065ed5:<path>` (the actual tip of `main` at audit time). **Every finding
below is now stated against the COMMITTED state of `main`, with the observed
uncommitted work called out separately and explicitly, never blended in.**
That correction is itself worth reporting: it's a live demonstration of
exactly the failure mode CLAUDE.md's Rule 13 exists to catch (verify against
the real thing, not a fixture — here, the "fixture" that fooled the first
pass was another session's unfinished work sitting in the same tree).

This is a companion to, not a repeat of, the earlier fitness-architecture
summary. That one was a design proposal written before most of this existed.
This one asks: **does what got built tonight actually match what got
written down tonight, and is the ownership discipline holding?**

---

## Executive summary

At the actual tip of `main` (`aa065ed5`), the migration discipline is
holding cleanly: **every domain built tonight — Activity Interpreter,
Evidence Engine, Runner Model, Readiness, Pace Prescription, Adaptation
Engine — is confirmed, by import trace, to be fully shadow.** Nothing new
has gone live prematurely; nothing old has been quietly bypassed. That is
the single most important finding in this report, and it is good news. The
two locked pace decisions (durability-personalized marathon pace, shakeout's
own ceiling) are built as real functions in the committed
`prescription-resolver.ts`, but nothing calls them yet. The real risk isn't
in what's committed — it's in what's *about* to be. A concurrent session was
observed, live, in the middle of wiring Pace Prescription into the
adaptation-time recompute path (~1,700 uncommitted lines across nine files);
that work is not on `main` yet, but the moment it lands, it will make
`recompute-paces.ts` price threshold pace from pure demonstrated capacity
while `generate.ts` (initial authoring, untouched by that work) keeps
pricing it partly from a goal-blend — a genuine, structural pace
contradiction, not yet real because the wiring isn't committed, but real the
day it is, unless `generate.ts` migrates in the same change or a
contradiction test is added first. Separately, one real, currently-live
ownership violation was found and confirmed independent of any of that:
`goalRunFloorMiForUser` lets the runner's stated goal distance gate whether
their own training effort counts as fitness evidence — a live breach of the
single hardest rule in the doctrine set, self-disclosed in code but not yet
fixed.

---

## Domain-by-domain: the Brain Constitution's §29 ownership table, checked

Unless stated otherwise, "authority" below reflects `git show aa065ed5`
(committed `main`), confirmed by tracing every import site in the committed
tree, not the working tree.

| # | Domain | Real implementation? | Authority (at committed `main`) | Verified against real data? | Ownership violation found? |
|---|---|---|---|---|---|
| A | Activity Interpreter | `lib/evidence/activity-evidence.ts`, `load-activity-evidence.ts` | **Shadow only.** Referenced in a code *comment* in `app/api/ingest/workout/route.ts` (which is unmodified in the working tree, so this reflects committed reality), not actually invoked there. No live caller found anywhere in the committed tree. | Yes — the two `docs/reference-cases/*.md` fixtures are real rows from the owner's own account, and the module was built directly against them. | None found. Cleanly scoped to `ActivityInterpretation`; doesn't reach into fitness or plan. |
| B | Evidence Engine | `lib/evidence/load-activity-evidence.ts`, `lib/evidence/reexamination.ts` (the belief-tension consumer named in the structured-long-run fixture) | **Shadow only.** Not called from any `app/api/*` route in the committed tree. Only reached through `capacity-resolver.ts`, which is itself fully shadow (see C). | Partially — built directly against the two reference-case fixtures, which are real production rows. No evidence it has run against the full corpus. | None found. |
| C | Runner Model | `lib/training/capacity-resolver.ts` — four resolvers (`resolveThresholdCapacity`, `resolveHighIntensityCapacity`, `resolveDurability`, `resolveEasyCeiling`) | **Fully shadow at committed `main`.** Confirmed by grepping every `.ts` file in the committed tree for the four resolver names and for `capacity-resolver`: the only references outside its own file are comments (`vdot.ts`, `durability-anchor.ts` — both one-directional, capacity-resolver importing *them*, not the reverse) and the doctrine-claims file (`lib/doctrine/registry.ts`, a test-time claims list, not runtime app code). Not reached by `generate.ts`, `recompute-paces.ts`, `race-projection.ts`, or anything else that runs when a real user hits the app. | Yes, substantively — built and shadow-compared against the owner's real 103-row CIM block (per the 2026-08-31 PRODUCT_DECISIONS entries this comparison produced). | **Goal isolation is real and compiler-enforced** — `capacity-resolver.ts` §0 falsifies itself by adding `goalSec?: number` to any of the four resolvers (Rule 18 discipline, done correctly, and unmodified in the working tree so this holds for committed `main` too). One **named, self-disclosed exception in the OLD engine, not this file**: `goalRunFloorMiForUser` — see Contradiction risk, item 2. |
| D | Readiness / Current State | `lib/training/runner-state.ts` | **Shadow only.** `resolvePrescription` (the one committed function that types a `state: RunnerState` argument) has zero callers anywhere in the committed tree outside its own file and its test. | No real-data run found for this domain specifically. | None found; correctly separated from capacity per Constitution §D. |
| E | Safety | No single module. Distributed across `lib/plan/injury-builder.ts`, `injury-protocols.ts`, `lib/coach/heat-gate.ts` | Pre-existing, live (injury/return-to-run ladders and heat gating are wired and doctrine-registry-gated), but **not consolidated** under one `SafetyDecision: NORMAL/CAUTION/MODIFY/STOP` resolver as Doctrine Enforcement §19 specifies. | Yes, for the pre-existing pieces (`INJURY.*` doctrine claims are closed per CLAUDE.md Rule 7). | Not a violation in the "two systems answer the same question" sense — more a **gap**: nothing yet plays the explicit override-channel role the Constitution assigns Safety over the new adaptation/prescription layer, whenever that layer does go live. |
| F | Coaching Thesis | **Does not exist.** Zero matches for `CoachingThesis`/"coaching thesis" anywhere in `lib/`. | N/A | N/A | N/A — flagged below as a real gap. |
| G | Pace Prescription | `lib/training/prescription-resolver.ts` | **Shadow at committed `main`, same as every other domain built tonight.** `resolvePrescription` — the sole exported entry point that composes a full prescription — has no callers anywhere in the committed tree. `marathonPaceFromDurability` and the shakeout-ceiling constant (the two 2026-08-31 locked decisions) both exist as real, committed functions inside this file, but nothing calls them yet either. `spec-builder.ts`, `recompute-paces.ts`, and `reanchor-plan.ts` at committed `main` contain **zero** references to `prescription-resolver.ts` — confirmed directly (`git show aa065ed5:web-v2/lib/plan/recompute-paces.ts \| grep resolveCapacityPrescription` → no matches). `generate.ts` and `recompute-paces.ts` both still run the old VDOT cascade, unchanged, including the goal-blended `blendedTPaceForWeek`/`tPaceFromGoal` path in both places. | The two locked decisions were adopted from a real shadow-mode comparison against the owner's live CIM block (per PRODUCT_DECISIONS), but the functions that resulted are, as of committed `main`, unreachable dead code from any live surface's perspective. | None at committed `main` — there's nothing live yet to conflict with anything. **See "Observed in-flight, uncommitted work" below: this is about to change, and the change as observed is not yet paired with a fix for the resulting split with `generate.ts`.** |
| H | Plan Generator | `lib/plan/generate.ts` (authoring, ~14k lines), `lib/plan/adapt.ts` + `recompute-paces.ts` (the adaptation-time path) | Live, as it has been — governed by the large pre-existing gate suite (dosing caps, archetype sweep, `_maint_invariants.test.ts`, etc.), none of which changed tonight in the committed tree. | Yes, extensively, via the pre-existing 11,598-archetype sweep and the owner's own real block. | None newly found at committed `main`. |
| I | Adaptation Engine | `lib/adaptation/adaptation-engine.ts`, `load-adaptation-engine.ts`, plus `lib/evidence/reexamination.ts` | **Confirmed fully shadow, exactly as the mid-session course-correction required.** Both landing commits (`a936e391`, `aa065ed5`) say so in their own messages ("Not wired. §21's shadow-mode step"), and the only importer of either file anywhere in the tree — committed or working — is a shadow-probe script. | Yes — the shadow probe is designed to run the layer against the owner's real account and print its proposals beside `adapt.ts`'s actual live behavior. | None found in the design — it consumes `classifyAdaptation`, `resolveWeekProgression`, `adaptive-ramp.ts`, `pace-anchor.ts`, `runner-state.ts` rather than re-deriving any of them, per its own commit message. |
| J | Race Prediction | `lib/training/race-projection.ts` (pre-existing; this is the file Rule 16 already consolidated to one resolver) | Live, unchanged by tonight's work. | Yes, per its existing status. | Not yet migrated onto the Runner Model — still computes entirely from `predictRaceTime(vdot, distanceMi)`, the raw VDOT scalar. Not a violation of anything claimed today; just unmigrated. Worth watching once Pace Prescription does go live, per the executive summary's concern. |
| K | Goal System | Existing `app/api/race/*`, `app/api/profile/goal/*` routes | Live, pre-existing. | N/A | The **2026-08-31 decision** (goal changes require explicit runner action; co-equal choice card; never silent renegotiation) is **decided and documented only** — `git log 2ab4162d..HEAD` shows zero commits touching `native-v2` or any UI surface after the decision was locked; only doctrine docs and the (shadow) adaptation engine landed after it. The **related, already-shipped** fix from the day before (`f5543b5d`, 2026-08-30, "the coach projects, it never renegotiates — and a gate that says so") is real, live, and the correct prior enforcement of the underlying principle — but it predates and is narrower than the specific co-equal-card UX this later decision calls for. |
| L | Goal Feasibility | `lib/plan/goal-outlook.ts`, `goal-outlook-copy.ts`, `lib/training/achievable-target.ts` | Live, pre-existing, untouched tonight. | Yes, per existing status. | None newly found. |
| M | Training Load | No single module; distributed across `normal-window.ts` (weekly mileage / quality density readers), `adaptive-ramp.ts`, and others | Live, pre-existing, descriptive rather than a magic score — matches Constitution §M's own instruction not to consolidate into "Load Score = 71." | Yes, per existing Rule 8 enforcement. | None found; the distribution here is the doctrine-correct shape, not drift. |
| N | Environmental Context | `lib/weather/heat-adjustment.ts`, `lib/coach/heat-*.ts` family | Live, pre-existing, doctrine-registry-gated (`HEAT.*` claims, closed per CLAUDE.md Rule 7). | Yes. | None found. |
| O | Workout Library | `lib/workout-catalogue/{catalogue.ts,select.ts}` | Live, pre-existing, untouched tonight. | Yes, per existing gates. | None found. |
| P | UI / Coaching Presentation | `native-v2` SwiftUI (thin client, no web-views, per the standing rule) | Live for the app as it exists today; the two 2026-08-31 decisions affecting UI (goal card, Races→Progress) are **not yet built** — confirmed no native-v2 commits after `2ab4162d`. | Not independently re-audited this session — out of scope for the `lib/`-focused reading this report is grounded in. | Not assessed in depth. Flagged as a gap in this report's own coverage, not a clean bill of health. |

---

## Observed in-flight, uncommitted work (not on `main`, reported for context only)

At audit time, the shared checkout carried substantial uncommitted changes —
confirmed via `git status` (nine modified files, ~1,700 insertions / 290
deletions per `git diff --stat`) plus three new untracked files, one of them
a whole new module (`lib/training/load-prescription-anchors.ts`). This is
someone else's active work, not this report's to judge or fix, but its
shape is directly relevant to where this migration is headed next, so it's
worth naming precisely rather than silently excluding:

- `recompute-paces.ts` is being rewritten to call a new `resolveCapacityPrescription` / `composePaceAnchors` chain in `prescription-resolver.ts` (also being expanded), which would make the nightly `run-adaptations` cron price every future/unsealed workout's pace from the Runner Model instead of VDOT — i.e., exactly the "Pace Prescription goes live for the recompute channel" step this report's first draft mistakenly reported as already true.
- `spec-builder.ts` is being taught to accept an optional `anchors: PrescribedPaceAnchors | null` parameter (default `null`, explicitly documented in-progress as "every authoring caller today" leaves the file byte-identical), which is the mechanism that would carry those new anchors through to the actual workout spec.
- `adaptation-engine.ts` and `load-adaptation-engine.ts` are both being substantially expanded (514 and 181 lines changed respectively).
- The four `check-doctrine.sh` failures and the `_adaptation_engine`/`reanchor-plan`/`activity_evidence` test failures this audit's build/test run turned up (below) trace directly to this in-progress work — the doctrine gate's regexes haven't been updated yet to match `spec-builder.ts`'s new conditional expressions, and several of the failing test files are themselves mid-edit. **None of this reflects a defect in what's committed to `main`.**

The forward-looking risk this creates: once this lands, `recompute-paces.ts`
will stop goal-blending threshold pace while `generate.ts` (not part of
this in-flight diff) keeps doing so — reintroducing, live, the exact
divergence described in Contradiction risk item 1 below. This report takes
no position on whether that observed work already accounts for it; it
wasn't finished at audit time.

---

## What's real vs. what's aspirational

**Real, built, and shadow-compared against real data — but not live:**

- `capacity-resolver.ts` — the four-resolver Runner Model, with compiler-enforced goal isolation. The single strongest piece of design work in this session, currently reachable by nothing that runs for a real user.
- `prescription-resolver.ts` — Pace Prescription, including both locked 2026-08-31 pace decisions as real functions, currently unreachable from any live surface.
- `activity-evidence.ts` / `load-activity-evidence.ts` / `reexamination.ts` — Activity Interpreter + Evidence Engine, fixture-verified, not wired anywhere.
- `runner-state.ts` — Readiness, built, not wired anywhere.
- `adaptation-engine.ts` / `load-adaptation-engine.ts` — Adaptation, built, deliberately and confirmedly shadow.
- The Brain Constitution itself, and a 322-claim doctrine registry (`lib/doctrine/registry.ts`) that has grown from the 289 cited in CLAUDE.md.

**Decided and documented, not yet built:**

- The goal-card co-equal-choice UX (2026-08-31 decision).
- Races folding into Progress as a navigation change (2026-08-31 decision).
- Coaching Thesis as a module — the Constitution names it, nothing implements it.
- A general contradiction checker / final decision validator (Constitution §16, Doctrine Enforcement §29). The only thing resembling one is `contradictionsIn()` inside `adaptation-engine.ts`, which checks contradictions *within one proposal set*, not across the app, and which is itself shadow-mode only.
- Golden-runner fixtures and historical-replay tooling (Doctrine Enforcement §12–13, both named as required acceptance criteria for "the entire rework" in §39). Neither exists as a file in the repo as of this report.
- A dedicated Safety resolver consolidating the distributed injury/heat logic into the `NORMAL/CAUTION/MODIFY/STOP` shape Doctrine Enforcement §19 specifies.

**In progress, uncommitted, observed mid-flight:** wiring Pace Prescription
into the live adaptation-time recompute path — see the section above.

---

## Contradiction risk, live-checked

The task here was explicit: don't assume the doctrine prevents a
contradiction just because it's written down — try to actually find one in
the current code. Two of the three below are real today; the third is
forward-looking, tied to the in-flight work above.

### 1. Pace contradiction (Constitution §15) — not yet possible at committed `main`; about to become possible

At committed `main`, both `generate.ts` and `recompute-paces.ts` run the
same old VDOT cascade with the same goal-blend (`blendedTPaceForWeek`,
`tPaceFromGoal`), so there is no live divergence today. But the in-flight
work described above is rewriting `recompute-paces.ts` to price threshold
pace from `resolveCapacityPrescription` — pure capacity evidence, no goal
blend — while leaving `generate.ts` on the goal-blended cascade untouched.
**The moment that work lands without a corresponding change to
`generate.ts` (or a bridging contradiction test), a freshly authored or
replanned plan will carry a goal-blended threshold pace, and the same plan,
after its first nightly recompute, will carry a pure-capacity threshold pace
for the same runner at the same point in time** — precisely the "plan says
6:50, [recomputed plan] says 7:05 → architecture bug" shape the Constitution
forbids. Nothing in the repo, committed or in-flight, currently guards
against this. Flagged now, before it lands, because the fix is far cheaper
before the seam exists in production than after.

### 2. Fitness contradiction, via goal-leakage into evidence admissibility (Constitution §15 / §K) — real, live, today

`goalRunFloorMiForUser` — which reads `profile.goal_race_distance` /
`profile.tt_goal_distance` to decide whether one of the runner's own hard
training efforts is even *admissible* as VDOT evidence — is live and called
directly from `generate.ts`, `lib/plan/drift-monitor.ts`, and four API
routes (`v5/race-authority`, `cron/snapshot-projections`, `coach/read`,
`targets/projection`) — all confirmed unmodified in the working tree, so
this reflects committed `main`, not in-flight work. This means, on the live
engine today, whether a 3.4-mile hard effort counts as fitness evidence
depends on what race the runner says they're training for — a direct
violation of "the fitness resolver should not be able to see the goal at
all" (Constitution §6 / Doctrine Enforcement §6). Not a new finding invented
for this report: `capacity-resolver.ts`'s own header comment (§3, lines
776–807) names it explicitly, explains why the *new* resolver deliberately
does not replicate it (a flat `CAPACITY_RUN_FLOOR_MI = 3.0` instead), and
names the eventual fix as follow-up work. **The point for this report: that
divergence is still live today, in the exact files listed above, not a
historical footnote.**

### 3. Race contradiction (Constitution §15) — latent, not yet active

Race Prediction (`race-projection.ts`) reads fitness purely from VDOT. At
committed `main`, Pace Prescription doesn't read fitness from anywhere live
yet, so there's no active divergence between the two today. But the two are
migrating on separate, unsynchronized timelines — once Pace Prescription
goes live (per the in-flight work above) and Race Prediction doesn't move
with it, the same "two owners can independently drift apart" risk
Constitution §17 warns against becomes real for this pair too. Named now as
a forward risk, not a current defect.

---

## Test / gate health, right now

**UPDATE 2026-09-01: this whole section is a point-in-time snapshot of an
uncommitted working tree and is now historical, not current.** The in-flight
work described above (the `spec-builder.ts` refactor, the four
`_doctrine_gate.test.ts` `PACE.*` bindings, `reanchor-plan.test.ts` mid-edit)
landed and was committed in `66a5fea5`. Re-verified independently against
current `main` on 2026-09-01: `_doctrine_gate.test.ts` passes 651/651 clean.
`reanchor-plan.test.ts` was run in isolation three consecutive times (12/12
passed, identical, every run) and as part of the full `lib/plan/` batch
three consecutive times (2031/2031 passed, identical file/test counts every
run) — the run-to-run instability this section documents does not reproduce
against committed code; it was the mid-edit uncommitted state itself. See
`docs/reports/gate-verification-2026-09-01.md` for the full determinism
proof. The two-different-answers-on-two-runs finding below was real and
correctly flagged at the time — it just does not describe `main` today.
Left in place below as the original record.

**This section reflects the actual disk state at audit time — committed
`main` PLUS the uncommitted in-flight work described above — because that
is what actually runs when you type `npx vitest run` in this checkout right
now. It is explicitly NOT a test of committed `main` in isolation.** Getting
a clean read of `main` alone would have required stashing a concurrent
session's ~1,700 uncommitted lines, which risked disrupting active work in
a shared checkout and was avoided per this task's own read-only,
non-conflicting brief. Treat every number below as "what the working tree
does today," not "what `main` does."

**`npx vitest run` — full suite, two consecutive runs, same code, different results (itself a finding — see below):**

- Run 1: 381 test files (368 passed, 6 failed, 7 skipped) / 7841 tests (7782 passed, 49 failed, 10 skipped)
- Run 2: 381 test files (367 passed, 7 failed, 7 skipped) / 7841 tests (7780 passed, 51 failed, 10 skipped)

Failing test files (union of both runs):

- `lib/adaptation/_adaptation_engine.audit.test.ts` — **modified in the uncommitted diff**, mid-edit for the in-flight adaptation-engine expansion.
- `lib/adaptation/_adaptation_engine.test.ts` — **modified in the uncommitted diff**, same.
- `lib/audit/_anchor_derivation_scan.test.ts`
- `lib/audit/_generated_content_gate.test.ts`
- `lib/doctrine/_doctrine_gate.test.ts` — fails on the four `PACE.*` claims described below, which trace directly to the uncommitted `spec-builder.ts` refactor.
- `lib/evidence/_activity_evidence.audit.test.ts`
- `lib/plan/reanchor-plan.test.ts` — **modified in the uncommitted diff**; failed *differently* between the two runs (assertion mismatches in run 1, a `ReferenceError: tPaceFromVdot is not defined` in run 2), consistent with a test file mid-edit rather than a stable regression.

**The suite gave two different answers on two consecutive runs of
identical code** — worth flagging on its own, independent of the
in-flight-work context, per CLAUDE.md's Rule 18 standard that a gate which
isn't stable run-to-run isn't trustworthy regardless of which run you'd
rather believe.

**`npm run prebuild` — FAIL** on the working tree. The 17-script chain gets
through `check-palette-sync.sh`, `check-spacing-tokens.sh`,
`check-modelled-mark.sh`, `check-coach-voice.sh` cleanly, then fails at
`check-doctrine.sh`, on exactly four claims: `PACE.easy-band-off-threshold`,
`PACE.tempo-is-threshold`, `PACE.marathon-offset`, `PACE.interval-offset`.
All four fail with "bound literal not found" — the doctrine gate's regexes
(e.g. `const mp = tPaceSec + (\d+);`) no longer match the **uncommitted**
version of `lib/plan/spec-builder.ts`, whose in-flight refactor made those
expressions conditional on the new `anchors` argument. Confirmed: this
exact regex still matches the **committed** version of `spec-builder.ts`
(`git show aa065ed5:web-v2/lib/plan/spec-builder.ts` contains the literal
pattern) — **so `check-doctrine.sh` would pass against committed `main`
alone.** This is a live, real-time illustration of Rule 7/Rule 18's exact
concern (a doctrine claim watching code that's mid-refactor), but it is not
a defect in anything on `main` today — it's the natural, expected
in-between state of unfinished work, and it's evidence the doctrine gate is
doing its job rather than reporting false-clean.

**`npm run build` — FAIL** on the working tree, but not from the Next.js
compiler — `next build`'s automatic `prebuild` lifecycle hook fails first on
the identical `check-doctrine.sh` error above, and the build log contains
zero occurrences of "next build," "Compiled," or "webpack." **This report
also confirmed the pre-push hook (`.githooks/pre-push`, which independently
runs `check-web-build.sh`) blocks a push against the current working tree
for the same reason** — attempting to push this very report's commit
triggered exactly that gate. So: this report cannot say whether `next
build` succeeds on `main` alone, because the working tree it had to operate
in was never in a state to test that in isolation without touching another
session's work.

**Bottom line:** the working tree cannot currently pass `prebuild` or
`build`, entirely traceable to one unfinished refactor sitting uncommitted
on top of `main`, not to anything that landed. The one thing this report
could not do — and flags honestly rather than papering over — is prove
`main` alone is green, because doing so safely would have required
disturbing a concurrent session's in-progress work.

---

## Genuine open risks worth an outside opinion

1. **The forward-looking pace-contradiction path (Contradiction risk, item 1) has no test guarding it, and the work that would create it is already in flight.** This is the single most actionable risk in this report, precisely because it's still cheap to fix — before it lands rather than after. Worth an outside opinion on whether landing the in-flight recompute-path wiring should be gated on either finishing the matching `generate.ts` migration in the same change, or adding a contradiction test that fails loudly until that migration completes (the latter is cheaper and is exactly what Constitution §16 calls for).

2. **`goalRunFloorMiForUser`'s live goal-into-evidence leak (Contradiction risk, item 2) is real, live, and unfixed today**, independent of any of the in-flight work. It's the single hardest rule in the whole doctrine set ("if the service cannot see the goal, it cannot accidentally train toward it"), and it's currently broken by the pre-existing engine that real users' plans still run on. Self-disclosed in code, which is good — but per CLAUDE.md Rule 20, a documented-but-unfixed violation is still a violation.

3. **Coaching Thesis has zero implementation.** The Constitution calls it the layer that "should prevent the Plan Generator from behaving randomly," and names it explicitly as one of only two domains (with Adaptation) it worries about becoming a god object. Once Runner Model, Pace Prescription and Adaptation all go live without a Coaching Thesis synthesizing "what currently matters" between them, whatever fills that gap will be implicit rather than a named owner — worth deciding now, while nothing is live yet, rather than after three systems are already talking past each other in production.

4. **The Brain Constitution has no gate of its own.** It's the newest, most load-bearing doctrine document in the repo (locked today), and per its own companion document's Rule 20 standard — "a product rule with no gate is a hypothesis" — that's exactly what it currently is. No script in the 17-entry `prebuild` chain checks ownership boundaries, no-side-doors, or the §15 contradiction taxonomy. This matters more, not less, given the whole architecture is still shadow: there is no automated check that would catch the very "wire Pace Prescription live without migrating `generate.ts`" scenario in item 1 above, even once it lands.

5. **Golden runners and historical replay, both named as required acceptance criteria for "the entire rework" (Doctrine Enforcement §39), don't exist.** The fitness-vector architecture is now three shadow layers deep (capacity, prescription, adaptation) without either safety net, and at least one of them is actively being wired toward live authority as of this audit. Worth an outside opinion on whether landing the in-flight recompute-path work should wait on at least one of these existing first.

6. **Test-suite non-determinism**, observed directly in this audit's own two consecutive runs, is real and worth tracking independent of everything else — a suite that answers differently to the same question on back-to-back runs undermines confidence in every other green-suite claim in this codebase's history, this report's own runs included.

7. **This report's own coverage gap: Safety and UI were not audited to the same depth as the domains touched by tonight's committed work.** Both are flagged rather than cleared. An outside reviewer with iOS/SwiftUI access could close that gap faster than continuing to expand this report's `lib/`-only lens.

8. **Process risk, named because it nearly shipped in this report's own first draft:** auditing a shared, actively-edited checkout without diffing every finding against the actual committed tip produces confident, well-cited, wrong conclusions — the first version of this report claimed Pace Prescription was "live for the recompute channel" based entirely on reading another session's unfinished work off disk. Worth naming as a standing hazard for any future audit run the same way, not just a one-off mistake caught this time.
