# Migration approval packet · the decision ledger and the reassessment scheduler

**2026-09-05 · branch `ledger-scheduler` · base `origin/main` `7e5be7eec`**

Nothing in this packet has been executed against production or against any hosted
database. Every statement below has been applied to, and exercised end to end on,
one local scratch database:

```
database   faff_ledger_scratch
host       127.0.0.1 (loopback), PostgreSQL 18.4 (Homebrew)
role       david
created    2026-09-05, for this purpose, empty before the first apply
```

Per CLAUDE.md's operational boundary: **code changes deploy on approval; DDL and
data writes need David's separate, explicit, per-statement go.** This document is
the material for that go, and it is deliberately statement by statement.

`scripts/check-write-barrier.sh` is armed and untouched. `scripts/check-decision-ledger.sh`
guard 1 refuses to pass either migration if a non-additive statement ever appears in it.

---

## Why these two tables exist at all

**The ledger.** CLAUDE.md Rule 21's census — 309 `coach_intents` rows, zero upward
adaptations — had to be reconstructed *sideways*, because the engine's own log could
not answer it. `lib/plan/adaptation-log.ts` (2026-09-04) fixed the "records that
something happened but not what" half by adding a `did` array. It could not fix the
two structural halves:

1. `adaptation_log` is a **column on `training_plans`**. `clearActivePlansFor`
   archives that row and a rebuild authors a new one whose `adaptation_log` is `[]`.
   Every decision a runner ever acknowledged is, from the new plan's point of view,
   gone. **A ledger a rebuild empties is a cache.**
2. Its **only writer is the nightly cron**. Its own Rule 22 note says so: "Three
   other paths can move a workout — `/api/today/reschedule`, `move_day` and `PATCH
   /api/plan/workout` — and none of them writes here."

**The scheduler.** Six of the seven kinds of promise this engine makes were
`reconsiderAtISO` fields on in-memory objects. In `deferral-queue.ts`'s own words:
"the date was a PROMISE nothing kept."

---

## What happens to `training_plans.adaptation_log`

**Nothing, in these migrations.** Not dropped, not renamed, not altered. Its column
definition, its `[]` default and its single writer (`applyAdaptations`) are all
untouched, because `docs/OVERNIGHT-REPORT.md` records consumers deriving "last
changed" as `max(adaptation_log.ts)` and these migrations are additive-only.

What changes is its **status**, and the status is enforced in code, not in DDL: it
is demoted from a *record of truth* to a *per-plan convenience index*, and
`plan_decision_ledger` becomes the record of truth. `lib/plan/mutate.ts`'s header
says this in as many words, and `scripts/check-decision-ledger.sh` is what holds it.

**Retiring the column is a separate, non-additive change** that needs its own
approval and its own reader audit (`max(adaptation_log.ts)` has consumers nobody has
enumerated). Proposing it here would smuggle a destructive step into an additive
migration, so it is named and left open rather than bundled.

---

## Statement-by-statement · migration 166 `plan_decision_ledger`

File: `web-v2/db/migrations/166_plan_decision_ledger.sql`

### 166.1 · `CREATE TABLE IF NOT EXISTS plan_decision_ledger`

**SQL** — the literal statement, not a line reference (the owner rejected the
earlier version of this section for citing lines instead of showing the text):

```sql
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
  after_state           jsonb,
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
```

(Comments stripped for length here; the fully-commented, byte-verified-identical
version of this and every other statement in 166, 167 and 168 is
`docs/reports/brain-2026-09-05/LITERAL-SQL-166-168.md`, which a script diffed
against the checked-in `.sql` files statement-by-statement before this round
closed.)

Its shape, in one paragraph: 36 columns (`id`, `user_uuid`, the four plan-lineage
columns, the four scope columns, `lever`, `direction`, the three evidence/provenance
columns, `before_state`/`after_state`, the three authority columns, `decision`, the
four proposal columns, the two mutation-outcome columns, `explanation`,
`model_version`, `at`, the four superseded/undone columns, `idempotency_key`,
`created_at`), five CHECK constraints, no foreign keys.

**What it does.** Creates the durable decision ledger. One row per coaching decision
or plan mutation, written from `lib/plan/mutate.ts` — the one door in front of
`plan_workouts` — on every exit, including the refusals and the crash.

**Risk: LOW.** A brand-new table with no foreign keys, no triggers and no consumers
outside this feature. An application running the OLD code against a database with
this applied behaves identically, because nothing else names the table. The table is
written by exactly one module (`lib/brain/ledger/decision-ledger.ts`) and read by
exactly two (that module and `app/api/admin/decision-ledger`, admin-gated, GET only).

**Additive-only: YES.** No ALTER against an existing table, no rename, no drop, no
TRUNCATE, no DELETE. Every `NOT NULL` is on a column of a table being created in the
same statement, where there are no rows to violate it.

**Why no foreign keys.** Deliberate, and the one place this table departs from
migration 164's precedent. `canonical_adaptation_shadow_log` references
`training_plans(id) ON DELETE CASCADE`, which is right for a diagnostic log that
should not outlive its subject. A ledger is the opposite: its whole value is
surviving the row it describes, and a CASCADE would mean deleting one plan silently
erases every decision ever made against it — the same class of loss as storing the
record inside `adaptation_log`, arriving by a different door. Rule 14 is satisfied by
the queries stating their population, not by a constraint that can delete the
evidence.

**Verification**

```sql
-- exists, with the expected column count and no FK
SELECT count(*) AS columns FROM information_schema.columns
 WHERE table_name = 'plan_decision_ledger';                       -- expect 36

SELECT count(*) AS foreign_keys FROM information_schema.table_constraints
 WHERE table_name = 'plan_decision_ledger' AND constraint_type = 'FOREIGN KEY';
                                                                   -- expect 0

-- the five CHECKs are present by name
SELECT conname FROM pg_constraint
 WHERE conrelid = 'plan_decision_ledger'::regclass AND contype = 'c'
 ORDER BY conname;
-- expect: …_explanation_is_present, …_response_is_timed,
--         …_supersession_is_explained, …_undo_is_explained,
--         plus the four column-level IN() checks

-- nothing else was touched
SELECT count(*) FROM training_plans;      -- unchanged from the pre-state
SELECT count(*) FROM plan_workouts;       -- unchanged from the pre-state
```

**Rollback — NOT "safe at any time".** The owner rejected that framing for this
exact statement. Whether `DROP TABLE IF EXISTS plan_decision_ledger;` is safe
depends entirely on whether the table has ever been written to — see §H below
for the full rollback matrix. Pre-use (§H(a)) it is clean: no other table
references it, and no code path treats its absence as an error
(`decision-ledger.ts` probes once per process and returns
`{ state: 'table_absent' }`, which every caller branches on). Once a decision has
been recorded, the same `DROP` destroys it — §H(c) is the export-first
procedure required before running it at that point, and §H(d) is the separate,
explicit approval the DROP itself always needs regardless of row count. §H.8
covers the one row an exactly-once accept can put beyond a clean rollback.

**What enabling it would allow that is not allowed today.** One thing, and it is the
point: `mutatePlan` would begin **recording what it did**, not only what it refused.
`plan_mutation_rejections` (migration 150) already records the refusals. It would
make Rule 21's census answerable in one query:

```sql
SELECT direction, count(*) FROM plan_decision_ledger
 WHERE user_uuid = $1 AND undone_at IS NULL GROUP BY direction;
```

It does **not** enable any new write to a plan. `AUTOMATIC_ADAPTATION_AUTHORITY`
stays false, nothing reads this table to change training, and the admin route is
GET-only with no accept, dismiss or re-run action.

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

**What they do.** The runner's own history; Rule 21's census; the whole lineage
across every rebuild; the idempotency identity; open proposals awaiting an answer.

**Risk: LOW.** Built on an empty table, so no lock of consequence and no rewrite.
The unique one is **partial** on a non-null key, deliberately: a row with no
idempotency key is a distinct event every time and must never collide.

**Additive-only: YES.**

**Verification**

```sql
SELECT indexname FROM pg_indexes
 WHERE tablename = 'plan_decision_ledger' ORDER BY indexname;   -- expect 6 incl. pkey
```

**Rollback**

```sql
DROP INDEX IF EXISTS plan_decision_ledger_pending_proposals;
DROP INDEX IF EXISTS plan_decision_ledger_idempotency;
DROP INDEX IF EXISTS plan_decision_ledger_lineage;
DROP INDEX IF EXISTS plan_decision_ledger_direction;
DROP INDEX IF EXISTS plan_decision_ledger_user_at;
```

**What enabling them would allow.** Nothing new; they make the reads above cheap.
The unique one additionally makes a re-run of the same nightly pass **refresh** its
row rather than doubling the census — a correctness property, not a performance one.

### 166.7 · `COMMENT ON TABLE`

**Risk: NONE.** Metadata. **Rollback:** `COMMENT ON TABLE plan_decision_ledger IS NULL;`

---

## Statement-by-statement · migration 167 `reassessment_schedule`

File: `web-v2/db/migrations/167_reassessment_schedule.sql`

### 167.1 · `CREATE TABLE IF NOT EXISTS reassessment_schedule`

**SQL** — the literal statement, not a line reference:

```sql
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
```

(Comments stripped for length; the fully-commented version, byte-verified against
the checked-in `.sql` file, is in `LITERAL-SQL-166-168.md`.)

34 columns, three CHECK constraints, no foreign keys, covering all seven kinds of
scheduled promise: `DEFERRAL`, `EARNING_GATE`, `CONDITIONAL_DOSE`,
`POST_RACE_RECOVERY_CHECK`, `RETURN_TO_TRAINING_STAGE`, `PROPOSAL_EXPIRATION`,
`FAILED_EVALUATION`.

**What it does.** The one durable scheduler. Each row stores the reason (code and
sentence), the assessment date, the required evidence, the plan and version, the
status, the attempt count, the last error, the next retry, and the resulting
decision.

**Risk: LOW.** A brand-new table with no foreign keys, no triggers, and no consumer
that can change training — promoting an item to `DUE` means "ask the question again",
never "apply what was queued".

**Additive-only: YES.** Same argument as 166.1.

**It replaces migration 165 rather than sitting beside it.**
`165_canonical_adaptation_deferrals.sql` was written 2026-09-04 for the deferral
queue alone and was **never applied to production** — only to a local scratch
database — so retiring it costs nothing and avoids the outcome that matters: a third
durable queue. 165 is now stamped SUPERSEDED in place and carries an executable
`DO $$ … RAISE EXCEPTION … $$;` **before** its DDL, so it fails loudly if anyone runs
it. Verified on the scratch database: the run errored with
`165_canonical_adaptation_deferrals.sql is SUPERSEDED and must not be applied.` and
`SELECT to_regclass('public.canonical_adaptation_deferrals')` returned NULL
afterwards. `lib/adaptation/canonical-shadow/deferral-store.ts` now reads and writes
migration 167's table with `kind = 'DEFERRAL'`.

**Rule 23 posture, which is the reason for three of the columns.**
`assess_on_iso` makes due-ness a DATE rather than a clock hour, so a sweep twelve
hours late does exactly what the on-time sweep would have. `overdue_after_iso` is
the date past which an unassessed item raises `reassessment_overdue` on `ops_alerts`
— because the cron ledger being green is not the same as the work being done.
`attempts` / `last_error` / `next_retry_at` keep "never assessed", "assessed and
carried" and "assessment BROKE" as three facts (Rule 11).

**Verification**

```sql
SELECT count(*) AS columns FROM information_schema.columns
 WHERE table_name = 'reassessment_schedule';                      -- expect 34

SELECT count(*) FROM information_schema.table_constraints
 WHERE table_name = 'reassessment_schedule' AND constraint_type = 'FOREIGN KEY';
                                                                   -- expect 0

SELECT conname FROM pg_constraint
 WHERE conrelid = 'reassessment_schedule'::regclass AND contype = 'c' ORDER BY conname;
-- expect: …_attempts_are_timed, …_failure_names_its_error,
--         …_terminal_is_explained, plus the column-level IN() checks

-- the superseded table must NOT exist
SELECT to_regclass('public.canonical_adaptation_deferrals');       -- expect NULL
```

**Rollback — NOT "safe at any time".** Same correction as 166.1's rollback line
above, applied here: `DROP TABLE IF EXISTS reassessment_schedule;` is clean
pre-use (§H(a) — `deferral-store.ts` and `reassessment-scheduler.ts` both probe
for the table and report `table_absent` rather than throwing, so the app
behaves exactly as it does today with the table gone) and LOSSY once any
promise has been queued against it (§H(c), export first, then §H(d)'s
separately-approved DROP) — every EARNING_GATE, CONDITIONAL_DOSE,
POST_RACE_RECOVERY_CHECK, RETURN_TO_TRAINING_STAGE, PROPOSAL_EXPIRATION and
DEFERRAL row disappears with it.

**What enabling it would allow that is not allowed today.** A deferred progression,
an earning gate, a post-race recovery check, a return-to-training stage, a
conditional dose or an unanswered proposal would **survive a process restart and a
deploy**. Today all of them except the deferral live in memory and die with the
process, and the deferral only persists on a scratch database.

It does **not** enable any automatic application. `AUTOMATIC_ADAPTATION_AUTHORITY`
is untouched, nothing in `lib/ops/reassessment-scheduler.ts` names a plan table or a
plan writer (asserted by `_reassessment_scheduler.test.ts`), and the sweep's only
mutations are: promote `PENDING → DUE`, expire an unanswered `PROPOSAL_EXPIRATION`
past its deadline, and raise an alert.

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

**What they do.** One live item per identity; the sweep's cross-runner due read; one
runner's live queue; retries waiting on their backoff.

**Risk: LOW.** Built on an empty table.

**The partiality of the unique index is load-bearing, not an optimisation.** Rows
here are never deleted, so a TOTAL unique index would put "keep the history" and
"re-queue this identity later" in direct conflict: the terminal row would occupy the
identity, and re-queueing could only succeed by reviving it, which erases the
resolution it was kept to record. (Migration 165's header argues this at length; 167
inherits the argument.) Proven on the scratch database: re-queueing a resolved
identity leaves `['EXPIRED', 'PENDING']`, not one rewritten row.

**Additive-only: YES.**

**Verification**

```sql
SELECT indexname FROM pg_indexes
 WHERE tablename = 'reassessment_schedule' ORDER BY indexname;   -- expect 5 incl. pkey
```

**Rollback**

```sql
DROP INDEX IF EXISTS reassessment_schedule_retry;
DROP INDEX IF EXISTS reassessment_schedule_user_live;
DROP INDEX IF EXISTS reassessment_schedule_due;
DROP INDEX IF EXISTS reassessment_schedule_live_identity;
```

### 167.6 · `COMMENT ON TABLE`

**Risk: NONE.** Metadata. **Rollback:** `COMMENT ON TABLE reassessment_schedule IS NULL;`

---

## Apply order, if approved

Either order. Both are `CREATE TABLE`, so neither depends on the other and neither
depends on any existing column. Per `db/migrations/README.md` this is "case 1": the
code that names these tables already treats their absence honestly, so the migration
and the deploy can land in either order.

```bash
psql $DATABASE_URL -f web-v2/db/migrations/166_plan_decision_ledger.sql
psql $DATABASE_URL -f web-v2/db/migrations/167_reassessment_schedule.sql
# and NOT 165 — it is superseded and raises if run.
```

**Pre-state to capture before applying** (the pattern
`docs/2026-08-24-missing-tables-prestate.sql` set):

```sql
SELECT to_regclass('public.plan_decision_ledger'),
       to_regclass('public.reassessment_schedule'),
       to_regclass('public.canonical_adaptation_deferrals');
SELECT count(*) FROM training_plans;
SELECT count(*) FROM plan_workouts;
```

**Full inverse** — but READ ADDENDUM 2 §H FIRST. This is the inverse for a
table that has never been written to. Once it has, the drop destroys the only
record of every decision since the apply, and there is an export step in front
of it.

```sql
DROP TABLE IF EXISTS plan_decision_ledger;
DROP TABLE IF EXISTS reassessment_schedule;
```

---

## Evidence from the scratch database

Applied 2026-09-05 to `faff_ledger_scratch` on loopback.

| check | result |
|---|---|
| `166` applied clean | `CREATE TABLE`, 5 × `CREATE INDEX`, `COMMENT` |
| `167` applied clean | `CREATE TABLE`, 4 × `CREATE INDEX`, `COMMENT` |
| `165` refuses to apply | `ERROR: 165_canonical_adaptation_deferrals.sql is SUPERSEDED and must not be applied.` |
| `canonical_adaptation_deferrals` after that run | does not exist |
| both re-applied a second time | exit 0, rows preserved (26 ledger, 31 schedule) |
| tables present | `plan_decision_ledger`, `reassessment_schedule` |
| indexes present | 6 and 5 respectively, including both pkeys |

**Exercised end to end against it** (55 assertions, all green):

- `lib/brain/ledger/_decision_ledger.db.test.ts` — 20 tests. Round trip; the Rule 21
  census; idempotency; **lineage across a three-deep rebuild chain** (`pln_1` →
  `pln_2` → `pln_3` all resolve to lineage `pln_1`); the four CHECK constraints each
  falsified by trying to break them, plus an ORACLE proving a well-formed row is
  still accepted; a proposal answered once and a second answer refused; an undo that
  leaves the census but keeps the row.
- `lib/ops/_reassessment_scheduler.db.test.ts` — 23 tests. All seven kinds persist; a
  sweep ten days late finds the same due set; a second sweep does the work once; an
  unanswered proposal expires **with its stated reason and the row kept**; an overdue
  non-proposal is **not** dropped; the retry ladder to `FAILED`; the three CHECK
  constraints falsified; a resolution that a later pass cannot rewrite.
- `lib/adaptation/canonical-shadow/_deferral_store.db.test.ts` — 12 tests, ported to
  the new table with `kind = 'DEFERRAL'`.

**These suites SKIP LOUDLY** when `DATABASE_URL` does not name the scratch database,
printing "this suite proved NOTHING about durability" and the reason. Reporting clean
while looking at nothing is the worst available outcome, because it also reports
confidence (Rule 18).

---

## What this packet does not claim

- **Nothing here is deployed.** Rule 19: green is not deployed, and a scratch
  database is not production. A green run says the schema and the code agree on a
  local copy of that schema.
- **The ledger cannot prove the engine pushes.** It makes the question answerable.
  Rule 21's census will read `UP: 0` on the day this lands, and that will be a true
  measurement of an engine that has not pushed — which is the point.
- **`adaptation_log` is untouched and still has consumers.** Retiring it is a
  separate, non-additive change with its own reader audit still to do.

---

# ADDENDUM · 2026-09-05, for the production approval

Everything below was added after the owner asked for permissions, deployment
ordering in both directions, locking risk, failure recovery, expected row counts
and read-only verification queries. It is measured, not assumed — the production
figures come from a read-only connection made while writing this.

## A · Production pre-state, measured

```
server                PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2)
scratch was           PostgreSQL 18.4 (Homebrew)      ← minor version differs
app runtime role      postgres   (superuser, owner of every table)
read-only role        faff_readonly  (SELECT only, not superuser)
owner of training_plans   postgres

to_regclass('public.plan_decision_ledger')          →  NULL   (absent)
to_regclass('public.reassessment_schedule')         →  NULL   (absent)
to_regclass('public.canonical_adaptation_deferrals')→  NULL   (absent, and 165 must stay unapplied)

training_plans   59 rows
plan_workouts  4742 rows
```

The minor-version gap (18.4 scratch, 18.6 production) is stated rather than
waved past. Nothing in either migration uses a feature that moved between those
releases — they are `CREATE TABLE`, `CREATE INDEX`, `COMMENT` and CHECK
constraints — but "it worked on my machine's Postgres" is not the same sentence
as "it will work on yours", and the difference belongs in the packet.

## B · Permissions · nothing to grant, and here is why

Neither migration contains a `GRANT`, and that is correct here rather than an
omission:

- **The app writes as `postgres`**, which is the superuser and will own both new
  tables. It needs no grant to write what it created.
- **`faff_readonly` is covered automatically.** `ALTER DEFAULT PRIVILEGES` is
  already configured on this database:

  ```
  pg_default_acl → grantor postgres, objtype r, acl {faff_readonly=r/postgres}
  ```

  Every new RELATION created by `postgres` is granted `SELECT` to
  `faff_readonly` on creation. That is what makes section E's verification
  queries runnable on the read-only connection immediately after the apply, with
  no follow-up grant.

**If that default ACL is ever removed**, the verification queries start failing
with `permission denied for table plan_decision_ledger` — which is a loud,
correct failure, not a silent one, and the fix is
`GRANT SELECT ON plan_decision_ledger, reassessment_schedule TO faff_readonly;`

## C · Locking and deployment risk · effectively none, and precisely why

| statement | lock taken | on what | blocks |
|---|---|---|---|
| `CREATE TABLE IF NOT EXISTS` | `AccessExclusive` | the NEW table only | nothing — no other session can name a table that did not exist |
| `CREATE INDEX` (×9) | `Share` | the NEW table | nothing — the table is empty and unreferenced |
| `COMMENT ON TABLE` | `ShareUpdateExclusive` | the NEW table | nothing |

**No statement touches `training_plans`, `plan_workouts`, `runs`, `races`, or
any other existing relation.** There is no `ALTER`, no `ADD COLUMN`, no rewrite,
no backfill and no `VACUUM`-triggering change. `scripts/check-decision-ledger.sh`
guard 3 fails the build if a non-additive statement ever appears in either file,
and it was falsified by planting an `ALTER TABLE`.

Expected wall-clock: sub-second each. Both tables are created empty, so the nine
`CREATE INDEX` statements have nothing to scan.

**Risk to the running app during the apply: none that we can construct.** The
app is not reading these tables — it cannot, they do not exist — and the code
paths that name them already branch on absence (section D).

## D · Deployment ordering · both directions, and one real hazard

The tables are independent `CREATE TABLE`s with no foreign keys, so **either
order is structurally safe.** But "safe" and "correct" came apart here, and the
difference was found while writing this section rather than after the apply.

### D.1 · Migration first, then code — RECOMMENDED

Nothing reads the tables until the code that names them deploys. Zero window.

### D.2 · Code first, then migration — WORKS, BUT RESTART THE SERVICE

Three modules probe `to_regclass` before writing: the decision ledger, the
reassessment scheduler, and the shadow deferral store. All three returned
`table_absent` honestly — and **all three cached that answer for the life of the
process.** A process started before the DDL would have kept answering
`table_absent` long after the table existed. The migration would land, section E
would verify clean, and the ledger would stay empty with nothing anywhere
reporting a fault.

**Fixed before this packet was submitted** (`MIGRATIONPROBE-1`): only a
DEFINITE answer is cached, only `true` is cached permanently, and a definite
absence is re-probed on a 60-second cooldown, so a table appearing under a live
process is picked up within a minute without asking the database on every write.

The same eight lines carried a second defect, which is the more dangerous one
because it does not need a migration to fire: **`catch { tableExists = false }`
cached a FAILED probe as "table absent"** — Rule 11, on the one function whose
entire job is to tell those two facts apart. A single connection blip during a
process's first probe and that process stops recording decisions permanently,
reporting a clean and confident wrong answer. A failed probe now caches nothing.

`lib/brain/ledger/_migration_probe.test.ts` gates both, and both were falsified
by restoring the original behaviour and watching the named test fail:

```
× does not cache a thrown probe as "table absent"
× notices the table appearing under a running process
× does not re-probe on every write while it is genuinely absent
```

**With that fix, D.2 is safe and self-healing within 60 seconds.** D.1 is still
recommended, because a rollout that needs nothing to heal is better than one
that heals.

## E · Verification, read-only, immediately after the apply

Run as `faff_readonly`. None of these writes anything.

```sql
-- 1 · both tables exist, and 165's table still does not
SELECT to_regclass('public.plan_decision_ledger')            AS ledger,
       to_regclass('public.reassessment_schedule')           AS schedule,
       to_regclass('public.canonical_adaptation_deferrals')  AS must_be_null;

-- 2 · expected row counts immediately after apply: 0 and 0.
--     Anything non-zero means this ran against a database that is not
--     production, or the apply was run twice against different data.
SELECT (SELECT count(*) FROM plan_decision_ledger)  AS ledger_rows,
       (SELECT count(*) FROM reassessment_schedule) AS schedule_rows;

-- 3 · indexes · expect 6 on the ledger (5 + pkey) and 5 on the schedule (4 + pkey)
SELECT tablename, count(*) AS idx
  FROM pg_indexes
 WHERE tablename IN ('plan_decision_ledger','reassessment_schedule')
 GROUP BY tablename ORDER BY tablename;

-- 4 · constraints survived · expect 5 CHECKs on the ledger, 3 on the schedule
SELECT rel.relname, count(*) FILTER (WHERE con.contype = 'c') AS checks
  FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
 WHERE rel.relname IN ('plan_decision_ledger','reassessment_schedule')
 GROUP BY rel.relname ORDER BY rel.relname;

-- 5 · nothing else moved
SELECT (SELECT count(*) FROM training_plans) AS training_plans,   -- expect 59
       (SELECT count(*) FROM plan_workouts)  AS plan_workouts;    -- expect 4742

-- 6 · the read-only role can actually see them (proves the default ACL held)
SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
 WHERE grantee = 'faff_readonly'
   AND table_name IN ('plan_decision_ledger','reassessment_schedule');
```

**Then, within one deploy cycle**, confirm the ledger is actually being written
rather than merely present — a table that exists and stays empty is the failure
mode D.2 describes:

```sql
SELECT count(*) AS decisions, max(at) AS most_recent FROM plan_decision_ledger;
SELECT direction, count(*) FROM plan_decision_ledger GROUP BY direction;
```

That second query is Rule 21's census. **On the day this lands it will read
`UP: 0`,** and that is a true measurement of an engine that has not yet pushed —
not a fault in the migration.

## F · Failure recovery

| what fails | symptom | recovery |
|---|---|---|
| `166` errors partway | Postgres runs each `CREATE` in its own implicit transaction; a failure leaves the table created and some indexes missing | re-run the file. Every statement is `IF NOT EXISTS`; the second pass creates only what is missing. Proven on scratch: applied twice, exit 0, **rows preserved** (26 ledger / 31 schedule) |
| `167` errors partway | same | same |
| both applied, app cannot write | ledger stays empty, `[ledger] table_absent` in logs | restart the service (or wait 60s for the re-probe, post-`MIGRATIONPROBE-1`) |
| applied to the wrong database | tables exist where they should not | `DROP TABLE IF EXISTS plan_decision_ledger; DROP TABLE IF EXISTS reassessment_schedule;` — nothing references them, so the drop is clean |
| decision to reverse entirely | — | see ADDENDUM 2 §H, which replaces this row. "No data loss to anything else" was true and misleading: nothing OUTSIDE these three tables is touched, and everything INSIDE the ledger is lost unless it is exported first. §H(c) carries the export step and states what an archive still cannot recover; §H(d) is the separately-approved DROP itself |

**There is no backfill.** Both tables start empty and accumulate forward. No
historical decision is reconstructed into the ledger, and none should be:
inventing provenance for decisions nobody recorded is exactly the fabrication
this ledger exists to make impossible.

## G · Runtime behaviour, before and after

| | before the migration | after |
|---|---|---|
| `mutatePlan` | all 8 exits reached; each calls the ledger, which answers `table_absent` and says so | same 8 exits; each writes a row |
| a plan mutation | applies exactly as today | applies exactly as today, plus a durable record |
| the reassessment sweep | `table_absent`, no deferrals persisted | deferrals persist and survive restart |
| `adaptation_log` | written | **still written, unchanged** |
| the runner's plan | untouched | untouched |
| `AUTOMATIC_ADAPTATION_AUTHORITY` | `false` | `false` |

**Applying these migrations enables nothing that writes a plan.** They create
two tables that record and schedule. The authority seam is a separate switch and
this does not move it.

---

# ADDENDUM 2 · 2026-09-05 · LEDGERATOMIC-1 and the rollback matrix

The owner rejected this packet's earlier claim that rollback is "safe at any
time". It is not one sentence. It is seven situations with seven different
answers, and two of them are not clean. They are written out below, each with
what it costs and what it does NOT recover.

He also ruled on the thing that made the rollback question sharp:

> "A plan mutation and its ledger record must be one atomic outcome. The system
> may not: (1) mutate the plan, (2) fail to write the ledger, (3) log an error,
> (4) return success."

That was the shipped behaviour, and it is fixed before this packet goes back to
him. What changed is in section I.

## H · The rollback matrix

**Restructured 2026-09-06 into the four categories the owner asked for,
explicitly, after "safe at any time" was rejected a second time in review.**
Which category applies is decided by two facts: has any table ever been
WRITTEN to, and is the application code deployed. All three tables (166's
`plan_decision_ledger`, 167's `reassessment_schedule`, 168's
`plan_decision_outcome`) are covered together below — none references another
by foreign key (168's `decision_id` points at 166's `id` **by value, no FK**;
see `LITERAL-SQL-166-168.md`'s cross-migration table), so all three sit in the
same row of this matrix at any given moment, and every SQL block below acts on
all three together for that reason, not out of convenience.

**The standing rule that governs (c) and, in the degenerate case, (a): a
`DROP TABLE` is a destructive schema removal, and it is never executed as part
of this packet's approval.** CLAUDE.md's own operating posture already says
this generally — "DDL / data writes still require David's explicit
per-statement go before execution, as always" — and category (d) below is that
rule applied to this specific action, named rather than left implicit, because
the earlier "safe at any time" framing let a real `DROP TABLE` slip out from
under it in review once already.

### (a) · Pre-use rollback · every table still empty · CLEAN

The window between applying the DDL and the first row landing in any of the
three tables. Nothing has been recorded, so nothing is lost — but the `DROP`
itself is still category (d), gated below, not a free action just because the
tables happen to be empty right now.

```sql
-- verify you are actually in this row, do not assume it
SELECT (SELECT count(*) FROM plan_decision_ledger)  AS ledger_rows,    -- must be 0
       (SELECT count(*) FROM reassessment_schedule) AS schedule_rows,  -- must be 0
       (SELECT count(*) FROM plan_decision_outcome) AS outcome_rows;   -- must be 0
```

**Cost: none, IF the counts above are all zero and IF the drop itself is
separately approved per (d).** Nothing else references any of the three
tables, no foreign key points at them, and nothing outside this feature reads
them. The application returns to the `table_absent` branch it is running on
today.

**What it does not recover:** nothing, because nothing was recorded.

### (b) · Code rollback with the data left in place · CLEAN, AND THE DEFAULT

Deploy the previous application build and leave all three tables exactly
where they are. This is the right first move for almost every problem: it is
the only category in this matrix that involves **no DDL at all**, is
reversible in both directions, and loses nothing.

```
revert the deploy only. NO SQL AT ALL. No table is touched, so category (d)'s
gate does not even apply here — there is nothing destructive to approve.
```

**Cost: none.** The old code does not name any of the three tables. The rows
stop accumulating and stay readable by hand.

**What it does not recover:** nothing. And it is the only category in this
matrix that can be undone by simply deploying forward again.

**Prefer this to (c) unless the schema itself is the problem.**

### (c) · Post-use export/archive, before any destructive step · LOSSY UNLESS EXPORTED FIRST

Once a table has accumulated rows, dropping it destroys the only record of
them. `plan_decision_ledger` and `plan_decision_outcome` have no foreign keys
ON PURPOSE — a ledger's whole value is that it survives the rows it
describes — and the same property means nothing else holds a copy. **Export
before dropping, or the coaching history of every runner since the apply is
gone.** This category is the export/archive PROCEDURE only; the DROP that
would follow it is category (d), separately approved, never run as step 4 of
this same procedure without a fresh explicit go.

```sql
-- 1 · archive, in the same database, so the export cannot be lost in transit.
CREATE TABLE plan_decision_ledger_archive_20260906 AS
  SELECT * FROM plan_decision_ledger;
CREATE TABLE reassessment_schedule_archive_20260906 AS
  SELECT * FROM reassessment_schedule;
CREATE TABLE plan_decision_outcome_archive_20260906 AS
  SELECT * FROM plan_decision_outcome;

-- 2 · prove the archive is complete BEFORE anything destructive. Counts, not
--     eyeballs.
SELECT (SELECT count(*) FROM plan_decision_ledger)                   AS live,
       (SELECT count(*) FROM plan_decision_ledger_archive_20260906)  AS archived;
-- and the same pair for reassessment_schedule and plan_decision_outcome.
-- Every pair must be equal before proceeding to (d).

-- 3 · and a copy off this database as well.
```

**Cost:** the archive tables are additive and inert. Nothing is destroyed by
this category on its own — the archive step is reversible by construction (it
is a `CREATE TABLE AS SELECT`, not a `DROP`).

**What it does not recover, even with the archive, once (d) actually runs:**
the ledger's FUTURE. A re-apply creates an empty table, and
`resolvePlanLineage` opens a NEW lineage for every plan, because rung 1 asks
the ledger what lineage it already knows and the answer is now nothing. Every
runner's history restarts at the re-apply. The archive stays readable but no
longer joins forward.

**There is no backfill and there must not be.** Reconstructing decisions
nobody recorded means inventing provenance, which is the fabrication this
ledger exists to make impossible.

### (d) · Destructive schema removal · ITS OWN APPROVAL, NEVER BUNDLED WITH ANYTHING ELSE

```sql
DROP TABLE IF EXISTS plan_decision_ledger;
DROP TABLE IF EXISTS reassessment_schedule;
DROP TABLE IF EXISTS plan_decision_outcome;
```

This statement — or any subset of it — is **only ever run with the owner's
explicit, separate go for that exact statement, at that exact time.** Not
implied by approving this packet. Not implied by approving (c)'s export. Not
bundled with a code deploy, a different migration's approval, or a prior
approval of the same DROP against a different table. Per-statement DDL
approval is CLAUDE.md's standing rule for this whole codebase; this category
is that rule, made explicit for the one action in this matrix capable of
destroying data.

If the tables are empty (category (a)'s precondition), the cost of this
statement is zero — but the approval is still required, because the person
running it and the person who last verified the counts are not guaranteed to
be making the same observation at the same moment, and a DROP does not check
row counts before it fires. If any row exists, this statement is only run
AFTER category (c)'s archive is verified complete, never before and never in
the same breath as the archive.

**What it does not recover, ever:** nothing this document can restore. A
`DROP` with no prior archive is not a rollback, it is data loss with SQL
syntax.

### H.4 · Only SOME of the three migrations applied · CLEAN, and it needs no repair

All three tables are independent `CREATE TABLE`s with no foreign keys between
them (168's `decision_id` is a plain column, not an FK — see the cross-migration
table above). No module reads another migration's table to decide whether it
may run.

- **166 applied, 167/168 not:** decisions record; deferrals do not persist;
  outcomes are never judged. The scheduler and the outcome sweep each answer
  `table_absent` and say so. Partially-improved, not broken.
- **167 applied, 166/168 not:** deferrals persist; decisions do not record;
  outcomes are never judged. The boundary takes the `table_absent` branch and
  commits, which is exactly production's behaviour today.
- **168 applied, 166/167 not:** the outcome sweep has somewhere to write, but
  nothing exists yet for it to judge — `outcome-sweep.ts` reads
  `plan_decision_ledger` at runtime, and with 166 absent it answers
  `table_absent` on that read and writes nothing. Inert, not broken.
- **Any two of three, or all three:** each pairing composes the same way —
  every table absent from the set answers `table_absent` on its own probe, and
  every table present behaves exactly as if the others were also present,
  because none of the three schemas branches on another's existence.

**Recovery:** apply whichever is missing, or drop whichever is applied per
§H(a) (if empty) or §H(c) then §H(d) (if not). Nothing needs repairing in
between, and there is no window in which the app is worse off than it is
today.

### H.5 · Indexes incomplete · SELF-REPAIRING, WITH ONE THAT IS NOT COSMETIC

Postgres runs each statement in these files in its own implicit transaction, so
a failure partway leaves the table created and some indexes missing. Every
statement is `IF NOT EXISTS`.

```sql
-- what SHOULD be there: 6 on the ledger (5 + pkey), 5 on the schedule (4 + pkey),
-- 5 on the outcome table (4 + pkey)
SELECT tablename, count(*) FROM pg_indexes
 WHERE tablename IN ('plan_decision_ledger','reassessment_schedule','plan_decision_outcome')
 GROUP BY tablename;
```

**Recovery: re-run the file.** The second pass creates only what is missing and
touches no row. Proven on scratch: applied twice, exit 0, rows preserved.

**What a missing index costs in the meantime** is CORRECTNESS on one of them,
not just latency. `plan_decision_ledger_idempotency` is the UNIQUE index that
`applyOnce` rests on — without it a duplicate accept is not refused, it is
applied twice. The rest are read paths and cost only speed, on tables that are
empty at this point anyway. So check that one BY NAME, never by count:

```sql
SELECT indexdef FROM pg_indexes WHERE indexname = 'plan_decision_ledger_idempotency';
```

### H.6 · The app deploys BEFORE the DDL · SAFE, SELF-HEALING WITHIN 60s

The code probes `to_regclass` and branches on absence. Every mutation commits
and logs `DECISION NOT RECORDED (table_absent)`; every deferral says it did not
persist.

The hazard here was `MIGRATIONPROBE-1`, already closed: the probe used to cache
a negative answer for the life of the process, so a process started before the
DDL would answer `table_absent` forever. It now caches only a DEFINITE answer,
only `true` permanently, and re-probes a definite absence on a 60-second
cooldown. A failed probe caches nothing at all.

**Recovery: none needed.** Within 60 seconds of the DDL landing, running
processes start writing. A service restart makes it immediate.

**What is lost:** the decisions made in that window are not recorded. They are
not recoverable and should not be reconstructed.

### H.7 · The DDL lands BEFORE the app · SAFE, ZERO WINDOW · RECOMMENDED

Nothing reads the tables until the code that names them deploys. There is no
window at all.

**Recovery: none needed.** This is the recommended order for exactly this
reason: a rollout that needs nothing to heal beats one that heals.

### H.8 · The one row that is NOT reversible by SQL alone

Once `applyOnce` is switched on for a runner-facing accept, a rollback of
migration 166 removes the unique index that makes that accept exactly-once. The
boundary REFUSES rather than degrading — a once-only guarantee that quietly
becomes at-least-once is a missing input disabling a safety mechanism (Rule 11)
— so the accept button would start returning a refusal instead of
double-applying.

**That is the correct failure and it is still a user-visible outage.** So:
**do not enable `applyOnce` on any production caller in the same change that
applies the migration.** Let the table prove itself first. Nothing in the
current code sets `applyOnce`; that is stated here as a known gap rather than
left implicit.

## I · What changed in the code before this packet was resubmitted

`LEDGERATOMIC-1`. The boundary used to run `COMMIT`, then write the ledger row
on a SECOND CONNECTION, then `console.error` the failure and return
`{ ok: true }`. All four steps of the sequence the owner forbade.

**Two lanes now, split on whether anything committed:**

| decision | lane | connection | on failure |
|---|---|---|---|
| accompanies a COMMITTED mutation | `recordDecisionInTransaction` | the mutation's own transaction, before its COMMIT | throws · the mutation ROLLS BACK and returns `ledger_unwritten` |
| records a REFUSAL | `recordDecision` | its own pool connection, after the ROLLBACK | logged · there was no mutation for it to be atomic with |

The tension the owner named is real, and this is where it lands: **a refusal
cannot be atomic with a mutation that never happened**, and writing it on the
rolled-back transaction would erase it. So refusals keep the second connection
and keep their three-state, never-throws contract. Everything that commits does
not.

**`table_absent` is not a failure**, and that distinction is what makes this
deployable against production today. The table does not exist there, so lane A
returns `table_absent` and the mutation commits, exactly as it does now. The
moment migration 166 lands, the ledger becomes REQUIRED with no flag to flip and
no code change.

**Two members added to `mutation_outcome`'s CHECK** (`ledger_unwritten`,
`duplicate`), which is free because the migration is unapplied. Both are facts
the old list could only tell as a lie: without them a ledger-refused rollback
would have to be filed as `not_attempted`, collapsing "the statement blew up"
with "the record refused" — Rule 11, inside the one table built to keep facts
apart. Section E's constraint count is unchanged: still 5 CHECKs on the ledger.

**Gate:** `scripts/check-decision-ledger.sh` guard 4 and
`lib/audit/_decision_ledger_gate.test.ts` GUARD 3 — every COMMIT preceded by an
in-transaction write, order walked and not merely counted, both lanes present,
and the transactional lane forbidden from returning a swallowable `failed`.
Falsified in both directions.

**Measurement:** `lib/plan/_ledger_atomicity.db.test.ts`, 14 tests against
`faff_roundtrip_scratch`, covering all eight cases the owner listed. A
BEFORE INSERT trigger makes the ledger fail for reasons unrelated to the row's
contents, and a terminated backend models the process dying mid-mutation. Run
against the unfixed code, 8 of them fail, including
`expected [ 530, 500, 500 ] to deeply equal [ 500, 500, 500 ]` — the plan moved
30 s/mi with zero applied ledger rows.

**One defect this work found in the ledger itself,** which no amount of reading
would have shown: a rolled-back mutation's refusal row carried the caller's
idempotency key, and lane B inserts ON CONFLICT DO UPDATE. So the
duplicate-accept refusal REWROTE the accept it was refusing — `applied` became
`duplicate`, and the only record that the runner's plan had ever moved was gone.
Lane B now drops the key: every row it writes is, by construction, a decision
that changed nothing, and it is a distinct event from whatever holds that key.

**And one hole in this packet's own evidence, found by falsifying it.** The db
suites here are described as skipping "LOUDLY". The new one did not: run against
a database with no fixture it printed `Tests 1 passed | 13 skipped` and not one
word of the reason, because `console.warn` inside a passing test is swallowed by
the reporter. It now writes to `process.stderr` directly and puts the verdict in
the TEST NAME. `lib/brain/ledger/_decision_ledger.db.test.ts` still has the
console.warn shape and the same hole — named here rather than fixed silently.
