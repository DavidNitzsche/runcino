# Overnight Report

Findings from queued overnight items. Each: evidence (real data, read-only), recommendation, status. **No deploy without David's GO.**

---

## ITEM — Weather adjustment in verdicts (logged 2026-06-08)

**Question:** for the Jun 4 tempo, pull the run's weather, compute the weather-adjusted target, show whether the verdict changes missed→nailed, and recommend whether the done-state verdict should heat-adjust the frozen target before comparing.

### ⚠️ Timing correction
E3 + E5 are **already deployed** (`origin/main` `6fd541e3`, on David's prior "GO on E3+E5"). So this is a **post-deploy** check, not a pre-deploy gate. The deployed E5 verdict is **heat-unaware** — see below; the fix is a **fix-forward** (code-complete, uncommitted, awaiting GO).

### Evidence (read-only, prod data)

**Jun 4 weather is not stored as a slowdown — it's derived.** The canonical row carries raw weather only: `{temp_f: 68.4, humidity_pct: 71, conditions: 'clear', cloud_cover_pct: 16, wind_mph: 3.7}`, `durationSec: 3579`. No `slowdownPct` on the row (David's premise corrected — it's computed at read time via `judgeWeather`).

**`judgeWeather(Jun 4) → slowdownPct = 7.9%` (hot band).** Heat-adjusted tempo target = `419 × 1.079 = 452 s/mi` (7:32/mi). Band = `[target−10, effTarget+10] = [409, 462]`.

| run | slowdown | frozen tgt | actual | raw verdict | heat-adjusted (= phase panel) | done-state |
|---|---|---|---|---|---|---|
| **Jun 4** tempo | 7.9% | 419 (6:59) | 437 (7:17) | **missed** (437 > 431) | effTgt 452 → band [409,462] → **on** | **short → NAILED** |
| **Jun 2** intervals | 11.4% | 389 (6:29) | 388/393/418/421 | reps 3,4 **missed** | effTgt 433 → all 4 **on** | **short → NAILED** |
| Jun 5 easy | 9.7% | 492 | 501 | ok | effTgt 540 → on | nailed (unchanged) |
| Jun 7 long | 0% | 480 | 481 | ok | 480 → on | nailed (unchanged) |

**Both Jun 2 and Jun 4 flip short → nailed under heat adjustment.** At 68–74°F the paces the runner held were *better than the heat-honest target* — they executed correctly for the conditions, not "short."

### Root finding: the deployed E5 is inconsistent with the phase panel
`loadPhaseBreakdown` (run-state.ts:855–863 — the per-rep phase panel) **already heat-adjusts** (`effectiveTarget = target × (1 + slowdownPct/100)`, band `[target−10, effTarget+10]`). The deployed E5 `computeTodayExecution` did **not** — it trusted the watch's on-device `verdict` (weather-unaware) + a raw `target+12` fallback. So on a hot run the phase panel reads a rep "on" while the done-state reads the session "short". Same screen, opposite verdict. The watch verdict is computed on-device without weather context and must not be trusted for this.

### Recommendation: YES — heat-adjust the done-state verdict
Two reasons: (1) **consistency** — the phase panel already does, so not doing it in the done-state is a guaranteed cross-surface contradiction; (2) **coaching correctness** — calling a heat-honest tempo "came up short" is exactly the kind of dishonest read the weather doctrine (Research/06) exists to prevent.

### Fix (IMPLEMENTED · uncommitted · awaiting GO) — `lib/coach/glance-state.ts`
`computeTodayExecution` now fetches the run's weather, derives `slowdownPct` via `judgeWeather` (same call `computeHeatSlowdownForRun` uses), and judges each work phase against the heat-honest target — identical band math to `loadPhaseBreakdown`. The watch `verdict` field is no longer consulted.

```js
const effTarget = slowdownPct >= 2 ? Math.round(tgt * (1 + slowdownPct / 100)) : tgt;
return Number(ph.actualPaceSPerMi) > effTarget + 10;   // "missed" only past the heat allowance
```

`workCutShort` (a work phase that didn't complete) and the ≥⅓ share threshold are unchanged. "short" now means **missed even after the heat allowance**, or the quality block abandoned mid-work.

**Effect on the deployed verdicts:** Jun 2 and Jun 4 go from "CAME UP SHORT / ◑ PARTIAL" → "NAILED IT / ✓ PLAN HIT". Jun 5/7 unchanged.

**Falsifiers:** tsc 0 · vitest 380 passed / 3 skipped / 0 failed · replicated-logic falsifier (`_e_heat_verdict.mjs`, RO prod data) shows both flips; judgeWeather slowdown cross-checked against the real module import (Jun 4 = 7.9%).

### Related follow-up (out of this item's scope)
The **recap win line** (`run-win.ts` `winTempo`/`winLong`, used by E3's `deriveWin`) is also weather-unaware — a raw delta vs the target. It isn't mis-firing on these specific runs (winTempo gets the whole-run avg, which is far from the segment target, so it returns null), but for full consistency it should heat-adjust too. Logged, not implemented.

### Status
- E3 + E5: **deployed** to `main` (raw, heat-unaware E5 verdict live now).
- Heat-adjustment fix: **code-complete, committed to branch `claude/sweet-carson-b36ea7` (pushed), NOT on `main`.** Persisted so it survives overnight; pushing the branch does not trigger Railway (only `main` does). The deployed E5 currently mislabels heat-honest runs (Jun 2, Jun 4, any future hot run) as "short" until this ships. **Awaiting GO to fast-forward `main` (commit `<branch tip>`) → Railway.**
