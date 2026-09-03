# Migration 163 · `plan_reschedules` — evidence record

Authorized statement-by-statement, per David's ruling 2026-09-03. Every
statement in the file matches an explicitly authorized category; none matches
a stop condition. Full text below, then the ten-step protocol as executed.

## 1 · Exact ordered statements

```sql
CREATE TABLE IF NOT EXISTS plan_reschedules (
  id                     text PRIMARY KEY,
  user_uuid              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                text NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
  plan_workout_id        text NOT NULL,
  decided_at             timestamptz NOT NULL DEFAULT now(),
  kind                   text NOT NULL DEFAULT 'RESCHEDULE'
                           CHECK (kind = 'RESCHEDULE'),
  origin                 text NOT NULL DEFAULT 'RUNNER_CONSTRAINT'
                           CHECK (origin = 'RUNNER_CONSTRAINT'),
  move_kind              text NOT NULL,
  stimulus_preservation  text NOT NULL
                           CHECK (stimulus_preservation IN ('FULL','PARTIAL','SUBSTITUTED','LOST')),
  identity_kind          text NOT NULL
                           CHECK (identity_kind IN ('SAME_INSTANCE','REVISED_VERSION')),
  original_date_iso      text NOT NULL,
  new_date_iso           text NOT NULL,
  decision               jsonb NOT NULL,
  undone_at              timestamptz,
  CONSTRAINT plan_reschedules_identity_ck CHECK (
    (identity_kind = 'SAME_INSTANCE'   AND stimulus_preservation = 'FULL')
    OR
    (identity_kind = 'REVISED_VERSION' AND stimulus_preservation <> 'FULL')
  )
);

CREATE INDEX IF NOT EXISTS plan_reschedules_user_decided_idx
  ON plan_reschedules (user_uuid, decided_at DESC);

CREATE INDEX IF NOT EXISTS plan_reschedules_plan_idx
  ON plan_reschedules (plan_id, original_date_iso);

COMMENT ON TABLE plan_reschedules IS '...' -- (verbatim in the source file)
COMMENT ON COLUMN plan_reschedules.stimulus_preservation IS '...' -- (verbatim)
```

## 2 · Additive — confirmed

Five statements: one `CREATE TABLE IF NOT EXISTS`, two `CREATE INDEX IF NOT
EXISTS`, two `COMMENT ON`. No existing table, column, row, or grant is
touched. Classified against the authorization:

| Statement | Authorized category |
|---|---|
| `CREATE TABLE IF NOT EXISTS plan_reschedules` | named explicitly |
| every column definition | additive column on the new table |
| `id text PRIMARY KEY` | primary key on the new table |
| `user_uuid ... REFERENCES users(id) ON DELETE CASCADE` | FK to existing user records, intentional delete behavior |
| `plan_id ... REFERENCES training_plans(id) ON DELETE CASCADE` | FK to existing plan records, intentional delete behavior |
| `kind`/`origin`/`stimulus_preservation`/`identity_kind` CHECKs + `plan_reschedules_identity_ck` | CHECK constraints limited to the new table |
| both `CREATE INDEX` | indexes supporting user/plan/created-time access |
| both `COMMENT ON` | table/column comments |

No `UPDATE`/`DELETE`/`DROP`/`TRUNCATE`, no destructive or type-changing
`ALTER` on an existing table, no backfill, no trigger, no grant of any kind
(broad or additive — none present), nothing touching completed activities or
sealed history, nothing outside the rescheduling capability.

## 3 · No rewrite or lock-scan of existing data — confirmed

`CREATE TABLE` creates a new, empty relation. The two `REFERENCES` clauses
require only a brief `ACCESS SHARE`-level lock on `users`/`training_plans` to
validate the FK definition itself — since `plan_reschedules` starts empty,
there are zero rows to validate against either table, so no scan of existing
rows in `users` or `training_plans` occurs.

## 4-5 · Isolated database, run twice

Applied against local `faff_sandbox` (loopback only, confirmed via
`inet_server_addr()`), 323 `users` rows / 307 `training_plans` rows present.

Run 1: `CREATE TABLE` / `CREATE INDEX` x2 / `COMMENT` x2 — all succeeded.
Run 2 (idempotency): `NOTICE: relation "plan_reschedules" already exists,
skipping` / same for both indexes — `CREATE TABLE` and `CREATE INDEX` again
report success (no-op), `COMMENT` re-applies harmlessly. Exit code 0 both
runs. `users`/`training_plans` row counts identical before and after both
runs: 323 / 307.

## 6 · FK and constraint behavior — six explicit tests

| Test | Expected | Result |
|---|---|---|
| Insert with a `user_uuid` not in `users` | FK violation | `ERROR: ... violates foreign key constraint "plan_reschedules_user_uuid_fkey"` ✓ |
| Insert with a `plan_id` not in `training_plans` | FK violation | `ERROR: ... violates foreign key constraint "plan_reschedules_plan_id_fkey"` ✓ |
| `identity_kind='SAME_INSTANCE'` with `stimulus_preservation='PARTIAL'` (mismatch) | CHECK violation | `ERROR: ... violates check constraint "plan_reschedules_identity_ck"` ✓ |
| `stimulus_preservation='BOGUS'` (not in the enum) | CHECK violation | `ERROR: ... violates check constraint` ✓ |
| A genuinely valid row (real user, real plan, consistent identity/preservation) | Succeeds | `INSERT 0 1` ✓ |
| Duplicate primary key of the row just inserted | Unique violation | `ERROR: duplicate key value violates unique constraint "plan_reschedules_pkey"` ✓ |

Final state after all six: exactly one row (the valid test insert), then
deleted as part of cleanup before the rollback test.

## 7 · Cross-user access — verified in the application code that will use this table

Every query against `plan_reschedules` in `lib/plan/reschedule.ts` scopes by
the authenticated caller's own `user_uuid`:
- the insert (`recordDecision`) writes the caller's own resolved `userUuid`,
  never a client-supplied one;
- the undo read: `WHERE id = $1 AND user_uuid = $2::uuid`;
- the undo write: `WHERE id = $1 AND user_uuid = $2::uuid`.

No row is ever read or mutated without that predicate. The table carries no
public grant and no row-level-security policy is needed given the
application never queries it unscoped.

## 8 · No reschedule record, no existing plan row changed — confirmed

`plan_reschedules` held 0 rows immediately after both applies (before the
constraint-test inserts, which were made and then removed as part of
verification, not as part of the migration itself). `training_plans` and
`plan_workouts` were not written by the migration at all — it contains no
statement that could write them.

## 9 · Rollback — confirmed, also idempotent

`DROP TABLE IF EXISTS plan_reschedules;` (the file's own stated reversal).
Run once: table dropped. Run twice: `NOTICE: table "plan_reschedules" does
not exist, skipping` — idempotent. `to_regclass('public.plan_reschedules')`
confirmed NULL after. `users`/`training_plans` unchanged throughout: 323 / 307.

## 10 · Deployment ordering

`lib/plan/reschedule.ts` (the only code that will ever query this table) is
already merged to `main` and already deployed — confirmed via
`git log -- web-v2/lib/plan/reschedule.ts` on `origin/main`. It already
treats the table's absence as a named, safe refusal
(`RescheduleRecordUnavailable`, whole transaction rolled back, runner told
nothing changed) — this has been true since before tonight. Applying the
migration now only ENABLES the capability the code already guards; there is
no window in which applying it could produce unsafe behavior regardless of
micro-timing relative to any future deploy.

## Verdict

All ten checks pass. No statement in the file matches a stop condition.
Proceeding to execute against production, statement by statement, with each
result recorded below.

## Executed against production — 2026-09-03

Confirmed target before executing: `current_database() = railway`,
`inet_server_addr()` a Railway-internal address, not loopback — genuinely
production, not the sandbox.

| Statement | Result |
|---|---|
| `CREATE TABLE IF NOT EXISTS plan_reschedules (...)` | `CREATE TABLE` |
| `CREATE INDEX IF NOT EXISTS plan_reschedules_user_decided_idx ...` | `CREATE INDEX` |
| `CREATE INDEX IF NOT EXISTS plan_reschedules_plan_idx ...` | `CREATE INDEX` |
| `COMMENT ON TABLE plan_reschedules IS ...` | `COMMENT` |
| `COMMENT ON COLUMN plan_reschedules.stimulus_preservation IS ...` | `COMMENT` |

All five succeeded, no errors. Post-apply verification (read-only role):

- `\d plan_reschedules` — every column, both indexes, all five CHECK
  constraints (including the compound identity/preservation one), and both
  FKs present exactly as specified.
- `plan_reschedules` row count: **0** — no reschedule record created.
- `training_plans` row count: **58**, `users` row count: **16** — production's
  real counts, unaffected by the migration.

Schema creation only. Moving Sunday's long run remains unapproved and
untouched until David selects an option from the ranked list.
