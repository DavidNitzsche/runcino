# faff.run — Coaching Brain Status Report

**2026-08-31. External-review-ready status report on the coaching brain as it
actually exists in the repository today** — not the design intent, the built
reality. Every claim below traces to a file read, a grep, or a command run
today against `main` at commit `aa065ed5`, plus the live working tree (which,
as noted throughout, carries substantial uncommitted in-flight work from a
concurrent session on exactly the files this report is auditing). Where the
working tree and the last commit disagree, both are stated.

This is a companion to, not a repeat of, the earlier fitness-architecture
summary. That one was a design proposal written before most of this existed.
This one asks: **does what got built tonight actually match what got
written down tonight, and is the ownership discipline holding?**

---

## Executive summary

The brain is mid-migration, and the migration is honest about being
mid-migration — every new resolver's own comments say plainly what is wired
and what isn't, which is the single best sign in this audit. But drift has
already crept in on exactly the seam you'd expect: **Pace Prescription is
now live for one channel (the nightly adaptation-time recompute) and not the
other (initial plan authoring)**, which means the same plan can carry two
different threshold paces today depending only on which code path touched it
last — a concrete, reproducible instance of the "Pace contradiction ...
architecture bug" the Brain Constitution names as forbidden, not yet proven
to have fired but structurally possible right now, with no test guarding
against it. The Adaptation Engine's shadow-mode discipline held exactly as
instructed — verified, not assumed. And as of this run, `main`'s own working
tree cannot currently pass `npm run build`, for a reason (a doctrine gate's
regex fell out of sync with the file it watches) that is itself a small
instance of the exact gate-rot pattern CLAUDE.md's Rule 18 was written to
catch.

---

## Domain-by-domain: the Brain Constitution's §29 ownership table, checked

| # | Domain | Real implementation? | Authority | Verified against real data? | Ownership violation found? |
|---|---|---|---|---|---|
| A | Activity Interpreter | `lib/evidence/activity-evidence.ts`, `load-activity-evidence.ts` | **Shadow only.** Referenced in a code *comment* in `app/api/ingest/workout/route.ts`, not actually invoked there. No live caller found anywhere. | Yes — the two `docs/reference-cases/*.md` fixtures are real rows from the owner's own account, and the module's own audit test asserts against them. That audit test (`_activity_evidence.audit.test.ts`) is currently **failing** in the working tree (see Test/gate health below). | None found. Cleanly scoped to `ActivityInterpretation`; doesn't reach into fitness or plan. |
| B | Evidence Engine | `lib/evidence/load-activity-evidence.ts`, `lib/evidence/reexamination.ts` (the belief-tension consumer named in the structured-long-run fixture) | **Shadow only.** Not called from any `app/api/*` route. Reached only through `capacity-resolver.ts`'s own internal wiring, which is itself only live via one channel (see G/H below). | Partially — built directly against the two reference-case fixtures, which are real production rows. No evidence yet that it runs against the full corpus in production. | None found. |
| C | Runner Model | `lib/training/capacity-resolver.ts` — four resolvers (`resolveThresholdCapacity`, `resolveHighIntensityCapacity`, `resolveDurability`, `resolveEasyCeiling`) | **Partially authoritative.** Live through the nightly `run-adaptations` cron → `lib/plan/adapt.ts` → `recompute-paces.ts` → `resolveCapacityPrescription` (confirmed by import trace). **Not** reached by `lib/plan/generate.ts` (initial plan authoring), `lib/training/race-projection.ts` (Race Prediction), or any of the other pre-existing consumers of the old VDOT cascade. | Yes, substantively — built and shadow-compared against the owner's real 103-row CIM block (per `prescription-resolver.ts`'s own comments and the 2026-08-31 PRODUCT_DECISIONS entries it produced). | **Goal isolation is real and compiler-enforced** — `capacity-resolver.ts` §0 falsifies itself by adding `goalSec?: number` to any of the four resolvers (Rule 18 discipline, done correctly). One **named, self-disclosed exception**: `goalRunFloorMiForUser` (used by the pre-existing "live engine," not by this new layer) still gates fitness-evidence admissibility by the runner's stated goal distance — see Contradiction risk, item 2. |
| D | Readiness / Current State | `lib/training/runner-state.ts` | **Shadow only.** Not imported by any `app/api/*` route. `prescription-resolver.ts`'s state-aware wrapper (`resolvePrescription`) imports `RunnerState` as a type and takes a `state` argument, but the one live caller (`recompute-paces.ts`) calls the state-free `resolveCapacityPrescription` instead — readiness genuinely does not reach any live path yet. | No — no evidence of a real-data run found. | None found; correctly separated from capacity per Constitution §D. |
| E | Safety | No single module. Distributed across `lib/plan/injury-builder.ts`, `injury-protocols.ts`, `lib/coach/heat-gate.ts` | Pre-existing, live (injury/return-to-run ladders and heat gating are wired and doctrine-registry-gated), but **not consolidated** under one `SafetyDecision: NORMAL/CAUTION/MODIFY/STOP` resolver as Doctrine Enforcement §19 specifies. | Yes, for the pre-existing pieces (`INJURY.*` doctrine claims are closed per CLAUDE.md Rule 7). | Not a violation in the "two systems answer the same question" sense — more a **gap**: nothing yet plays the explicit override-channel role the Constitution assigns Safety over the new adaptation/prescription layer. |
| F | Coaching Thesis | **Does not exist.** Zero matches for `CoachingThesis`/"coaching thesis" anywhere in `lib/`. | N/A | N/A | N/A — but flagged below as a real gap, not an oversight to wave off. |
| G | Pace Prescription | `lib/training/prescription-resolver.ts` | **Partially authoritative, and this is the sharpest finding in this report.** Live for the adaptation-time recompute channel only: nightly `run-adaptations` cron → `adapt.ts` → `recompute-paces.ts` → `resolveCapacityPrescription`, confirmed by `recompute-paces.ts`'s own header ("THIS IS NOW THE PACE PRESCRIPTION LAYER'S LIVE PATH, AND IT NO LONGER SPEAKS VDOT"). **Not live for initial authoring** — `generate.ts` still calls `tPaceFromVdot`/`resolveCurrentTPace`/`blendedTPaceForWeek`/`tPaceFromGoal` directly (5+ real call sites, enumerated below), and `recompute-paces.ts`'s own comment says so explicitly: "The five functions remain exported because `generate.ts`'s authoring path still calls them and is a separately-scoped migration; this path does not." | Yes — the two 2026-08-31 pace decisions (durability-personalized marathon pace, shakeout's own ceiling) were adopted from a real shadow-mode comparison against the owner's live CIM block, and both are now built into `prescription-resolver.ts` and threaded through the live recompute channel (`marathonPaceFromDurability`, `shakeoutCeilingSecPerMi` both traced into `recompute-paces.ts`/`reanchor-plan.ts`). | **Yes — see Contradiction risk, item 1.** Two different resolvers can now produce two different threshold paces for the same runner depending only on which code path last touched the plan. |
| H | Plan Generator | `lib/plan/generate.ts` (authoring, ~14k lines, untouched by tonight's rework), `lib/plan/adapt.ts` + `recompute-paces.ts` (the live adaptation-time path) | Live, as it has been — governed by the large pre-existing gate suite (dosing caps, archetype sweep, `_maint_invariants.test.ts`, etc.), none of which changed tonight. | Yes, extensively, via the pre-existing 11,598-archetype sweep and the owner's own real block. | None newly found; this session did not touch session/structure selection. |
| I | Adaptation Engine | `lib/adaptation/adaptation-engine.ts`, `load-adaptation-engine.ts`, plus `lib/evidence/reexamination.ts` | **Confirmed fully shadow, exactly as the mid-session course-correction required.** Grepped for every import site: the only consumer is `scripts/_shadow_adaptation_probe.ts`. Both landing commits (`a936e391`, `aa065ed5`) say so explicitly in their own messages ("Not wired. §21's shadow-mode step"). | Yes — the shadow probe runs the layer against the owner's real account and prints its proposals beside `adapt.ts`'s actual live behavior. | None found in the design (§29's "must never become a second coach" boundary is respected — it consumes `classifyAdaptation`, `resolveWeekProgression`, `adaptive-ramp.ts`, `pace-anchor.ts`, `runner-state.ts` rather than re-deriving any of them, per its own commit message). **However:** `lib/adaptation/_adaptation_engine.test.ts` and `_adaptation_engine.audit.test.ts` are currently **failing** in the working tree — see Test/gate health. |
| J | Race Prediction | `lib/training/race-projection.ts` (pre-existing; this is the file Rule 16 already consolidated to one resolver) | Live, unchanged by tonight's work. | Yes, per its existing status. | **Not yet migrated onto the Runner Model at all** — still computes entirely from `predictRaceTime(vdot, distanceMi)`, the raw VDOT scalar. Not a violation of today's architecture (nothing claims otherwise), but it means Race Prediction and the live half of Pace Prescription can now draw from two different fitness pictures for the same runner — see Contradiction risk, item 1's second-order version. |
| K | Goal System | Existing `app/api/race/*`, `app/api/profile/goal/*` routes | Live, pre-existing. | N/A | The **2026-08-31 decision** (goal changes require explicit runner action; co-equal choice card; never silent renegotiation) is **decided and documented only** — `git log 2ab4162d..HEAD` shows zero commits touching `native-v2` or any UI surface after the decision was locked; only the Brain Constitution doc and the (shadow) adaptation engine landed after it. The **related, already-shipped** fix from the day before (`f5543b5d`, 2026-08-30, "the coach projects, it never renegotiates — and a gate that says so") is real and live, and is the correct prior enforcement of the underlying principle — but it predates and is narrower than the specific co-equal-card UX this decision calls for. |
| L | Goal Feasibility | `lib/plan/goal-outlook.ts`, `goal-outlook-copy.ts`, `lib/training/achievable-target.ts` | Live, pre-existing, untouched tonight. | Yes, per existing status. | None newly found. |
| M | Training Load | No single module; distributed across `normal-window.ts` (weekly mileage / quality density readers), `adaptive-ramp.ts`, and others | Live, pre-existing, descriptive rather than a magic score — matches Constitution §M's own instruction not to consolidate into "Load Score = 71." | Yes, per existing Rule 8 enforcement. | None found; the distribution here is the doctrine-correct shape, not drift. |
| N | Environmental Context | `lib/weather/heat-adjustment.ts`, `lib/coach/heat-*.ts` family | Live, pre-existing, doctrine-registry-gated (`HEAT.*` claims, closed per CLAUDE.md Rule 7). | Yes. | None found. |
| O | Workout Library | `lib/workout-catalogue/{catalogue.ts,select.ts}` | Live, pre-existing, untouched tonight. | Yes, per existing gates. | None found. |
| P | UI / Coaching Presentation | `native-v2` SwiftUI (thin client, no web-views, per the standing rule) | Live for the app as it exists today; the two 2026-08-31 decisions affecting UI (goal card, Races→Progress) are **not yet built** — confirmed no native-v2 commits after `2ab4162d`. | Not independently re-audited this session — out of scope for the `lib/` reading this report is grounded in. | Not assessed in depth this session. Flagged as a gap in this report's own coverage, not a clean bill of health. |

---

## What's real vs. what's aspirational

**Real, built, and running against real data tonight:**

- `capacity-resolver.ts` — the four-resolver Runner Model, with compiler-enforced goal isolation. The single strongest piece of work in this session.
- `prescription-resolver.ts` — Pace Prescription, live for one channel (below).
- `activity-evidence.ts` / `load-activity-evidence.ts` / `reexamination.ts` — Activity Interpreter + Evidence Engine, built and fixture-verified, not yet wired anywhere live.
- `runner-state.ts` — Readiness, built, not yet wired anywhere live.
- `adaptation-engine.ts` / `load-adaptation-engine.ts` — Adaptation, built, deliberately and confirmedly shadow.
- The Brain Constitution itself, and a 322-claim doctrine registry (`lib/doctrine/registry.ts`) that has grown from the 289 cited in CLAUDE.md.
- **The recompute-time pace-prescription wiring is now genuinely live**, and both 2026-08-31 pace decisions (durability-personalized marathon pace, shakeout's own ceiling) rode in with it.

**Decided and documented, not yet built:**

- The goal-card co-equal-choice UX (2026-08-31 decision).
- Races folding into Progress as a navigation change (2026-08-31 decision).
- Coaching Thesis as a module — the Constitution names it, nothing implements it.
- A general contradiction checker / final decision validator (Constitution §16, Doctrine Enforcement §29). The only thing resembling one is `contradictionsIn()` inside `adaptation-engine.ts`, which checks contradictions *within one proposal set*, not across the app, and which is itself shadow-mode only.
- Golden-runner fixtures and historical-replay tooling (Doctrine Enforcement §12–13, both named as required acceptance criteria for "the entire rework" in §39). Neither exists as a file in the repo as of this report — `find` for either pattern returns nothing.
- A dedicated Safety resolver consolidating the distributed injury/heat logic into the `NORMAL/CAUTION/MODIFY/STOP` shape Doctrine Enforcement §19 specifies.

---

## Contradiction risk, live-checked

The task here was explicit: don't assume the doctrine prevents a contradiction just because it's written down — try to actually find one in the current code.

### 1. Pace contradiction (Constitution §15) — structurally possible right now, not yet proven to have fired

`lib/plan/generate.ts` (initial authoring, and the path every `replan`/`onboarding complete`/`race create` call goes through) still calls `tPaceFromGoal` and `blendedTPaceForWeek` at line 9081 — the exact calendar-indexed, goal-blended pace derivation that `recompute-paces.ts`'s own header comment says is "GONE from this path entirely... Not softened: gone" for the channel it owns. That gone-ness is true only of the recompute channel. The same plan, once it passes through the nightly `run-adaptations` cron, gets its future/unsealed workouts' threshold pace rewritten by `resolveCapacityPrescription` — pure capacity evidence, zero goal blend, per PRESCRIPTION-WIRE-1.

Concretely: a plan authored or replanned today carries a threshold pace that is partly a function of the stated goal (via the calendar blend). The same plan, after its first nightly recompute, carries a threshold pace that is a pure function of demonstrated capacity. **Nothing in the repo currently tests that these two numbers agree**, or bounds how far apart they're allowed to be. This is precisely the "plan says 6:50, [recomputed plan] says 7:05 → architecture bug" shape the Constitution names as forbidden. It is not yet confirmed to have actually diverged in the owner's live plan — that would take pulling his current `plan_workouts` rows and comparing pre/post-recompute threshold values, which this report did not do — but the code path to produce it exists today, unguarded.

### 2. Fitness contradiction, via goal-leakage into evidence admissibility (Constitution §15 / §K)

`goalRunFloorMiForUser` — which reads `profile.goal_race_distance` / `profile.tt_goal_distance` to decide whether one of the runner's own hard training efforts is even *admissible* as VDOT evidence — is live and called directly from `generate.ts`, `lib/plan/drift-monitor.ts`, and four API routes (`v5/race-authority`, `cron/snapshot-projections`, `coach/read`, `targets/projection`). This means, on the live "engine" today, whether a 3.4-mile hard effort counts as fitness evidence depends on what race the runner says they're training for — a direct violation of "the fitness resolver should not be able to see the goal at all" (Constitution §6 / Doctrine Enforcement §6). This is not a new finding invented for this report — `capacity-resolver.ts`'s own header comment (§3, lines 776–807) names it explicitly, argues why the *new* resolver deliberately does not replicate it (a flat `CAPACITY_RUN_FLOOR_MI = 3.0` instead), and names the eventual fix as follow-up work. **The point for this report: that "live engine" divergence is still live today, in the exact files listed above, not just a historical footnote.**

### 3. Race contradiction (Constitution §15) — latent, not yet active

Race Prediction (`race-projection.ts`) still reads fitness purely from VDOT. Pace Prescription, for the one channel that's live, now reads fitness from `capacity-resolver.ts`. These are not yet provably different numbers for the owner today (VDOT itself is fed by `pace-corpus.ts`, which the new resolvers also consult as a fallback rung), but there is no shared source of truth enforcing that they stay in agreement as the two migrate at different speeds. This is exactly the "two owners can independently drift apart" shape Constitution §17 warns against, currently latent rather than confirmed-firing.

---

## Test / gate health, right now

Run today against the actual working tree (which, see below, is not just `aa065ed5` — a concurrent session has ~1,700 uncommitted lines in flight across exactly the files this report is auditing: `spec-builder.ts`, `recompute-paces.ts`, `reanchor-plan.ts`, `prescription-resolver.ts`, `adaptation-engine.ts`, `load-adaptation-engine.ts`, `progression-pass.ts`, `zone-anchors.ts`, `normal-window.ts`, plus a modified `reanchor-plan.test.ts`). That matters: the results below are a snapshot of an actively-changing repo, not necessarily what `aa065ed5` alone would produce, and they should be re-verified once that other session's work lands or is reverted.

**`npx vitest run` — full suite, two consecutive runs, same code, different results (itself a finding — see below):**

- Run 1: 381 test files (368 passed, 6 failed, 7 skipped) / 7841 tests (7782 passed, 49 failed, 10 skipped)
- Run 2: 381 test files (367 passed, 7 failed, 7 skipped) / 7841 tests (7780 passed, 51 failed, 10 skipped)

Failing test files (union of both runs):

- `lib/adaptation/_adaptation_engine.audit.test.ts`
- `lib/adaptation/_adaptation_engine.test.ts`
- `lib/audit/_anchor_derivation_scan.test.ts`
- `lib/audit/_generated_content_gate.test.ts`
- `lib/doctrine/_doctrine_gate.test.ts`
- `lib/evidence/_activity_evidence.audit.test.ts`
- `lib/plan/reanchor-plan.test.ts`

`reanchor-plan.test.ts` failed *differently* between the two runs — assertion mismatches in run 1, a `ReferenceError: tPaceFromVdot is not defined` in run 2 — which looks like a real reference error surfacing intermittently, not just noisy fixture data. **The suite gave two different answers on two consecutive runs of identical code.** Per CLAUDE.md's own Rule 18 standard, a gate that isn't stable run-to-run isn't trustworthy regardless of which run you'd rather believe.

**`npm run prebuild` — FAIL.** The 17-script chain gets through `check-palette-sync.sh`, `check-spacing-tokens.sh`, `check-modelled-mark.sh`, `check-coach-voice.sh` cleanly, then fails at **`check-doctrine.sh`**, on exactly four claims:

- `PACE.easy-band-off-threshold`
- `PACE.tempo-is-threshold`
- `PACE.marathon-offset`
- `PACE.interval-offset`

All four fail with "bound literal not found" — the doctrine gate's regexes (e.g. `const mp = tPaceSec + (\d+);`, `const interval = tPaceSec - (\d+);`) no longer match `lib/plan/spec-builder.ts`, because PRESCRIPTION-WIRE-1 rewrote those expressions to be conditional on the `anchors` argument (`anchors ? anchors.thresholdSecPerMi : tPaceSec`, etc.). The gate's own error message states the correct diagnosis: "The code this claim watches has been refactored. Re-point the claim at the new expression." **This is Rule 7/Rule 18 territory precisely** — a doctrine claim that used to watch real code now watches nothing, and the gate is doing exactly what it should (failing loudly) rather than reporting false-clean. The 13 scripts after `check-doctrine.sh` never ran, so their status is unknown.

**`npm run build` — FAIL**, but not from the Next.js compiler. `next build`'s own npm lifecycle runs `prebuild` first automatically; it fails on the identical `check-doctrine.sh` error above, and the build log contains zero occurrences of "next build," "Compiled," or "webpack" — the compiler itself never started. So this report cannot say whether `next build` would succeed on its own merits.

**Bottom line:** as of this report, `main`'s working tree cannot currently pass `prebuild` or `build`, for a well-understood and narrowly-scoped reason (four doctrine claims desynced from a refactor), compounded by the fact that a second, concurrent session's substantial in-flight edits to the same files make it unclear whether this is the state the other session intends to land, or a transient mid-edit condition. Either way, `aa065ed5`'s own commit message claim of "prebuild and next build green locally" cannot be reproduced against the current working tree, and whoever lands next on these files needs to re-run this chain before trusting that claim again.

---

## Genuine open risks worth an outside opinion

1. **The live pace-contradiction path (above, item 1) has no test.** This is the single most concrete, reproducible risk in this report — a plan's threshold pace can now legitimately differ depending on whether it was just authored or just recomputed, and nothing catches it. Worth an outside opinion on whether the right interim fix is "finish migrating `generate.ts` now" or "add a contradiction test that fails loudly until the migration completes" (the latter is cheaper and is exactly what Constitution §16 calls for).

2. **`goalRunFloorMiForUser`'s live goal-into-evidence leak (above, item 2)** is a real, currently-shipping violation of the single hardest rule in the whole doctrine set ("if the service cannot see the goal, it cannot accidentally train toward it"). It's self-disclosed in code, which is good, but self-disclosure isn't a fix, and per Rule 20 a documented-but-unfixed violation is still a violation.

3. **Coaching Thesis has zero implementation.** The Constitution calls it the layer that "should prevent the Plan Generator from behaving randomly," and names it explicitly as one of only two domains (with Adaptation) it worries about becoming a god object. Right now there's nothing there to become one — the risk is the opposite: with Runner Model, Pace Prescription and Adaptation all now real, partially-wired systems and no Coaching Thesis synthesizing "what currently matters" between them, whatever is filling that gap today is implicit and undocumented rather than a named owner.

4. **The Brain Constitution has no gate of its own.** It's the newest, most load-bearing doctrine document in the repo (locked today), and per its own companion document's Rule 20 standard — "a product rule with no gate is a hypothesis" — that's exactly what it currently is. No script in the 17-entry `prebuild` chain checks ownership boundaries, no-side-doors, or the §15 contradiction taxonomy. The four `check-doctrine.sh` failures found today are a different, narrower gate (physiological constants), not this one.

5. **Golden runners and historical replay, both named as required acceptance criteria for "the entire rework" (Doctrine Enforcement §39), don't exist.** The fitness-vector architecture is now three layers deep (capacity, prescription, adaptation) without either safety net. Worth an outside opinion on whether that's acceptable risk for a system this deep into "shadow mode until validated," or whether it should be a blocker before the next layer (wiring `generate.ts` onto the new resolvers) proceeds.

6. **Test-suite non-determinism (above).** Two consecutive runs of the same code produced different pass/fail counts, including a test that failed for two different reasons on two different runs. This predates and is independent of tonight's work, but it means every "green suite" claim anywhere in this codebase's history — including the one this report couldn't reproduce — needs to be read with that in mind going forward.

7. **This report's own coverage gap: Safety and UI were not audited to the same depth as the six domains touched by tonight's session.** Both are flagged rather than cleared. An outside reviewer with iOS/SwiftUI access could close that gap faster than continuing to expand this report's `lib/`-only lens.
