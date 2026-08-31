# Shadow-log production activation — 2026-09-01

Authorized by the account owner, exact scope: apply
`web-v2/db/migrations/160_adaptation_shadow_log.sql`, review it against seven
named criteria first, expand the shadow-compare record to the full
audit-required shape, build the authoring/reanchor convergence guard, wire
the pace/HR compatibility validator, and enable production persistence with
a re-confirmed zero-mutation proof. No other DDL was needed or run.

Everything below was run against the owner's real account
(`0645f40c-951d-4ccc-b86e-9979cd26c795`), through production, 2026-09-01.

---

## 1 · The migration, reviewed against all seven criteria

Read in full before applying. Findings, one per criterion:

| # | Criterion | Finding |
|---|---|---|
| 1 | No changes to live plan behavior | Pass, unmodified from the draft. `CREATE TABLE` only — nothing touches `plan_workouts`, `training_plans`, or any table a live surface reads. |
| 2 | No triggers or consumers that can mutate plans | Pass, unmodified. No trigger defined; `grep` across `web-v2` confirms nothing reads `adaptation_shadow_log` except `shadow-compare.ts` (the writer) and the new retention prune (`DELETE` on this table alone). |
| 3 | Bounded growth + explicit retention policy | **MISSING from the draft — added before applying.** No retention policy existed. Added `lib/adaptation/shadow-log-retention.ts` (180-day age bound + 400-row-per-user cap, both `DELETE`-only), a new cron route (`/api/cron/prune-adaptation-shadow-log`), and a workflow (`.github/workflows/prune-adaptation-shadow-log.yml`), following this repo's existing cron pattern. Registered in `lib/ops/cron-ledger.ts`'s `EXCLUDED_FROM_TICK` (argued reason: nothing downstream reads this table, so lateness is harmless) and in `lib/audit/automatic-mutation-registry.ts` (idempotent `DELETE`-only entry). |
| 4 | Idempotent deployment | Pass, unmodified. `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` throughout — verified by literally re-running the file after the first apply; second run reports `NOTICE: relation ... already exists, skipping` for every statement, `COMMENT` succeeds, no error. |
| 5 | Appropriate access controls | Verified empirically, not assumed. `faff_readonly` (the RO role) gets `SELECT` on a freshly-created table with **no explicit `GRANT` in the migration** — confirmed on migration 159's `travel_windows` before applying (`has_table_privilege('faff_readonly','travel_windows','SELECT') = true`, `...,'INSERT') = false`, no `ALTER DEFAULT PRIVILEGES` row for it), and confirmed again directly on the new table after applying: `psql $DATABASE_URL_RO -c "SELECT count(*) FROM adaptation_shadow_log"` succeeds (0 rows), and `INSERT ... ` over the same role returns `ERROR: permission denied for table adaptation_shadow_log`. |
| 6 | Safe rollback or disablement | Pass, unmodified — `REVERSED BY: DROP TABLE IF EXISTS adaptation_shadow_log;`. Disablement needs no DDL at all: `persistShadowCompareRecord`'s table-probe cache means removing the cron's call site (or the table itself) silently degrades to the pre-migration no-op/file-fallback posture with no code change. |
| 7 | No interference with existing proposal or measurement tables | Pass, unmodified. Read by nothing else; references `users` and `training_plans` by `FOREIGN KEY` only, in the direction that lets this table alone be dropped. |

**What was added before applying (criterion 3), not patched in after**, per the
task's explicit instruction not to apply an incomplete migration and fix it
later.

---

## 2 · Migration applied, schema verified in production

```
psql $DATABASE_URL -f web-v2/db/migrations/160_adaptation_shadow_log.sql
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
COMMENT
```

Re-run immediately after (idempotency check):

```
NOTICE:  relation "adaptation_shadow_log" already exists, skipping
CREATE TABLE
NOTICE:  relation "adaptation_shadow_log_user_date_idx" already exists, skipping
CREATE INDEX
NOTICE:  relation "adaptation_shadow_log_resolved_at_idx" already exists, skipping
CREATE INDEX
NOTICE:  relation "adaptation_shadow_log_convergence_idx" already exists, skipping
CREATE INDEX
COMMENT
```

Schema verified over the **read-only role** (`\d adaptation_shadow_log`): 37
columns, 3 secondary indexes plus the primary key, 2 `CHECK` constraints
(`convergence_state`, `hr_compat_verdict`, both closed enums), 2
`FOREIGN KEY`s (`users`, `training_plans`, both `ON DELETE CASCADE`) — matches
the migration file exactly, full column list included in §5 below (the real
record dump carries every one).

Access control, empirically:

```
SELECT count(*) FROM adaptation_shadow_log;   -- over RO: 0 rows, succeeds
INSERT INTO adaptation_shadow_log (...) ...;  -- over RO: ERROR: permission denied for table adaptation_shadow_log
```

---

## 3 · The expanded record shape

`ShadowCompareRecord` (`web-v2/lib/adaptation/shadow-compare.ts`) now carries
every field the task named:

- **user and plan identifiers** — `userUuid`, `planId` (from the convergence
  guard's own plan read, so there is one resolution of "the active plan," not
  two).
- **evaluation date and engine/model version** — `todayISO`, `modelVersion`.
- **plan-authored timestamp and last canonical reanchor timestamp** —
  `convergence.authoredIso`, `convergence.lastCanonicalReanchorAt`.
- **contamination/convergence status** — `convergence.state` (four states,
  §4) + `convergence.detail` (plain-English, built from the same fields, per
  §27 discipline).
- **phase and workout family affected** — `workoutFamily` (the PACE lever's
  fixed scope, carried as data), `engine.phaseBreakdown` (every phase, moved
  or not — unchanged from Part 1 of the 2026-09-01 decision).
- **current target and proposed target** — `engine.previous` /
  `engine.proposed`.
- **capacity belief, evidence mode, confidence, and evidence dates** —
  `capacityBelief` (`resolveThresholdCapacity`'s own output verbatim:
  `paceSecPerMi`, `vdot`, `confidence`, `sourceMode`, `evidenceIds`,
  `reasons`), `evidenceDates` (each evidence id mapped to a date where
  resolvable, `null` named rather than guessed where not — see §5's real
  record for an honest example of both).
- **representative and excluded observations** — `representativeObservations`
  (the sessions `PaceEvidence` actually named, each flagged `controlled` or
  not) and `excludedObservations` (`EvidenceLookback`'s own
  `windowDays`/`representativeDays`/`excludedDays`/`reachedOuterBound`/
  `stalenessFactor` — never re-derived, only carried).
- **pace/HR compatibility result** — `hrCompatibility`, the full
  `PaceHrCompatibilityResult` (§6).
- **decision and refusal reasons** — `engine.decision` (the raw PACE-engine
  output, never overwritten) plus `finalDecision`/`finalDecisionReason` (the
  shadow pipeline's own call after Part 4's compatibility check — see §6).
- **contradictions** — `contradictions[]`, two concrete checks implemented:
  HR compatibility refusing a proposal the engine itself would have
  progressed, and a `PROGRESS` proposal read against convergence-contaminated
  evidence (§4).
- **zero-mutation checksum or equivalent proof** — `mutation.checksumBefore`
  / `mutation.checksumAfter` / `mutation.verified`, computed by this file
  itself, bracketing its own work, not just asserted in a separate test (§7).

The migration's table carries all of the above column-for-column (37 columns
total — full list in the `\d` output referenced in §2).

**Zero-mutation re-verified after the schema expansion, explicitly, not
assumed to still hold**: `_shadow_compare.audit.test.ts`'s checksum test was
re-run after every change in this pass, most recently after the coercion fix
in §7 — `925312284e816aabe3b4d09c6226e286:103` before, identical after, three
cycles, unchanged.

---

## 4 · The authoring/reanchor convergence guard, real behavior

`web-v2/lib/adaptation/authoring-convergence.ts` — `resolveAuthoringReanchorConvergence`.
Four states, matching the brief's own four bullets exactly:

| State | Meaning | Detection |
|---|---|---|
| `AUTHORED_CANONICALLY` | Composed directly through the canonical resolvers at authoring time | `authored_state.pace_anchors.authored_directly === true` — **structurally unreachable today**: `generate.ts` never writes this key (confirmed by grep, again, this pass — 32 call expressions into the legacy VDOT cascade, zero references to `capacity-resolver.ts`). Kept as a real branch so the day `generate.ts` migrates, this guard needs no change. |
| `REANCHORED_CANONICALLY` | Authored by the legacy cascade, but `reanchorActivePlan` has landed a canonical rewrite since | A reanchor stamp exists in `authored_state` (`pace_blend.reanchored_at` or top-level `reanchored_at` — whichever arm wrote it, race-prep or maintenance) at or after `authored_iso`. **Today's normal case.** |
| `AUTHORED_TOO_RECENTLY` | `authored_iso` is newer than the last successful canonical reanchor | No reanchor stamp postdates authoring, AND the reanchor job's own heartbeat (`lastSuccessAt('snapshot-projections')`, `lib/ops/cron-ledger.ts` — the job that runs `reanchorActivePlan` unconditionally, nightly, across every active plan) last succeeded **before** authoring. Benign timing, not a failure. |
| `REANCHOR_STATUS_UNKNOWN` | Honest "we don't know" | Fires when the reanchor job's heartbeat is unreadable or has never completed at all (can't rule out a broken scheduler), OR when the job has reported success **since** authoring but this specific plan still carries no reanchor stamp — `cron-ledger.ts`'s own documented blind spot ("it cannot see a job that succeeds for one runner and throws for another") means a global 200 does not prove *this* plan converged. Never defaults to "assumed fine." |

**Real classification, the owner's actual plan, production, 2026-09-01:**

```
plan_id                     pln_9a57561debb776e5
plan_authored_iso           2026-08-31 03:40:26.259+00
last_canonical_reanchor_at  2026-08-31 07:04:27.148+00
convergence_state           REANCHORED_CANONICALLY
convergence_detail          authored_state carries a reanchor stamp
  (2026-08-31T07:04:27.148Z) at or after authoring (2026-08-31T03:40:26.259Z)
  — the canonical resolvers have rewritten this plan's pace targets at least
  once since it was composed. Evidence from this cycle is meaningful; the two
  brains have converged.
```

Correct on the merits: the plan was authored 03:40 UTC, `snapshot-projections`
(07:30 UTC daily) ran its 07:04 slot and reanchored it within the same
morning — well inside the "under 24 hours, usually same-session" window
`pace-shadow-compare-2026-09-01.md` §3 predicted.

`FIXTURE 10` in `_pace_replay_corpus.test.ts` — the existing test corpus that
had documented this exact gap as "not built yet" — is updated (comments only,
assertions unchanged) to record that the guard now exists **one layer up**
from `composeAdaptation`: the pure engine still cannot tell contaminated
pricing from genuine gain on its own (by design — capacity resolution and the
decision layer are deliberately different owners), and that is exactly why
the guard lives in `shadow-compare.ts` instead. 176/176 adaptation unit tests
pass, including this one.

---

## 5 · One real production shadow-log record, in full

Triggered via a one-off activation script
(`web-v2/scripts/_run_shadow_compare_production_2026-09-01.mjs`) using the
full write role — the only write this session made outside the migration
itself, and it is the exact write the mechanism exists to make. Read back
over the **read-only** role immediately after:

```
id                          | 1
user_uuid                   | 0645f40c-951d-4ccc-b86e-9979cd26c795
plan_id                     | pln_9a57561debb776e5
today_iso                   | 2026-08-31
resolved_at                 | 2026-08-31 23:50:02.753+00
model_version                | 1.0.0
plan_authored_iso            | 2026-08-31 03:40:26.259+00
last_canonical_reanchor_at   | 2026-08-31 07:04:27.148+00
convergence_state            | REANCHORED_CANONICALLY
convergence_detail           | (see §4)
workout_family                | {threshold,tempo,cruise}
phase_breakdown               | QUALITY 435→430 (moved, 6 rows) · RACE-SPECIFIC
                                 424→424 (held, 4 rows) · TAPER 475→466 (moved, 2 rows)
phases_moved                  | {QUALITY,TAPER}
engine_decision                | PROGRESS
engine_reason_codes            | REPEATED_CONTROLLED_QUALITY_EXECUTION,
                                  CAPACITY_LEADS_PRESCRIPTION_BY_A_USEFUL_STEP,
                                  PACE_STEP_CLAMPED_TO_DOCTRINE_QUANTUM,
                                  LOOKBACK_EXTENDED_PAST_A_PRESCRIBED_PERIOD,
                                  CONFIDENCE_DISCOUNTED_FOR_EVIDENCE_AGE
engine_explanation              | "Your recent threshold work consistently
                                   supports faster training. Move 2 of 3
                                   upcoming phases..."
engine_previous / proposed      | 435 → 430 s/mi
engine_confidence               | 0.709
engine_refusals                  | DENSITY refused — NO_PROGRESSION_TARGETS
                                    (an authoring gap, not runner evidence)
final_decision                   | PROGRESS   (unchanged — HR compatibility did not refuse)
final_decision_reason            | (null)
capacity_belief                  | paceSecPerMi 430, vdot 47.9, confidence 0.727,
                                    sourceMode direct, 3 evidenceIds,
                                    DIRECT_CORROBORATED_THRESHOLD_EVIDENCE + 3 more
evidence_mode                    | direct
evidence_dates                   | 1 of 3 evidenceIds resolved to a date
                                    (2026-07-07); 2 named null rather than
                                    guessed — they fall outside PaceEvidence's
                                    own session window (Rule 11: absence
                                    stated, not fabricated)
representative_observations      | 5 sessions, dated 2026-07-07 → 2026-08-30,
                                    4 controlled / 1 variable
excluded_observations             | windowDays 56, representativeDays 28,
                                     excludedDays 29, stalenessFactor 0.976,
                                     reachedOuterBound false
hr_compat_verdict                 | COMPATIBLE
hr_compat_reason                  | "The controlled sessions backing this pace
                                     proposal sit inside or reasonably near
                                     the runner's own Z4 ceiling (160-167 bpm)...
                                     HR stays put, no action."
hr_compat_evidence                 | 4 sessions read, avgWorkHrBpm 154.3–166.0
                                      (REAL work-segment HR from
                                      segmentActivity's own quality-segment
                                      classification — not the pace-based
                                      proxy the earlier report used for two of
                                      its three sessions), lthrReanchorAdvisory
                                      not stale
contradictions                     | []
live_training_lead_fired            | false
live_recompute_paces_fired          | false
agrees_with_live                    | false   (engine proposed PROGRESS; the
                                                live detector found no
                                                pace-moving trigger this cycle
                                                — a real, expected disagreement,
                                                not a defect this task's scope
                                                covers)
mutation_checksum_before             | 925312284e816aabe3b4d09c6226e286:103
mutation_checksum_after              | 925312284e816aabe3b4d09c6226e286:103
zero_mutation_verified               | true
source                                | cron_run_adaptations_shadow
```

(Full untruncated `hr_compat_evidence`/`phase_breakdown` jsonb available via
`SELECT * FROM adaptation_shadow_log WHERE id = 1` over the RO role — the
table above is the same query, reformatted for readability.)

---

## 6 · Pace/HR compatibility, wired for real

`web-v2/lib/adaptation/pace-hr-evidence.ts` — new. Closes the one gap the
2026-09-01 `pace-hr-compatibility-2026-09-01.md` report named explicitly:
"a production wiring of this validator should instead source `avgWorkHrBpm`
from the Evidence Engine's own quality-segment grouping... rather than [the]
pace-based proxy [used for two of three sessions in that report's
demonstration]." `resolveHrCheckedSessions` now calls the SAME
`classifyRecentActivities` batch classifier the engine itself uses, reads the
real `segmentActivity` output (`threshold_like`/`high_intensity` segments,
distance-weighted mean HR), and never falls back to a pace proxy.

Wired into `shadow-compare.ts`: every PACE record with a live proposal now
resolves `hrCompatibility` against the **controlled** sessions backing that
proposal (`sessionDemonstratesControl` — the same population `detectPace`
itself required before proposing at all), plus a real `LTHR`/staleness read
(`resolveLthrContext`).

The four verdicts, wired exactly per the decision:

- `COMPATIBLE` — retains HR guidance, no change. **Real example: §5's
  record, verdict `COMPATIBLE`.**
- `COMPATIBLE_ENVIRONMENTAL_EXPLAINED` — heat-explained overage, capacity
  belief untouched. Falsified against synthetic cases in
  `pace-hr-compatibility.test.ts` (7/7 passing, unchanged by this pass).
- `COMPATIBLE_HR_CEILING_LIKELY_STALE` — undershoot pattern flagged for the
  HR owner, pace proceeds.
- `INCOMPATIBLE_REFUSE` — **now actually refuses**, via a new field:
  `finalDecision`/`finalDecisionReason` on `ShadowCompareRecord`.
  `engine.decision` (the raw PACE-engine output) is never overwritten — it
  stays the literal, traceable fact; `finalDecision` becomes
  `'REFUSED_HR_INCOMPATIBLE'` and `finalDecisionReason` carries the
  compatibility check's own reason string whenever `hrCompatibility.paceProposalMayProceed`
  is false. A `deriveContradictions` helper also names this case explicitly
  in `contradictions[]` (`HR_COMPATIBILITY_REFUSES_PROGRESS`) so it is never
  a silent pass-through.

No synthetic `INCOMPATIBLE_REFUSE` was hit on the owner's real evidence
tonight (the real case is genuinely `COMPATIBLE` — every controlled session
sits at or under the Z4 ceiling), which is itself informative and consistent
with the earlier report's finding on the same account. The refusal path is
exercised by `pace-hr-compatibility.test.ts`'s existing synthetic falsifier
and by `shadow-compare.ts`'s own logic (`hrRefuses` branch, unit-testable and
directly readable in the source) — not fabricated as a real-account result
that did not occur.

---

## 7 · Zero-mutation, re-confirmed after every change in this pass

Not assumed to survive the schema expansion — re-run explicitly, most
recently after fixing a real coercion-gate violation the expansion
introduced (`persistShadowCompareRecord`'s new "table exists but the insert
failed" branch had a blind `.catch(() => false)` around a probe that already
catches its own failure internally and never rejects — removed, not
exempted; `check-coercion.sh` clean afterward).

`_shadow_compare.audit.test.ts`, four tests, all passing against production
over the **read-only role**:

1. **3× same-day cycle** — `plan_workouts` checksum
   `925312284e816aabe3b4d09c6226e286:103` before and after, byte-identical.
   Determinism unchanged: three runs, identical decision/phaseBreakdown
   (minus `resolvedAt`).
2. **Cron path over the RO role** — now that the table exists in production,
   the RO role's `INSERT` is refused at the Postgres permission level
   (`permission denied for table adaptation_shadow_log`); `persistShadowCompareRecord`
   reports `{posture:'skipped', detail:'adaptation_shadow_log exists but the
   insert failed: permission denied...'}` rather than either crashing or the
   now-stale pre-migration message ("table does not exist yet").
3. **New test, added this pass** — the OTHER honest skip reason (table
   genuinely absent, simulated via a scoped `pool.query` patch rather than
   dropping the real production table) is proven distinct from the
   permission-refusal message above — the exact Rule 11 distinction the
   coercion fix in §... made necessary to keep testing both branches.
4. **5-date walk for a non-upward case** — `HOLD` found on 2026-02-01 through
   2026-06-01 (all five), confirming the mechanism handles the non-upward
   path with the expanded schema too. Timeout bumped 120s→240s (documented
   in the test file) — the walk now also resolves the convergence guard and
   re-runs activity classification for HR compatibility per cycle, real
   added work, not a regression.

Separately, the real production write in §5 carries its OWN checksum proof
in-band: `mutation_checksum_before` = `mutation_checksum_after` =
`925312284e816aabe3b4d09c6226e286:103`, `zero_mutation_verified: true` —
proof that ships with the row itself, not only with the test suite.

Retention verified against production too (safe — with only two rows, both
from today, neither bound could fire): `pruneAdaptationShadowLog()` run via
`web-v2/scripts/_run_shadow_log_prune_verify_2026-09-01.mjs` —
`{"deletedByAge":0,"deletedByCap":0}`, 2 rows before and after, no error.

---

## 8 · Verification summary

- `npx tsc --noEmit` — clean, whole project, run after every substantive
  change in this pass (final run: 0 errors).
- `npx vitest run lib/adaptation --exclude "**/*.audit.test.ts"` — 176/176
  passing (includes the updated Fixture 10 in `_pace_replay_corpus.test.ts`).
- `npx vitest run lib/adaptation/_shadow_compare.audit.test.ts` — 4/4
  passing, real account, real production database.
- `npx vitest run lib/adaptation/pace-hr-compatibility.test.ts` — 7/7
  passing, unchanged.
- `npx vitest run lib/ops/_cron_ledger.test.ts` — 35/35 passing, including
  the new `prune-adaptation-shadow-log` exclusion entry.
- `scripts/check-coercion.sh`, `check-automatic-mutations.sh`,
  `check-doctrine.sh`, `check-normal-window.sh`, `check-swallowed-failure.sh`
  — all clean after this pass's own fixes.
- `scripts/check-generated-content.sh` — clean for everything this session
  touched (the stale `pace-hr-compatibility.ts` `MODULE_ORPHANS` exemption
  was deleted, since it now has a real caller). One PRE-EXISTING, UNRELATED
  finding remains from a concurrent agent's uncommitted work
  (`lib/adaptation/_season_sweep_absorption_duration.script.ts`, untracked,
  not part of this session's diff) — left untouched per the shared-checkout
  discipline of not editing another agent's WIP.

## Files touched

- `web-v2/db/migrations/160_adaptation_shadow_log.sql` — expanded schema +
  retention documentation, **applied**.
- `web-v2/lib/adaptation/shadow-compare.ts` — expanded `ShadowCompareRecord`,
  wired convergence guard + HR compatibility, per-cycle checksum, coercion
  fix.
- `web-v2/lib/adaptation/authoring-convergence.ts` — new. Part 3.
- `web-v2/lib/adaptation/pace-hr-evidence.ts` — new. Part 4's real wiring.
- `web-v2/lib/adaptation/shadow-log-retention.ts` — new. Criterion 3.
- `web-v2/app/api/cron/prune-adaptation-shadow-log/route.ts` — new.
- `.github/workflows/prune-adaptation-shadow-log.yml` — new.
- `web-v2/lib/ops/cron-ledger.ts` — `EXCLUDED_FROM_TICK` entry.
- `web-v2/lib/audit/automatic-mutation-registry.ts` — prune-job entry.
- `web-v2/lib/audit/generated-content-registry.ts` — stale orphan exemption
  deleted.
- `web-v2/lib/adaptation/_shadow_compare.audit.test.ts` — updated for
  post-migration reality (two persistence-skip reasons distinguished, walk
  timeout bumped).
- `web-v2/lib/adaptation/_pace_replay_corpus.test.ts` — Fixture 10 comments
  updated to record the guard now exists one layer up; assertions unchanged.
- `web-v2/scripts/_run_shadow_compare_production_2026-09-01.mjs` — new,
  one-off. The production activation run behind §5.
- `web-v2/scripts/_run_shadow_log_prune_verify_2026-09-01.mjs` — new,
  one-off. The retention verification run behind §7.
- `docs/reports/adaptation-shadow-log/0645f40c-951d-4ccc-b86e-9979cd26c795.jsonl`
  — 9 more lines appended by this pass's RO-role test runs (file-fallback
  posture), checked in as evidence, matching the prior report's own
  convention.

## Constraint held

No shadow record was consumed by any live mutation path. Nothing built this
pass touches `adapt.ts`, `applyAdaptations`, or writes to `plan_workouts` —
verified structurally (every new function is either pure or read-only) and
empirically (the checksum proof in §7, both in the test suite and carried
in-band on the real production row in §5).
