# `goal_realism` · what it means, why it flipped, and what was done about it

**Runner:** `0645f40c-951d-4ccc-b86e-9979cd26c795` · CIM marathon 2026-12-06 · stated goal 3:00:00
**Date:** 2026-09-02 · **Branch:** `docs/goal-realism-explained`
**Verdict: MISNAMED. The predicate is correct; the name was not. Renamed, gated, and the record made honest. The 3:00:00 goal is untouched, and nothing in the app has ever read this flag to alter it.**

---

## 0 · The short answer

`goal_realism.flag` never answered "is the goal realistic". It answered one much narrower question:

> Does the VDOT the typed goal time demands sit more than **15%** above the runner's currently-resolved threshold-capacity VDOT?

That is a typo-and-absurdity screen on a number the runner entered. It has **no runway input and no uncertainty input**. Remaining training time, the projection's confidence, the likely range, durability and race-day decay are all structurally absent from it.

It flipped from `true` to `false` because exactly one input moved: the canonical threshold capacity went from **44.1 to 47.8 VDOT**, which pushed the 15% edge from 50.715 up to 54.970, past the goal's 53.5. Nothing about the goal, the runway or the outlook changed.

So the objection is correct, and it is a naming defect rather than an arithmetic one. Two things were wrong and both are fixed:

1. **The name promised the whole question while the predicate answered a sliver of it.** Renamed to `goal_vdot_sanity.beyondSanityBand`, in the code, in `authored_state`, and at its only consumer.
2. **It was a second answer to a question the Constitution has already assigned an owner.** Goal Feasibility (`docs/BRAIN_CONSTITUTION.md` §L) belongs to `lib/race/race-outlook.ts` §7, and at the same instant, for the same runner, that owner returned `unlikely_currently` with a 19:42 gap. Both were arithmetically right. Only one had a name that told you which question it had answered.

---

## 1 · Where it is computed, and who owns it

**Computed at:** `web-v2/lib/plan/generate.ts` inside `composePlan`, at the block that resolves the stated goal against demonstrated capacity (formerly lines 9420-9465; now delegated to a resolver, see §7).

**Persisted at:** `web-v2/lib/plan/generate.ts` → `authored_state.goal_realism` (now `authored_state.goal_vdot_sanity`) on the `training_plans` row.

**Read at:** `web-v2/app/api/coach/read/route.ts` — one query, returning the value verbatim on the response as `goalRealism` (now `goalVdotSanity`).

**Read by any UI:** **nothing.** Grepped across `web-v2/app`, `web-v2/components` and `native-v2`: there is no fetch of `/api/coach/read` anywhere in the repo, and no surface decodes the field. The route's own comment already said so in 2026-08 ("composePlan has computed and persisted this since 2026-06 and NOTHING read it"). It is still true.

### Is that the right owner? No.

`docs/BRAIN_CONSTITUTION.md` §L:

> **L. Goal Feasibility.** Owns: how does the runner's goal compare with the current race outlook? Consumes Goal + Race Prediction. Result: COMFORTABLE / REALISTIC / AGGRESSIVE / UNLIKELY_CURRENTLY.

The implementation of §L is `web-v2/lib/race/race-outlook.ts` §7 ("feasibility (Goal Feasibility §L) — compare, never edit"), which consumes the projection, its likely range and expected race day. The Plan Generator computing its own boolean verdict about the same goal is a second answer to that row, which the Constitution says to reject on sight.

**There is a third.** `web-v2/lib/training/goal-assessment.ts` produces a seven-state `GoalFeasibility` (`comfortable` / `realistic` / `ambitious` / `aggressive` / `out-of-reach` / `unreadable` / `open-ended`), reached through `lib/plan/goal-gap.ts`. It does not mutate the goal — its own comment is explicit: *"The stated goal is never removed; the plan keeps training for it"* — but it is a third producer of a §L verdict. This is already recorded in `ownership-scorecard.md` row 17 and is out of scope for this change; it is named here so it is not rediscovered as new.

---

## 2 · The exact semantics, read out of the code

Inputs, and only these:

| Input | Source |
|---|---|
| `input.goalSec` | the runner's stated goal, in seconds |
| `input.raceDistanceMi` | 26.2188 for a marathon |
| `estimatedCurrentVdot` | `anchors.basis.threshold.vdot` — the **canonical threshold capacity's** derived VDOT (Constitution §C) |
| `anchorIsProvisional` | whether that capacity came from a self-report or a population prior rather than a measurement |

The predicate, verbatim as it stood:

```ts
const goalVdot = input.goalSec != null
  ? vdotFromRace(input.goalSec, input.raceDistanceMi)
  : null;

const realismFlag = (goalVdot != null && estimatedCurrentVdot != null)
  ? goalVdot > estimatedCurrentVdot * 1.15
  : (input.goalSec != null && currentPredicted != null && input.goalSec < currentPredicted);
```

with a three-state wrapper:

```ts
= (anchorIsProvisional || estimatedCurrentVdot == null)
  ? { flag: false, assessable: false, basis, ...(goalVdot != null ? { goalVdot } : {}) }
  : realismFlag
    ? { flag: true,  assessable: true, basis, ...(goalVdot != null ? { goalVdot } : {}), estimatedCurrentVdot }
    : { flag: false, assessable: true, basis, estimatedCurrentVdot };
```

**The threshold is `1.15`.** It was a bare literal in `generate.ts` with no constant, no doctrine citation and no registry claim. It is a screening tolerance someone chose; it is not derived from `Research/`. That is now said out loud rather than left to look derived (§7).

**The three states are real and correct.** `assessable: false` means "no measured fitness to screen against", which is neither true nor false, and that distinction was added deliberately in 2026-08 after a cold-start account was handed `{ flag: false }` — an affirmative-looking all-clear about a runner the engine had never seen take a step.

**The second branch matters and survives.** `vdotFromRace` returns `null` off the **top** of the Daniels table as well as off the bottom, so the most absurd goals produce a null `goalVdot`. Without the time comparison the screen would invert for exactly the inputs it exists to catch.

**What the boolean asserts, precisely:** `true` = the typed goal demands more than 1.15 × demonstrated threshold capacity. `false` = it does not. Nothing else.

---

## 3 · The true → false transition, with the arithmetic

Both records, and both were reproduced by composing against live production rows read-only on 2026-09-02.

**Constant across both:** `goalSec` = 10800 (3:00:00), `raceDistanceMi` = 26.2188.

```
vdotFromRace(10800, 26.2188)  raw = 53.5284  →  rounded  goalVdot = 53.5
```

### Input set A · the live plan, authored 2026-08-31 03:40 UTC

```
estimatedCurrentVdot = 44.1
edge  = 44.1 × 1.15                     = 50.715
flag  = 53.5 > 50.715                   = TRUE
bandExcess = 53.5 − 50.715              = +2.785 VDOT
Daniels equivalent of 44.1 at 26.2188mi = 3:31:48
```

Recorded: `{"flag":true,"basis":"measured_vdot","goalVdot":53.5,"assessable":true,"estimatedCurrentVdot":44.1}` — verified against the live `training_plans` row `pln_9a57561debb776e5`.

### Input set B · composing today, 2026-09-02

```
estimatedCurrentVdot = 47.8
edge  = 47.8 × 1.15                     = 54.970
flag  = 53.5 > 54.970                   = FALSE
bandExcess = 53.5 − 54.970              = −1.470 VDOT
Daniels equivalent of 47.8 at 26.2188mi = 3:18:01
```

Recorded: `{"flag":false,"assessable":true,"basis":"measured_vdot","estimatedCurrentVdot":47.8}` — reproduced exactly by composing his CIM block against live rows.

### The input that moved, verified rather than assumed

`estimatedCurrentVdot` is `anchors.basis.threshold.vdot`, the canonical threshold capacity. Between the two composes the capacity ownership layer landed (`e16bd636`, `a27b35a0`, `7b89ecf8`), replacing the older `bestRecentVdot` evidence ladder with one resolver over a weighted evidence corpus. The live plan row proves the move independently: its `pace_blend` carries

```
season_anchor_vdot: 47.7   season_anchor_source: measured_vdot
reanchored_at:      2026-09-02T05:55:06.673Z
reanchored_from:    canonical_prior
```

while `derived_from.bestRecentVdot` on the same row still reads `44.1`. The goal did not move (`goal_sec` 10800, `goal_pace_s_per_mi` 412, identical in both records). The runway did not enter the predicate at all. **One input moved, by +3.7 VDOT, and it carried the boolean across the edge.**

### A defect found while verifying this

`reanchor-plan.ts` rewrites `pace_blend.season_anchor_vdot` **in place** on the live plan and leaves `goal_realism` untouched. So the owner's live row currently holds two numbers for one quantity: `season_anchor_vdot: 47.7`, re-anchored today, beside `goal_realism.estimatedCurrentVdot: 44.1`, frozen at authoring. That is Rule 16 (one quantity, one name) and Rule 10 (a persisted derived value carries its anchor, or it is recomputed). The frozen one is what `/api/coach/read` was serving. Fixed in §7 by recomputing at read time from the live anchor on the same row.

### Why `goalVdot` is absent from today's record

It is not missing data. Look at the wrapper above: the **not-flagged branch omits `goalVdot` unconditionally**, while the flagged branch and the not-assessable branch both include it. The value was computed (53.5) and thrown away. The same absence therefore carried three different meanings depending on which branch produced the record — and `/api/coach/read` collapsed all of them to `goalVdot: null`, which reads as "off the Daniels table / unknown".

That is Rule 11 exactly: don't-know, measured-zero and dropped-on-the-floor are three facts, never one. Fixed: `goalVdot` and `anchorVdot` are now always present, and `null` means and only means "genuinely absent". Note the value was never actually lost from the plan — `pace_blend.goal_vdot` carries 53.5 on both records — which is itself a Rule 16 smell that two keys held the same quantity.

---

## 4 · Does `false` mean "currently demonstrated", "achievable by race day", or something else?

**Neither. It means "inside a fixed 15% VDOT band around demonstrated threshold capacity", and nothing more.**

### Remaining training time does not enter

`totalWeeks` is computed a few lines above the predicate and passed to `achievableRaceTarget`. It is **not** passed to this screen. A 3:00 goal 52 weeks out and the same goal two days out produce the identical answer. That is the finding: the flag cannot mean "achievable by race day", because it cannot see how much race day is left.

### Uncertainty does not enter

The threshold capacity's confidence, the projection's likely range and the durability blend are all absent. `1.15` is a fixed multiplier, not a confidence interval. The canonical Race Prediction owner produces a range and a confidence for this runner (`confidence 0.51`, range 3:17:43-3:29:57 today); none of it reaches this predicate.

### And the band is wider than anything the engine believes a build can deliver

This is the decisive point, and it is why `false` cannot quietly be read as "reachable":

```
band tolerance at anchor 47.8  = 47.8 × 0.15   = 7.170 VDOT
MAX_BLOCK_GAIN_VDOT                            = 5.000 VDOT
```

`MAX_BLOCK_GAIN_VDOT` (`lib/training/vdot-gain-rate.ts`) is the largest single-block fitness movement the engine will model, sized off `Research/01` §"Triggers to retest" (the only VDOT swing doctrine puts a number on). The gap the goal actually needs is **53.5 − 47.8 = 5.70 VDOT** — larger than a maximal block. So the engine's own gain model says the 3:00 goal is beyond one full build from here, at the same moment the sanity screen says the goal is inside the band. Those are not in conflict; they are answers to different questions, and only one of them was named as though it settled the matter.

### What the canonical owner says, at the same instant

Resolved live on 2026-09-02 through `resolveRaceOutlookBySlug(david, 'cim')`:

| Quantity | Value |
|---|---|
| Current projection (what he could race today) | **3:23:50**, likely range 3:17:43-3:29:57, confidence 0.51, basis `durability_blend` |
| Expected race day (trajectory through 10.6 build weeks) | **3:19:42**, likely range 3:13:28-3:26:51, confidence 0.30, projected VDOT 50.4 |
| Prescribed execution target | **3:13:30** (11610 s), 7:23/mi, source `stated_goal_clamped_to_range_edge` |
| **`goalFeasibility.status`** | **`unlikely_currently`** |
| Gap to expected | 1182 s = **19:42** |
| Gap to the fast edge of the range | 808 s = **13:28** |

Its own sentence, live on the block: *"Your goal (3:00:00) is faster than the likely range's fast edge (3:13:28) · race to the edge; the goal stays yours."*

**That is the honest answer to "is my goal realistic", and it is already computed, already canonical, and already says what the objection said it should.** The incoherence was one boolean under a borrowed name sitting next to it.

---

## 5 · Rule 9 · the cliff, measured

The screen is a hard threshold on a continuous quantity, so it was walked.

```
crossing point:  estimatedCurrentVdot = goalVdot / 1.15 = 53.5 / 1.15 = 46.5217

 anchor 46.52  →  beyond = TRUE    marathon equivalent 3:22:34
 anchor 46.53  →  beyond = FALSE   marathon equivalent 3:22:32
```

**Two seconds of demonstrated marathon capacity flip the boolean.** He currently sits 1.278 VDOT above the edge, which is comfortably clear, but the shape is the Rule 9 signature: a categorical output hinging on a hair.

And the tolerance the edge represents, in the unit he actually reads:

```
at the crossing point, current fitness predicts    3:22:33
the goal is                                        3:00:00
tolerated gap at the band edge                     22:33
```

A boolean named "goal realism" that reads `false` while tolerating a twenty-two-and-a-half-minute marathon gap is the defect, stated in one line. It is also the reason the boolean is not the right shape for this question at all: `unlikely_currently` versus `aggressive` versus `realistic` is a four-state answer, and a step function at 1.15 cannot express it.

**Mitigation shipped rather than smoothed.** The cliff is not removed by relocating the threshold — the screen genuinely is discrete, and the graded answer already exists at the canonical owner. What changed is that the **continuous quantity the boolean steps on is now published beside it** (`bandExcessVdot = goalVdot − anchorVdot × band`, monotone by construction, −1.470 for him today), so any consumer can grade instead of reading a step, and the gate walks it in 0.1 VDOT increments and asserts monotonicity and sign agreement.

---

## 6 · Does anything use this flag to alter, renegotiate or downgrade the goal?

**No.** Verified three ways:

1. **Grep.** `goal_realism` / `goalRealism` had exactly two live sites: the write in `generate.ts` and the pass-through read in `/api/coach/read`. `realismFlag` and `goalRealism` are referenced nowhere else inside `generate.ts` except at their own definition and the persist.
2. **No consumer at all.** There is no fetch of `/api/coach/read` in `web-v2/app`, `web-v2/components` or `native-v2`. The field reached no screen.
3. **A gate, now.** `_goal_vdot_sanity_gate.test.ts` guard 4 scans every `.ts`/`.tsx` under `lib`, `app`, `components` and `scripts` for any file that both reads the screen and writes a goal, with liveness assertions on both halves of the conjunction so it cannot pass vacuously. It is green, and `scripts/check-goal-immutability.sh` continues to hold the wider rule.

The stated goal is untouched by this change and by everything around it: `goal_sec` 10800 and `goal_pace_s_per_mi` 412 are identical before and after, and today's compose writes the same values.

---

## 7 · What changed

His ruling was: *"If the flag answers a narrower question than its name implies, rename it. If it is wrong, fix it."* The predicate is not wrong. The name was, and so was the record's honesty. Both are fixed.

**New · `web-v2/lib/plan/goal-vdot-sanity.ts`** — one resolver for this narrow question, with a header that states what it structurally cannot see (runway, uncertainty, durability), names `lib/race/race-outlook.ts` §7 as the canonical owner of the wider question, and says out loud that `1.15` is a screening tolerance rather than a doctrine number. Exports:

- `GOAL_VDOT_SANITY_BAND = 1.15` — one constant, greppable, with the `MAX_BLOCK_GAIN_VDOT` comparison written into its doc comment and asserted in the gate rather than trusted.
- `assessGoalVdotSanity(...)` → `{ beyondSanityBand, assessable, basis, goalVdot, anchorVdot, bandExcessVdot, band }`.
- `goalVdotSanityFromLegacyRecord(...)` — reads the old shape forward for already-authored plans, and returns `null` rather than inventing a verdict when the record predates `assessable`.

**Renamed** — `authored_state.goal_realism` → **`authored_state.goal_vdot_sanity`**; the field `flag` → **`beyondSanityBand`**; `estimatedCurrentVdot` → **`anchorVdot`**; the API response field `goalRealism` → **`goalVdotSanity`**. Every call site moved: `lib/plan/generate.ts`, `app/api/coach/read/route.ts`, `lib/plan/_coldstart_doctrine.test.ts`, `lib/plan/_probe_cim_block.test.ts`, `lib/plan/_probe_race_pace.test.ts`, `scripts/p0-proof/after-plan-snapshot.ts`.

**Rule 11 fixed** — `goalVdot` and `anchorVdot` are now always present on the struct. `null` means genuinely absent (off the Daniels table; no measured anchor), never "we dropped it".

**Rule 10 fixed at the read** — `/api/coach/read` no longer serves the frozen boolean. It recomputes from `pace_blend.season_anchor_vdot` and `pace_blend.goal_vdot` on the same row (both kept current by `reanchor-plan.ts`), and declares which posture produced the answer via `anchorFreshness: 'recomputed' | 'frozen_at_authoring'`. The legacy `goal_realism` key is still read as the back-compat fallback for plans authored before today, with an allowlist entry that fails once no unarchived row carries it.

**Rule 9 mitigated** — `bandExcessVdot` publishes the continuous quantity beside the step.

**Behaviour deliberately unchanged:** the predicate, the 1.15 band, the three-state `assessable` contract and the GOAL-3 direction awareness are all identical. Nothing about the prescribed plan, the paces, the race target or the goal moves.

---

## 8 · The gates, and their falsification

Two, in the repo's existing pattern.

**`web-v2/lib/plan/_goal_vdot_sanity_gate.test.ts`** — eight guards plus a liveness probe. It declares its own blind spots in the header per Rule 22: it cannot tell whether 1.15 is the *right* band, it cannot see a rendered surface, and it cannot spot a new third owner invented under a name it does not know.

**`scripts/check-goal-sanity-naming.sh`** — wired into `web-v2` `prebuild`, so it blocks a Railway deploy. Guard 1 is pure grep and runs on a cold container with no toolchain; guard 2 demands the real `describe`/`it` text so it cannot be satisfied by a comment; guard 3 runs the full vitest gate. Also available as `npm run test:goalsanity`.

### Falsification output (Rule 18) · the vitest gate

Every failure below was produced by breaking the real thing on purpose, then restored.

```
############ F1 · reintroduce the retired identifier in a non-allowlisted file
     × guard 1 · no source outside the argued allowlist mentions goal_realism / goalRealism
AssertionError: retired identifier still present in:
  lib/plan/adapt.ts: expected [ 'lib/plan/adapt.ts' ] to deeply equal []
      Tests  1 failed | 9 passed (10)

############ F1b · a stale allowlist entry (target now clean)
     × guard 1b · every allowlist entry is still needed (ratchet)
AssertionError: delete these allowlist entries:
  lib/plan/adapt.ts (now clean): expected [ 'lib/plan/adapt.ts (now clean)' ] to deeply equal []
      Tests  1 failed | 9 passed (10)

############ F2+F5 · restore the OLD struct shape ('flag', goalVdot dropped when inside the band)
     × guard 2 · the persisted struct carries no field named for a verdict it cannot reach
     × guard 5 · Rule 11 · goalVdot and anchorVdot are always present, null only when genuinely absent
     × guard 6 · the predicate is the band, and the arithmetic is monotone across it
     × guard 7 · off-the-top goals stay flagged (GOAL-3 direction awareness survives)
AssertionError: field "flag" is back: expected true to be false
      Tests  4 failed | 6 passed (10)

############ F3 · narrow the band to 1.02 so 'inside' would imply reachable
     × guard 3 · the band is WIDER than the largest gain the engine models
AssertionError: expected 0.9560000000000031 to be greater than 5
      Tests  3 failed | 7 passed (10)

############ F7 · delete GOAL-3 direction awareness (off-the-top goals stop being flagged)
     × guard 7 · off-the-top goals stay flagged (GOAL-3 direction awareness survives)
AssertionError: expected false to be true
      Tests  1 failed | 9 passed (10)

############ RESTORED · gate green again
      Tests  10 passed (10)
```

### Falsification output · the prebuild script

```
############ S1 · resolver loses an exported seam
  FAIL · resolver lost 'export const GOAL_VDOT_SANITY_BAND'

############ S1b · the retired identifier reappears outside the allowlist
  FAIL · retired identifier present outside the argued allowlist:
    .../web-v2/lib/plan/adapt.ts

############ S1c · resolver stops naming the canonical feasibility owner
  FAIL · resolver no longer names Goal Feasibility's canonical owner
  EXIT:1

############ S2 · the vitest gate is deleted
  FAIL · gate missing: .../lib/plan/_goal_vdot_sanity_gate.test.ts · this check cannot be satisfied by deleting it

############ S2b · the gate keeps its name but loses its liveness probe
  FAIL · gate lost its liveness probe · a scanner that reads nothing reports clean
  EXIT:1

############ RESTORED
  ok · Tests  10 passed
PASS   EXIT:0
```

Falsifying S1b also caught a real bug in the gate itself: an unquoted shell expansion word-split the offending filename into three lines, because this repo lives under a path with spaces. Fixed and re-falsified.

**Regression:** `npx tsc --noEmit` clean; `lib/plan`, `lib/race`, `lib/training`, `lib/doctrine` — 249 files, 4307 tests, all passing.

---

## 9 · What is still open

1. **`1.15` has no doctrine claim.** It is honestly labelled a screening tolerance now, and the gate holds it wider than `MAX_BLOCK_GAIN_VDOT` so it cannot be misread as reachability. It is not registry-bound, because there is no `Research/` passage to bind it to. If it should be doctrine, it needs a source; if it should not, it stays a screen.
2. **Three producers of a §L verdict remain** — `race-outlook.ts` §7 (canonical), `goal-assessment.ts` (seven-state, reached via `goal-gap.ts`), and this screen (now honestly named as *not* a feasibility verdict). Reducing three to one is a Constitution §L consolidation, already logged as `ownership-scorecard.md` row 17.
3. **`/api/coach/read` has no consumer.** The whole route is unread by any surface. If it stays, one of its blocks should be the canonical `goalFeasibility` rather than this screen; if it goes, deleting it removes a stale second answer for free. Per the Constitution's own "prefer deletion before addition", that is worth a decision.
4. **The live plan row still carries the old key.** Nothing renders it, and the read path handles both, so no backfill is needed. The allowlist entry for the legacy read is a ratchet: it fails once no unarchived `training_plans` row carries `goal_realism`.

---

## 10 · The sentence to take away

The system already supports training toward 3:00 without pretending the capacity exists today, and it always did: the block is priced at demonstrated fitness, the prescribed execution target is 3:13:30 clamped to the honest range edge, the stated goal stays at 3:00:00 and untouched, and the canonical feasibility owner says `unlikely_currently` in as many words. What was missing was that one boolean, computing a narrow screen, wore a name that made it sound like the verdict. It no longer does.
