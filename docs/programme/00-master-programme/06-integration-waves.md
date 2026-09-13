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
- [ ] `lane-c/adaptation-vertical-slice` reconciliation agent still running.

Wave 0 is not fully closed until that reconciliation agent reports and the duplicate-programme-lead question (`05-`) is answered.

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
