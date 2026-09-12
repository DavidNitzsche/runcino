# Handback — Wave 3 (2026-09-11)

New movement only, per your standing instruction — see `docs/audit-2026-09-11-session-handback.md` and `docs/audit-2026-09-11-handback-movement-2.md` for everything before this wave.

## 1. Merges and deployments this wave

| Branch | Merge commit | New `origin/main` | Railway |
|---|---|---|---|
| `feat/shipping-lock-and-artifact-mapping` @ `1050a48c7` | `952b40d0d` | — | folded into next |
| `fix/standing-recommendation-convergence-and-cutback-copy` @ `ab5a5eb7c` | `e32dde4a7` | — | folded into next |
| `fix/cold-open-cache-honesty` @ `2a8ee1d89` | `333f520f4` | **`333f520f49079c5fffebd8caaddea5dbd955ba34`** | `[PROD]` SUCCESS |
| `fix/execution-identity-watch-matcher` @ `f4cbb67f8` | `6fd65a6f6` | `6fd65a6f642631fc7a9528a67e970f2df748d573` | `[PROD]` SUCCESS |
| `fix/postrun-missing-pace-routing` @ `859ea18f3` | `4bfd69ad9` | **`4bfd69ad9b3ad029555e8d8267192001d28e2f30`** | `[PROD]` SUCCESS — independently confirmed live via a real `curl www.faff.run/api/up` → 200, not just Railway's own report |

The shipping lock (`scripts/main-push-lock.sh`) is now live on `main` and has been used for real, including catching a genuine concurrent authorization from a parallel merge in this same wave — the mechanism is doing real work, not just installed.

Missing-pace's own copy required one small fixup mid-integration: a real, non-drift-induced em dash in its own `MILEFALLBACK-LABEL-1` commit tripped the coach-voice gate. Fixed (`—` → `·`), confirmed not drift-induced by testing the branch tip standalone, re-verified clean.

## 2. Holds resolved

**Lane A (`fix/recovery-honesty-strides-grading`) — fully resolved across 3 review rounds, ready for merge.** Your product-correctness challenge was answered concretely, not just technically:
- The mechanism fix (`886d1529e`) is correct — recovery-honesty grading now reaches strides workouts.
- A real investigation into David's real workout found a genuine THIRD state beyond the four requested: a silent-short recovery with no wire signal distinguishing "chose to advance" from anything else (a pre-existing watch-firmware gap, not fixable here). It also found the mechanism itself doesn't mislabel anything — but the "Coach's Read" composer text did, falsely implying inconsistent *work* when only recovery timing varied. Fixed (`b018980c1`): neutral, honest wording that works for both the "chose it" and "unknown reason" cases without asserting either.
- That fix itself then failed its own standard — a literal em dash, plus the discovery that the coach-voice gate doesn't even scan the directory that authors this text (`lib/postrun`, the same gate-scope-gap shape that already burned this project once via `lib/plan`). Both fixed (`b13c2c59a`): em dash removed, `lib/postrun` added to the gate's scan targets (383 files now scanned, up from 377), and — because the gate can now see that directory — it immediately found two more pre-existing violations, correctly reported rather than silently touched (one confirmed safe/server-only, one confirmed genuinely runner-facing and needing the same treatment as a follow-up).
- Final independent pass: PASS, no conditions.

**CIM elevation (`fix/cim-elevation-integrity`) — fully resolved, ready for merge.** Confirmed two ways: structurally (the choice card with an actionable "use my measurement" button is architecturally unreachable for ANY curated course, not just incidentally not firing today — traced the confidence computation exhaustively) and by actual simulator render (screenshot matches the confirmed payload character-for-character: one "Acknowledge" button, correct numbers, correct copy). The render process itself caught a real methodological trap — a stale `simctl install` that silently didn't replace the binary despite reporting success, caught via MD5 comparison before trusting the screenshot.

**Santa Monica copy — REJECTED, held as a failed reference case, not merged.** Your critique of the rewrite was sharp and specific (repetitive phrasing, mechanical/threatening tone, a meaningless "yours to change" claim with no verified control behind it). `38d090ec8` stays held. A new, dedicated **Natural Coaching Experience owner** session is now running, scoped exactly as you specified (presentation language only, real rendered outputs across all 7 named surfaces, canonical facts not recomputed conclusions, David's real data, this Santa Monica case as its first acceptance test) — result pending.

## 3. Race-week protection: three more branches, three review rounds, all clean

Beyond the already-merged `adapt.ts`/`mutate.ts`/`dose-guard.ts` fix, four more sites of the same `is_race_week`-column-only bug were found and fixed this wave, with review catching real gaps at every step — this bug shape has now touched **9 confirmed sites**, not the "7, exhaustive" originally believed:

- `fix/progression-pass-race-week-protection` @ `ee6df002d` — PASS. Fixed `progression-pass.ts`'s two sites plus `replan/route.ts`'s sick-ladder (confirmed same shape despite that file's own header comment claiming otherwise).
- `fix/load-adaptation-week-ahead-race-detection` @ `3d382824c` — PASS WITH CONDITIONS, resolved. Fixed a 4th site feeding the Adaptation Engine's lever eligibility. **Real dependency confirmed**: this branch cannot compile against plain `main` (proven with an actual `tsc` error) — must merge after the branch above. Review also found, with live DB access, that the reference example I'd been citing (Santa Monica 10K) is actually protected by `is_cutback`, not by this fix, at 3 of 4 sites — a better real proof exists instead (David's real Dodgers 10K tune-up week, confirmed flipping from the buggy `null` to correct `RACE_WEEK` on real data).
- `fix/replan-scenarios-race-week-protection` @ `c57733696` — PASS after 3 rounds, ready for merge. Found and fixed a 5th unfixed site (`replan-scenarios.ts`, five call sites, with genuinely nuanced per-site GOAL-only-vs-any-race decisions — verified independently, including one deliberately-correct non-fix backed by this project's own RACEWEEK-2 doctrine). Second review round caught a 6th site (`move-orchestrator.ts`) whose own doc comment claimed parity with the just-fixed `weekMiles` — a parity this fix had silently broken. Fixed and re-verified: the two surfaces genuinely disagreed (47.2mi vs 41mi for the same real tune-up-week shape) and now agree.
- **Two more sites confirmed real but explicitly deferred, not yet dispatched**: `strategy-contracts.ts`'s week-role labeling, and several sites in the adjudication layer (`adjudicate.ts`/`live-sequence.ts`) — the adjudication layer's own code already admits this exact blindness in a header comment. Your call on whether to take these up now.

## 4. Finding 3 (missed/skipped/moved) — fully closed, ready for merge

`fix/missed-skipped-moved-state` @ `6db2859d7`. Two review rounds:
- First pass on the core mechanism: PASS WITH CONDITIONS. Everything actually executed was solid (17/17 tests, 506/506 native, real button-taps proving live wiring — one correctly triggered a genuine 401/sign-out against an unauthenticated request). But a significant gap was found beyond what was disclosed: `PlanSnapshotStore`, the app's own stated "ONLY" path for date navigation, bypassed the whole feature by default — not an edge case, the default case for the population this feature exists to serve.
- Fix chose the more thorough option: made the snapshot itself carry resolution data (reusing the canonical resolver, not re-deriving it) rather than just routing around the gap.
- Second, final review: PASS. Independently reproduced the exact "before" (a real missed Thursday and a real skipped day carry no resolution field) and "after" (both correctly resolve) against a real copy of the reference runner's data at both commits — not fixtures. All test counts matched exactly on independent re-execution.

## 5. Infrastructure

**Shipping lock — 3 real defects found by adversarial review, all fixed and re-verified.** A main-branch-deletion bypass, a TTL-fails-open bug reachable via a genuine concurrency race, and a false-clean SHA-verification gap. All reproduced with real pushes against a real scratch remote, fixed, and re-verified with even more rigor than the original attack. Now merged and live (see §1).

**Pre-push hook's silent node_modules skip** — found live this session (it's exactly how one of Lane A's commits went unverified). Fixed: `fix/pre-push-node-modules-gate` @ `94ebc8e4d`, chose fail-loud over auto-install for a well-reasoned concurrency argument, proved via a real end-to-end push through the actual production hook chain. PASS WITH CONDITIONS: correct and safe, but now blocks *every* push from a fresh worktree regardless of whether it touches `web-v2` — real friction given how many concurrent worktrees this repo runs. Recommended follow-up: scope the check to web-v2-touching pushes only. Not dispatched yet, pending your call.

## 6. Runner Data receipt & canonical v3

Runner Data's provenance receipt independently verified PASS (hash-by-hash, ancestry, content-alteration check) — accepted, provenance gate closed. This directly unblocked the missing-pace merge (§1). The StateScreens merge-parent inconsistency you flagged was independently re-verified against live git history and folded into the actual canonical v3 draft document (not just this handback).

## Current merge-candidate roster — all independently reviewed, clean, awaiting your authorization

- `fix/recovery-honesty-strides-grading` @ `b13c2c59a`
- `fix/cim-elevation-integrity` @ `1b31a55ae`
- `fix/progression-pass-race-week-protection` @ `ee6df002d`
- `fix/load-adaptation-week-ahead-race-detection` @ `3d382824c` (merge after the above)
- `fix/replan-scenarios-race-week-protection` @ `c57733696`
- `fix/missed-skipped-moved-state` @ `6db2859d7`
- `fix/pre-push-node-modules-gate` @ `94ebc8e4d`

**Held, not for merge:** `fix/santa-monica-race-day-copy` @ `38d090ec8` (rejected reference case).

## Still open / awaiting you

- Natural Coaching Experience session's first result (Santa Monica v2).
- `strategy-contracts.ts` / adjudication-layer race-week follow-ups — flagged, not dispatched.
- `experience.ts:711`'s em-dash follow-up (found by the widened coach-voice gate) — flagged, not dispatched.
- The node_modules gate's web-v2-scoping follow-up — flagged, not dispatched.
- Migration 166/170: still not authorized.
- No TestFlight candidate authorized.
