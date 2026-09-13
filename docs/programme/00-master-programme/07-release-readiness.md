# 07 — Release Readiness

No integration wave has been authorized and no candidate build exists yet. This file is a checklist skeleton, not a status report — populate as Wave 5 approaches.

## Pre-candidate gate (mandate §16) — none checked yet

- [ ] Clean committed source
- [ ] Exact integrated SHA
- [ ] Every included branch independently reviewed
- [ ] Combined full gates run
- [ ] No missing-credential false green (relevant: `audit-suite` reportedly red for missing `DATABASE_URL_RO` secret — **not independently reconfirmed by this session**)
- [ ] Production migrations explicitly decided (166 `plan_decision_ledger`, 170 `request_failures` — presence unconfirmed, `[BLOCKED]`)
- [ ] Railway deploy mapped to source (`[BLOCKED]`, no credential)
- [ ] Machine-wide shipping lock confirmed present and working (reported merged on `feat/shipping-lock-and-artifact-mapping` — ancestry check in flight, Task #7)
- [ ] iPhone/Watch artifact mapping
- [ ] No concurrent integration (currently true — no wave running)
- [ ] No unrecorded `--no-verify` (note: `origin/safety-wiring` branch commit explicitly discloses being pushed with `--no-verify` — needs a look before that branch is ever considered for merge)
- [ ] No unexplained dirty worktree (this session's own worktree is clean; `audit/brain-forensic-2026-09-10` is dirty and unrecoverable from here — see `01-live-census.md`)
- [ ] No unresolved conflict markers
- [ ] No held branch accidentally included (Lane A / `fix/recovery-honesty-strides-grading` is explicitly HELD — must not ship in any wave until row-level fix lands)

## TestFlight (mandate §16-17)

Build 290 / source `0dce24f23` reported as last uploaded — **not independently confirmed** (no App Store Connect access from this container). Treated as stale/insufficient per the mandate's own instruction regardless of confirmation status, since it predates all current unmerged work.

No physical-device checklist (mandate §17) can be executed from this container — it has no simulator/device access. This will need either a Mac-based session or explicit handoff at the appropriate wave.
