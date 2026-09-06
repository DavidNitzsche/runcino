# Round 10 handback — the operating loop, narrowed and pushed

**2026-09-06 · branch `core/closure-2026-09-04` → `main`, fast-forward only, five commits**

```
0b744d681  fix(ledger): LEDGERREQUIRED-1 · an absent ledger table refuses the mutation
917865763  feat(orchestration): ORCHESTRATIONWIRE-1 · steps 1/5 reach production (10→12)
fffcae5b1  feat(brain): STEADYEFFORT-1, COLDSTART-PROMO-1 ext, STALEPLAN-1, CLASSIFYCTXWIRE-1
38860e01c  feat(brain): DECISION-1 pace-drift monitor, ROLLINGBOUNDARY-EVAL-1 wired live
6f778217b  feat(health): DECISION-3 · HealthKit resync preview, read-only, never a trigger
```

Every commit individually confirmed `SUCCESS` on Railway for its own exact SHA before the next one started (Rule 19) — not just green locally. `AUTOMATIC_ADAPTATION_AUTHORITY` was never touched; it is still the literal `false`. No production DDL applied, no data write performed. Full command history for each Railway check is in this session's own transcript, not restated here.

This is a narrower session than the prior overnight rounds, per your own instruction — the operating loop, not another broad audit. What follows is organized by your five decisions, then the eleven numbered items, in the order you gave them, with an honest cut between **done and verified**, **built but not fully closed**, and **not started**.

---

## The five decisions

### Decision 1 · pace drift — DONE, shipped, live

Built `lib/audit/pace-drift-monitor.ts#explainPaceDrift`: a live-vs-persisted pace drift is EXPLAINED only when a pending `plan_workout_proposals` reprice row satisfies all six named fields — accepted/persisted before value, proposed after value, current plan version (the proposal's own `planId` matches the active plan), evidence (non-empty), creation timestamp, and two independently-checked forms of expiration (the proposal's own recorded "before" no longer matching what's live — something else already changed the row — or age past `REPRICE_DISMISSAL_QUIET_DAYS`, reusing the existing reprice-flow constant rather than inventing a second one), and proposal status `'pending'`. No tolerance number anywhere. Twelve tests, each falsifying one field in isolation, plus one proving it isn't a blanket pass for "some proposal exists."

Wired into a genuine schedule, not a bare exclusion: `app/api/cron/pace-drift-monitor` + `.github/workflows/pace-drift-monitor.yml` (daily, 09:00 UTC), registered in both `lib/ops/cron-ledger.ts` (`CRON_JOBS`, idempotent, no ordering dependency) and `lib/audit/automatic-mutation-registry.ts` (writes only `ops_alerts`, never a plan table). `scripts/check-generated-content.sh`'s DEPLOYFENCE-1 comment now points at this monitor by name rather than standing as a bare exclusion. `_cross_surface_contract.test.ts` itself is **untouched** — still fails loudly when run directly, still excluded from the build-blocking path, and is exactly the finding this monitor now watches on a schedule instead of on every deploy.

### Decision 2 · Pa:HR steady-effort precondition — DONE, shipped, live

`deterioration.ts`'s own header had named this gap open since the prior session: nothing corrected for a deliberate fast-finish/progression long run, so a prescribed pace change could read as a genuine late fade. Built `steadyEffortReadabilityFrac`, reading the matched workout's `sub_label` prescription (parsed the same regex `lib/plan/spec-builder.ts#extractLongSegments` already uses — duplicated locally, not imported, to avoid a backwards edge into the walled `canonical/` layer, matching this file's own existing `clamp01`/`rampAcross` precedent) against the run's total distance. Continuous, not a cliff (Rule 9): a canonical fast-finish executed exactly as written discounts to zero readability; a tail that only partly overlaps the final-third comparison window gets a proportional discount; two windows with the *same* engagement in the quality tail (both fully easy, or both fully in the tail) read as fully readable, because that isn't the confound Q13 warns about even though a tail exists elsewhere in the run. Composed multiplicatively into `decouplingReadabilityFrac` alongside the existing heat/terrain factors — four factors now, not three.

Wired end to end: `lib/plan/volume-evidence-loader.ts`'s `environmentalContextOf` now threads the matched prescription's `sub_label` through (it was already threading the run itself), so this runs on the real nightly volume-evidence pass, not just in a test. Ten new tests including the canonical case and the falsification-ready end-to-end composition proof.

### Decision 3 · calorie repair — PREVIEW BUILT, NOT triggered, needs your go to build the native half

`lib/health/resync-preview.ts#buildResyncPreview` + `POST /api/admin/healthkit-resync-preview`: all six required fields (date, current stored total, on-device recomputed total, delta, source sample count, upsert identity — the real `(user_id, sample_type, sample_date)` unique index `app/api/ingest/health/route.ts` already targets), split into `wouldChange`/`unchanged`. Writes nothing, ever — it is a pure diff plus a read-only query against `health_samples`.

**What it cannot do, stated plainly rather than hidden:** the corrupted historical days (REQUESTSTORM-2's 54-of-135) lost their raw per-bucket HealthKit samples the moment the old ingest upsert overwrote them. There is no query against this database that recovers a correct historical total — only a fresh read of the phone's own HealthKit store can. This route is the **server half only**, verified against real production (`health_samples` queried read-only for the reference account's currently-corrupted dates — 2026-08-23 still reads 11.4 kcal, matching your cited example exactly) with synthetic candidate totals standing in for a device resync, clearly labeled as such. **Building the native dry-run flow that reads real HealthKit history and POSTs it here instead of the live ingest endpoint is real, separate work this session did not do.** Nothing has been resynced. Nothing will be until you approve triggering it for real.

### Decision 4 · production migrations — SQL WRITTEN, VERIFIED ON SCRATCH, NOT APPLIED

`docs/reports/brain-2026-09-05/MIGRATION-PACKET.md` ADDENDUM 3 (new this session) covers everything the standing decision named that ADDENDUM 1/2 didn't:

- **A correction owed to the packet's own Section I**: it said "`table_absent` is not a failure... the mutation commits, exactly as it does now." `LEDGERREQUIRED-1` (this session, already shipped) reverses that on your own ruling — `table_absent` now refuses, doesn't commit. The packet is corrected in place rather than left stale.
- **Migration 168** (`plan_decision_outcome`) — literal SQL reproduced in the packet, verified idempotent on `faff_roundtrip_scratch`, full rollback/verification/locking analysis (effectively none — one empty `CREATE TABLE`).
- **Migration 169** (`runner_beliefs`, new this session) — literal SQL, a byte-for-byte transcription of `ensureBeliefStoreSchema`'s own CREATE TABLE so the two cannot drift silently, same verification treatment.
- **The `plan_weeks`/`plan_phases` `user_uuid` backfill** — literal SQL (unchanged from migration 143's own statement), proven idempotent on a synthetic rig (`UPDATE 2`/`UPDATE 1` the first run, `UPDATE 0` on immediate re-run), full locking/rollback/failure-recovery writeup. Measured live on production, read-only: 88/672 `plan_weeks` and 25/222 `plan_phases` rows are NULL right now. **The writer-side root cause is already fixed and shipped, no DDL needed for that half** — `generate.ts`/`injury-builder.ts`/`seed-from-onboarding.ts` all stamp `user_uuid` on their `plan_weeks`/`plan_phases` INSERT now (they always did on the sibling `plan_workouts` row and never did on these two — that asymmetry is the whole root cause), gated by a new source-scan test so it can't regress silently.

**None of 168, 169, or the backfill has been applied to production.** All three are pending your explicit, per-statement go.

### Decision 5 · Pa:HR precondition, decision 2 — same as above, no separate action needed

---

## The eleven numbered items

### Item 1 · Move-a-Run / ledger runtime truth — CLOSED

Traced and answered exactly what you asked: `table_absent` was previously non-fatal — a mutation committed, the runner got `{ ok: true }`, and the only trace of the missing audit row was a `console.warn` nobody sees. Fixed (`LEDGERREQUIRED-1`): `table_absent` now throws and rolls back the whole transaction for every touch except plan authorship (a brand-new plan — refusing that too would block all plan creation while 166 is pending, a far larger blast radius). An undo always requires the ledger. Proven by renaming the real ledger table on a scratch database and falsifying both directions.

**Practical consequence, live now:** since migration 166 is still unapplied, every proposal-accept and every Move-a-Run in production currently returns a visible error rather than applying unaudited. That is the conservative direction you asked for, but it does mean those two flows are non-functional in production until 166 ships — which is exactly why decision 4's packet exists.

I did not separately re-verify the TestFlight-284 Today-defect fix (viewed-date Move/Skip resolution, rest-day hiding) this session — no native work was done, see item 11.

### Item 2 · orchestration steps — 10 → 12, not 16

Steps 1 ("load canonical runner state") and 5 ("update beliefs") are now WIRED, verified by the real import-graph walk (`buildModuleGraph`), not asserted: `lib/runner-state/store/orchestrator.ts` is called from `app/api/cron/run-adaptations/route.ts`'s real per-runner loop. Every call refuses honestly today (`BeliefsTableUnavailable`, mirroring the ledger's three-state probe) because migration 169 is unapplied — the same "reachable and blocked on approval" state steps 12 and 16 already established, not a new argument invented to justify this one.

**Steps 3 (classify evidence), 4 (grade sessions/week), 7 (generate PUSH/HOLD/PULL_BACK options), 12 (schedule reassessment) are still not WIRED** by this session's own numbering — `dose-responsive.ts` (step 3's owner) remains an argued orphan pending a wiring decision that isn't mine to take (see item 6 below), and step 12 needs migration 167. `lib/evidence/classify-evidence.ts` — a DIFFERENT evidence classifier, not orchestration step 3's owner — was wired into production this session (see item 4), which is real progress but does not move this pin.

### Item 3 · canonical belief store, 13 quantities — LARGELY PRE-EXISTING, NOT RE-VERIFIED THIS SESSION

`_owner_agreement.test.ts`/`_owner_agreement.audit.test.ts` already carry the disagreement gate for 12 quantities against production-shaped divergence (per this session's own prebuild output: "12 quantities · 16 owners · 14 measured divergences, each argued") — built in a prior session, unchanged by this one. I did not audit whether a 13th quantity is missing, and I did not re-verify plan-rebuild survival across all 12/13 beyond what the belief-store's own DB test already proves for the handful of beliefs it seeds (`_belief_store.db.test.ts`'s rebuild-survival falsification, re-confirmed passing this session). This is real, standing work, not claimed as new.

### Item 4 · evidence classification, 19 tags — WIRED, verified with production-shaped cases

`lib/evidence/classify-evidence.ts` was a deliberate, registered orphan pending a consumer. Wired into `live-input.ts#provenanceFor` (reached from the real `run-adaptations` cron via `run-live-shadow-evaluation.ts`) — `provenanceFor` previously flagged only `TREADMILL_UNCALIBRATED` among four possible pace-representativeness confounds; two more (hills, heat) now have a real composed owner reading the same `resolveRunTerrain`/`heatEffort` this app already trusts elsewhere. Verified against real production activities for the reference account: a duplicate/merged pair, a treadmill session, a pauses-heavy long run, the exact HRFLATLINE-1 incident CLAUDE.md cites by name (18 samples read exactly 134 bpm), a real A-priority race and a real C-priority tune-up. Named honestly: `identity.moved/substituted`, `runnerState.*` (illness/injury/disruption) and `context.missingTelemetry` have **no real production case** for this account — zero rows in the relevant tables — so those tags are proven only against the unit-test corpus, not production. `duplication.splitRecording` remains permanently `unknown` by design; no detector exists anywhere.

`MODULE_ORPHANS` entry deleted per its own stated exit condition.

### Item 5 · a real, non-seeded PUSH through the full proposal path — NOT DONE

This is the largest single item not attempted this session. It needed careful, safe demonstration against production-shaped state (accept, decline, stale-plan, ledger-failure, restart, safety-hard-stop, competing-proposals) and I judged it too large and too easy to get wrong under this session's remaining time to do honestly rather than rush. Genuinely open.

### Item 6 · generator/facet coverage toward 21/21, 294/294 — AUDITED, 0 CLOSED, RATCHET CONFIRMED ACCURATE

An independent audit (background agent, verified against live source rather than trusted from the gate) re-checked all 33 gaps individually. Result: the 33 is accurate, not stale. Twelve are doctrine-permanent (never-delete, the 2026-09-02 reshape ruling, safety-stop-overrides-undo, no forced goal renegotiation). Three are decision-gated, not closeable unilaterally (the `dose-responsive.ts` wiring decision named in item 2 above; a UX call about whether an authority-refusal deserves a card). Eighteen are genuine engineering gaps, each needing a NEW coaching-evidence reader that doesn't exist yet (a weekly-demand-shape reader, a long-run progression axis, a taper-depth reader, a recovery-response-across-a-window reader) — none fabricatable without new doctrine-cited logic, so none were forced closed to move a counter. Confirmed your specific worry unfounded: the old sealed reshape path only gaps its own five `PROPOSAL_WRITER` cells; every other facet for those five kinds is already closed via the generalized schema.

### Item 7 · reassessment scheduler, 7 kinds — PARTIALLY CLOSED

`DEFERRAL` already has a real writer and processor. Five more (`EARNING_GATE`, `CONDITIONAL_DOSE`, `POST_RACE_RECOVERY_CHECK`, `RETURN_TO_TRAINING_STAGE`, `PROPOSAL_EXPIRATION`) each have a real scheduling caller but **no evaluator anywhere reads a due item and re-asks its question** — that's a separate, much larger build (per-kind engines), correctly left to whoever owns each kind rather than fabricated. `FAILED_EVALUATION` was investigated specifically at your request: tying it to the outcome-verdict sweep (`outcome.ts`/`outcome-sweep.ts`) would be exactly the automatic coefficient tuning those files explicitly rule out by instruction ("Do not automatically tune coefficients from this yet"). No legitimate trigger was found; none was invented. Recorded as an argued, confirmed-correct exemption, not a gap.

**New this session:** `STALEPLAN-1` — a live reassessment item against an archived plan now supersedes itself rather than sitting live against a plan that no longer exists, the missing fourth member of the `ACKSURVIVE-1` family (`plan_proposals`/`plan_workout_proposals`/`coach_intents` already had this; `reassessment_schedule` didn't). Proven on a scratch database, falsified both directions.

**Also new: the third of the "9/21" rolling boundaries is now a real evaluator, not just a scheduler.** `lib/plan/adjudication/rolling-boundary-evaluator.ts` was the missing re-ask for `week_demand_step`/`weekend_after_quality`/`long_run_after_race` — LIVESEQ-2 already scheduled all three nightly and nothing ever read one back due. Wired into `run-adaptations`'s per-runner loop this session (own try/catch). **One constant needs your confirmation before this matters in production**, named honestly by the agent that built it: `allowedStepShare` uses `RERAMP_WEEKLY_GROWTH - 1` (0.10) because no other production constant answers this exact question; the original file's own test used an illustrative 0.15, and the two values flip the verdict on the worked 2026-09-21 week (PROCEED at 0.15, REDUCE at 0.10). Currently harmless — migration 167 is unapplied, so every call answers `table_absent` regardless — but worth settling before 167 is approved.

### Item 8 · the three 9/21 rolling boundaries — see item 7, same work

### Item 9 · cold start / terminal disposition — CLOSED, 7 of 7

The one plan with zero future weeks (`pln_0c75f856a3849c32`) was correctly *diagnosed* by the existing false-block classifier as "finished, not incoherent" but that diagnosis changed nothing downstream — it still reported BLOCKED. `resolveDisposition` (`lib/plan/adjudication/false-block.ts`) closes the gap between diagnosis and disposition without adding a field to `PlanAdjudication` itself (the first draft did, and the orphan-reachability gate caught it immediately — `checkPromotion` is already reachable from the live cron, so that draft would have made the file's own "runtime code must never import it" claim false). Proven against real production via `npm run promotion-replay`: 7 of 7 active plans now report a valid disposition (6 PROMOTED, 1 TERMINAL), confirmed independently by me, not only claimed by the agent that built it.

### Item 10 · canonical-shadow second cycle + cross-surface monitoring — HALF DONE

The cross-surface monitoring replacement is Decision 1, done and shipped. **A second canonical-shadow cycle was not run or proven this session** — genuinely open.

### Item 11 · native/Watch verification — NOT DONE

No simulator work, no native build, no TestFlight this session. Request-count collapse on second foreground, the Decisions screen, Move/Skip viewed-date behavior, the re-adjudicating route, and Watch tests from a clean checkout are all unverified by this session. If any of item 1's or item 2's server-side changes have a native-visible effect (they shouldn't — both are additive and fail-safe), that has not been checked on a device either.

---

## What was verified, mechanically, before every push

Every one of the five commits above passed, in order: `npx tsc --noEmit` clean; the full non-audit/non-db vitest suite (currently 558 files, ~11,621 tests) with **zero new failures** — the one failure that persists throughout is `_cross_surface_contract.test.ts`'s live pace-anchor drift, which is the pre-existing, already-named, already-excluded finding Decision 1's monitor now watches, not a regression; the full `prebuild` gate chain (28 scripts); `next build`. Three commits additionally required fixing real findings from gates I hadn't anticipated — an orphan-registry staleness (twice, once per new reachable module), a coach-voice em-dash violation, and three genuinely new sites in the pace-drift cron that the coercion/swallow/active-plan scanners caught (a blind-indirect `.catch(() => null)`, an emptied `.catch(() => ({rows:[]}))`, a chained `??` fallback, and a prose string that accidentally matched a SQL-pattern regex) — all fixed for real, none exempted.

## What is still genuinely open, stated plainly rather than left to be discovered

- Items 5 and 11 in full; item 10's canonical-shadow half; item 3's 13th-quantity/full-rebuild-survival audit.
- Six of seven reassessment kinds have schedulers but no evaluators (item 7).
- Eighteen generator/facet gaps need new coaching-evidence readers that don't exist (item 6).
- Orchestration steps 3, 4, 7, 12 remain unwired (item 2) — 12/16, not 16/16.
- Decision 3's native dry-run flow does not exist; the resync preview has never received a real HealthKit read.
- Decision 4's three migrations and one backfill are fully specified and scratch-verified but **not applied** — this is the largest single blocker on real production progress: until 166 lands, Move-a-Run and proposal-accept stay broken in production (correctly refusing rather than silently corrupting, but broken); until 167 lands, the reassessment scheduler's six unevaluated kinds and the rolling-boundary evaluator stay inert.
- The `allowedStepShare` constant (0.10 vs 0.15) in the rolling-boundary evaluator needs your call before 167 makes it matter.

The next session should keep pushing on items 5, 7's evaluators, and 11 specifically — those are where "wired but not reached" is still this codebase's live failure mode, exactly the shape Rule 15 and Rule 21 both warn about.
