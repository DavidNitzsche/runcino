# Proof 11 · what actually ran, named

Run against the anchored engine, `DATABASE_URL=$DATABASE_URL_RO`, on 2026-09-02.
Read-only throughout.

## The composing suites and the contract suites

44 suites match `composeForUser|composePlan(` under `lib/**/*.test.ts` — listed in
`PROOF11-suite-inventory.txt` — plus 13 named contract and invariant suites:

```
lib/audit/_cross_surface_contract.test.ts
lib/faff/_surface_contracts.test.ts
lib/plan/_layout_contract.test.ts
lib/plan/_strategy_contracts.test.ts
lib/race/_race_outlook_contract.test.ts
lib/plan/_sweep_allusers.test.ts
lib/plan/_maint_invariants.test.ts
lib/plan/_coach_sensible.test.ts
lib/plan/_restore_continuity.test.ts
lib/plan/_audit_periodization.test.ts
lib/plan/_block_anchor.test.ts
lib/plan/_backdate_guard.test.ts
lib/training/_brain_acceptance.test.ts
```

Result:

```
Test Files  46 passed | 5 skipped (51)
     Tests  1168 passed | 6 skipped (1174)
  Duration  189.58s
```

## The five skipped files, and what they are

Skipped by `describe.skipIf`, not by failure — they are opt-in probes gated on an
env flag or on a database being present. Naming them rather than counting them,
because "5 skipped" inside a green run is exactly the shape Rule 18 warns about:

| File | Gate |
|---|---|
| `lib/plan/_probe_cim_block.test.ts` | `FAFF_CIM_PROBE` |
| `lib/plan/_probe_cim_phases.test.ts` | `FAFF_CIM_PROBE` |
| `lib/plan/_probe_cim_sessions.test.ts` | `FAFF_CIM_PROBE` |
| `lib/plan/_probe_race_pace.test.ts` | `FAFF_RACE_PACE_PROBE` |
| `lib/plan/_probe_stage2b.test.ts` | `FAFF_S2B_PROBE` |

Two more in the set carry the same shape and did run, because their gate is a
database rather than a flag: `lib/plan/_open_block_authoring.test.ts`
(`HAS_DATABASE`) and `lib/plan/_authoring_shadow_compare.audit.test.ts` (`RO`).

## The skipped five, run

All five were then run WITH their flags set, against production read-only, with
the anchor live — these are the probes that compose the owner's own CIM block
and assert what the phone shows:

```
FAFF_CIM_PROBE=1 FAFF_RACE_PACE_PROBE=1 FAFF_S2B_PROBE=1
Test Files  7 passed (7)
     Tests  31 passed (31)
  Duration  112.14s
```

## The validator, run directly

`validateComposedPlan(result, raceDistanceMi, mode, ctx, opts)` was called on the
composed block outside the test suites, with both advisory sinks attached. Its
verbatim verdict and every advisory dosing and combined-stress finding are in
`AFTER-composed-plan.md` §8.

## The prebuild gate chain

All 19 scripts in `web-v2`'s `prebuild` green, including `check-doctrine`,
`check-normal-window`, `check-goal-immutability`, `check-anchor-derivation`,
`check-goal-pace-leak`, `check-goal-volume-leak` and `check-client-graph`.
`next build` green (the push hook runs it — Rule 19's last step).

## What this evidence does NOT cover

- No suite here composes a block and then WRITES it. The persistence half is
  exercised only through `persistsComposedDay` and `persistedDayShape`, called
  directly by the preview. A defect that lives in `persistPlan`'s SQL rather
  than in the row shape those two produce would not be caught by any of this.
- `_sweep_allusers`'s 11,598 archetypes still cannot express a runner with a
  history (CLAUDE.md Rule 15), so its green says nothing about the four
  history-gated mechanisms, and nothing here changes that.
- The iPhone and watch surfaces were not rendered. This preview proves what the
  backend would write, not what the phone would draw from it.
