# Wave 2 · Canonical current-fitness resolver — investigation + proposal

**Date:** 2026-09-13
**Branch:** `proposal/wave2-canonical-fitness-resolver` (based on `origin/main` @ `a79c5c86d`)
**Status:** PROPOSAL ONLY. Nothing here is wired into a live job. No production data was written. No `vdot_last_reviewed` write, no `recompute_paces` trigger, no reprice, no runner-visible card.

---

## 0. Executive summary

`users.vdot_last_reviewed` is frozen at 46.6 and has been for 4+ months. It is
read *first* by the legacy anchor cascade (`anchorVdotFromState()`,
`lib/training/pace-anchor.ts`) that feeds the nightly `detectFitnessRegression`
/ `detectTrainingLead` detectors in `lib/plan/adapt.ts`. Investigation finds:

1. **There are three candidate "current fitness" values, not two.** Beyond
   `vdot_last_reviewed` and the authored-plan snapshot, `capacity-resolver.ts`'s
   `resolveThresholdCapacity()` is a **third, already-canonical** belief —
   named as the sole Runner Model authority by `docs/BRAIN_CONSTITUTION.md`
   §C — that the legacy cascade does not call at all.
2. **The `vdot_last_reviewed` write path is not merely stale, it is dead.**
   Its only writer (`applyAdaptations`'s `recompute_paces` branch,
   `lib/plan/adapt.ts:2404-2408`) is unreachable from every live call site
   because the 2026-09-02 seam (`lib/plan/adaptation-authority.ts`) diverts
   `recompute_paces` to an observational note *before* it ever reaches the
   `apply` or `propose` lane. Confirmed by tracing every caller of
   `applyAdaptations`.
3. **Reading `vdot_last_reviewed` first is a real, argued design choice — but
   the argument is idempotency, not epistemic superiority**, and its premise
   (the same value gets re-stamped after acting on it) no longer holds now
   that the stamp never fires. It predates `capacity-resolver.ts` and was
   never migrated to call it.
4. The proposed resolver (`lib/training/resolve-current-fitness.ts`, real,
   tested code on this branch) does not re-litigate which of the two legacy
   numbers to trust. It calls the doctrine-designated canonical resolver and
   treats the legacy cascade as a read-only safety cross-check that **refuses**
   rather than guesses when the two disagree by more than a doctrine-cited
   threshold.

---

## 1. Definitions — meaning, owner, provenance, belief vs. snapshot

| Quantity | Where it lives | Computed from | Belief or Snapshot | Owner (Constitution) |
|---|---|---|---|---|
| `users.vdot_last_reviewed` | `users` table, one scalar | Whatever VDOT the last *unsealed, applied* `recompute_paces` action carried, stamped post-commit | **Designed as a gated BELIEF** ("reviewed" implies a review event happened); **operationally a dead SNAPSHOT** — its only writer is unreachable since 2026-09-02 (see §2) | None currently — pre-dates §C's Runner Model owner and was never migrated to it |
| Authored plan's VDOT (`authored_state.pace_recompute.vdot`, and its own fallbacks `pace_blend.season_anchor_vdot` / `derived_from.bestRecentVdot`) | `training_plans.authored_state` jsonb | Whatever VDOT was live at plan authoring, or at the last successful `recomputePacesForPlan` call | **SNAPSHOT, by design** — `pace-anchor.ts`'s own header calls it "the durable fallback anchor," explicitly not self-refreshing | Plan authoring (`lib/plan/generate.ts`, `lib/plan/recompute-paces.ts`) |
| "Current fitness VDOT," live-resolved | Not persisted | `resolveThresholdCapacity(userId, today).vdot` (`lib/training/capacity-resolver.ts:1543`) — confidence-weighted, source-mode-tagged, evidence-gated, recomputed at read time (Rule 10) | **BELIEF, canonical** | Runner Model (§C) — "no other subsystem may maintain a competing fitness estimate" |
| Threshold pace, persisted | `plan_workouts.pace_target_s_per_mi` / `workout_spec` | Frozen at authoring or last `recomputePacesForPlan` call | **SNAPSHOT** (Rule 10 subject — carries no anchor stamp of its own beyond the plan's `authored_state`) | Plan authoring |
| Threshold pace, live-resolved | Not persisted | `resolveThresholdCapacity().paceSecPerMi`, or `composePaceAnchors().anchors.thresholdSecPerMi` (`lib/training/prescription-resolver.ts:1515`) | **BELIEF** | Pace Prescription (§G), consuming Runner Model |
| Marathon-training pace, persisted | `plan_workouts` marathon-specific rows | Frozen at authoring/recompute | **SNAPSHOT** | Plan authoring |
| Marathon-training pace, live-resolved | Not persisted | `composePaceAnchors().anchors.marathonSecPerMi` — threshold capacity run through `marathonPaceFromDurability` | **BELIEF** | Pace Prescription (§G) |
| Goal pace | `races.meta` / goal fields | The runner's stated target, echoed | Neither — a **declaration**, never derived from fitness | Goal System (§K) — "does NOT determine current fitness" |
| Canonical race-outlook / evidence projection | Not persisted | `resolveRaceOutlookBySlug(userUuid, slug, today)` (`lib/race/race-outlook.ts:1088`) — reads `currentProjection` off canonical threshold capacity + durability exponent, **never off `vdot_last_reviewed`** | **BELIEF (composite)** | Race Prediction (§J), explicitly built to be "THE race-pace brain — one resolver, one object" |

**The crux, answered:** `vdot_last_reviewed` and the plan's snapshot are not
"genuinely different semantics" in the way that would justify keeping them as
two permanent, independently-trusted numbers. They are both **pre-Constitution
snapshots of a computation that now has a canonical, doctrine-owned home**
(`capacity-resolver.ts`). The honest belief/snapshot split is: canonical
resolver = belief; everything persisted in `users`/`authored_state` = snapshot,
useful only as an audit trail or a cross-check, never as the answer itself.

---

## 2. Every writer and reader of `users.vdot_last_reviewed`

**Writers — exactly one, confirmed (grepped `web-v2/lib` and `web-v2/app`):**

- `lib/plan/adapt.ts:2404-2408` — inside `applyAdaptations`, gated on
  `postCommitVdotReviewed != null`, which is only set at `adapt.ts:2315`
  inside the `kind === 'recompute_paces'` branch (`adapt.ts:2239-2317`).

**Is that branch reachable today? Traced every caller of `applyAdaptations`:**

| Caller | Actions passed | Reaches `recompute_paces`? |
|---|---|---|
| `app/api/cron/run-adaptations/route.ts:520` | `sealAutomaticActions(actions).apply` | **No.** Under the closed seal (`AUTOMATIC_ADAPTATION_AUTHORITY = false`), `apply` contains only `kind === 'note'` actions — `recompute_paces` is not in `PROPOSABLE_KINDS` (`adaptation-authority.ts:125-172`), so `sealAutomaticActions` converts it to `toObservationalNote` before it can reach `apply` or `propose`. |
| `lib/brain/proposal/accept.ts:190` (`ADAPTATION_PIPELINE`, runner-accepted) | One `adaptation` built from an accepted proposal card | **No.** A card can only exist for a `PROPOSABLE_KINDS` member (`downgrade`, `shave`, `reschedule`, `field_test`, `mark_upgrade`) — `recompute_paces` never becomes a card in the first place, so there is nothing to accept. |
| `app/api/plan/workout-proposals/[id]/accept/route.ts:287` | Same as above | Same — no. |
| `lib/plan/adaptive-ramp.ts:1143` | Hand-built volume-bump action | No — not a `recompute_paces` action at all (Rule 21's volume axis, unrelated). |
| `lib/adaptation-harness/drive.ts:136` | Test/simulation harness only | Not a production call site. |

**Conclusion: the write path has been mechanically dead since the 2026-09-02
seam landed.** The column was already 4+ months stale before that (predating
the seam by a wide margin), so the seam did not cause the staleness — it
foreclosed the only route back to freshness.

**Readers, beyond `anchorVdotFromState()`:**

- `lib/training/pace-anchor.ts:78-106` — `anchorVdotFromState()` itself, the
  shared cascade.
- `lib/plan/adapt.ts:3244-3247` (`detectPrBank`) — reads
  `vdot_last_reviewed` **directly**, with no fallback cascade at all (if
  null, the detector simply returns null). This is a narrower ad hoc read
  than the cascade used by its two siblings — worth noting as its own
  migration site (§4).
- `lib/plan/adapt.ts:3684-3691` (`detectFitnessRegression`) and
  `lib/plan/adapt.ts:4157-4164` (`detectTrainingLead`) — both via
  `anchorVdotFromState()`.
- `lib/audit/automatic-mutation-registry.ts:239` — lists it as a column the
  automatic-mutation audit registry watches; does not read the *value*.
- Test-only references: `_downward_reanchor.test.ts`,
  `_representativeness_upward.test.ts` (hardcodes the live value, 46.6, as a
  fixture constant), `_pace_anchor.test.ts`.

No second writer found. The task's premise is confirmed exactly as stated.

---

## 3. Why the detector reads the stale field first — deliberate or accident?

**Both, at different layers — and the deliberate part's premise is now false.**

`adapt.ts:4112-4115` argues the ordering explicitly, for `detectTrainingLead`:

> "the anchor cascade below reads `vdot_last_reviewed` first, and the
> `recompute_paces` limb stamps it after applying — so a credited lead becomes
> the anchor it was measured against, the delta collapses to zero, and the
> detector cannot re-fire on the same evidence."

This is an **idempotency argument**, not an epistemic claim that a reviewed
number should outrank a fresher one. It only works if the stamp keeps firing.
Per §2, it does not — the closed seam means every night `anchorVdotFromState()`
reads the same 46.6 it read the night before, so the idempotency the ordering
was built to provide is now moot (there is nothing to be idempotent against;
the value never moves).

**The deeper, unargued layer:** the cascade itself — reading `vdot_last_reviewed`
→ `authored_state.pace_recompute.vdot` → `pace_blend.season_anchor_vdot` →
`derived_from.bestRecentVdot`, and never `resolveThresholdCapacity()` — is
**legacy architecture that predates `capacity-resolver.ts`**. `capacity-resolver.ts`'s
own header explicitly lists the modules its migration has NOT yet reached
(`generate.ts`, `spec-builder.ts`, `reanchor-plan.ts`, `recompute-paces.ts`,
`zone-anchors.ts`, `sim-inputs.ts`, `goal-projection.ts`, `zone-stimulus.ts`,
`execution/reconstruct.ts`) — `adapt.ts`'s detectors are not on that list at
all, meaning the gap was not even tracked as pending migration work.
Constitution §C's hard rule — "no other subsystem may maintain a competing
fitness estimate... it does not calculate threshold itself" — is violated by
this cascade's mere existence, independent of which of its two legacy rungs
answers first.

**Verdict for the design decision this unlocks:** the fix is *not* "read
`pace_recompute.vdot` before `vdot_last_reviewed`" (that just swaps which
stale snapshot answers) and *not* "read whichever is newer" (David's ruling,
correctly, against timestamp-only preference — a fresher number is not
automatically the more correct one). **The fix is that neither legacy number
should be the primary answer at all** — the canonical resolver already exists
and already out-ranks both by doctrine. What the legacy cascade is actually
good for, going forward, is exactly what this proposal uses it for: a
cross-check that flags disagreement for human attention.

---

## 4. The resolver, and the migration list

**File (real, committed on this branch):**
`web-v2/lib/training/resolve-current-fitness.ts`

**What it does:**

1. Calls `resolveThresholdCapacity(userId, today)` — the canonical Runner
   Model belief. This is the answer, on its own authority (Constitution §C).
2. Independently, read-only, re-derives the legacy cascade value via the
   *exact* query `detectFitnessRegression`/`detectTrainingLead` use (so the
   cross-check cannot silently disagree with the live detectors about what
   "the legacy anchor" even is).
3. Compares. If they agree within `SELF_HEAL_REANCHOR_DELTA` (2.0 VDOT,
   imported from `lib/training/pace-anchor.ts` rather than re-derived — Rule
   16, one quantity one name) — or if there is no legacy anchor to compare
   against — the canonical belief answers, `ok: true`, with full provenance
   (both readings, confidence, source mode, evidence ids).
4. If they disagree by more than that threshold, it **refuses**
   (`ok: false, reason: 'BELIEF_SNAPSHOT_DISAGREEMENT'`), carrying both
   numbers and the delta, rather than picking a side.
5. If the canonical belief is below-table (`vdot === null`), it refuses with
   `'INCOMPARABLE_BELOW_TABLE'` rather than fabricating a VDOT to compare —
   Rule 11 applied to the resolver's own output, not just its inputs.
6. A failed legacy-anchor read (`LegacySnapshotProbe.status === 'failed'`) is
   distinguished from "no anchor exists" (`'none'`) per Rule 11, and neither
   blocks the canonical belief from answering — a broken cross-check must not
   stop the doctrine-designated authority from doing its job (the same
   "ensure, don't block on, a precondition" posture Rule 23 argues for).

**Why `SELF_HEAL_REANCHOR_DELTA` and not a new constant:** its own header in
`pace-anchor.ts` already argues the exact shape this comparison needs —
"the self-heal has no evidence-kind context ... it acts only on a move too
large to be candidate-set jitter" — which is precisely this resolver's
relationship to the legacy anchor: no corroboration context, a context-free
sanity check. Reusing it avoids inventing a second number for the same
question (Rule 16).

**Migration list — every ad hoc read site found (grepped `vdot_last_reviewed`
and `pace_recompute` across `web-v2/lib`):**

| Site | What it does today | Migration |
|---|---|---|
| `lib/training/pace-anchor.ts:89-106` (`anchorVdotFromState`) | The shared legacy cascade | Becomes the resolver's cross-check input only; stop calling it for the *primary* answer |
| `lib/plan/adapt.ts:3684-3699` (`detectFitnessRegression`) | Reads cascade as "old_vdot" to regress from | Should read `resolveCurrentFitnessVdot()`; on refusal, the detector should skip that night rather than act on an ambiguous anchor |
| `lib/plan/adapt.ts:4154-4170` (`detectTrainingLead`) | Same cascade, same role | Same migration |
| `lib/plan/adapt.ts:3236-3250` (`detectPrBank`) | Reads `vdot_last_reviewed` directly, no fallback at all | Same migration — currently the narrowest/most fragile of the three, since it has no fallback when the column is null |
| `lib/plan/adapt.ts:2248-2252, 2402` (`recompute_paces` write branch) | Writes `pace_recompute.vdot` in-transaction, stamps `vdot_last_reviewed` post-commit | Out of scope for this proposal (a write path) — but once the resolver exists, this branch's role becomes "record what the canonical resolver said at authoring time," not "compute a new number" |
| `lib/plan/pace-drop-event.ts:16` | Reads `pace_recompute` for the pace-drop-event ledger | Should read the resolver's `paceSecPerMi` for the *current* comparison side; the *prior* side is legitimately a snapshot (the event is about a change, not a live belief) |
| `lib/plan/reanchor-proposal.ts:122-131`, `lib/plan/reanchor-plan.ts:140,926` | Read `pace_recompute.anchors` as a drift-comparison stamp | These are explicitly the Rule-10 "stamp beside the derivation" pattern already, comparing live vs. stamped — **already doing the right thing structurally**; no migration needed, just worth noting they are the model this resolver's cross-check design borrows from |
| `app/api/cron/pace-drift-monitor/route.ts:69` | Reads `authored_state.pace_recompute.anchors` as the stamp side of a drift check | Same as above — already correct pattern, not touched |

Note: `capacity-resolver.ts`'s own header already lists eight modules
(`generate.ts`, `spec-builder.ts`, `reanchor-plan.ts`, `recompute-paces.ts`,
`zone-anchors.ts`, `sim-inputs.ts`, `goal-projection.ts`, `zone-stimulus.ts`,
`execution/reconstruct.ts`) as **known, tracked, not-yet-migrated** consumers
of the old VDOT cascade — that migration is a separate, larger, already-scoped
piece of work and is not re-litigated here. This proposal's migration list is
scoped to the **`vdot_last_reviewed` / `pace_recompute.vdot` ad hoc read
sites specifically**, per the task.

---

## 5. The 2026-09-02 prohibition, preserved — explicit confirmation

- **No write to `vdot_last_reviewed`, anywhere in the new file.** Verified by
  a test that scans the file's own SQL template literals and asserts every
  one starts with `SELECT` and contains no `UPDATE`/`INSERT`/`DELETE`
  (`_resolve_current_fitness.test.ts`, "never imports the mutation seam").
- **No `recompute_paces` trigger.** The file contains no `AdaptationAction`
  construction and imports nothing from `lib/plan/adapt.ts`.
- **No reprice.** `recomputePacesForPlan` / `applyReanchorProposal` are not
  imported.
- **No runner-visible card.** The resolver returns a plain TypeScript value
  to whatever calls it; nothing writes `plan_workout_proposals` or
  `coach_intents`.
- **Not wired into any live job.** Grepped: nothing outside this file's own
  test imports `resolve-current-fitness`. `adapt.ts`, `run-adaptations`, and
  every cron are untouched.

**If a write were ever wanted (designed here, NOT implemented, per the task):**
a narrow `users.vdot_last_reviewed_at` (or a small `fitness_review_events`
ledger row) recording *that the canonical resolver's belief was checked and
found to agree with, or intentionally supersede, the legacy anchor* — written
by a human-triggered or explicitly-scheduled *review* action, never by the
nightly detectors. Argued why this would not reopen the seam: it writes no
`plan_workouts` row, triggers no reprice, and raises no runner-visible card —
the seam's own scope (`adaptation-authority.ts`'s header) is specifically
about "SCHEDULED, UNATTENDED code [changing] the runner's live plan." A review
stamp changes an audit column, not the plan. It would still need David's
explicit go before implementation, both because it is a new persisted
derivation (Rule 10) and because "what counts as a completed review" is
exactly the kind of decision CLAUDE.md's decision-bucket rules ask to be
flagged rather than assumed.

---

## 6. Code, tests, verification

- `web-v2/lib/training/resolve-current-fitness.ts` — the resolver.
- `web-v2/lib/training/_resolve_current_fitness.test.ts` — 10 tests:
  no-disagreement (three shapes: legacy agrees, legacy absent, legacy read
  failed), disagreement refusal (both directions, plus a Rule-9 boundary
  check that the threshold itself is not a cliff — `atThreshold` passes,
  `beyondThreshold` by 0.01 refuses), below-table incomparability (two
  shapes), and a wiring/seal smoke test.
- **Falsified per Rule 18**, not just written: disabled the disagreement
  guard, confirmed 4 of 10 tests failed as expected, restored, confirmed all
  10 pass again.
- `npx tsc --noEmit -p tsconfig.json` — zero errors project-wide.
- `npx vitest run lib/training/_pace_anchor.test.ts lib/training/_capacity_resolver.test.ts`
  — 61/61 still pass; nothing in the existing suite regressed.

**Not done, and stated rather than hidden:** this proposal does not run
against David's live production data (no DB credentials used, no query
executed against `DATABASE_URL`), so the "no-disagreement, current case"
claim is proven against representative fixtures, not the live 46.6 vs.
whatever `resolveThresholdCapacity` would return today for his account. That
comparison is a natural next step once this proposal is reviewed and someone
chooses to run it read-only against prod.
