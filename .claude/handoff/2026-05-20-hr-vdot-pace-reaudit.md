# Handoff · HR / VDOT / pace coaching re-audit (for the agent on `main`)

**Base for all line numbers:** `origin/main` @ `2d9e27d` (2026-05-20). `main` moves fast — grep to confirm anchors before editing.

**Reference implementation (DO NOT cherry-pick):** commit `f43fb7a` on `origin/claude/build-runcino-app-OIRJr`. Read it for the *ideas* (`git show f43fb7a`). It was built on a stale base and a cherry-pick onto `main` conflicts in `coach-state.ts` + `vdot.ts` and would REGRESS main (clobbers HealthKit RHR, revives the deprecated `E = M+75` pace formula). See the "Branching & integration" section added to root `CLAUDE.md` (commit `2d9e27d`) for the why.

---

## What we did

Audited how the app turns heart rate, VDOT, and race results into coaching decisions. Found 10 issues; the core problem: the app collects the runner's max HR but the **coach engine ignores it and judges everyone against flat cutoffs (152 bpm "hard", 170 bpm "redlined") that are only right for a ~30-year-old.** Built fixes on the dev branch, then discovered `main` had already diverged ahead with real HR infrastructure. This doc is the re-audit of those findings against `main`'s *current* code.

## Key realization for `main`

`main` ALREADY HAS the HR infrastructure (better than the dev attempt — it's Karvonen/HRR-aware):

- `web/lib/compute-max-hr.ts` → `resolveEffectiveMaxHr(userId)` — measured/computed max HR.
- `web/lib/hr-zones.ts` → `buildFitnessHrZones(maxHr, restingHr)` — returns `z1..z5` with `lowBpm`/`highBpm`. Z4 Threshold = 80–90%, Z5 = 90–100%. Uses HRR (resting-HR-adjusted) when RHR known, else %max.
- `web/lib/fitness-resolver.ts` → `resolveFitness(userId, today)` → `ResolvedFitness { hrZones, maxHr, restingHr, vdot, paces, ... }`. This is the single source of truth for per-runner fitness signals.

**So the remaining work is NOT building HRmax resolution — it's feeding `main`'s existing zones into the coach engine, which still uses flat constants.** The personalized "hard" floor = `z4.lowBpm`; "redlined" = `z4.highBpm` (or `z5.lowBpm`).

## Re-audit verdict (against `main` @ 2d9e27d)

| # | Finding | Status on main | Fix |
|---|---------|----------------|-----|
| 1 | 24h-recovery gate is pure-HR (`coach-engine.ts:821` `avgHr >= 152` only) — misses a tempo at 145–150 bpm | OPEN | `hard = isHardByName(name) OR avgHr >= z4.lowBpm` (the `isProbablyHard` name regex already lives in `strava-stats.ts`; export a `isHardByName(name)` helper) |
| 2 | Profile HR not in coach engine | INFRA EXISTS, not plumbed | Plumb zones (or just `z4.lowBpm` + `z4.highBpm`) into `CoachState` via `gatherCoachState` (already multi-tenant `opts.userId`, already calls `gatherHealthBiometrics`) |
| 3 | Hard-effort cutoff flat 152 (`coach-principles.ts:242` `HARD_EFFORT_HR_DEFAULT_BPM`) | OPEN | Use `z4.lowBpm` when zones known; keep 152 as the no-data fallback |
| 4 | Quality redline flat 170 (`strava-stats.ts:660` `scoreQualitySession(..., hrCeiling = 170)`) | OPEN | Use `z4.highBpm`/`z5.lowBpm`; keep 170 fallback |
| 5 | `effortBalance` flat 152 (`strava-stats.ts:571`) | OPEN | Pass `z4.lowBpm`; keep 152 fallback |
| 6 | `coach/doctrine/hr_zones.ts` header (line ~7–16) claims the 152 cutoff was "replaced with research-backed threshold" — it WASN'T | OPEN | After #1/#3 land it becomes true; until then, fix the header to say WIRED vs NOT-YET-WIRED |
| 7 | E-pace `E = M + 75` offset | **OBSOLETE — DROP** | `main` replaced it with `resolveTrainingPaces` (canonical Daniels Table 2; see `docs/2026-05-19-sim-sweep.md`). Do NOT reintroduce a `+75` constant. |
| 8 | Riegel exponent `1.06` copy-pasted ×3 (`coach.ts:1659`, `:2467`, `:2888`) | OPEN | Extract `RIEGEL_EXPONENT` in `coach/doctrine/race_prediction.ts` (already has `RIEGEL_FORMULA.defaultExponent`); reference it at the 3 `Math.pow` sites |
| 9 | `MARATHON_VDOT_CORRECTION` (`coach/doctrine/pace_zones.ts:502`, −1.5 VDOT, cited) has **zero consumers** | OPEN | Wire into the M-pace path **only after** checking whether `resolveTrainingPaces` already applies a marathon adjustment. Gate strictly: source race is 5K/10K AND no marathon-specific long-run block, AND only when activity history is present (don't auto-correct on absence of data). |
| 10 | Daily prescribed paces never adjusted for heat/humidity/altitude (`weather-slowdown.ts` only feeds the race brief) | DEFER — it's a feature | Needs weather plumbed into `CoachState` first, plus a design call (slow the pace vs switch to effort/HR). Out of scope for this pass. |

## Recommended sequence

1. Plumb HR zones into `CoachState` (the keystone — unblocks #1/#3/#4/#5). `gatherCoachState` already resolves biometrics per `userId`; add `resolveEffectiveMaxHr` + `buildFitnessHrZones` (or reuse `resolveFitness`) and attach `z4.lowBpm` / `z4.highBpm` to state.
2. Rewire #1, #3, #4, #5 off those bands.
3. #8 (mechanical), #6 (doc), then #9 (most care — check the resolver first).
4. Drop #7. Defer #10.

## What to check / verify

- **Typecheck:** worktree needs `node_modules`; symlink the parent repo's: from `web/`, `ln -sfn ../../../../web/node_modules node_modules`, then `node_modules/.bin/tsc --noEmit -p tsconfig.json`.
- **Tests:** `node_modules/.bin/vitest run lib/__tests__ coach`.
- **Known pre-existing noise — do NOT chase (fails on clean `main` too):**
  - `coach-engine-events.test.ts` → "long-run plan ramps… 13.9 vs ≥14" (brittle boundary, off by 0.1).
  - `retrospective.test.ts` → `ENOENT … web/public/big-sur-3-50.runcino.json` (fixture exists in the parent checkout, absent in worktrees).
- **Behavior-neutrality gate:** when `maxHr` is unknown (no HR data), every threshold MUST fall back to the existing 152/170 so users without HR data see no change. Verify the fallback path.
- **Concurrency:** `coach-state.ts`, `coach-engine.ts`, `strava-stats.ts` are the hot files — fetch + rebase right before pushing; fast-forward only.

## Don't

- Don't cherry-pick `f43fb7a`.
- Don't add `resolveEffectiveHrmax` / `HRMAX_FRACTION` constants — `main`'s `buildFitnessHrZones` already does this, HRR-aware.
- Don't reintroduce `E = M + 75`.
- Don't auto-apply the marathon correction on missing data, and don't wire it before confirming `resolveTrainingPaces` doesn't already handle it.
