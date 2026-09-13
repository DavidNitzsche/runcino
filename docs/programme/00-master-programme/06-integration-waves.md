# 06 — Integration Waves

## Wave 0 — takeover and truth (IN PROGRESS)

- [x] Agent/session census (`01-live-census.md`)
- [x] Branch census (`04-branch-and-file-occupancy.md`, coarse pass)
- [x] Live production/CI census (`00-index.md`, `01-live-census.md`§D)
- [ ] External-review reconciliation — **blocked**, `/Volumes/WP` unreachable from this container; recovered what exists in-repo instead (handback docs on branches)
- [x] File-occupancy map — hot zone only; full 182-branch sweep not yet done
- [x] Canonical master ledger — this directory
- [x] Recover missing handbacks — found `docs/audit-2026-09-09-canonical-handback.md` (superseded, kept for history) and `docs/design/natural-coaching-handback-2026-09-12-final.md` (current) on `main`/branches
- [x] Freeze collisions — `generate.ts` cross-lineage, see `04-`
- [x] Ancestry-check of the mandate's 25 "reported merged" items (24 named + 1 sub-split) against `origin/main` — **all 25 confirmed real merges with matching content**, via `git merge-base --is-ancestor` + diff spot-check (not just branch-name matching). Two items (#12 tune-up cluster, #16 ambiguity-leak) are multi-part/overlapping as anticipated, not missing. No fabricated or stale claims found in this list. Full table in this session's record; not duplicated here per Rule 17 — summary: 25/25 on `origin/main` as of `a79c5c86d`.
- [x] `lane-c/adaptation-vertical-slice` reconciliation — **branch is real, exists on origin, 3 clean commits directly on top of current `origin/main` tip (0 behind, fast-forwardable), 28 files / +2126/-7, mostly tests+docs.** Verified by direct source tracing (not comment-trust): DURATION discriminator bug/fix real (`action-proposal-lane.ts:352-360`); DENSITY confirmed genuinely absent (a pre-existing, unrelated `work_density`→`QUALITY_DOSE_CHANGE` mapping on `main` predates this branch and is not the new lever — flagged so it isn't mistaken for one); PACE's "complete reprice lifecycle" claim holds but is **pre-existing infrastructure already on `main`**, not new Lane-C work — this branch only adds fixes/tests against it (accept-route reopen-on-failure gap, archived-plan PATCH guard, race-prep reprice bind bug); **no automatic/unattended mutation path found** — the only new entry point (`runActionProposalLane`, cron-invoked) is structurally RECORD_ONLY, and the only plan-mutating path (`REPRICE_APPLY`) is reachable only via the user-triggered accept HTTP route. Not verified from source alone (correctly BLOCKED, not assumed): live runtime/DB behavior, actual test-suite pass/execution, device render.
- **Wave 1 re-prioritization:** this branch is now the safest, best-understood Wave-1 candidate — smaller, cleaner, and more thoroughly source-verified than initially expected. Promoted ahead of Natural Coaching in practical readiness, though Natural Coaching's truth-review (Task #9, in flight) may change that ordering once it lands.

Wave 0 is closed pending only the duplicate-programme-lead question (`05-`), which requires David and cannot be resolved by this session.

## Wave 1 — current release blockers (NOT YET DISPATCHED — see rationale)

The mandate names four candidate lanes: Lane A (recovery/intentional-advance truth), Marathon Plan Phase 3 redesign, Adaptation milestone finalization, Natural Coaching reconciliation. **Smallest-safe-first-wave judgment call (this session's, per its "determine the smallest safe first implementation wave" authority):**

Dispatch order once Wave 0 closes:
1. **Natural Coaching reconciliation** — lowest implementation risk of the four. `natural-coaching-programme-lead` already has two independent fresh reviews (PASS WITH NOTES) and a disclosed, bounded gap list. This is a truth-reviewer + rendered-UX-reviewer task against the *existing* branch, not new implementation: confirm the branch's own claims (§1 of its handback), resolve the "Dodgers" second stale row's disposition (flag, don't write), and only then it's a Wave-5 merge candidate.
2. **Adaptation milestone finalization** — gated on the background reconciliation agent's report (Task #8). Do not treat PACE's "complete reprice-card lifecycle" claim as true until that agent's source-citations come back; DENSITY must independently verify as absent.
3. **Marathon Plan Phase 3** — the existing WIP is explicitly not a finished deliverable (harness only, one unconfirmed finding). This is the least safe to hand to a fresh implementer cold; needs a bounded continuation task scoped to exactly: (a) confirm or refute the Week-1 spacing finding is real vs. harness artifact, (b) do not proceed to a CIM plan rewrite until Wave 2 (pace/VDOT reconciliation) lands, since Phase 3's own candidates already embed a pace number (472 s/mi) the mandate says needs reconciling first.
4. **Lane A (recovery/intentional-advance truth)** — held per its own branch note (`fix/recovery-honesty-strides-grading` is explicitly `HELD`, aggregate copy changed but row-level execution state not fixed). Needs a fresh bounded implementer, not a review of existing work.

**None of these four have been dispatched yet as of this ledger's creation.** This file will be updated with implementer/reviewer assignments once Wave 0's two outstanding verifications land — dispatching Wave 1 blind, before knowing whether e.g. the adaptation branch's core claims hold up, would risk exactly the "wired, tested, and inert" or "confidently wrong" failure modes CLAUDE.md's Rules 15/18/20 exist to catch.

## Wave 2 — canonical Pace/Brain foundations (NOT STARTED)

Blocked on Wave 1. Scope per mandate §10/§11: reconcile threshold pace (430s/mi) vs. marathon-training pace (~472s/mi) vs. goal pace (412s/mi) vs. authored VDOT (47.8) vs. profile VDOT (46.6) — mandate itself flags "a threshold pace slower than goal marathon pace is a contradiction, stale value, or naming problem until proven otherwise." This is exactly the kind of single-owner/single-resolver problem `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` governs — read that doctrine file in full before scoping Wave 2 implementers, not just this ledger.

## Wave 3 — autonomous Brain shadow loop (NOT STARTED)

## Wave 4 — complete runner experience and supporting product (NOT STARTED)

## Wave 5 — integration and candidate (NOT STARTED)

No reviewed wave exists yet to present for authorization.
