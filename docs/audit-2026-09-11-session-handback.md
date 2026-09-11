# Session Handback — 2026-09-11 — Full Detail

**Status:** This document is a complete record of everything executed, found, fixed, reviewed, merged, and deployed in this session. It is NOT the same document as `docs/audit-2026-09-11-canonical-record-v3-DRAFT.md` (the three-audit-packet reconciliation, still labeled DRAFT pending Runner Data's provenance receipt) — this handback covers the full engineering session, cross-references that draft, and should be read alongside it.

**Evidence tags used below:** `[SRC]` = confirmed by reading source directly · `[TEST]` = confirmed by running a test · `[SIM]` = confirmed by simulator render · `[PROD]` = confirmed against live production (DB query, ASC API, Railway API) · `[DEVICE]` = confirmed on David's physical phone · `[INF]` = inference, not directly proven · `[BLOCKED]` = could not be verified, reason stated.

---

## 1. Executive summary

- **`origin/main` is now `72ae3831ff841f87f1a76f143ed1b92f4b19feeb`**, up from `9696decac2` at session start — a 6-branch integration wave landed, built, tested, and **deployed to Railway production** `[PROD]` (confirmed `SUCCESS` via live Railway API poll, not assumed from a push).
- `docs/PRODUCT_DECISIONS.md`'s literal, live git-conflict markers — present on `main` since before this session and confirmed broken twice — are now fixed on `main`.
- Three new implementation lanes (A/B/D) landed real fixes for confirmed cross-audit findings; a fourth (G) produced a UX/IA acceptance plan. **Lane B is fully independently reviewed and clean. Lanes A and D are implemented and pushed, but their independent reviews were dispatched only just now, after an accuracy correction — see §4.**
- Four new runner-observed physical-device findings were investigated to full root cause; none implemented yet (see §5) — all are precisely scoped and ready for a lane assignment.
- Real, tested infrastructure was built for a machine-wide shipping lock and TestFlight artifact-SHA mapping (§6), and rollout/rollback evidence was prepared for Migrations 166/170 without applying either (§6).
- **No TestFlight candidate has been cut.** Build 290 (source `0dce24f23`) remains the only build ever uploaded and is now 118+ commits behind `main` before today's integration, more after. It contains none of this session's work.
- Canonical v3 remains explicitly a DRAFT. Brain and Coach packets are fully integrated into it; Runner Data's findings are integrated but its **provenance receipt** is still the one thing standing between the draft and real canonical status.

---

## 2. Production state

| Fact | Value | Evidence |
|---|---|---|
| `origin/main` HEAD | `72ae3831ff841f87f1a76f143ed1b92f4b19feeb` | `[SRC]` `git rev-parse origin/main` |
| Railway deployment for that SHA | `SUCCESS` | `[PROD]` polled live via `railway status --json` until terminal state |
| `build-check` / `test-full` / `native-check` | All green on the integrated tree | `[TEST]` see §3 |
| `audit-suite` | Red — `DATABASE_URL_RO` not a GitHub secret | `[PROD]` `gh run list`; human action only, see §8 |
| Migration 166 (`plan_decision_ledger`) | NOT applied | `[PROD]` live `SELECT to_regclass(...)` → NULL |
| Migration 170 (`request_failures`) | NOT applied | `[PROD]` same query → NULL |
| Latest TestFlight build | 290, source `0dce24f23`, uploaded 2026-09-07 | `[PROD]` live ASC query; confirmed still the only build in existence |
| Commits behind `main` (pre-integration) | 118 | `[SRC]` `git rev-list --count 0dce24f23..origin/main` at last check; now higher post-integration |

---

## 3. The 6-branch integration wave — MERGED, BUILT, DEPLOYED

Executed by a single dedicated integration agent, sequentially, in one isolated worktree off a freshly-fetched `origin/main`, with explicit one-time authorization to push to `origin/main` (the sole exception this session to the standing no-merge rule).

| # | Branch | Tip (pre-integration) | Merge commit | Conflicts | Targeted test result |
|---|---|---|---|---|---|
| 1 | `fix/product-decisions-conflict-and-watch-gate-log` | `24326a35d` | `789bbe697` | None | Conflict markers gone; `check-watch.sh`/`shoot.sh` overridable paths verified |
| 2 | `fix/sealed-identity-canonical-resolver` | `0883490f0` | `9e896de3b` | 1 auto-merge, inspected clean | 40 passed, 1 DB-gated skip |
| 3 | `fix/treadmill-cues-menu-overlay` | `9462c8205` | `911531bdc` | `project.pbxproj` — real conflict (two branches each added a new test file at the same list index) + routine `TEMP_<uuid>` churn, resolved via `--ours` + `xcodegen generate`, verified by grep + clean build | 13/13 passed |
| 4 | `fix/race-week-protection-tuneup-gaps` | `ffe5ee553` | `9094b994f` | None | 17/17 passed (matches 7→17 falsification exactly); `progression-pass.ts` confirmed untouched, not silently expanded |
| 5 | `fix/scroll-header-status-bar-collision` | `7502f8166` | `4437f5815` | `project.pbxproj` churn only | Full `FaffTests` 506/506 |
| 6 | `fix/statescreens-scaffold-stale-banner-ordering` | `25d193b27` (already an ancestor via #5) | `686dfe3f3` | None | `StateScreenScaffoldStaleBannerCompositionUITests` 1/1; full `FaffTests` 506/506 |

**Two standalone fixup commits**, found and fixed by the integration agent after merging (prebuild lint caught them, not part of any of the six branches' own reviewed diffs): `610c4725b` (hardcoded panel-ink color instead of computed value, `check-panel-ink.sh`) and `72ae3831f` (an em dash in `ScrollClock3RegressionV5`'s harness label, `check-coach-voice.sh`).

**Combined gate results on the fully-merged tree** `[TEST]`:
- `npm run prebuild`: 30/30 gates pass, `tsc --noEmit` 0 errors, `next build` succeeded (73 static pages).
- Full `vitest run` (no path filter): 599 files / 12,007 tests passed, 205 skipped, **0 failed**. Liveness floor (300 files / 7000 tests) cleared with margin.
- Native `FaffTests`: 506/506. `FaffUITests`: 15 executed, 14 env-gated skips (need `FAFF_UI_HOST`/`TOKEN`), 0 failures. Watch suite: 234/234. `check-watch.sh`: `WATCH-GATE: OK` (one environmental flake diagnosed and cleared on retry — a shared-simulator resource contention, reproduced identically on a clean pre-merge checkout, confirmed not code-caused).
- `audit-suite`: correctly left red, not treated as a gate (see §2).

**Unrelated main content preserved** — shown, not asserted: every merge was diffed against both parents (`HEAD^1` and `HEAD^2`), confirming each merge touched only its own branch's stated files and correctly folded in main's independent accumulated work (12 files at merge 1, growing to 80 by merge 6). The one non-trivial auto-merge (`generated-content-registry.ts` in merge 2) was inspected directly and confirmed to correctly combine both sides' changes with no clobbering.

---

## 4. New implementation lanes

### Lane A — Recovery honesty
**Branch:** `fix/recovery-honesty-strides-grading` @ `886d1529ee3c91b7e1c8443a3f36cf07e4097c3c`. **Status: IMPLEMENTED, PUSHED — independent review dispatched, not yet returned.**

Root cause (deeper than the original brief assumed): `resolveWorkoutVerdict()` in `web-v2/lib/execution/verdict.ts` read only `spec.rep_rest_s`, but strides-format workouts never carry that field — and the real wire completion payload carries no `targetDurationSec` at all, so recovery-honesty grading for **every** strides workout was permanently `null` (no signal), not merely sometimes wrong. Fix: `restS ?? stridesRecoverySec` precedence.

Nine-case falsification matrix, all in a new test file: 6/9 red pre-fix exactly as predicted, 9/9 green post-fix `[TEST]`. Full adjacent suites: 4700 passed, 0 new failures. Full repo suite: 11,990 passed, 1 pre-existing unrelated `DATABASE_URL_RO`-gated failure. `tsc --noEmit` clean.

**Push required a documented `docs/VERIFICATION_POLICY.md` bypass** — the watch-gate failed on `SessionTimelineTests` dying under confirmed concurrent-agent simulator contention, unrelated to this web-only diff (independently spot-checked by Main: `tsc` clean, 243/244 targeted tests pass in a fresh isolated worktree at the exact commit). Bypass justification recorded via `git notes` on the commit — closing the documentation gap flagged twice earlier this session on a different branch.

Flagged but explicitly NOT fixed (correct scope discipline): `web-v2/lib/training/_recovery_ended_early.test.ts` exercises `gradeStoredPhases` with a synthetic `targetDurationSec` shape real completion data never produces — a Rule 15 test-corpus blind spot in a sibling file, named for a future pass, not folded into this branch.

**Independent review: dispatched (agent `a18774208db5beef7`), result pending.**

### Lane B — Execution identity
**Branch:** `fix/execution-identity-watch-matcher` @ `f4cbb67f88b75a33217ff7dc08fa5ac330630dd0`. **Status: IMPLEMENTED, PUSHED, INDEPENDENTLY REVIEWED — PASS. Ready for merge.**

Confirmed by both Runner Data v2.1 and Brain as the same underlying defect: the primary watch-completion matcher (`app/api/watch/workouts/complete/route.ts`, confirmed the live tier-5-canonical route for Watch/treadmill/phone-GPS) carried an inline symmetric `[0.7, 1.3]` band with silent closest-delta tie-breaking, duplicated separately (and slightly better, asymmetric `[0.7, 2.0]`) in a sibling ingest route. Fix extracted one shared `selectMatchingPlanDay()` (asymmetric band + a `NormalReading<T>`-style discriminated-union refusal) into `lib/runs/plan-type-stamp.ts`, used by both routes now — eliminating the duplicate. Separately closed Brain's "date-only supplemental-run identity side door" finding by gating `lib/evidence/load-activity-evidence.ts`'s classifiers against the canonical `day-resolver.ts` before treating a same-date run as matching a scheduled workout.

Pushed clean through the real pre-push hook (native watch gate passed, 234/234) — no bypass needed.

**Independent review** (agent `ab2a7f19805a7f878`): **PASS WITH CONDITIONS.** Verified the asymmetric band and discriminated-union refusal are real (not relabeled), independently reproduced both falsifications with a superset of the claimed failing tests, wrote adversarial cases of its own (band boundary at exactly 2.0x, three-way ambiguity, LEGACY-tier day-resolver gating, traced treadmill/phone-GPS coverage by hand), confirmed regressions clean (7494 passed, 1 pre-existing unrelated failure reproduced identically on unmodified main), and — critically — cite-checked the branch against the **current, accepted** Brain v2.1/v2.1.1 FINAL document directly (confirming this addresses real, current, still-unassigned findings, not a stale draft) and against today's canonical v3 draft (confirming rows #76/#81 were genuinely unowned before this branch).

**One condition found: a real leak.** The new ambiguity-refusal write (`recordPlanMatchAmbiguity()`) was correctly hidden from the coach's pending-intents query, but **not** from a second, unfiltered read path (`GET /api/coach/intents`) feeding a live "COACH ACTIVITY" timeline on the native Profile screen — meaning raw internal JSON (`{"code":"ambiguous-plan-day-match"...`) was reaching the runner's own phone verbatim, contradicting the code's own "never shown to the runner" doc comment.

**Condition fixed** (commit `f4cbb67f88b75a33217ff7dc08fa5ac330630dd0`): excluded `plan_match_ambiguous` outright from that route's default query (chose exclusion over inventing runner-facing copy, since the branch's own doc comments already claimed this should never be phrased to the runner at all; confirmed no manual-resolution UI exists yet to need read access). Falsified (reverted the one-line exclusion, confirmed the leak reproduces verbatim; restored, confirmed clean) and independently re-verified by a fast targeted re-review (agent `a110914a5d49f8e5b`): **PASS**, condition closed, zero discrepancies, `state-loader.ts` confirmed untouched and unaffected.

### Lane D — Readiness and coaching truth
**Branch:** `fix/standing-recommendation-convergence-and-cutback-copy` @ `ab5a5eb7cae0314ba87d75fc368af8b3715b6655`. **Status: IMPLEMENTED, PUSHED — independent review dispatched, not yet returned.**

**Fix 1 (single-domain standing recommendation):** `standing-recommendation.ts`'s `evaluateSignals()` fired on any one of several single-domain signals (a composite pull-back band, a sleep streak, one elevated RHR reading, an HRV streak, soft pillars), violating convergence doctrine. Investigation found the current canonical owner isn't `gradeConvergence()` directly but `lib/training/runner-state.ts`'s `resolveRunnerState()` — whose own header records that `gradeConvergence` was **removed** as an input on 2026-09-02 (a doctrine correction: readiness pillars no longer argue for a training decision alone). Routed through the current owner, inheriting the more recent correction rather than the one the original brief assumed.

**Fix 2 (false cutback copy):** found in `lib/plan/strategy-contracts.ts` (not `easy-discipline.ts`, the original guess) — three copy sites said "the reduction is deliberate" for any `CUTBACK`-flagged week regardless of whether the week's actual composed mileage went down. Gated on `vol < prevVol` using values already in scope — no new Plan calculation created inside Coach, per the hard constraint.

Both falsified: Fix 1's oracle-vs-live-composer test went 4/6 red pre-fix, 6/6 green after; Fix 2's fixture (an 18mi cutback-flagged week following a 15mi week) reproduced the false copy verbatim, 3/8 red pre-fix, 8/8 green after including a control case. Full `lib/coach`/`lib/training`/`lib/plan` (3426 tests) green; two pre-existing unrelated failures confirmed identical on unmodified main. `tsc --noEmit` clean; coach-voice/doctrine/normal-window checks pass with no new violations. Confirmed: neither Lane A's files nor the C-race note's files (`generate.ts`/`runner-instruction.ts`) were touched.

Rule 13 (render with real data) explicitly not performed — no DB/simulator access in that environment; verified instead by calling the real production functions directly with realistic fixtures. Disclosed honestly, not substituted.

**Independent review: dispatched (agent `a9318fe97c593f846`), result pending.**

### Lane G — UX/IA acceptance owner (read-only)
**Output:** `docs/design/ux-ia-acceptance-plan-2026-09-11.md` @ `27f657581` (pushed via documented bypass — pure docs, zero code, lowest possible risk).

Rendered and personally inspected 22 distinct catalog screens plus a real non-catalog app launch (no prior audit had done the latter). Folded Design-System Phase 2's KEEP/REFINE/RESTYLE/UNIFY/REMOVE register into the 27-area master list. Got one genuinely new result no prior pass achieved: AX5 (largest accessibility Dynamic Type size) on Today visibly reflows correctly, **contradicting** two prior audits' "inconclusive" finding on that exact mechanism — everything else stays honestly marked BLOCKED, not assumed fine, including 16 Pro Max (simulator set up, ran out of time to render).

**Most important structural finding: the sign-in screen (`Views/SignInView.swift`) — the actual first screen every runner sees — is pre-v5 legacy code**, hardcoded colors, wrong CTA color, missed by both prior UX audits because they scoped only to the post-auth catalog. Everything downstream (~59 catalog screens) is correctly on v5.

Also live-confirmed independently: two of Design-System Phase 2's own priority findings (the Races decision-card eyebrow label, the green route-map start-dot) are **already fixed** on `main` — that register is partially stale. The treadmill cues-menu occlusion and the missing modelled `~` marker are both confirmed genuinely still open on unmerged/held branches respectively (not contradictions — see §3 and the held missing-pace branch).

---

## 5. Physical-device intake — four new findings, all root-caused, none implemented

All four are from real screenshots off the installed phone. Build identity verified first: **build 290 is confirmed still the only build ever uploaded** `[PROD]` — nothing here is stale-build noise.

### Finding 1 — Cold-open loading experience
**Severity: High, should gate the next candidate.**

The good news first: the "render last-known-good data immediately, refresh silently behind it" architecture **already exists** (`V5Surface` seeds synchronously from `AppCache` on construction) — this is not a missing subsystem. The actual defect is narrow: `AppCache.fresh()`'s hard 12-hour cutoff discards perfectly decodable, on-disk data the instant it turns 12h01m old, treating it identically to "never cached." When that coincides with a failed network refresh, the whole screen falls through to the full `OutageBodyV5` scaffold — exactly the reported "Readiness did not load" sequence, on Today, Block, **and** Races (shared code, `[SRC]` confirmed all three call the same `V5Surface`/`AppCache` plumbing).

Confirmed on `origin/main` unmodified `[SRC]`. Confirmed zero overlap with any active or merged branch (diffed every one against `AppCache.swift`/`SurfaceStoreV5.swift`/`HostsV5.swift`). A monolithic single-endpoint fetch (`/api/v5/today`) also means a total-fetch failure removes the workout along with readiness, and the outage copy misdescribes a whole-model failure as readiness-specific.

**Remaining gap:** raise/remove the 12h cliff so stale-but-decodable data still seeds `model` (letting the existing, already-correct stale-banner path handle it honestly); make the outage copy honest about what actually failed; verify the "session is on the phone already" reassurance before printing it unconditionally.

**Falsifying test:** a five-case matrix (cold / warm / offline / expired-cache / recovery-after-reconnect) per surface — none of which exist today (`AppCacheRetentionTests`/`SurfaceCancellationTests` are the nearest neighbors, covering eviction and cancellation, not cache-age-vs-seeding interaction).

**Device acceptance step:** airplane mode, force-quit/relaunch 12+ hours after last sync (or back-date the cache UserDefaults key for a controlled repro) — expect the last real session with an honest "showing what you had ___ ago" banner, never a blank skeleton or full outage scaffold; re-enable network, expect silent recovery.

### Finding 2 — CIM elevation "decision"
**Severity: High, release-blocking for this specific card.**

The engine already computes everything needed — `resolveCourseElevation()` returns old/new elevation values, provenance, confidence, and a conflict object; `computeCourseImpact()` (already used elsewhere, for Targets) quantifies the actual seconds-of-race-time impact — and the decision card (`race-card.ts:113`) **discards all of it**, shipping only a race name. Queried live `DATABASE_URL_RO` `[PROD]`: David's own 10,050-point GPS upload for CIM measures −304 ft net vs. the curated −340 ft; dense enough that the resolver would likely already trust the measured value internally. Both "Acknowledge" and "Not now" trace to the same functional outcome — a 14-day suppression, zero data correction — confirming they aren't two meaningful choices.

Code last touched 2026-08-25, predating every fix this session; confirmed **zero overlap** with the already-merged `fix/races-sample-verdict-string` (a 4-line fixture-only diff, unrelated). One piece of the Design-System Phase 2 finding — the "NEEDS A DECISION" header label specifically — is already fixed on `main` (`79a1e894e`), independently confirmed by Lane G too, just not in a build David has received.

**Remaining gap:** thread the resolver's already-computed conflict data into the card payload; surface source/verification-date (note: no dedicated "verified-at" schema column exists — a real, separate schema gap); reuse the existing seconds-impact figure; and, given the resolver already picks a winner at high/medium confidence, seriously consider whether this should be a runner decision at all versus an internal correction with an honest explanation.

**Device acceptance step:** the card should read old value, new value, both sources, verification recency, and quantified time impact, with two buttons carrying distinct named effects — never generic Acknowledge/Not-now with identical outcomes.

### Finding 3 — Missed/skipped workout has no distinct state
**Severity: High — a truthful-state-presentation defect on the app's own core promise.**

DB-confirmed `[PROD]` not a sync bug — the run genuinely never happened. Root cause: the live V5 `dayStateWordFor()` is a pure function of `plannedType`, with no input for "did this happen" or "is this date in the past"; the V5 `DayState` Swift enum has no `missed`/`skipped` case at all (only `{easy, rest, quality, race, phase, long}`); and `/api/v5/today?date=` treats the requested past date as if it were live "today" for every downstream computation. A legacy v3 pipeline (`glance-adapter.ts`) DOES define a `'missed'` state with a gradient token — but it's dead code, never called by the live route, and its own comment says "deferred for v1."

The good news: the hard infrastructure already exists and is production-proven — `day-resolver.ts`'s canonical match resolver, and `reschedule.ts`'s mature "Move a Run" engine (candidate generation, Rule-9-continuous costs, audit table, undo, and an explicit guarantee that a moved day never displays as missed). **"Move a Run" has zero production UI entry point** despite being fully built server- and UI-side — only reachable via a hidden debug launch argument. This is confirmed as a deliberate 2026-08-21 design ruling (don't tear down the week strip when stepping back to a past day) that simply left no remaining visual channel for missed/skipped to show through — not an oversight in isolation, but a gap that ruling left behind.

**Remaining gap:** compute the missed fact (past + no matched run + no skip row + no reschedule row); add a wire/type case to carry it; wire "Move a Run" to an actual button; extend "declared skip" (today-only currently) to arbitrary past days.

**Device acceptance step:** open a past day with a genuinely unresolved workout — the card and its week-strip dot must be visually and textually distinct from both a completed and an upcoming day of the same type, and tapping in should offer a real choice, not a passive label.

### Finding 4 — Santa Monica 10K copy refinement
**Severity: Low — preserve the layout, refine only the language.** Routed to Lane D/Lane G per your instruction; both have now reported (§4), so this is ready to fold into whichever of them (or a fast follow-up) you want to pick it up — no live channel exists to inject it into an already-running agent, so it was held rather than dispatched as overlapping new work. Not yet assigned.

---

## 6. Infrastructure built this session

### Machine-wide shipping lock + artifact mapping
**Branch:** `feat/shipping-lock-and-artifact-mapping` @ `1dec1c22a501995c60cd86943ba941f8b36fc510`. Real, tested infrastructure, not documentation.

- `scripts/main-push-lock.sh` + `.githooks/pre-push` extension (Section 0, scoped strictly to `refs/heads/main` — feature-branch pushes provably unaffected): both **authorization** (single-use, SHA-bound, TTL-expiring) and **serialization** (atomic mkdir lock, staleness auto-recovery) as separate concerns, since either alone doesn't stop the actual incident class this session had (an unauthorized-but-uncontested push, or two authorized integrations thrashing each other).
- `scripts/check-main-push-lock.sh`: 19/19 Rule-18 falsifier assertions, including a **real** two-process race (not simulated sequentially).
- `web-v2/scripts/_build_ledger.mjs` + `docs/testflight-builds.jsonl`: durable, offline-readable SHA↔build mapping, with live-ASC drift verification. Seeding it **caught a real, live documentation error elsewhere in this repo**: another doc cites the wrong commit for build 290 (confusing the post-archive counter-bump commit for the actual shipped tree) — confirmed `0dce24f23` (what this whole session has cited) is correct.
- `scripts/ship-testflight-v2.sh` now auto-records to that ledger on every future upload.
- One disclosed `--no-verify` (pure infrastructure change touching zero watch-gate trigger paths, verified before bypassing, per policy).

**Status: pushed, not merged, not independently reviewed yet.**

### Migration 166/170 rollout/rollback evidence
**Branch:** `evidence/migration-166-170-rollout-rollback-v2` @ `706a9ea8f`. No DDL executed against any real database — verified empirically against a disposable local scratch Postgres instead.

Confirmed both migrations independent, schema-safe, cleanly reversible in both directions. **New finding**: `decision-ledger.ts`'s `ledgerTableExists()` caches a *positive* result permanently (module-level, never re-probed) — if 166's table were ever dropped again after being observed, a live process would throw on the stale-cache-driven insert (caught safely by `mutate.ts`, converted to a clean refusal, but with wider blast radius than intended). Self-heals on process restart; not a concern for a one-way apply. Confirmed `mark_upgrade`-blocked-while-166-absent is real; the "3 of 4 accept lanes" messaging claim is only partially verifiable (2 of 2 checked lanes: one correctly wired, one silent) — reported honestly rather than repeating an unverified count.

**Status: evidence complete, no action taken, awaiting your explicit go to apply either migration.**

---

## 7. Canonical v3 status

Brain (accepted, closed) and Coach (accepted, closed) are both fully integrated into `docs/audit-2026-09-11-canonical-record-v3-DRAFT.md`, along with Runner Data's already-accepted findings and Design-System Phase 2's register. Genuinely new discrepancies surfaced and flagged loudly during integration (not smoothed over): Brain's own errata reversed one of its v2.1 conclusions (the C-race finding); two Design-System Phase 2 "live" findings turned out already fixed on main; the unauthorized self-merge disposition is now recorded DECIDED (leave merged, per your instruction); build 290 is flagged obsolete everywhere it's cited.

**What's still open, precisely:** Runner Data's dedicated-branch provenance receipt (blocks canonical completeness and specifically the missing-pace branch's merge — nothing else); the five active/new lanes (A/B/D/G done or in review, plus Findings 1–3 unassigned); Migration 166/170 application; a real TestFlight candidate; physical-device verification.

---

## 8. Decisions and actions that need you specifically

1. **`DATABASE_URL_RO` GitHub secret** — the exact command, so it never passes through an agent:
   ```bash
   grep '^DATABASE_URL_RO=' web-v2/.env.local | cut -d= -f2- | gh secret set DATABASE_URL_RO --repo DavidNitzsche/runcino
   ```
2. **Merge authorization for Lane A/B/D** once Lane A and D's independent reviews return (Lane B is already fully clean).
3. **Lane assignment for Findings 1–3** — all fully root-caused and scoped; none started.
4. **Finding 4's owner** — Lane D, Lane G, or a fresh small copy-only pass.
5. **`progression-pass.ts` sibling defect** (same raw-`is_race_week` shape as the now-merged race-week-protection fix) — queued per your instruction, not started.
6. **Migration 166/170 application** — evidence is ready; still needs your explicit per-statement go.
7. **Runner Data's dedicated-branch provenance receipt** — the last gate on canonical v3 and the missing-pace merge specifically.

No TestFlight candidate should be cut until the items above that you flagged as gates are resolved.
