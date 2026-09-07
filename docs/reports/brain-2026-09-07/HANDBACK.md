# Handback · round 13 · 2026-09-07 (supersedes round 12, `docs/reports/brain-2026-09-06/HANDBACK.md`)

`main` at `3a5139a57`. Railway confirmed `SUCCESS` for this exact SHA
(checked live, this handback). TestFlight **287** is the current build, in
`IN_BETA_TESTING` (your internal group only — no external submission).
`AUTOMATIC_ADAPTATION_AUTHORITY` still the literal `false`. **No production
DDL applied — reconfirmed live, this handback, by querying
`information_schema.tables` directly: none of `plan_decision_ledger`,
`reassessment_schedule`, `plan_decision_outcome`, `runner_beliefs` exist in
production.** Your plan has not been written to.

No agent of mine is in flight. Three I dispatched earlier
(`mileage-responsive`, `continuous-evidence`, `live-arbitration`) completed,
were reviewed, and are already merged into `main` — confirmed by ancestry,
not assumed. This round's own work is the migration-transaction wrap
(committed `3a5139a57`) and this verification pass itself.

---

## The ten answers, first, unambiguous, re-verified live just now

1. **Is orchestration genuinely 16/16? No — 15/16, unchanged in headline
   count from what OPTIONLANE-1 landed, but re-confirmed independently this
   round** (`WIRED_STEP_PIN = 15`, re-read from source; `npx vitest run
   lib/brain/_option_lane_wired.test.ts
   lib/brain/orchestration/_orchestration.test.ts` → 15/15 tests green, run
   by me directly, not trusted from a report). **Step 3 (classify evidence)
   is the one remaining gap, and it is DELIBERATE, not neglected** — a real
   Rule 16 ownership question (the 19-tag `classifyEvidence` vs. the dose-axis
   `DOSE_EVIDENCE_READERS`) that a state flip cannot resolve, documented
   in-source with the reasoning, waiting on your call rather than either
   agent picking a side.
2. **Did one organic, non-seeded decision complete the entire loop? Yes —
   closed this session (OPTIONLANE-1, `acfe4e35a`), independently
   re-verified by me just now, not re-taken on faith.** `lib/brain/
   option-lane.ts` is the missing Step-7 caller: it takes the REAL verdict
   from `evaluateDueRollingBoundariesForUser` (no re-derivation, no
   construction), classifies the runner's real evidence, calls the real
   `rankOptions` and the real `resolveArbitrationPriority`, and writes
   through `recordDecision`/`writeActionProposal` — never `mutatePlan`,
   never touches `plan_workouts` directly. `_option_lane_wired.test.ts` is
   the falsification gate built specifically to prove this is WIRED in the
   sense that matters (a real caller feeds it the real verdict), because
   `_orchestration.test.ts` alone was shown this session not to catch that
   distinction — it kept reporting 9/9 with the call replaced by an inline
   stub.
3. **Can that decision survive restart and plan rebuild?** Proven for the
   constructed-proposal half in an earlier round; the organic half now
   writes through the SAME ledger/proposal machinery (`recordDecision`,
   `writeActionProposal`), so the same idempotency guarantees apply by
   construction — not re-run as a fresh end-to-end restart test this round.
   Flagged, not claimed.
4. **Can the runner accept or decline it on the shipped V5 surface?**
   Mechanically yes (accept/decline both fire real requests through the
   proposal surface, verified in an earlier round) — but **the entire
   ledger-required mutation path still refuses in PRODUCTION**, correctly,
   because migration 166 is unapplied (§6). Nothing has silently bypassed
   that refusal. Confirmed live, this round: `plan_decision_ledger` does not
   exist in production.
5. **Are mutation and ledger atomic in production, or still blocked on
   DDL? Still blocked on DDL, confirmed live this round, not carried
   forward from memory.** I queried `information_schema.tables` against
   production directly: zero of the four new tables exist. Every real
   mutation attempt through the ledger-required paths (including Move-a-Run)
   refuses, visibly, rather than proceeding unaudited.
6. **Which reassessment kinds genuinely re-evaluate?** Unchanged from round
   12's 9-point matrix (§4a there, not re-run this round since nothing
   touched that code) — all six kinds real, one bug found and fixed then
   (`DEFERRALCARRYALERT-1`). **New signal this round, live production
   telemetry, not a test:** the `deferral_queue_carry` alert is now firing
   for real, nightly — most recent read (`2026-09-07T08:03:59Z`) says
   "4/7 runners' deferral queue carried clean," proof the mechanism the
   fix put in place is actually observing something, not a log nobody
   reads.
7. **How many generators and facets are complete? 14/21 generators,
   re-derived live this round by reading `GENERATOR_REGISTRY` in
   `lib/brain/proposal/facets.ts` directly and counting non-null entries —
   not trusted from any prior report.** Up from the stale 13/21 baseline;
   the +1 is `RACEDAYSTRUCTURE-1`/`LONGRUNSTRUCTURE-1`, which closed the
   long-run-structure generator gap this session by building an independent
   reader (`lib/brain/proposal/evidence/long-run-structure.ts`) rather than
   reaching across the `lib/brain`/canonical-engine boundary the mutation
   gates forbid. The facet-cell figure (previously reported 265/294) was
   **not** re-derived this round — flagged as unverified, not restated as
   fact.
8. **Which belief quantities still have multiple live owners? 11 of 12,
   re-derived live this round by parsing `QUANTITY_OWNERSHIP` in
   `lib/runner-state/quantity-owners.ts` and counting `role: 'SECOND'`
   sites per quantity — not estimated.** Only `GOAL` currently carries zero
   `SECOND` (competing) sites. `RECOVERY_SPACING` — the one this session's
   `RECOVERY-OWNER-1` touched — **still shows 5 competing `SECOND` sites**
   after that fix; the fix closed one specific divergent branch
   (`lib/coach/recovery-phase.ts`'s intervals/tempo/threshold case, matching
   your 2026-09-03 ruling), not the whole quantity. Correcting the
   remaining 10 open quantities (WEEKLY_VOLUME 2, LONG_RUN_DISTANCE 2,
   THRESHOLD_DOSE 1, INTERVAL_PACE 1, INTERVAL_DOSE 1, MARATHON_PACE_DOSE 2,
   QUALITY_FREQUENCY 1, RUNNING_FREQUENCY 3, RECOVERY_SPACING 5, RACE_TARGET
   1, HEAT_TERRAIN_RESPONSE 1) is real, scoped, remaining work — not started
   beyond RECOVERY_SPACING's partial fix.
9. **What was physically verified this round?** Railway deploy status for
   the exact current SHA (`SUCCESS`, checked live). Production
   `information_schema` state for the DDL question (checked live, twice —
   once before writing the migration-transaction commit, once after).
   `plan_weeks`/`plan_phases` NULL counts refreshed live (88/672, 25/222 —
   unchanged from round 12, no drift). `ops_alerts` read live for
   `pace_drift_unexplained`, `deferral_queue_carry`, `belief_store_pass`
   (below). TestFlight processing state for build 287. The option-lane and
   orchestration test files re-run directly by me. **Not done this round:**
   any native/Watch verification, any new simulator rendering, any fresh
   walk-substrate session — this round was a production-state and
   merged-tree integrity pass, not a UI pass.
10. **What still requires your approval?** Unchanged in substance from round
    12 — migrations 166/167/168/169 and the `plan_weeks`/`plan_phases`
    backfill (literal SQL, transaction-wrapped, schema-verification queries
    and locking detail all below in §6); the pace-drift correction
    mechanism, now materially more urgent (§7 — the alert has gone from
    1 unexplained plan to 3 across 7 active plans since round 12); nothing
    else is currently gated on you.

---

## 1 · What changed since round 12 (`3127f3c28` → `3a5139a57`, 7 commits)

- **`RACEDAYSTRUCTURE-1` / `2791821f7`** — the "Holding the plan… Sept 13"
  nonsense card, fixed and Railway-confirmed in round 12, is also what
  closed generator gap #14 (§ above, item 7).
- **`DEFERRALCARRYALERT-1` / `3127f3c28`** — reassessment matrix to 9/9 on
  DEFERRAL; now producing live telemetry (item 6 above).
- **`REQUESTSTORM-2` / `279492cc8`, shipped as TestFlight 287
  (`90fb2fde6`)** — every V5 surface (Today/Block/Races) was reloading 2-3x
  per real foreground because `.faffForegroundRefresh` posts twice
  deliberately and nothing coalesced the second post. Fixed with a 3-second
  coalesce window (`ForegroundWork.shouldLoadOnForeground`); removed the
  redundant `.v5ReloadOnForeground { load() }` calls that were a third
  trigger on Today/Block/Races. Verified via marker instrumentation that
  both real posts still fire (confirming the fix isn't just hiding a
  missing signal) and that exactly one load wave now results, including
  under rapid double-foreground. **Separate finding, NOT fixed:** a
  different legacy prefetch bundle (`/api/strava/status`, `/api/races`,
  `/api/coach/intents`, `/api/today/purpose`, `/api/profile`) also
  duplicates on foreground on an undiagnosed path — both waves currently
  return 401 in the harness this was found in, so it may or may not be
  runner-visible; not investigated further this round.
- **`RECOVERY-OWNER-1` / `684feaa36`** — closed one specific
  `RECOVERY_SPACING` divergence (native code was telling you to wait 2 days
  after a quality session when the plan's own composer only required 1,
  per your 2026-09-03 ruling). See item 8 above for what's still open on
  this quantity.
- **`COMPETINGPROPOSAL-1` / `e8672ce4b`** — `writeWorkoutProposals`'s dedup
  used to silently `continue` past a competing action. Now arbitrates: an
  ordinary competing proposal defers with a real reason and reconsider
  date (`reassessment_schedule`, kind `DEFERRAL`); an evidenced safety
  decline against a pending push retires the push and ledgers it as a
  `HOLD` — "safety defeats every push, no exception" now has a mechanism,
  not just a sentence. I found and fixed a Rule 11 violation in this code
  before it shipped (`.catch(() => ({rows:[]}))` collapsed "query failed"
  into "no row matched"; routed through `rowOrNull` instead).
- **`OPTIONLANE-1` / `acfe4e35a`** — the primary deliverable. See item 2
  above.
- **`3a5139a57` (this round)** — migrations 166/167/168/169 each wrapped in
  an explicit `BEGIN;`/`COMMIT;`. Postgres DDL statements are individually
  atomic but not atomic as a batch; without the wrap, a mid-sequence
  failure (e.g. an index creation failing after the table succeeded) would
  leave a partially-applied artifact with no clean signal. Railway
  confirmed `SUCCESS` for this exact SHA.

## 2 · Pace drift — now worse, still your call, still not touched

Round 12 found one account (yours) with a 1 s/mi drift, diagnosed as a
propose-then-accept threshold (1.0-2.0 VDOT) too coarse to catch a ~0.1-0.2
VDOT gap that a retired nightly auto-heal used to close silently. **Live
`ops_alerts` read this round: `pace_drift_unexplained` now reports 3
unexplained drifts across 7 active plans** (was 1 of however many were
active at the time of the prior read — the monitor is doing its job,
correctly widening the finding as more accounts drift). Nothing has been
written anywhere on this. Your two options from round 12 stand unchanged:
(a) have the drift-monitor create the missing re-anchor proposal itself
when it finds an uncovered mismatch (you'd still accept it like any other
proposal), or (b) leave it alert-only. Both require touching the
plan-mutation/proposal system for real accounts and need your go regardless
of which direction. I have implemented neither.

## 3 · Native/Watch verification checklist — still not run this round

Explicitly not attempted this round (this was a state-verification pass on
the server side, not a device pass): Decisions loading on device, a
stale-proposal refusal rendering correctly, accepted-change consistency
across Today/Block/Watch, Watch explanation-text accuracy against a real
decision, a clean Watch unit-test run. Also not started: the native
HealthKit calorie-resync dry-run preview flow. Both remain open, stated
plainly rather than folded into "done."

## 4 · Rolling-boundary three-point proof — not re-run this round

Before-week, after-midweek-quality, after-race-before-long-run. OPTIONLANE-1
organically exercised one real boundary as part of closing item 2 above; the
other two have not been freshly re-verified since the round that first
built the rolling-boundary evaluator. Not claimed as re-proven.

## 5 · Belief-owner consolidation — 1/12 closed, 10 more scoped (item 8 detail)

The exact 10 remaining quantities and their competing-site counts are listed
in item 8 above, derived live from source, not from memory. This is the
single largest piece of real, scoped, not-yet-started engineering work left
on the list — each quantity needs either a doctrine ruling on which site is
canonical (the RECOVERY_SPACING pattern: find the citation, delegate the
loser to the winner) or, where no doctrine conflict exists, a mechanical
consolidation.

## 6 · Migrations — literal SQL, transaction-wrapped, with schema-shape verification

**Still none of this applied.** Reconfirmed live against production
immediately before writing this section (not carried over from round 12):
zero of the four tables exist; `plan_weeks` 88/672 NULL, `plan_phases`
25/222 NULL, unchanged from round 12's read — no drift in the interim.

**Locking, stated precisely, per your ask:** the four `CREATE TABLE`
migrations take no lock beyond Postgres's own brief lock on a new, empty,
unshared object — sub-second regardless of database size, because nothing
else references these tables yet. The `plan_weeks`/`plan_phases` backfill
is a plain `UPDATE`, which Postgres executes under an `ROW EXCLUSIVE` table
lock (the standard lock any `UPDATE`/`DELETE`/`INSERT` takes — it does not
block concurrent reads or other row-level writes to different rows) plus a
row-level exclusive lock on each of the ~113 rows actually matched
(`user_uuid IS NULL`). It does not block the rest of the table's normal
read/write traffic.

**Schema-shape verification — added this round, not present in round 12.**
`CREATE TABLE IF NOT EXISTS` is a silent no-op if a table by that name
already exists with a *different* shape than expected. Run each of these
immediately after applying the matching migration; the row count is the
number of columns in that migration's own `CREATE TABLE` above (166→36,
167→34, 168→23, 169→24), and every row should show the type each column
was declared with (`uuid`, `text`, `jsonb`, `timestamptz`, `boolean`,
`double precision`, `bigserial`→reported as `bigint` with a sequence
default, `date`, `numeric`).

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'plan_decision_ledger'
ORDER BY ordinal_position;
-- expect 36 rows

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'reassessment_schedule'
ORDER BY ordinal_position;
-- expect 34 rows

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'plan_decision_outcome'
ORDER BY ordinal_position;
-- expect 23 rows

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'runner_beliefs'
ORDER BY ordinal_position;
-- expect 24 rows
```

If any of these returns a row count that doesn't match, or 0 rows, the
`CREATE TABLE IF NOT EXISTS` silently did nothing against a pre-existing
same-named table — stop and tell me before anything else touches it.

**Confirmed this round: `ensureBeliefStoreSchema` (the application-code
twin of migration 169) cannot be invoked by production.** It carries its
own internal `assertScratchDatabase` guard, checking both a loopback
connection address and a `FORBIDDEN_DATABASE_NAMES` set containing `faff`,
`railway`, and `postgres`. Read the source directly: it is called from test
setup and the scratch-bootstrap script only, never from any application
code path.

**Literal SQL, all four tables plus the backfill, exactly as they exist in
`web-v2/db/migrations/` right now** (transaction-wrapped this round):

### 166 · `plan_decision_ledger`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS plan_decision_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid             uuid NOT NULL,
  plan_id               text,
  plan_lineage_id       text NOT NULL,
  replaced_plan_id      text,
  plan_version          text,
  scope                 text NOT NULL
                          CHECK (scope IN ('PLAN', 'WEEK', 'WORKOUT', 'NONE')),
  workout_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_from_iso        date,
  scope_to_iso          date,
  lever                 text NOT NULL
                          CHECK (lever IN (
                            'PACE', 'VOLUME', 'LONG_RUN', 'SESSION_SHAPE',
                            'SCHEDULE', 'PLAN_STRUCTURE', 'RECORD_ONLY')),
  direction             text NOT NULL
                          CHECK (direction IN ('UP', 'DOWN', 'NEUTRAL', 'UNKNOWN')),
  evidence              jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance            text NOT NULL,
  source_mode           text,
  before_state          jsonb,
  after_state            jsonb,
  authority             text NOT NULL
                          CHECK (authority IN (
                            'RUNNER_INITIATED', 'RUNNER_ACCEPTED', 'LIFECYCLE',
                            'COACHING_ADAPTATION', 'AUTHORSHIP')),
  authority_verdict     text NOT NULL
                          CHECK (authority_verdict IN ('PERMITTED', 'REFUSED', 'HELD')),
  hold                  jsonb,
  decision              text NOT NULL
                          CHECK (decision IN (
                            'PROGRESS', 'HOLD', 'REGRESS', 'REFUSE',
                            'APPLY', 'DEFER', 'EXPIRE', 'UNDO')),
  proposal_id           text,
  proposal              jsonb,
  runner_response       text
                          CHECK (runner_response IS NULL OR runner_response IN (
                            'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  responded_at          timestamptz,
  mutation_outcome      text
                          CHECK (mutation_outcome IS NULL OR mutation_outcome IN (
                            'applied', 'rejected', 'undeclared_structural', 'bypassed',
                            'authorship_drift', 'no_plan', 'not_attempted',
                            'ledger_unwritten', 'duplicate')),
  mutation_violations   jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation           text NOT NULL,
  model_version         text NOT NULL,
  at                    timestamptz NOT NULL DEFAULT now(),
  superseded_by         uuid,
  superseded_at         timestamptz,
  undone_at             timestamptz,
  undo_reason           text,
  idempotency_key       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_decision_ledger_explanation_is_present
    CHECK (length(explanation) > 0),
  CONSTRAINT plan_decision_ledger_supersession_is_explained
    CHECK ((superseded_at IS NULL AND superseded_by IS NULL)
        OR (superseded_at IS NOT NULL AND superseded_by IS NOT NULL)),
  CONSTRAINT plan_decision_ledger_undo_is_explained
    CHECK ((undone_at IS NULL AND undo_reason IS NULL)
        OR (undone_at IS NOT NULL AND undo_reason IS NOT NULL AND length(undo_reason) > 0)),
  CONSTRAINT plan_decision_ledger_response_is_timed
    CHECK ((COALESCE(runner_response, 'PENDING') IN ('ACCEPTED', 'DECLINED', 'EXPIRED'))
           = (responded_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS plan_decision_ledger_user_at
  ON plan_decision_ledger (user_uuid, at DESC);
CREATE INDEX IF NOT EXISTS plan_decision_ledger_direction
  ON plan_decision_ledger (user_uuid, direction, at DESC);
CREATE INDEX IF NOT EXISTS plan_decision_ledger_lineage
  ON plan_decision_ledger (plan_lineage_id, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS plan_decision_ledger_idempotency
  ON plan_decision_ledger (user_uuid, provenance, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS plan_decision_ledger_pending_proposals
  ON plan_decision_ledger (user_uuid, at DESC)
  WHERE runner_response = 'PENDING';

COMMENT ON TABLE plan_decision_ledger IS
  'THE durable decision ledger. One row per coaching decision or plan mutation, written by '
  'lib/plan/mutate.ts (the one door in front of plan_workouts) and by the proposal surface. '
  'Survives a plan rebuild: plan_lineage_id is stable across the chain and there are no '
  'foreign keys, deliberately. Rows are never deleted; a decision that stops being current is '
  'superseded or undone, with its reason. Replaces training_plans.adaptation_log as the record '
  'of truth (that column is untouched and keeps its max(ts) consumers).';

COMMIT;
```

Rollback pre-use: `DROP TABLE IF EXISTS plan_decision_ledger;`. Post-use
archival before any destructive step: `pg_dump -t plan_decision_ledger`.
Failure recovery: the whole block above is one transaction — a failure on
any statement rolls back everything, leaving production exactly as it was.

### 167 · `reassessment_schedule`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS reassessment_schedule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid              uuid NOT NULL,
  kind                   text NOT NULL
                           CHECK (kind IN (
                             'DEFERRAL',
                             'EARNING_GATE',
                             'CONDITIONAL_DOSE',
                             'POST_RACE_RECOVERY_CHECK',
                             'RETURN_TO_TRAINING_STAGE',
                             'PROPOSAL_EXPIRATION',
                             'FAILED_EVALUATION')),
  reason_code            text NOT NULL,
  reason_detail          text NOT NULL,
  assess_on_iso          date NOT NULL,
  overdue_after_iso      date,
  required_evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence               jsonb NOT NULL DEFAULT '[]'::jsonb,
  newest_evidence_iso    date,
  plan_id                text,
  plan_lineage_id        text,
  plan_version           text NOT NULL,
  evidence_version       text,
  model_version          text,
  lever                  text,
  before_value           double precision,
  proposed_after_value   double precision,
  magnitude              jsonb,
  payload                jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 text NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN (
                             'PENDING', 'DUE', 'RESOLVED', 'EXPIRED', 'FAILED', 'ABANDONED')),
  attempts               integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error             text,
  last_attempt_at        timestamptz,
  next_retry_at          timestamptz,
  resulting_decision     text,
  resulting_decision_detail text,
  resulting_ledger_id    uuid,
  resolved_at            timestamptz,
  origin_ledger_id       uuid,
  idempotency_key        text NOT NULL,
  queued_at_iso          date NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reassessment_schedule_terminal_is_explained
    CHECK (
      (status IN ('PENDING', 'DUE')
        AND resolved_at IS NULL AND resulting_decision IS NULL)
      OR
      (status IN ('RESOLVED', 'EXPIRED', 'FAILED', 'ABANDONED')
        AND resolved_at IS NOT NULL
        AND resulting_decision IS NOT NULL
        AND resulting_decision_detail IS NOT NULL
        AND length(resulting_decision_detail) > 0)
    ),
  CONSTRAINT reassessment_schedule_failure_names_its_error
    CHECK (status <> 'FAILED' OR (last_error IS NOT NULL AND length(last_error) > 0)),
  CONSTRAINT reassessment_schedule_attempts_are_timed
    CHECK ((attempts = 0) = (last_attempt_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS reassessment_schedule_live_identity
  ON reassessment_schedule (user_uuid, kind, idempotency_key)
  WHERE status IN ('PENDING', 'DUE');
CREATE INDEX IF NOT EXISTS reassessment_schedule_due
  ON reassessment_schedule (assess_on_iso, user_uuid)
  WHERE status IN ('PENDING', 'DUE');
CREATE INDEX IF NOT EXISTS reassessment_schedule_user_live
  ON reassessment_schedule (user_uuid, assess_on_iso)
  WHERE status IN ('PENDING', 'DUE');
CREATE INDEX IF NOT EXISTS reassessment_schedule_retry
  ON reassessment_schedule (next_retry_at)
  WHERE next_retry_at IS NOT NULL AND status IN ('PENDING', 'DUE');

COMMENT ON TABLE reassessment_schedule IS
  'THE durable reassessment scheduler. One row per promise the engine made to look at '
  'something again: deferrals, earning gates, conditional doses, post-race recovery checks, '
  'return-to-training stages, proposal expirations and failed evaluations. Due-ness is a DATE, '
  'so lateness is harmless (CLAUDE.md Rule 23). Rows are never deleted: an item leaving the '
  'live queue is stamped with a terminal status, a resulting decision and a sentence. '
  'Supersedes the unapplied migration 165 (canonical_adaptation_deferrals), which covered one '
  'of these seven kinds.';

COMMIT;
```

Rollback pre-use: `DROP TABLE IF EXISTS reassessment_schedule;`. Same
transactional/failure-recovery posture as 166.

### 168 · `plan_decision_outcome`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS plan_decision_outcome (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id           uuid NOT NULL,
  user_uuid             uuid NOT NULL,
  plan_lineage_id       text NOT NULL,
  lever                 text NOT NULL,
  chosen_option         text NOT NULL,
  rejected_options      jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_direction    text NOT NULL
                          CHECK (expected_direction IN ('UP', 'DOWN', 'NEUTRAL', 'UNKNOWN')),
  prediction            jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_from_iso     date NOT NULL,
  observed_to_iso       date NOT NULL,
  subsequent_execution  jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovery              jsonb NOT NULL DEFAULT '{}'::jsonb,
  later_performance     jsonb NOT NULL DEFAULT '{}'::jsonb,
  pain_or_injury        jsonb NOT NULL DEFAULT '{}'::jsonb,
  verdict               text NOT NULL
                          CHECK (verdict IN (
                            'PRODUCTIVE', 'EXCESSIVE', 'UNDERDOSED', 'UNRESOLVED')),
  verdict_because       text NOT NULL,
  unresolved_reason     text,
  confidence            numeric(4,3),
  model_version         text,
  evaluated_at          timestamptz NOT NULL DEFAULT now(),
  idempotency_key       text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_decision_outcome_window_ordered
    CHECK (observed_to_iso >= observed_from_iso),
  CONSTRAINT plan_decision_outcome_unresolved_is_explained
    CHECK ((verdict = 'UNRESOLVED') = (unresolved_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS plan_decision_outcome_idem
  ON plan_decision_outcome (decision_id, idempotency_key);
CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_runner
  ON plan_decision_outcome (user_uuid, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_lineage
  ON plan_decision_outcome (plan_lineage_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_verdict
  ON plan_decision_outcome (user_uuid, lever, verdict);

COMMENT ON TABLE plan_decision_outcome IS
  'Step 16 · whether a coaching decision turned out to be right. Written by a '
  'later sweep, never by the decision itself. UNRESOLVED is a real answer.';

COMMIT;
```

Rollback pre-use: `DROP TABLE IF EXISTS plan_decision_outcome;`. Same
transactional posture as 166/167. No FK to either — order-independent.

### 169 · `runner_beliefs`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS runner_beliefs (
  id                 bigserial PRIMARY KEY,
  user_uuid          uuid NOT NULL,
  registry           text NOT NULL CHECK (registry IN ('BELIEF', 'QUANTITY')),
  belief_key         text NOT NULL,
  plan_lineage_id    text NOT NULL,
  reading_ok         boolean NOT NULL,
  reading_value      jsonb,
  reading_absent_reason jsonb,
  CHECK (
    (reading_ok = true  AND reading_value IS NOT NULL AND reading_absent_reason IS NULL) OR
    (reading_ok = false AND reading_value IS NULL AND reading_absent_reason IS NOT NULL)
  ),
  confidence         double precision CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source_mode        text,
  supporting         jsonb NOT NULL DEFAULT '[]'::jsonb,
  contradicting      jsonb NOT NULL DEFAULT '[]'::jsonb,
  tension            jsonb,
  recency            jsonb,
  rule8_side         text NOT NULL CHECK (rule8_side IN ('HABIT', 'ABSORBED_LOAD', 'NEITHER')),
  moves_up_on        jsonb NOT NULL DEFAULT '[]'::jsonb,
  moves_down_on      jsonb NOT NULL DEFAULT '[]'::jsonb,
  never_moves_on     jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_module       text NOT NULL,
  owner_symbol       text NOT NULL,
  owner_answers      text NOT NULL,
  computed_at        timestamptz NOT NULL,
  model_version      text NOT NULL,
  stored_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runner_beliefs_latest_idx
  ON runner_beliefs (user_uuid, registry, belief_key, stored_at DESC);
CREATE INDEX IF NOT EXISTS runner_beliefs_lineage_idx
  ON runner_beliefs (user_uuid, plan_lineage_id);

COMMENT ON TABLE runner_beliefs IS
  'Steps 1/5 · the durable belief store. Append-only; the current belief is '
  'the newest row per (user_uuid, registry, belief_key). A reading_ok=false '
  'row is an honest refusal, never a coerced zero.';

COMMIT;
```

Rollback pre-use: `DROP TABLE IF EXISTS runner_beliefs;`. **The moment this
applies, the next `run-adaptations` cron pass starts writing beliefs — no
code change, no restart, no separate flip required.** The application-code
twin (`ensureBeliefStoreSchema`) cannot reach production regardless (see
above), so this migration is the only path by which the table comes into
existence there.

### `plan_weeks` / `plan_phases` · `user_uuid` backfill — data only

Code-side root cause already fixed and shipped, no approval needed there:
all six INSERT sites now stamp `user_uuid` on write. Only the backfill for
the 113 pre-existing NULL rows needs your go.

```sql
BEGIN;

UPDATE plan_weeks w
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE w.plan_id = t.id AND w.user_uuid IS NULL;

UPDATE plan_phases p
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE p.plan_id = t.id AND p.user_uuid IS NULL;

COMMIT;
```

Verification, read-only, immediately after:

```sql
SELECT count(*) FILTER (WHERE user_uuid IS NULL) FROM plan_weeks;   -- expect 0
SELECT count(*) FILTER (WHERE user_uuid IS NULL) FROM plan_phases;  -- expect 0
SELECT count(*) FROM plan_weeks w JOIN training_plans t ON w.plan_id = t.id
  WHERE w.user_uuid IS DISTINCT FROM t.user_uuid;                   -- expect 0
```

**Apply order, if you approve some or all:** 166 → 167 → 168 → 169 →
`plan_weeks` backfill → `plan_phases` backfill. No item depends on another
having landed (no foreign keys between any of the six) — this is a
convenience grouping, not a requirement.

## 7 · Branch hygiene — unchanged from round 12, still clean

`mileage-responsive`, `continuous-evidence`, and `live-arbitration` — the
three agents I dispatched and that reported completion — are all confirmed
merged into `main` by ancestry (`git merge-base --is-ancestor` on each,
checked this round). `evidence-classifier` remains deleted from `origin`
(round 12).

## 8 · Exact commits this round, each confirmed on Railway for its own SHA

`3a5139a57` (MIGRATIONTXN-1, this round's only code/data change) — `SUCCESS`
confirmed live on Railway for this exact commit hash before writing this
handback.

---

**Nothing above is claimed done that was not independently checked this
round — live against production for the DDL/pace-drift/schema questions,
live against source for the orchestration/generator/belief-owner counts,
directly re-run for the option-lane and orchestration tests. The two
largest pieces of real remaining engineering work are unchanged in kind from
round 12 and now precisely scoped: belief-owner consolidation (10 named
quantities, item 8/§5) and the native/Watch verification checklist (§3) —
neither started this round, stated plainly rather than rounded up.**
