# Migration 164 · `canonical_adaptation_shadow_log` — evidence record

Authorized statement-by-statement, per David's ruling 2026-09-03 ("Apply migration 164
statement by statement. Verify its schema, constraints, permissions, and the first successful
shadow record. It must remain shadow-only and incapable of mutating the plan."). Follows the
same ten-step protocol as migration 163 (`docs/migrations/163-plan-reschedules-evidence-2026-09-03.md`).

## 1 · Statements

Five: one `CREATE TABLE IF NOT EXISTS canonical_adaptation_shadow_log`, three
`CREATE INDEX IF NOT EXISTS`, one `COMMENT ON TABLE`. Full text in
`web-v2/db/migrations/164_canonical_adaptation_shadow_log.sql`, whose own header carries the
seven-criterion review (additive-only, no triggers, bounded retention, idempotent, default
grants, safe rollback, no interference with existing tables).

## 2 · Additive — confirmed

`CREATE TABLE`, three CHECK constraints scoped to the new table
(`boundary`/`lever`/`decision` enums), two FKs to existing tables (`users`, `training_plans`,
both `ON DELETE CASCADE`), three indexes, one table comment. No `ALTER` on an existing table, no
`UPDATE`/`DELETE`/`DROP`/`TRUNCATE`, no backfill, no trigger, no grant statement of any kind.

## 3 · No rewrite or lock-scan of existing data — confirmed

New, empty relation. The two `REFERENCES` clauses need only `ACCESS SHARE` to validate the FK
definitions; zero rows to check against since the new table starts empty.

## 4-5 · Isolated database, run twice

`faff_sandbox` (loopback, confirmed via `inet_server_addr() = '::1'`), 323 users / 307
training_plans. Run 1: `CREATE TABLE` / 3x `CREATE INDEX` / `COMMENT` — all succeeded. Run 2:
`NOTICE: relation ... already exists, skipping` for the table and all three indexes,
`COMMENT` re-applies harmlessly, exit 0. Row counts identical before/after both runs: 323/307,
`canonical_adaptation_shadow_log` 0 rows.

## 6 · Constraint tests

| Test | Expected | Result |
|---|---|---|
| Insert with `user_uuid` not in `users` | FK violation | `violates foreign key constraint "canonical_adaptation_shadow_log_user_uuid_fkey"` ✓ |
| Insert with `plan_id` not in `training_plans` | FK violation | `violates foreign key constraint "canonical_adaptation_shadow_log_plan_id_fkey"` ✓ |
| `boundary='BOGUS_BOUNDARY'` | CHECK violation | `violates check constraint "canonical_shadow_log_boundary_check"` ✓ |
| `lever='BOGUS_LEVER'` | CHECK violation | `violates check constraint "canonical_shadow_log_lever_check"` ✓ |
| `decision='BOGUS_DECISION'` | CHECK violation | `violates check constraint "canonical_shadow_log_decision_check"` ✓ |
| A genuinely valid row | Succeeds | `INSERT 0 1` ✓, then deleted as cleanup |

## 7 · Cross-user access

`shadow-log-writer.ts` is allow-listed (falsified 9 ways by the landing commit) to exactly one
INSERT shape against this table, called only from `run-live-shadow-evaluation.ts` with the
`userUuid` the caller resolved server-side — never client-supplied. No public grant, no RLS
needed given the app never queries this table unscoped.

## 8 · No existing plan row changed — confirmed

`training_plans` (58) and `plan_workouts` (4639) row counts identical before and after both the
DDL apply and the first live shadow-evaluation trigger (§10 below). The migration contains no
statement that could write either table, and the writer is allow-listed to one INSERT shape
against `canonical_adaptation_shadow_log` alone.

## 9 · Rollback — confirmed, idempotent

`DROP TABLE IF EXISTS canonical_adaptation_shadow_log;` — run once: dropped. Run twice:
`NOTICE: table ... does not exist, skipping`. `to_regclass('public.canonical_adaptation_shadow_log')`
NULL after. `users`/`training_plans` unchanged throughout: 323/307.

## 10 · Deployment ordering

The only code that writes this table (`lib/adaptation/canonical-shadow/*`,
`app/api/admin/canonical-adaptation-shadow/route.ts`, `app/api/cron/run-adaptations/route.ts`)
was merged to `main` at `cb8bf8ee` and confirmed **deployed** (not merely pushed) — GitHub
commit status for `0b46b147` (a later commit on the same deploy) reports
`faff.run - faff: success · Success - www.faff.run`, polled to resolution rather than assumed.
`run-live-shadow-evaluation.ts` already treats the table's absence as a graceful "not persisted"
result — applying the migration only enables the capability, no unsafe window either way.

## Verdict

All ten checks pass. Proceeding to execute against production.

## Executed against production — 2026-09-03

Confirmed target before executing: `current_database() = railway`, `inet_server_addr()` a
Railway-internal address (`10.168.27.93`), not loopback.

| Statement | Result |
|---|---|
| `CREATE TABLE IF NOT EXISTS canonical_adaptation_shadow_log (...)` | `CREATE TABLE` |
| `CREATE INDEX IF NOT EXISTS canonical_adaptation_shadow_log_user_date_idx ...` | `CREATE INDEX` |
| `CREATE INDEX IF NOT EXISTS canonical_adaptation_shadow_log_lever_decision_idx ...` | `CREATE INDEX` |
| `CREATE INDEX IF NOT EXISTS canonical_adaptation_shadow_log_idempotency_idx ...` | `CREATE INDEX` |
| `COMMENT ON TABLE canonical_adaptation_shadow_log IS ...` | `COMMENT` |

All five succeeded, no errors. Post-apply verification (read-only role):

- `\d canonical_adaptation_shadow_log` — every column, all three indexes (plus the primary key),
  all three CHECK constraints, both FKs present exactly as specified.
- Row counts: `users` 16, `training_plans` 58 — production's real counts, unaffected.
- `canonical_adaptation_shadow_log` row count: 0 immediately after DDL.
- Grants: `faff_readonly` → `SELECT` only. No `INSERT` granted to any role but the table owner —
  confirmed by `information_schema.role_table_grants`, not assumed from the DDL's silence.

## First live shadow record — 2026-09-03

Triggered directly via `runAndPersistCanonicalShadowEvaluation(userUuid)`
(`scripts/p0-proof/trigger-canonical-shadow-once.ts`), run as a plain process — **not** under
vitest and **not** with `FAFF_VERIFICATION=1` — so the production write barrier does not
classify it as a verification process and the write proceeds through the app's own writable
pool exactly as the `run-adaptations` cron would perform it in production. For David's
`user_uuid` (`0645f40c-951d-4ccc-b86e-9979cd26c795`):

```
3/3 records persisted.
  WEEKLY_VOLUME   REGRESS   45 → 42.8
  LONG_RUN        REFUSE    6.2, unchanged (only 1 comparable long run, contract needs 2)
  THRESHOLD_PACE  REFUSE    394 s/mi (6:34/mi), unchanged (no qualifying threshold session in 28d)
```

Read back from production (`faff_readonly`, not the writer's own connection) — three rows exist
in `canonical_adaptation_shadow_log`, `user_uuid` matches, `source =
'cron_run_adaptations_canonical_shadow'` on all three, `resolved_at` within the same second as
the trigger run. `training_plans` (58) and `plan_workouts` (4639) row counts identical
before and after this call — the shadow evaluation touched nothing beyond its own table.

**Shadow-only, confirmed structurally rather than by observation alone:** the mutation guard
(`lib/adaptation/canonical/_cannot_mutate.test.ts` guard 4, and
`lib/adaptation/canonical-shadow/_never_mutates_plan.test.ts`) proves from source that nothing
in this code path can reach a plan-mutating function — this production run is a live instance of
what those tests already established statically, not a substitute for having proven it.
