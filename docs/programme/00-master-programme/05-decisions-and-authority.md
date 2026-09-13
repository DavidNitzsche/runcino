# 05 — Decisions and Authority

## Authority boundaries (from the mandate, restated once, governs every other file — Rule 17)

**May do without asking:** read anything reachable (code/docs/branches/logs/CI/ASC metadata — DB/Railway not currently reachable from this container, see `01-live-census.md`§D); create worktrees/branches; spawn bounded sub-agents; implement within an assigned lane; add tests/fixtures/harnesses/docs/render evidence; push dedicated branches; run local/CI tests; run simulator verification (not available from this container — flag, don't fake); request/manage independent reviews; prepare merge/migration/SQL/release/TestFlight plans (paper only); remove derived build products or obsolete worktrees only after proving no unique uncommitted work.

**May NOT do without David's explicit authorization:** push/merge to `main`; deploy an integration wave; apply a production migration; any production data write; change production secrets; upload/distribute TestFlight; submit external beta review; enable automatic plan mutation; revert an unauthorized prior merge; delete branches/worktrees/reports/user data with unique work.

## Open authority question — BLOCKING, raised to David, not resolved by this session

`session_018q8uZGrJpbq2nEgxiuhx8P` is titled "Transition to new master programme-lead session," created 2026-09-12T15:47:38Z (before this takeover session started). It is unreachable (see `01-live-census.md`§B.1). **This session has not been told to stand down and has not confirmed it will.** Two possibilities: (a) it's a stalled/abandoned attempt at the same transition this session is now completing — safe to supersede; (b) it's an active, further-along process that this session would be duplicating. Proceeding as sole programme lead per this session's own explicit instruction from David, but **this is flagged, not silently assumed resolved** — David's confirmation is requested at the next checkpoint.

## Decisions made by this session under its "may do without asking" authority

1. **Ledger location:** in-repo at `docs/programme/00-master-programme/`, not `/Volumes/WP` (unreachable). Committed to `claude/epic-ride-9bvh99` only.
2. **Freeze `generate.ts`-touching branches** (marathon-plan-quality lineage, natural-coaching lineage) from further edits pending an authorized integration wave — see `04-branch-and-file-occupancy.md`.
3. **No merges executed.** Both natural-coaching (`natural-coaching-programme-lead`) and marathon-plan-quality Phase 1/2 read as plausibly merge-ready from their own handbacks, but merge/deploy is outside this session's standing authority — treated as a Wave 5 action pending explicit authorization of a specific reviewed wave, not a one-branch-at-a-time ask.
4. **DB/Railway/TestFlight facts from the mandate's §8 "known current state" are NOT being treated as current** until independently confirmed — this container has no credential for any of them. Marked `[BLOCKED]` throughout rather than carried forward as fact (mandate §6 evidence grammar; CLAUDE.md Rule 11).

## Decisions requiring David specifically (checkpoint items, not implementation ambiguities)

- Resolve the duplicate-programme-lead question above.
- Authorize (or not) a specific reviewed integration wave once one exists — no wave is ready yet.
- The Santa Monica second stale row (`wko_...` "Dodgers," 2026-09-26) has no write authorization per the mandate — needs an explicit go/no-go, not a default.
- Whether a Mac-based session should be tasked with mirroring this ledger to `/Volumes/WP` and recovering literal state from the `for external review` folder that this container cannot read.
