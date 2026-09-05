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

**SQL** — the exact statement is the file's `CREATE TABLE` block, lines 104-215. Its
shape, in one paragraph: 36 columns (`id`, `user_uuid`, the four plan-lineage
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

**Rollback**

```sql
DROP TABLE IF EXISTS plan_decision_ledger;
```

Safe at any time: no other table references it, and no code path treats its absence
as an error (`decision-ledger.ts` probes once per process and returns
`{ state: 'table_absent' }`, which every caller branches on).

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

**SQL** — the file's `CREATE TABLE` block. 34 columns, three CHECK constraints, no
foreign keys, covering all seven kinds of scheduled promise: `DEFERRAL`,
`EARNING_GATE`, `CONDITIONAL_DOSE`, `POST_RACE_RECOVERY_CHECK`,
`RETURN_TO_TRAINING_STAGE`, `PROPOSAL_EXPIRATION`, `FAILED_EVALUATION`.

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

**Rollback**

```sql
DROP TABLE IF EXISTS reassessment_schedule;
```

Safe at any time. `deferral-store.ts` and `reassessment-scheduler.ts` both probe for
the table and report `table_absent` — a distinct state from "empty queue" — rather
than throwing, so the app behaves exactly as it does today with the table gone.

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

**Full inverse**

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
