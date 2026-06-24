# Plan Engine Audit — Paused 2026-06-23

## What was shipped this session

All four David-approved fixes plus the maintenance horizon fix are live on Railway.

| Commit | Fix | What it does |
|---|---|---|
| `9143e9fa` | MAINT-HORIZON | Maintenance duration = weeks until race-prep window opens. 5K 10.57wk away → 1 maintenance week, not 4. |
| `9b2c0c24` | RC2-4 + PP-3 | Cutback deload 85%→80% (doctrinal). WoW validator exempts the return week after a planned cutback. Non-race taper weeks: 1 quality session (not 2). |
| `3c6ad40a` | TAPER-RW-1 + LSP2-2 | Race-week easy runs are time-based ("EASY · 35 MIN", "EASY · 40 MIN"). PR recency window: only `<6mo` races count as current fitness (sim + prod fallback). |

Gate status: **560/560 tests, FIRM=0** across 9,294 archetypes. 12 WARNs are expected (2-day available-days runners can't reach the weekly band — structurally correct).

---

## Where the audit was paused

The adversarial audit was mid-pass when David asked to pause. The open item that hadn't been acted on:

**RAMP-CEIL-1** (not yet approved) — add a band-floor warning to `validate.ts`: when `longPeak < tierTarget.peakLongMiBand[0]` and runway ≥ 12 weeks, surface a warning. Would add `minPeakLongMi?: number` to `PlanValidationContext`. Decision needed before implementing — changes what the validator reports, not what the plan builds.

Nothing else was outstanding. The prior full multi-round audit (4 Workflow passes, 19 defects found and fixed) is complete. The 12 WARNs in the sweep are expected behavior, not bugs.

---

## What the gate covers

`lib/plan/_sweep_allusers.test.ts` — 9,294 archetypes × 3 modes (race-prep / justRun / far-out-race). FIRM failures = 0.

`lib/plan/_audit_stimulus_gap.test.ts` — B3 + SP-7: quality spacing + long-primacy validator.

`lib/plan/_audit_persist_realization.test.ts` — BRK-1/PINV-1: no pace inversions; persist≈composed; long-finish in marathon zone.

`lib/plan/_audit_periodization.test.ts` — 556 scenarios: phase labels, taper shape, tune-up count, week structure.

---

## To resume the audit

1. Re-run gate: `npx vitest run lib/plan/_sweep_allusers.test.ts lib/plan/_audit_stimulus_gap.test.ts lib/plan/_audit_persist_realization.test.ts lib/plan/_audit_periodization.test.ts --disable-console-intercept 2>&1 | tail -12`
2. If FIRM=0, start with RAMP-CEIL-1 (needs David's go) and any new dimensions to probe.
3. The next audit area not yet touched: **coach-voice layer** — are the notes/subLabels Research-conformant across all day types? That's a softer audit (no firm gate) but worth a pass.
