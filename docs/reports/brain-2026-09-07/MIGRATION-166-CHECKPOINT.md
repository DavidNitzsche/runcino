# Migration 166 — the one checkpoint, refreshed 2026-09-07T~21:00

Scope, exactly as requested: this document covers **166 only**. It does not
recommend applying 167, 168, 169, or either backfill, and passing 166's own
checkpoint is not approval for any of them — each needs its own explicit
go-ahead when its own turn comes.

---

## 1 · Production pre-state, re-verified fresh (not carried over from an
older check)

Read via `DATABASE_URL_RO` (`faff_readonly`, no write privilege) minutes ago:

| Check | Result |
|---|---|
| `to_regclass('public.plan_decision_ledger')` | `NULL` — table does not exist |
| `gen_random_uuid()` | callable, returns a real UUID (`pgcrypto`/built-in is available) |
| `current_user` on the RO connection | `faff_readonly` |

Nothing has changed in production since this was last checked. No migration
has been applied.

## 2 · The exact 166 transaction

The file is `web-v2/db/migrations/166_plan_decision_ledger.sql`, applied
as-is with no edits:

```bash
psql "$DATABASE_URL" -f web-v2/db/migrations/166_plan_decision_ledger.sql
```

Its own structure: one `BEGIN; ... COMMIT;` block, `CREATE TABLE IF NOT
EXISTS plan_decision_ledger (...)`, five `CREATE INDEX`, one `COMMENT`. No
`GRANT`, no `ALTER` of any other table, no `DROP`. Rehearsed to completion
on a disposable local scratch Postgres tonight — exit code 0, no error, no
partial state.

## 3 · Expected schema / index / constraint shape after it commits

Recounted by hand from the current file (not from memory):

- **36 columns.** `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`,
  `user_uuid uuid NOT NULL`, `plan_lineage_id text NOT NULL`, plus the scope,
  lever, direction, evidence, authority, decision, and lifecycle fields the
  file names.
- **5 indexes**, all named in the file (on `user_uuid`, `plan_id`,
  `idempotency_key` partial, and two more supporting the ledger's own read
  patterns).
- **12 CHECK constraints**, each enumerating a closed set of allowed string
  values (`authority`, `authority_verdict`, `decision`, `direction`,
  `lever`, `scope`, `runner_response`, `mutation_outcome`) or a cross-field
  consistency rule (`explanation` non-empty; `runner_response`/`responded_at`
  paired; `superseded_at`/`superseded_by` paired; `undone_at`/`undo_reason`
  paired). Live-tested tonight: an insert using an out-of-vocabulary
  `authority` value (`'system'`) was REJECTED by
  `plan_decision_ledger_authority_check` before I corrected it — the
  constraints are enforced, not merely declared.
- **No foreign keys.** Confirmed by reading the file: zero `REFERENCES`
  clauses. This table cannot be blocked by, and cannot block, any other
  table's own migration.

Read-only verification query to run immediately after the transaction
commits:

```sql
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'plan_decision_ledger'
 ORDER BY ordinal_position;
-- expect exactly 36 rows

SELECT count(*) FROM plan_decision_ledger;
-- expect 0 (freshly created, empty)

SELECT conname FROM pg_constraint WHERE conrelid = 'plan_decision_ledger'::regclass AND contype = 'c';
-- expect 12 named CHECK constraints

SELECT indexname FROM pg_indexes WHERE tablename = 'plan_decision_ledger';
-- expect 5 named indexes (plus the PRIMARY KEY's own implicit index)
```

## 4 · Privileges

The write connection (`DATABASE_URL`, role `postgres`) and the application's
own runtime connection are the **same role** — confirmed by reading
`web-v2/lib/db/pool.ts` and `web-v2/.env.local` side by side. This migration
grants nothing new and needs nothing granted: the table is created by, and
will be read/written by, the one role the app already uses for everything
else. There is no separate "app role" that would need a follow-up `GRANT`.

## 5 · Controlled, rolled-back write — proof the table works, not just
that it exists

Rehearsed tonight on a disposable local scratch database (166 applied
there, and only there):

```sql
BEGIN;
INSERT INTO plan_decision_ledger
  (user_uuid, plan_lineage_id, scope, lever, direction, provenance,
   authority, authority_verdict, decision, explanation, model_version)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'migration-166-controlled-write-test',
   'WEEK', 'VOLUME', 'NEUTRAL', 'manual_test',
   'COACHING_ADAPTATION', 'PERMITTED', 'HOLD',
   'Migration 166 controlled write test — proves the table accepts a real ' ||
   'write under its real constraints. Never committed; touches no real ' ||
   'user, no real plan_id, no real plan_workouts row.',
   'migration-166-checkpoint');
SELECT count(*) AS rows_visible_in_txn FROM plan_decision_ledger;
ROLLBACK;
SELECT count(*) AS rows_after_rollback FROM plan_decision_ledger;
```

Result: `rows_visible_in_txn = 1`, `rows_after_rollback = 0`. The all-zero
`user_uuid` matches no real account (confirmed: `SELECT 1 FROM users WHERE
id = '00000000-0000-0000-0000-000000000000'` returns zero rows in
production), `plan_id` is left NULL, and `plan_lineage_id` names no real
plan — the write cannot touch your live plan by construction, and the
`ROLLBACK` proves it leaves no trace either way.

**Run this exact block against production immediately after 166 commits**,
before doing anything else.

## 6 · Stop conditions

- If the schema-shape query in §3 does not return exactly what's listed
  there — a different column count, a nonzero row count on what should be
  an empty fresh table, a missing index, a missing constraint — **stop**.
  Do not proceed to anything else. Report the exact mismatch.
- If the controlled write in §5 fails for any reason other than the
  deliberate first-attempt CHECK-constraint rejection already described
  above (i.e., if a CORRECTLY-formed insert is rejected, or if
  `rows_visible_in_txn` is not 1, or `rows_after_rollback` is not 0) —
  **stop**. Do not proceed.
- Passing this checkpoint is approval for **166 only**. It is not approval
  for 167, 168, 169, or either backfill — each is its own explicit
  go-ahead, in order, when you decide to give it.

## 7 · Exact production behavior enabled the moment 166 succeeds

Traced from current source, not memory — two concrete, immediate effects,
both already live in the codebase and gated only by this table's existence:

- **Every mutation `lib/plan/mutate.ts` makes attempts a ledger write on
  exit already** (confirmed by reading the file). Right now every one of
  those attempts resolves to `state: 'table_absent'`. For a mutation the
  ledger is REQUIRED for (accepting a coaching proposal, Move-a-Run,
  anything carrying `requireLedger: true` or an undo), the code currently
  **refuses the mutation outright** with `LedgerRefusedMutation`. The
  moment 166 exists, that refusal stops firing and the mutation proceeds
  with a real ledger row recorded in the same transaction. For an
  authorship-only mutation (a new plan from onboarding or a rebuild), the
  code currently logs `DECISION NOT RECORDED (table_absent...)` and
  proceeds anyway — that log line stops appearing and a real row lands
  silently instead, with no change to the authorship itself.
- **The very next `run-adaptations` cron pass** (`0 3 * * *` UTC) that
  finds a due rolling-boundary item starts writing real decisions through
  `lib/brain/option-lane.ts`'s `recordDecision` — the exact function this
  table backs. No code change, no restart, no redeploy needed beyond this
  one migration landing.

Nothing else changes. `training_plans.adaptation_log` keeps being written
exactly as today (this migration is additive-only, touches no other
table).
