# F139 — priority never weights evidence: implementation report

**Date:** 2026-09-15
**Status:** Implemented, verified, uncommitted (per instructions — a separate process commits and submits this).
**Ruling implemented:** `for coaching consult/consult-log/2026-09-15-035-f139-priority-evidence-weighting.md`
**Doctrine:** `docs/RACE_TIERING_AND_SEASON_PHILOSOPHY.md` §"Planning cost and evidence value are separate" — *"An A race can produce weak or non-representative evidence. A C race can produce strong evidence. Priority alone must never accept, reject, or weight the result."*

This report is written so a reviewer does not need to re-derive the reasoning from the diff. Read the **"Read this first"** section, then use the per-file sections as reference.

---

## Read this first — the three things that matter most

1. **The core fix is small and mechanical**: four call sites stopped reading `selectionAuthority(priority)` as an evidence weight, and one call site (`representativeness.ts`'s downward limb) stopped defaulting its effort-class baseline to the declared priority. `effort-authority.ts` itself is untouched, exactly as instructed.

2. **The design had to answer one hard question that the initial brief underestimated**: with priority removed, what replaces it as the "default" when no runner report exists? Two candidate answers were tried, in order, and the second is what shipped:
   - **Two-bucket** (runner report only; a bare `'representative'` report treated as inert, same as no report). This satisfied Rule 11 but made it *structurally impossible* for any VDOT/LTHR candidate to ever reach `REPRESENTATIVE_FLOOR`, which silently broke three downstream mechanisms that key off that floor (see §"The central disclosed consequence" below) and — critically — conflicted with a **pre-existing test already in this branch** (`lib/training/lthr-reanchor.test.ts`, not written by this change) that explicitly expected a `'representative'` report to be a working confirmation lever.
   - **Three-bucket** (shipped): a runner-reported `'representative'` grades at *exactly* `REPRESENTATIVE_FLOOR` — a genuine measured confirmation, never a promotion above it, and never priority-derived. This restored the pre-existing test's behaviour, restores real (if rare) recoverability for the three dormant mechanisms, and is still fully doctrine-compliant: it is a *measured self-report*, not priority, and it cannot lift a race above the minimum "counts as evidence" bar.

3. **The single largest real-world consequence**: because a runner's confirmation is a rare, opt-in, retroactive flag, and none of the four fixed sites has an *automatic* per-race representativeness signal wired in (unlike `durability-anchor.ts`, which already has one via `assessRaceRepresentativeness`), **most races will now grade as `unrepresentative` by default** where they used to grade `representative` off declared priority alone. This is disclosed exhaustively below, per site, with exact mechanisms named and real test fixtures (including production data) demonstrating it.

---

## The concrete fix, per file

### 1. `web-v2/lib/race/effort-authority.ts` — untouched

Per instructions. `selectionAuthority`/`authorityTier`/`RECOVERY_EFFORT_SCALE`/`RUNNER_REPORTED_AUTHORITY_CAP` are unchanged in signature and behaviour. They remain correct for the planning-cost question they answer (recovery-duration pricing) and are no longer read for evidence-weighting anywhere.

**Disclosed, out-of-scope finding**: after this fix, `selectionAuthority` has **no remaining production caller for a genuine planning-cost purpose** — the actual planning-cost table (`RECOVERY_EFFORT_SCALE`/`recoveryEffortScale`) lives in `lib/plan/goal-tiers.ts` and is called directly by `postRaceRecoveryWeeks`, never through `selectionAuthority`. The only remaining call site of `selectionAuthority(` in the live (non-test, non-doctrine-registry) codebase is:

- **`web-v2/app/api/v5/races/route.ts:247`**, `raceRowAuthority()` — computes an `authority_tier` badge shown to the runner on their race schedule ("representative"/"compromised"/etc.), using `authorityTier(selectionAuthority(priority))` as the base, capped downward by the runner's own report. **This is the same priority-as-evidence-weight violation, in a fifth, previously undiscovered location.** It was not in this task's named scope (4 files + `representativeness.ts` + the registry), it does not feed pace prescription (it is a display badge), and I did not touch it — flagging it here for a follow-up finding rather than silently fixing or silently ignoring it.

### 2. `web-v2/lib/training/vdot.ts` — `bestRecentVdot`

**Before:** `const declaredAuthority = selectionAuthority(r.priority); const authority = (reported && reported !== 'representative') ? Math.min(declaredAuthority, RUNNER_REPORTED_AUTHORITY_CAP[reported]) : declaredAuthority;`

**After:**
```ts
const reported = r.runner_authority_tier ?? null;
const authority =
  (reported === 'compromised' || reported === 'unrepresentative') ? RUNNER_REPORTED_AUTHORITY_CAP[reported]
  : reported === 'representative' ? REPRESENTATIVE_FLOOR
  : RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative;
```
Priority (`r.priority`) is no longer read at all for this purpose (it is still stored on the candidate for display). `runner_authority_tier` — the runner's own retroactive "did this race count?" answer — is the only measured signal.

**Disclosed consequence (the central one)**: `REPRESENTATIVE_FLOOR` (0.65) sits above both `RUNNER_REPORTED_AUTHORITY_CAP.compromised` (0.35) and `.unrepresentative` (0.175). The only way to reach it is an explicit `'representative'` report. Since that report is a rare, opt-in, retroactive flag, in practice **no race reaches `REPRESENTATIVE_FLOOR` unless the runner has proactively confirmed it** — where before, a bare declared A or B priority reached it automatically. This makes three mechanisms **dormant for the common case** (all three key off `REPRESENTATIVE_FLOOR`, all three fire correctly once a runner confirms a race, none of them were touched in shape — only what feeds `authority` changed):

1. **`authorityDemoted`** (the candidate-sort demotion): requires a *better-graded race in the same pool* to demote against. Absent any confirmed race, it never fires, and ranking reverts to raw VDOT value. **This is the doctrine-correct outcome, not a regression** — see the reframe below.
2. **`bestRaceRaw`** (the AUDIT #8 training-read ceiling's race-based fallback): excludes every race with `authority < REPRESENTATIVE_FLOOR`. Absent a confirmation, every race is excluded, so this fallback is dormant. The **primary** ceiling mechanism — the training-corpus-based one (`corpusRead.ok`) — is completely unaffected and still bounds training reads once enough qualifying runs corroborate each other (verified directly, see Test results). The gap is specifically: *when the corpus cannot yet corroborate itself* (a new user's first ~2 weeks, or an established runner returning from a break with too few recent qualifying runs) *and* the runner has an unconfirmed race in scope, training reads are now uncapped rather than bounded to race + 1.0.
3. **`representativeRaceDates`** (the same-day identity guard, stopping a race leading itself by +1 through its own re-ingested GPS row): also requires `authority >= REPRESENTATIVE_FLOOR`. Belt-and-braces in production (`loadVdotInputs` already excludes race-day runs at the loader), so this is a real but low-severity dormancy.

**Why this is not a dangerous regression, on reflection**: my first instinct was that "a faster, jogged C race can now outrank a slower A-priority PR" was a reopened safety hazard (this exact scenario, `vdot-race-authority.test.ts`'s Sombrero/AFC fixture, was the original justification for the whole authority-demotion mechanism). On closer reading, **the doctrine's own worked example is precisely this scenario, decided the other way**: *"An A race can produce weak or non-representative evidence. A C race can produce strong evidence."* The old test's premise — a C-priority result must never outrank an A-priority one on raw evidence — **was itself an instance of the violation being fixed**, not a genuine safety net; it inferred "not real evidence" from a scheduling label. Removing it is the correct application of the ruling. This reframe is documented at length in `vdot-race-authority.test.ts`'s new header and is the load-bearing conceptual point of this whole change.

**Genuine, narrower safety-relevant finding, still worth flagging**: `vdot-slow-runner-floor.test.ts`'s below-table anchor selection (which sets T-pace for runners below the Daniels VDOT-30 floor — often beginners) had a test asserting a *slower* A-priority race beats a *faster* jogged C-priority one specifically because a faster prescribed pace is the less-safe direction for that population. That test now fails for the same doctrine-correct reason (see below) — the pace prescribed can now be faster, absent measured signal, for exactly the population with the least margin. I did **not** invent a new tie-break rule to compensate (that would be scope creep — the existing tie-break, "faster pace wins," is pre-existing code untouched by F139); I disclosed it as a distinct, named consequence in the rewritten test and here.

**Registry check added**: `EVIDENCE.priority-never-weights-evidence` source-greps `vdot.ts` (comments stripped) for `selectionAuthority(` and fails the build if reintroduced.

### 3. `web-v2/lib/training/durability-anchor.ts` — `loadRaceObservationsForDurability` / `applyRepresentativeness`

**Before:** `let weight = selectionAuthority(priority); const cap = runnerAuthorityCap(ar); if (cap != null) weight = Math.min(weight, cap);` — then `applyRepresentativeness` multiplied that priority-derived `weight` by the measured `read.authority` when the assessor succeeded, or left it unchanged (still priority-derived) when the assessor failed.

**After:**
```ts
const cap = runnerAuthorityCap(ar);
const weight = cap != null ? cap : 1;
out.push({ ..., weight, hasRunnerReport: cap != null, representativenessReason: 'NOT_ASSESSED' });
```
and, in `applyRepresentativeness`'s assessor-failure branch:
```ts
if (!read) {
  out.push({ ..., weight: o.hasRunnerReport ? o.weight : 0, representativeness: null, representativenessReason: 'ASSESSOR_UNAVAILABLE' });
  continue;
}
```
Base weight is now `1` (full) unless the runner's own downward report caps it (unchanged mechanism, kept exactly). When the automatic representativeness assessor (`assessRaceRepresentativeness`) succeeds, it multiplies that base by its own measured `read.authority` — **this is the file that already had a real, automatic, per-race measured signal, and this fix does not touch that part**. When the assessor *cannot* read the race row and no runner report exists either, there is now genuinely no measured signal, and the observation's weight goes to exactly `0`, which is picked up by `fitRaceExponent`'s **pre-existing** `usable` filter (`o.weight > 0`) — no new exclusion mechanism was added; this reuses the filter that was already there.

**Why this file's disclosure is much narrower than `vdot.ts`'s**: `assessRaceRepresentativeness` runs automatically from race data (splits, weather, taper state) — it does **not** require the runner to do anything. So most races will still be genuinely, automatically measured here. The disclosed gap is specifically: a race the assessor *cannot* read (a real but presumably rare failure mode) and that also has no runner report is now excluded from the fit entirely, where it used to fall back to a priority-scaled weight.

**Belief-source-pin (shadow evidence) consequence**: this file is one of eight pinned "belief sources" the Adaptation Engine's shadow-comparison log keys on (`lib/adaptation/shadow-evidence-epoch.ts`, `_belief_source_pins.test.ts`). Because this change genuinely moves what the durability exponent (and the marathon anchor) resolve to for the *same* real race history (an unflagged C-priority race now weighs the same as an unflagged A-priority one; an unassessable-and-unreported race now contributes zero instead of a priority-scaled weight), this is **branch (a)** of that file's own decision rule ("the change moves what a belief resolves to"), not branch (b) (cosmetic/refactor). I bumped `SHADOW_EVIDENCE_EPOCH` from `2026-09-02.runner-owns-readiness` to `2026-09-15.priority-never-weights-evidence`, re-pinned `durability-anchor.ts`'s digest (`eaa8fc67ec470f0e`), and wrote a full `why` and a new `EPOCH HISTORY` entry explaining the branch-(a) reasoning. This is a real judgement call a reviewer should independently sanity-check; I made it explicitly rather than by omission, per that file's own stated purpose.

**Registry check added**: same `EVIDENCE.priority-never-weights-evidence` claim source-greps `durability-anchor.ts` for `selectionAuthority(` (comments stripped) and additionally checks `RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative` presence is unaffected here (that specific sub-check targets `vdot.ts`/`lthr-reanchor.ts` only, since this file's default is `1`, not that constant — see the check's source for the exact scoping).

### 4. `web-v2/lib/training/lthr-reanchor.ts` — `selectLthrAnchor`

**Before:** `const declared = selectionAuthority(c.priority); const authority = (reported && reported !== 'representative') ? Math.min(declared, RUNNER_REPORTED_AUTHORITY_CAP[reported]) : declared; const tier = authorityTier(authority); if (tier !== 'representative') continue;`

**After:** same three-way read as `vdot.ts`:
```ts
const reported = c.runnerAuthorityTier ?? null;
const authority =
  (reported === 'compromised' || reported === 'unrepresentative') ? RUNNER_REPORTED_AUTHORITY_CAP[reported]
  : reported === 'representative' ? REPRESENTATIVE_FLOOR
  : RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative;
const tier = authorityTier(authority);
if (tier !== 'representative') continue;
```
Only the input to `tier` changed; the gating logic (`continue` when non-representative) is untouched, exactly as instructed.

**Disclosed consequence — the largest single functional impact of this whole change**: `selectLthrAnchor` has **no automatic per-race representativeness signal at all** (unlike `durability-anchor.ts`). The *only* measured input is the runner's report. Since that is rare and opt-in, **`selectLthrAnchor` now returns `null` for the overwhelming majority of real candidates** — every race the runner has not proactively confirmed — where before, a bare declared A/B priority was sufficient. **LTHR re-anchoring is effectively dormant** for anyone who has never tapped "yes, it counted" on a qualifying half.

This is demonstrated directly and concretely on real production data: `lib/training/lthr-reanchor.test.ts` (a pre-existing file documenting a real historical incident — David's LTHR anchor stuck at 162 for three months while two qualifying halves went unread) has its own fixture, `DAVID_RACES`, built from verbatim production rows with **no runner report on any race**. Before this fix, `selectLthrAnchor(DAVID_RACES, TODAY)` correctly picked Americas Finest City and returned `168`. After this fix, it returns `null`. **The exact historical bug this file was built to catch would, under today's doctrine-correct code, require David to explicitly confirm the race via `POST /api/v5/race-authority` before the automatic fix could reach him** — it is no longer a fully automatic re-derivation off ordinary race data. This is asserted as the first test in that file's `selectLthrAnchor` block, with a Rule-18 falsifier immediately after it proving the `null` is new, deliberate behaviour.

I did not invent a workaround for this (e.g., wiring `assessRaceRepresentativeness` into LTHR selection) — that is real, non-trivial engineering work (an async, DB-querying function would need to be threaded into what is otherwise a synchronous selection function used across many callers) explicitly out of scope for "stop reading priority as an evidence weight." I recommend it as the concrete, named follow-up.

**Registry check added**: same claim, source-greps `lthr-reanchor.ts` for `selectionAuthority(` and confirms `RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative` is still the no-report default.

### 5. `web-v2/lib/evidence/classify-evidence.ts` — `classifyRace`

**Before:** `const authority = selectionAuthority(input.matchedRace.priority); const tier = authorityTier(authority); const controlledEffort = tier === 'representative' ? absent(...) : present(...);`

**After:** `controlledEffort` is now **unconditionally `present(...)`** for every matched race, with a detail string naming why.

**This is the cleanest, most complete "no measured signal reaches this function at all" case in the whole fix** — verified by reading `loadMatchedRace`'s actual SQL query (`SELECT slug, meta FROM races ...`): it never reads `actual_result` (where the runner's report lives) and never calls any representativeness assessor. There is **no code path today** by which any measured effort-class signal could reach `classifyRace`, for any race, ever. So the honest, Rule-11-correct behaviour is exactly what shipped: every matched race reads as a controlled effort (not confirmed clean evidence) until either a runner-report read or a representativeness-assessment read is wired into this classifier's inputs. This is disclosed in the code comments, the doc comment on the `controlledEffort` field, and the rewritten test.

**Registry check added**: source-greps `classify-evidence.ts` for `authorityTier(` (its presence with no measured input would itself be evidence of a reintroduced violation, since there is nothing legitimate for this file to feed it).

### 6. `web-v2/lib/race/representativeness.ts` — `effectiveEffortClass` / `assessRepresentativeness`'s downward limb

**`effectiveEffortClass`, before:**
```ts
const declared = String(state?.priority ?? 'A').trim().toUpperCase();
const base: RacePriority = declared === 'B' || declared === 'C' ? (declared as RacePriority) : 'A';
```
**After:**
```ts
const base: RacePriority = 'A';
```
The baseline no longer reads `state.priority` at all. It is always fully representative unless a REAL measured signal (`OVERREACH`, a severe niggle, a `LOADED` form band, or a measured taper shortfall) steps it down — exactly mirroring the upward limb's own multiplier-of-1-unless-a-real-detractor shape, which was already correct.

**`assessRepresentativeness`'s `classMultiplier`, before:** `direction === 'upward' ? 1 : recoveryEffortScale(cls)` (i.e., the downward limb was *always* charged the effort-class scale, using a `cls` that defaulted to the declared priority absent any real signal).

**After:** `direction === 'upward' || downgradedBy == null ? 1 : recoveryEffortScale(cls)` — the downward limb now also defaults to `1` (no charge) whenever no real signal fired, and only applies `recoveryEffortScale(cls)` when `downgradedBy != null` (a real signal actually stepped `cls` down). This is the module's own explicit doctrine violation named in the consult ruling ("priority IS the default weight whenever no fatigue/taper signal fires, which is the common case, not a rare edge") — fixed at its root.

**This also retires the pre-existing ungraded-priority inconsistency** the consult ruling flagged (this function defaulted an ungraded declaration to `'A'`, while `selectionAuthority` elsewhere defaults ungraded to `'C'` — two different, uncoordinated conventions for the same word "ungraded"). Since priority no longer sets a baseline here at all, there is no ungraded-default left to disagree with anything.

**Doctrine registry**: two checks were affected here beyond the two named claims:
- `REPRESENTATIVENESS.effort-class-authority` — a **pre-existing, third claim** (not named in the original task scope) that also exercises `effectiveEffortClass` directly. Verified it still passes unmodified: none of its assertions depend on the declared-priority-driven stepping behaviour this fix changed (its OVERREACH assertions were already priority-independent).
- `REPRESENTATIVENESS.both-directions-are-diagnosed` — a **pre-existing, fourth claim**, whose `check()` contained a hand-built `slowC` scenario asserting `assessRepresentativeness({state:{priority:'C'}}).authority < 1` purely from the declared priority. This directly encoded the exact violation being fixed and **failed** once the fix landed. Rewrote it in place: renamed to `slowDeclaredCOnly` asserting `authority === 1` (no measured signal, no discount) and added `slowOverreached` asserting a *real* OVERREACH signal still discounts to the doctrine floor. Updated the claim's prose to name this explicitly (see the registry diff).

---

## The doctrine registry rewrite (`web-v2/lib/doctrine/registry.ts`)

- **`EVIDENCE.race-authority-is-the-effort-class` → renamed `EVIDENCE.priority-never-weights-evidence`.** The old claim asserted and tested the *opposite* invariant (that priority-derived authority is correctly "spent" in the candidate sort). The new claim states the doctrine-correct rule and its `check()`:
  - Re-verifies `selectionAuthority`'s own internal numbers (A=1.0, ordering, tier placement, case-insensitivity) — these are unchanged and still matter for whatever legitimate planning-cost caller reads them.
  - **Source-greps `vdot.ts`, `durability-anchor.ts`, `lthr-reanchor.ts`, `classify-evidence.ts` (comments stripped) for `selectionAuthority(` and fails the build if any of them call it again.**
  - Confirms `vdot.ts`/`lthr-reanchor.ts` still default an unmeasured race to `RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative`, never full trust.
  - Confirms the candidate-sort demotion mechanism and the "no VDOT scaled by authority" invariant are still wired (unchanged checks, preserved).
  - Confirms the old `IN ('A','B')` SQL filter has not returned to `vdot-inputs.ts`.
  - Confirms `classify-evidence.ts` no longer calls `authorityTier(`.
  - Extracts `effectiveEffortClass`'s function body (regex-isolated up to the next `export function`) and confirms it does not reference `state.priority`, that its baseline is the literal `const base: RacePriority = 'A';`, and that `classMultiplier` in `representativeness.ts` requires `downgradedBy == null` before defaulting to `1`.
  - Cites `docs/RACE_TIERING_AND_SEASON_PHILOSOPHY.md`, anchor `"Priority alone must never accept, reject, or weight the result."` (verbatim, line 129).

- **`CONVENTION.ungraded-race-priority` — kept, unchanged mechanically**, since it validates `selectionAuthority`'s own internal ungraded-row convention, which was never touched. Reworded the surrounding prose to make explicit that `selectionAuthority` is now reserved for planning-cost use only, and that the word "AUTHORITY" in its own claim text (written before this vocabulary distinction existed) should be read as "the planning-cost-reserved number," never "evidentiary authority."

- **A required, un-scoped supporting change**: `docs/RACE_TIERING_AND_SEASON_PHILOSOPHY.md` is **not tracked in this repository's git history at all** (confirmed via `git log --all -- docs/RACE_TIERING_AND_SEASON_PHILOSOPHY.md`, empty). It exists as an uncommitted working file in the main repo checkout (`/Volumes/WP/06 Claude Code/Runcino/docs/RACE_TIERING_AND_SEASON_PHILOSOPHY.md`), which my isolated worktree does not share. I copied it byte-for-byte into my worktree at the same repo-relative path so the doctrine gate's citation-resolution (`scripts/check-doctrine.sh`, which greps the literal file on disk) can find it. **Whoever commits this work must ensure this doc file is committed too** (or confirm it already lands via another path before this merges) — otherwise the doctrine gate will hard-fail on the next clean checkout with "cited file does not exist."

**`bash scripts/check-doctrine.sh` run**: passes clean. `doctrine OK · 350 citations resolve against Research/` — 14 pre-existing, independently-documented, exempted violations print as informational output (unrelated to this change; same count before and after). 718 doctrine-gate tests pass (0 failures).

---

## Test results

### Files rewritten (per the task's own enumeration, all handled)

| File | Result |
|---|---|
| `lib/training/vdot-race-authority.test.ts` | Substantially rewritten (477 → ~340 lines). 20/20 pass. |
| `lib/training/_race_authority_durability.test.ts` | Rewritten in place. 9/9 pass. |
| `lib/fitness/_fitness_model.test.ts` | Fixture-only comment update (unaffected mechanically, as anticipated — it bypasses `bestRecentVdot`'s selection logic entirely). 45/45 pass. |
| `lib/training/vdot-selection-order.test.ts` | Rewritten in place, `priority:'C'` fixture and 4 others. 18/18 pass. |
| `lib/training/_durability_anchor.test.ts` | Rewrote the "QUALITY — A-priority instead of C" test and its neighbour; added a same-priority-different-weight falsifier. 29/29 pass. |
| `lib/evidence/_classify_evidence.test.ts` | Rewrote the A-priority assertion; added a Rule-18 falsifier. 27/27 pass. |
| `lib/race/_controlled_c_effort.test.ts` | **Not touched**, per instructions (different, legitimate feature). |
| `lib/training/lthr-reanchor.ts` test coverage | **A pre-existing, comprehensive test file (`lib/training/lthr-reanchor.test.ts`) already existed in this branch** — the task's premise ("no existing test file") was based on `origin/main`, which this branch has diverged from substantially. See below. |

### `lib/training/lthr-reanchor.test.ts` — pre-existing file, extensively reconciled

This file did not exist on the base the task's investigation used, but exists in the actual branch this work was done on and documents a real historical incident (David's stale LTHR anchor). 10 of its ~24 tests broke initially. Resolved by:
- Adding a header note disclosing that its central fixture (`DAVID_RACES`, verbatim production data, no runner reports) now returns `null` from `selectLthrAnchor` — the concrete, named consequence above.
- Adding a `DAVID_RACES_CONFIRMED` variant (AFC explicitly runner-confirmed) so the remaining tests — which are about `selectLthrAnchor`'s *other* gates (distance, cadence) and `decideLthrReanchor`'s downstream write/hold/stale logic and the HR-zone "blast radius" — keep exercising realistic, qualifying data rather than `null` throughout.
- All 22 tests pass (some renamed to state the new dependency on confirmation explicitly).

### New test file created

`lib/training/_lthr_reanchor_authority.test.ts` — the task asked for this file assuming it didn't exist; given the pre-existing `lthr-reanchor.test.ts` above already covers the production-data narrative, this new file focuses specifically on the priority-vs-authority question in isolation (priority never differentiates; a confirmation clears the floor at exactly `REPRESENTATIVE_FLOOR`, never above; downward reports still work; the non-authority gates are independent). 10/10 pass.

### Additional files discovered broken during full-directory verification (not in the task's enumeration, all fixed)

The task's file list was accurate for the sites it named, but running the full `lib/race lib/training lib/evidence lib/fitness` directories surfaced **five more pre-existing test files** built on the old priority-driven behaviour, all now fixed with the same rewrite-plus-Rule-18-falsifier pattern:

- `lib/race/_representativeness.test.ts` — 6 tests directly asserted the old `effectiveEffortClass`/`assessRepresentativeness` priority-driven downward discount. Rewritten; 65/65 pass.
- `lib/training/_vdot_corpus_anchor.test.ts` — 1 test relied on a bare declared-A race capping a training read when the corpus was insufficient. Rewritten with the ceiling-dormancy disclosure; 13/13 pass.
- `lib/training/vdot-anchor-fade.test.ts` — 2 tests relied on the same ceiling mechanism. Rewritten (including a "runner-confirmed race still caps correctly" companion, proving the mechanism itself is intact); 54/54 pass (combined with its sibling file below).
- `lib/training/vdot-slow-runner-floor.test.ts` — 1 test asserted a slower A-priority below-table race always beats a faster C-priority one. This is the safety-relevant below-table finding described above. Rewritten with full disclosure and a confirmed-race companion test proving the protection still works once real signal exists.

### Full suite

```
npx tsc --noEmit                → clean, 0 errors
bash scripts/check-doctrine.sh  → doctrine OK · 350 citations resolve · 718/718 doctrine tests pass
npx vitest run (lib/race, lib/training, lib/evidence, lib/fitness)
                                 → 1799/1799 pass, 0 failed, 13 skipped (DB-dependent)
npx vitest run (full web-v2 suite)
                                 → 11931 passed, 1 failed, 1 expected fail, 205 skipped (12138 total)
```

**The one failure** (`lib/plan/_authoring_shadow_compare.audit.test.ts`) is a pure environmental gate that hard-fails whenever `DATABASE_URL_RO` is absent from the sandbox, by design ("skipping it silently would report green for a check that looked at nothing"). It has zero code-path overlap with anything F139 touched (verified: no reference to `selectionAuthority`, `durability-anchor`, `lthr-reanchor`, `classify-evidence`, or `representativeness` anywhere in that file). This matches the pre-briefed "known DB-dependent failures in this sandbox." I did not find the second DB-related failure or the `_rolling_seven_ceiling.test.ts` defect the task mentioned — running that file directly shows 6/6 passing — most likely because this task's briefing was written against a different, earlier state of this fast-moving branch; I report the actual, current, measured result rather than reconciling it against a possibly-stale expectation.

---

## Rule 18 falsification — real revert/run/restore cycles, per file

Per the explicit instruction, for each of the five source files I performed a genuine falsification: copied the file, ran `git checkout --` to revert it to the pre-fix committed state, ran the relevant test(s) and/or the doctrine gate, confirmed the expected failures for the expected reasons, then restored the fix from the copy and re-confirmed green. (Followed the existing project convention of never using `git stash` for this — see `feedback_git_stash_shared_across_worktrees.md` — using a plain file copy instead.)

| File | Test(s) used | Reverted result | Restored result |
|---|---|---|---|
| `vdot.ts` | `vdot-race-authority.test.ts` | **10/20 fail** — the new "priority no longer differentiates" and "ranking by raw value" and "ceiling dormancy" tests all fail exactly as expected (e.g. Sombrero no longer outranks the A-priority race; the ceiling re-applies). | 20/20 pass. |
| `durability-anchor.ts` | Doctrine gate (`_doctrine_gate.test.ts -t "priority-never-weights-evidence"`) | **1/1 fails**, naming the file explicitly: `"web-v2/lib/training/durability-anchor.ts calls selectionAuthority(...) again"`. (Its own unit test file, `_durability_anchor.test.ts`, does *not* falsify — it calls `fitRaceExponent` directly with hand-set weights, bypassing `loadRaceObservationsForDurability` entirely; the doctrine gate is the correct, and in fact stronger, falsifier here since it is the actual CI gate that would catch a real regression.) | Doctrine gate + `_durability_anchor.test.ts` both pass. |
| `lthr-reanchor.ts` | `_lthr_reanchor_authority.test.ts` + `lthr-reanchor.test.ts` | **7/37 fail** — unmeasured races incorrectly anchor again (e.g. `DAVID_RACES` picks Americas Finest City at 168 instead of `null`); confirmed reports no longer distinguishable from unmeasured ones. | 37/37 pass. |
| `classify-evidence.ts` | `_classify_evidence.test.ts` | **2/27 fail** — the A-priority race reads `controlledEffort: absent` again (full trust from priority alone) instead of `present`. | 27/27 pass. |
| `representativeness.ts` | `_representativeness.test.ts` | **6/65 fail** — a declared C race with no measured signal is discounted to the doctrine C row again; `LOADED` steps a declared-C race to `'C'` (priority-seeded) instead of `'B'` (fixed-baseline); priority strings differentiate the class again. | 65/65 pass. |

All five reverts and restores were verified against `git diff --stat` after restoration to confirm the intended fix (not the original committed state) was back in place.

---

## What was explicitly NOT touched, per instructions

- `web-v2/lib/plan/goal-tiers.ts` and every legitimate planning-cost use of `RECOVERY_EFFORT_SCALE`/`recoveryEffortScale`/`selectionAuthority`.
- `web-v2/lib/race/_controlled_c_effort.test.ts` and the pacing-restraint feature it covers.
- `web-v2/lib/race/coach-goal.ts` — confirmed it has two genuinely dead imports (`selectionAuthority`, `REPRESENTATIVE_FLOOR`, line 132), but per instructions I had no other reason to be in this 635-line file (its `priority === 'C'` branch is a different, legitimate scheduling use), so I left it alone rather than opening it for a one-line cleanup unrelated to any other change.

## Recommended follow-ups (not done here, out of scope)

1. **Wire a real, automatic per-race representativeness signal into `bestRecentVdot` and `selectLthrAnchor`.** This is the actual fix for the dormancy disclosed above — `durability-anchor.ts` already has the pattern (`assessRaceRepresentativeness`); it is currently the only one of the four call sites with automatic (not runner-opt-in) measured signal.
2. **`app/api/v5/races/route.ts`'s `raceRowAuthority`** — the fifth, undiscovered instance of the same violation (§1 above). Worth its own finding.
3. **Reconsider the below-table anchor tie-break** for very slow / novice runners specifically (§`vdot.ts` above) — whether "faster pace wins on tie" is the right default for a population with the least margin for an over-hard prescription, independent of the priority question this fix resolved.
4. **Get `docs/RACE_TIERING_AND_SEASON_PHILOSOPHY.md` committed** to the repository (it is not in git history at all today) — the doctrine gate now depends on it existing on disk at that path.

## Deliverable state

All changes are uncommitted in this worktree, as instructed. Files changed:

```
 M web-v2/lib/adaptation/shadow-evidence-epoch.ts
 M web-v2/lib/doctrine/registry.ts
 M web-v2/lib/evidence/_classify_evidence.test.ts
 M web-v2/lib/evidence/classify-evidence.ts
 M web-v2/lib/fitness/_fitness_model.test.ts
 M web-v2/lib/race/_representativeness.test.ts
 M web-v2/lib/race/representativeness.ts
 M web-v2/lib/training/_durability_anchor.test.ts
 M web-v2/lib/training/_race_authority_durability.test.ts
 M web-v2/lib/training/_vdot_corpus_anchor.test.ts
 M web-v2/lib/training/durability-anchor.ts
 M web-v2/lib/training/lthr-reanchor.test.ts
 M web-v2/lib/training/lthr-reanchor.ts
 M web-v2/lib/training/vdot-anchor-fade.test.ts
 M web-v2/lib/training/vdot-race-authority.test.ts
 M web-v2/lib/training/vdot-selection-order.test.ts
 M web-v2/lib/training/vdot-slow-runner-floor.test.ts
 M web-v2/lib/training/vdot.ts
?? docs/RACE_TIERING_AND_SEASON_PHILOSOPHY.md   (new — see registry section above)
?? web-v2/lib/training/_lthr_reanchor_authority.test.ts   (new)
```
