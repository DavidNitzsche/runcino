# S2 · Cross-surface context-filter reuse audit

**Date:** 2026-05-19 round 5
**Status:** complete · one inconsistency fixed inline

## Matrix · which surface applies which context filter

| Filter | L7 Signal 1 | L7 Signal 2 | L7 Signal 3 | V5 Z2 stimulus | V5 under-reach | VDOT shift guard | Readiness score | Race trajectory |
|---|---|---|---|---|---|---|---|---|
| **Heat >78°F** | ✅ | ✅ | ✅ | n/a* | ✅ (this audit) | n/a | ⚠️ deferred | (inherits from L7) |
| **Race-recency ±7d** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ deferred | (inherits from L7) |
| **Race-week suspend ≤7d** | ✅ verdict | ✅ verdict | ✅ verdict | ✅ surface-level | n/a | n/a | n/a | (inherits from L7) |
| **Injury mark (signalsSuspended)** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ deferred | ✅ | (inherits from L7) |

*V5 Z2 stimulus check uses HR-in-band on per-mile splits to define Z2. Heat doesn't need a separate filter at the band-definition layer because higher HR in heat means FEWER splits qualify as Z2, not more.

## Findings

### FIXED inline this audit · V5 threshold-under-reach was missing heat filter

The under-reach sub-finding inside the V5 surface walked recent threshold workouts looking for "pace in T-band, HR below Z4 floor" — the downstream evidence connecting "easy days too hard → can't hit Z4 in workouts." But this lookup wasn't applying the heat filter that L7 Signal 1 uses for the same shape of observation. A pace-in-T-band, HR-sub-Z4 workout in heat is explained by heat (cardiac drift slows pace AND artificially depresses HR-to-pace ratio at threshold effort) — NOT by easy-day overload.

**Fix:** import `HEAT_CEILING_F` + `getWorkoutTemperatureF`; per-workout skip when temp > 78°F. Applied to `findThresholdUnderReach()` in `lib/z2-coverage.ts`.

Same pattern as the race-recency fix shipped earlier (commit `99f9bd4`) — when a surface aggregates downstream findings, each finding applies its own context filters concretely (Rule 5).

### DEFERRED · two filters not yet applied to two surfaces

1. **Readiness score · heat filter on yesterday's load.** Currently the readiness score reads yesterday's avgHr / workoutType to classify as hard/long/easy. A hot easy run produces elevated HR even at conversational effort — could be misclassified as "hard" via the HR check. Real but minor; would over-penalize the readiness score on hot easy days.
   - **Why deferred:** the impact is modest (single-day score variance) and the fix isn't trivial (needs per-workout temp lookup, adds a network call to the SSR pass). Worth queuing if David sees readiness scores he disagrees with after hot days.

2. **Readiness score · race-recency filter on hard-session count.** A hard session within 7 days of a race is taper-pace work, not the same recovery cost as an out-of-context hard session. Could under-fire "freshness" boost when really the runner is well-rested between taper sessions.
   - **Why deferred:** taper hard sessions ARE legitimate stress just packaged differently. The current logic treats them as hard sessions, which is approximately right.

3. **VDOT shift guard · injury suspension.** Shift guard currently fires when aggregate VDOT moves >2pts from last review. During injury, no new races land, so aggregate doesn't typically move. But if a race result lands mid-injury (e.g., user races during what they later mark as an injury window), shift guard could fire spuriously.
   - **Why deferred:** edge case. The injury-mark path explicitly suspends L7 signal evaluation; the shift guard is a different surface watching the aggregate. The aggregate-watch makes sense even during injury — if a race result lands while injured, the user probably wants to know the resulting VDOT moved.

## What this audit confirms

The five locked rules + candidate Rule 6 are doing real work. Specifically Rule 5 (per-finding context filters) — every audit row here is a Rule 5 application or a deferred Rule 5 candidate. The discipline of "each finding applies its own filters concretely" makes the matrix straightforward to read and the gaps easy to identify.

Heat filter discovered missing on V5 under-reach during this audit. Without the audit it would have surfaced as a "huh, why did V5 say my easy runs were too hard the day after a hot tempo?" moment in production. Better to find it in the audit pass.

## Recommendation

Lock the matrix above as the source of truth for "which filter applies where." When a new surface ships, add a column to the matrix and explicitly mark each filter applied/deferred. The matrix becomes the structural artifact preventing the "I forgot to add the race-recency check on the new surface" class of bug.

This is similar discipline to the L6 source-of-truth checklist — a small, narrow, mechanical check that catches a whole class of bugs.
