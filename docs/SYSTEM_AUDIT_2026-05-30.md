# System Audit · 2026-05-30 · Full-auto Simulation Pass

**Scope.** Run simulations across every major system path. Find holes,
fix what's auto-fixable, queue what needs David's input. Push each fix
to main. Repeat.

**Approach.** Read code, trace data flows, run targeted probes against
production read-only. Don't pollute David's row — use synthetic
fixtures or pure-function tests where possible.

---

## Status

| Sim | Subject | Status | Findings |
|---|---|---|---|
| SIM-01 | New user onboarding completeness | _pending_ | — |
| SIM-02 | Plan library coverage | _pending_ | — |
| SIM-03 | Race priority lifecycle | _pending_ | — |
| SIM-04 | Pre/post run data loop | _pending_ | — |
| SIM-05 | Sync dedup (Strava / Apple Health / watch) | _pending_ | — |
| SIM-06 | Plan adaptation triggers | _pending_ | — |
| SIM-07 | Doctrine alignment audit | _pending_ | — |
| SIM-08 | Cold-start coach behavior | _pending_ | — |

---

## Findings log

(Findings are appended as simulations complete. Each finding tagged
**P0** / **P1** / **P2** by impact + status **FIXED** / **DOCUMENTED** /
**QUESTION**.)
