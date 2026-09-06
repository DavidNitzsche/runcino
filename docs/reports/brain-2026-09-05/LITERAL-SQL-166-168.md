# Literal SQL · migrations 166, 167, 168

Every `CREATE TABLE`, every index, and every `COMMENT ON TABLE` this packet
covers, pasted verbatim from the migration files on this branch — not
line-number references. This document exists because the packet's own
166.1 and 167.1 sections previously said *"the exact statement is the
file's `CREATE TABLE` block, lines 104-215"* rather than showing it, and
the owner rejected that: a reviewer approving DDL should not have to open a
second file to read the thing being approved. `MIGRATION-PACKET.md` §166.1
and §167.1 now inline this same text; this document is the one place all
three migrations' literal statements sit side by side, for a reviewer
diffing 166 against 167 against 168 without three tabs open.

**Source of truth:** the `.sql` files under `web-v2/db/migrations/`. If this
document and a migration file ever disagree, the `.sql` file is correct and
this document is stale — regenerate it from the files rather than editing
the two by hand in parallel. Verified identical to the checked-in files as
of this branch's `166_plan_decision_ledger.sql` (271 lines),
`167_reassessment_schedule.sql` (232 lines) and
`168_plan_decision_outcome.sql` (93 lines).

**None of the three is applied to production.** All three remain blocked
per the owner's explicit decision: *"Production migrations 166-168 remain
blocked until their literal SQL and atomicity guarantees are reviewed."*
Everything below is scratch-database proof and documentation, not a
production apply.

---

## 166 · `plan_decision_ledger`

File: `web-v2/db/migrations/166_plan_decision_ledger.sql`

### 166.1 · `CREATE TABLE`

```sql
CREATE TABLE IF NOT EXISTS plan_decision_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── the runner · Rule 14, the population is stated, never `user_id` ──────
  user_uuid             uuid NOT NULL,

  -- ── plan lineage ────────────────────────────────────────────────────────
  plan_id               text,
  plan_lineage_id       text NOT NULL,
  replaced_plan_id      text,
  plan_version          text,

  -- ── workout scope · what this decision reached ──────────────────────────
  scope                 text NOT NULL
                          CHECK (scope IN ('PLAN', 'WEEK', 'WORKOUT', 'NONE')),
  workout_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_from_iso        date,
  scope_to_iso          date,

  -- ── the lever and the direction · Rule 21's census, in one query ────────
  lever                 text NOT NULL
                          CHECK (lever IN (
                            'PACE', 'VOLUME', 'LONG_RUN', 'SESSION_SHAPE',
                            'SCHEDULE', 'PLAN_STRUCTURE', 'RECORD_ONLY')),
  direction             text NOT NULL
                          CHECK (direction IN ('UP', 'DOWN', 'NEUTRAL', 'UNKNOWN')),

  -- ── evidence and provenance ─────────────────────────────────────────────
  -- `provenance` is the named write site (`adapt/apply`, `api/plan/workout
  -- PATCH`), the same string `plan_mutation_rejections.source` already carries,
  -- so the two audit surfaces join on a vocabulary that already exists.
  evidence              jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance            text NOT NULL,
  -- DIRECT / INFERRED / RACE_DERIVED / VDOT_FALLBACK / USER_PRIOR /
  -- POPULATION_PRIOR, per DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md.
  -- Nullable: a runner-initiated edit rests on no estimate at all, and
  -- inventing a source mode for it would be a lie with a controlled vocabulary.
  source_mode           text,

  -- ── before and after ────────────────────────────────────────────────────
  before_state          jsonb,
  after_state           jsonb,

  -- ── authority · lib/brain/mutation/authority.ts, verbatim ───────────────
  authority             text NOT NULL
                          CHECK (authority IN (
                            'RUNNER_INITIATED', 'RUNNER_ACCEPTED', 'LIFECYCLE',
                            'COACHING_ADAPTATION', 'AUTHORSHIP')),
  authority_verdict     text NOT NULL
                          CHECK (authority_verdict IN ('PERMITTED', 'REFUSED', 'HELD')),
  -- {owner, blocker, expiresWhen} when a COACHING_ADAPTATION ran under a named
  -- hold. A hold that is not written down is a bypass.
  hold                  jsonb,

  -- ── the decision ────────────────────────────────────────────────────────
  decision              text NOT NULL
                          CHECK (decision IN (
                            'PROGRESS', 'HOLD', 'REGRESS', 'REFUSE',
                            'APPLY', 'DEFER', 'EXPIRE', 'UNDO')),

  -- ── the proposal, and the runner's answer to it ─────────────────────────
  proposal_id           text,
  proposal              jsonb,
  runner_response       text
                          CHECK (runner_response IS NULL OR runner_response IN (
                            'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  responded_at          timestamptz,

  -- ── what actually happened to the plan · lib/plan/mutate.ts outcomes ────
  -- LEDGERATOMIC-1 adds two members, and both are facts the old list could
  -- only tell as a lie:
  --   `ledger_unwritten` · the plan mutation was ROLLED BACK because this
  --      table refused its row. Recorded on a second connection afterwards,
  --      which is the only connection that survives the rollback. Without it
  --      the outcome would have to be written as `not_attempted`, collapsing
  --      "the statement blew up" with "the record refused" — Rule 11, in the
  --      one table built to keep facts apart.
  --   `duplicate` · an exactly-once mutation whose idempotency key already
  --      carried a row. The mutation rolled back and the FIRST row still
  --      stands; this member exists so a caller can say so without inventing
  --      a second row that would claim the work happened twice.
  mutation_outcome      text
                          CHECK (mutation_outcome IS NULL OR mutation_outcome IN (
                            'applied', 'rejected', 'undeclared_structural', 'bypassed',
                            'authorship_drift', 'no_plan', 'not_attempted',
                            'ledger_unwritten', 'duplicate')),
  mutation_violations   jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── the explanation, the model, the time ────────────────────────────────
  explanation           text NOT NULL,
  model_version         text NOT NULL,
  at                    timestamptz NOT NULL DEFAULT now(),

  -- ── superseded / undone · never a DELETE, never an in-place rewrite ─────
  superseded_by         uuid,
  superseded_at         timestamptz,
  undone_at             timestamptz,
  undo_reason           text,

  -- ── idempotency · a re-run of the same pass refreshes, never duplicates ─
  idempotency_key       text,

  created_at            timestamptz NOT NULL DEFAULT now(),

  -- An explanation is not optional. A ledger row that cannot say why is the
  -- `{"n": 1}` failure with more columns (Rule 21).
  CONSTRAINT plan_decision_ledger_explanation_is_present
    CHECK (length(explanation) > 0),

  -- A supersession names its successor, or it is not a supersession.
  CONSTRAINT plan_decision_ledger_supersession_is_explained
    CHECK ((superseded_at IS NULL AND superseded_by IS NULL)
        OR (superseded_at IS NOT NULL AND superseded_by IS NOT NULL)),

  -- An undo states a reason. "It was reversed" without "because" is the same
  -- shape as an expiry with no expiry_reason, which migration 165 already
  -- refused for the same argument.
  CONSTRAINT plan_decision_ledger_undo_is_explained
    CHECK ((undone_at IS NULL AND undo_reason IS NULL)
        OR (undone_at IS NOT NULL AND undo_reason IS NOT NULL AND length(undo_reason) > 0)),

  -- A settled runner response carries the moment it settled; a pending or
  -- absent one does not. COALESCE rather than a bare IN, because a NULL
  -- comparison makes a CHECK pass vacuously and a constraint that cannot fail
  -- is Rule 18's whole complaint.
  CONSTRAINT plan_decision_ledger_response_is_timed
    CHECK ((COALESCE(runner_response, 'PENDING') IN ('ACCEPTED', 'DECLINED', 'EXPIRED'))
           = (responded_at IS NOT NULL))
);
```

36 columns, 5 table-level `CHECK` constraints plus 5 column-level `IN()`
checks, no foreign keys.

### 166.2-166.6 · the five indexes

```sql
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
```

### 166.7 · `COMMENT ON TABLE`

```sql
COMMENT ON TABLE plan_decision_ledger IS
  'THE durable decision ledger. One row per coaching decision or plan mutation, written by '
  'lib/plan/mutate.ts (the one door in front of plan_workouts) and by the proposal surface. '
  'Survives a plan rebuild: plan_lineage_id is stable across the chain and there are no '
  'foreign keys, deliberately. Rows are never deleted; a decision that stops being current is '
  'superseded or undone, with its reason. Replaces training_plans.adaptation_log as the record '
  'of truth (that column is untouched and keeps its max(ts) consumers).';
```

---

## 167 · `reassessment_schedule`

File: `web-v2/db/migrations/167_reassessment_schedule.sql`

### 167.1 · `CREATE TABLE`

```sql
CREATE TABLE IF NOT EXISTS reassessment_schedule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Rule 14 · the population this row belongs to, stated. Never `user_id`.
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

  -- ── reason · the code and the sentence ──────────────────────────────────
  -- Deliberately NOT a CHECK-constrained enum: seven kinds have seven
  -- vocabularies, and a shared CHECK would either have to list every code every
  -- kind will ever use (a constraint that blocks a code change on a DDL
  -- approval) or be so wide it constrains nothing. The per-kind vocabulary is
  -- typed in `lib/ops/reassessment-scheduler.ts` and gated there.
  reason_code            text NOT NULL,
  reason_detail          text NOT NULL,

  -- ── the assessment date · due-ness is a DATE, never a clock hour ────────
  assess_on_iso          date NOT NULL,
  -- Past this date an unassessed item is a defect and raises an alert. NULL
  -- means "this item has no deadline", which is a real answer for a standing
  -- earning gate and is not the same as a deadline of never.
  overdue_after_iso      date,

  -- ── required evidence · what must be true before this can be answered ───
  required_evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What supported it when it was queued, so a reader can judge it later.
  evidence               jsonb NOT NULL DEFAULT '[]'::jsonb,
  newest_evidence_iso    date,

  -- ── plan and version ────────────────────────────────────────────────────
  plan_id                text,
  plan_lineage_id        text,
  plan_version           text NOT NULL,
  evidence_version       text,
  model_version          text,

  -- ── the payload · what will be re-offered at the boundary ───────────────
  lever                  text,
  before_value           double precision,
  proposed_after_value   double precision,
  magnitude              jsonb,
  payload                jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── status ──────────────────────────────────────────────────────────────
  -- PENDING   queued, not yet due.
  -- DUE       due and awaiting assessment.
  -- RESOLVED  assessed; `resulting_decision` says what came of it.
  -- EXPIRED   retired for a stated reason without being assessed.
  -- FAILED    assessment broke past the retry budget. Loud, never silent.
  -- ABANDONED withdrawn by a runner action (a plan rebuild, an explicit undo).
  status                 text NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN (
                             'PENDING', 'DUE', 'RESOLVED', 'EXPIRED', 'FAILED', 'ABANDONED')),

  -- ── attempts · Rule 11, a broken read is not an empty one ───────────────
  attempts               integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error             text,
  last_attempt_at        timestamptz,
  next_retry_at          timestamptz,

  -- ── the resulting decision ──────────────────────────────────────────────
  resulting_decision     text,
  resulting_decision_detail text,
  -- The ledger row this item produced, when it produced one. No FK: the ledger
  -- outlives everything by design and this table must not be able to cascade.
  resulting_ledger_id    uuid,
  resolved_at            timestamptz,

  -- The ledger row that queued this item, when there was one.
  origin_ledger_id       uuid,

  -- ── identity ────────────────────────────────────────────────────────────
  -- The engine's own idempotency key, so a re-assessment over unchanged
  -- evidence refreshes this row rather than queueing a second copy.
  idempotency_key        text NOT NULL,

  queued_at_iso          date NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- A terminal status states what came of the item and when, or it is not a
  -- resolution. The database refuses a row that says "gone" without saying why
  -- — 165's constraint, generalised from expiry to every terminal state.
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

  -- A FAILED item carries the error that failed it. "It failed" with no message
  -- is the swallowed-failure shape `check-swallowed-failure.sh` exists to keep
  -- out of the code, asserted here in the schema as well.
  CONSTRAINT reassessment_schedule_failure_names_its_error
    CHECK (status <> 'FAILED' OR (last_error IS NOT NULL AND length(last_error) > 0)),

  -- An attempt that happened has a time; a row with attempts = 0 has not been
  -- tried. Rule 11: never-tried and tried-and-fine must stay distinguishable.
  CONSTRAINT reassessment_schedule_attempts_are_timed
    CHECK ((attempts = 0) = (last_attempt_at IS NULL))
);
```

34 columns, 3 table-level `CHECK` constraints plus 2 column-level `IN()`
checks (`kind`, `status`), no foreign keys.

### 167.2-167.5 · the four indexes

```sql
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
```

### 167.6 · `COMMENT ON TABLE`

```sql
COMMENT ON TABLE reassessment_schedule IS
  'THE durable reassessment scheduler. One row per promise the engine made to look at '
  'something again: deferrals, earning gates, conditional doses, post-race recovery checks, '
  'return-to-training stages, proposal expirations and failed evaluations. Due-ness is a DATE, '
  'so lateness is harmless (CLAUDE.md Rule 23). Rows are never deleted: an item leaving the '
  'live queue is stamped with a terminal status, a resulting decision and a sentence. '
  'Supersedes the unapplied migration 165 (canonical_adaptation_deferrals), which covered one '
  'of these seven kinds.';
```

---

## 168 · `plan_decision_outcome`

File: `web-v2/db/migrations/168_plan_decision_outcome.sql`

Step 16 · did a decision turn out to be right. A **separate table** from 166,
written by a *later* sweep (`lib/brain/ledger/outcome-sweep.ts`) days or
weeks after the decision it judges — never by the decision itself — for
three reasons the migration's own header states: (1) an outcome row
appearing at all is itself the "the loop closed" signal, distinct from the
decision row; (2) 166 was already submitted for review when this was
written, so extending it would invalidate that review; (3) one decision can
be re-evaluated as more evidence arrives, which is a row set, not a column.

### 168.1 · `CREATE TABLE`

```sql
CREATE TABLE IF NOT EXISTS plan_decision_outcome (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The decision this judges. No FK, for the same reason 166 carries none: a
  -- record whose whole value is outliving its subject must not be deletable by
  -- a cascade.
  decision_id           uuid NOT NULL,
  user_uuid             uuid NOT NULL,
  plan_lineage_id       text NOT NULL,

  -- ── WHAT THE DECISION SAID IT WOULD DO ───────────────────────────────────
  lever                 text NOT NULL,
  chosen_option         text NOT NULL,
  rejected_options      jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_direction    text NOT NULL
                          CHECK (expected_direction IN ('UP', 'DOWN', 'NEUTRAL', 'UNKNOWN')),
  prediction            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── WHAT ACTUALLY HAPPENED ───────────────────────────────────────────────
  observed_from_iso     date NOT NULL,
  observed_to_iso       date NOT NULL,
  subsequent_execution  jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovery              jsonb NOT NULL DEFAULT '{}'::jsonb,
  later_performance     jsonb NOT NULL DEFAULT '{}'::jsonb,
  pain_or_injury        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ── THE VERDICT ──────────────────────────────────────────────────────────
  --
  -- UNRESOLVED is a first-class answer and the default. Rule 11: "not enough
  -- has happened yet" is not "the decision was fine", and an engine that
  -- cannot say the first will report the second.
  verdict               text NOT NULL
                          CHECK (verdict IN (
                            'PRODUCTIVE', 'EXCESSIVE', 'UNDERDOSED', 'UNRESOLVED')),
  verdict_because       text NOT NULL,
  -- What was missing, when the verdict is UNRESOLVED. Never a shrug.
  unresolved_reason     text,
  confidence            numeric(4,3),

  model_version         text,
  evaluated_at          timestamptz NOT NULL DEFAULT now(),
  -- One evaluation per decision per observation window, so a nightly sweep
  -- re-evaluating the same decision updates rather than accumulating.
  idempotency_key       text NOT NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plan_decision_outcome_window_ordered
    CHECK (observed_to_iso >= observed_from_iso),
  CONSTRAINT plan_decision_outcome_unresolved_is_explained
    CHECK ((verdict = 'UNRESOLVED') = (unresolved_reason IS NOT NULL))
);
```

25 columns, 2 table-level `CHECK` constraints plus 1 column-level `IN()`
check (`verdict`), no foreign keys.

**What the two `CHECK`s enforce, read out loud:**

- `plan_decision_outcome_window_ordered` — the observation window cannot end
  before it starts. Trivial, and it is the kind of trivial that a hand-typed
  `INSERT` gets backwards under deadline pressure exactly once.
- `plan_decision_outcome_unresolved_is_explained` — a verdict of
  `UNRESOLVED` is required to carry `unresolved_reason`, and every OTHER
  verdict is required NOT to carry one. This is the same shape as 166's
  `…_supersession_is_explained` and 167's `…_terminal_is_explained`: a
  terminal-shaped answer states why, or the database refuses the row.

### 168.2 · the unique index (identity)

```sql
CREATE UNIQUE INDEX IF NOT EXISTS plan_decision_outcome_idem
  ON plan_decision_outcome (decision_id, idempotency_key);
```

Not partial, unlike 166's and 167's identity indexes — this table has no
terminal/live split to protect (an outcome row is never "reopened", it is
re-evaluated under a fresh idempotency key for a fresh observation window),
so a total unique index is the correct shape here rather than an
oversight.

### 168.3-168.4 · the two read indexes

```sql
CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_runner
  ON plan_decision_outcome (user_uuid, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_lineage
  ON plan_decision_outcome (plan_lineage_id, evaluated_at DESC);
```

### 168.5 · the verdict-distribution index

```sql
CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_verdict
  ON plan_decision_outcome (user_uuid, lever, verdict);
```

This is the Rule 22 index: the one that lets a reader ask "how many of this
runner's VOLUME decisions were EXCESSIVE versus UNDERDOSED" without a
sequential scan — the distribution check Rule 22 demands of any mechanism
with opposing verdicts, made cheap to run.

### 168.6 · `COMMENT ON TABLE`

```sql
COMMENT ON TABLE plan_decision_outcome IS
  'Step 16 · whether a coaching decision turned out to be right. Written by a '
  'later sweep, never by the decision itself. UNRESOLVED is a real answer.';
```

---

## Cross-migration facts a reviewer will want in one place

| | 166 `plan_decision_ledger` | 167 `reassessment_schedule` | 168 `plan_decision_outcome` |
|---|---|---|---|
| Columns | 36 | 34 | 25 |
| Table-level CHECKs | 5 | 3 | 2 |
| Column-level `IN()` CHECKs | 5 | 2 | 1 |
| Foreign keys | 0 | 0 | 0 |
| Indexes (excl. `pkey`) | 5 | 4 | 4 |
| Partial unique index | yes (`…_idempotency`) | yes (`…_live_identity`) | no — total unique on `(decision_id, idempotency_key)` |
| Writer | `lib/plan/mutate.ts` (+ proposal surface) | `lib/ops/reassessment-scheduler.ts`, `lib/adaptation/canonical-shadow/deferral-store.ts` | `lib/brain/ledger/outcome-sweep.ts` |
| Applied to production? | **No** | **No** | **No** |
| Applied to a scratch DB? | Yes — `faff_ledger_scratch`, `faff_roundtrip_scratch` | Yes — `faff_ledger_scratch`, `faff_roundtrip_scratch` | Not yet exercised against a live scratch DB as of this round; DDL is additive-only and structurally identical in shape to 166/167 |
| Depends on the other two? | No — no FK to 167 or 168 | No — no FK to 166 or 168 | References `decision_id` (166's `id`) **by value, no FK** — see below |

**168's reference to 166 is deliberately not a foreign key.** Same argument
166's own header makes about `training_plans`: a table whose whole value is
outliving its subject must not be deletable by a cascade from that subject.
`decision_id` can point at a `plan_decision_ledger.id` that a future, entirely
separate cleanup has removed, and `plan_decision_outcome` would keep the
judgement anyway — orphaned but not lost. This also means 168 can be applied
before, after, or independent of 166 without any ordering constraint between
them at the DDL level; the only real dependency is that `outcome-sweep.ts`
reads `plan_decision_ledger` rows to know what to judge, which is a
**runtime** dependency (168's writer needs 166 to have DATA), not a schema
one.
