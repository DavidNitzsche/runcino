# Migration 166 (`plan_decision_ledger`) — Review Packet

Prepared 2026-09-09, read-only (no database write, no migration applied, no product code touched while preparing this). Scope: migration 166 only, per David's own on-record ruling ("approval for 166 only… not 167/168/169"). **This packet is neutral input to David's decision — it recommends approval or non-approval on nothing.** It is the prerequisite named in the master report's §11 decision 3, which explicitly states approval should not be recommended from a summary alone.

**Primary sources cited throughout:**
- `web-v2/db/migrations/166_plan_decision_ledger.sql` (the migration itself — read in full)
- `docs/reports/brain-2026-09-07/MIGRATION-166-CHECKPOINT.md`
- `docs/reports/brain-2026-09-07/MIGRATION-166-RECHECK-2026-09-08.md`
- `docs/reports/brain-2026-09-05/LITERAL-SQL-166-167.md`
- `docs/reports/brain-2026-09-07/MIGRATION-PACKET-FINAL.md`
- `web-v2/lib/plan/mutate.ts`, `web-v2/lib/brain/ledger/decision-ledger.ts`
- `web-v2/lib/plan/_ledger_atomicity.db.test.ts`, `web-v2/lib/brain/ledger/_migration_probe.test.ts`
- `docs/PRODUCT_DECISIONS.md` (`LEDGERRESPONDED-1` entry)
- `web-v2/scripts/_build_roundtrip_scratch.sh`, `web-v2/lib/db/pool.ts`, `scripts/check-decision-ledger.sh`

---

## 1. Exact migration SQL

Verbatim, from `web-v2/db/migrations/166_plan_decision_ledger.sql` (cross-verified byte-identical against `docs/reports/brain-2026-09-05/LITERAL-SQL-166-167.md`, and independently against a git-blob-hash comparison in `MIGRATION-166-RECHECK-2026-09-08.md` §2: sha256 `239335e766e0…`, blob `f9b7199050b8…`, working tree = `HEAD`):

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

Note: the `mutation_outcome` vocabulary above includes `'ledger_unwritten'` and `'duplicate'`, added by a later commit (`LEDGERATOMIC-1`) after `LITERAL-SQL-166-167.md` was written; the version transcribed here is read directly from the current, authoritative source file.

## 2. Full inventory — table, columns, indexes, constraints

**One table, 36 columns**, recounted directly from source (matches the independent recount in `MIGRATION-166-RECHECK-2026-09-08.md` §3):

| Column | Type | Nullable | Default / notes |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK, `gen_random_uuid()` |
| `user_uuid` | uuid | NOT NULL | the runner |
| `plan_id` | text | nullable | plan touched, at the time |
| `plan_lineage_id` | text | NOT NULL | stable across every rebuild |
| `replaced_plan_id` | text | nullable | on an AUTHORSHIP row |
| `plan_version` | text | nullable | |
| `scope` | text | NOT NULL | CHECK: `PLAN\|WEEK\|WORKOUT\|NONE` |
| `workout_ids` | jsonb | NOT NULL | default `'[]'` |
| `scope_from_iso` / `scope_to_iso` | date | nullable | |
| `lever` | text | NOT NULL | CHECK: 7-value enum |
| `direction` | text | NOT NULL | CHECK: `UP\|DOWN\|NEUTRAL\|UNKNOWN` |
| `evidence` | jsonb | NOT NULL | default `'[]'` |
| `provenance` | text | NOT NULL | the write-site name |
| `source_mode` | text | nullable | unconstrained |
| `before_state` / `after_state` | jsonb | nullable | |
| `authority` | text | NOT NULL | CHECK: 5-value enum |
| `authority_verdict` | text | NOT NULL | CHECK: `PERMITTED\|REFUSED\|HELD` |
| `hold` | jsonb | nullable | |
| `decision` | text | NOT NULL | CHECK: 8-value enum |
| `proposal_id` / `proposal` | text / jsonb | nullable | |
| `runner_response` | text | nullable | CHECK: `NULL\|PENDING\|ACCEPTED\|DECLINED\|EXPIRED` |
| `responded_at` | timestamptz | nullable | paired with `runner_response` by constraint |
| `mutation_outcome` | text | nullable | CHECK: `NULL` or 9-value enum |
| `mutation_violations` | jsonb | NOT NULL | default `'[]'` |
| `explanation` | text | NOT NULL | non-empty by constraint |
| `model_version` | text | NOT NULL | |
| `at` | timestamptz | NOT NULL | default `now()` |
| `superseded_by` | uuid | nullable | |
| `superseded_at` | timestamptz | nullable | paired with `superseded_by` |
| `undone_at` / `undo_reason` | timestamptz / text | nullable | paired |
| `idempotency_key` | text | nullable | |
| `created_at` | timestamptz | NOT NULL | default `now()` |

**5 explicit indexes**, plus the implicit PK index (6 total, matching the rehearsed `pg_indexes` count in `MIGRATION-PACKET-FINAL.md` §6): `plan_decision_ledger_user_at` (runner history, newest-first); `plan_decision_ledger_direction` (backs the Rule 21 census `GROUP BY direction`); `plan_decision_ledger_lineage` (whole coaching history across rebuilds); `plan_decision_ledger_idempotency` (UNIQUE, partial, one live row per runner/write-site/key); `plan_decision_ledger_pending_proposals` (partial, open proposals).

**12 CHECK constraints total** (8 inline enum CHECKs plus 4 named cross-field constraints: explanation non-empty; supersession fields paired; undo fields paired-and-non-empty; runner-response settlement paired with `responded_at`). **No foreign keys** — deliberate, per the file's own "NO FOREIGN KEYS, DELIBERATELY" section: a ledger must outlive the row it describes.

## 3. Locking behavior

The transaction contains only `CREATE TABLE IF NOT EXISTS` (on a table that doesn't exist), `CREATE INDEX IF NOT EXISTS` (not `CONCURRENTLY`), and one `COMMENT ON TABLE`. **No statement touches any existing table** — no `ALTER TABLE`, no trigger, no FK referencing an existing table, confirmed both in the file's own header and independently in `LITERAL-SQL-166-167.md`/`MIGRATION-166-CHECKPOINT.md`. A `CREATE TABLE` and non-`CONCURRENTLY` `CREATE INDEX` on a brand-new, empty table take `ACCESS EXCLUSIVE` locks only on the object being created, which has no other lock holders since it doesn't yet exist. **No lock of any kind is taken on any pre-existing table. No blocking risk against live traffic.**

## 4. Expected execution time

Reasoned from the SQL: a brand-new empty table with 5 indexes on zero rows is a near-instant (sub-second) operation under normal load — no `CONCURRENTLY` build, nothing scans or rewrites existing rows. **No scratch-test report gives an explicit wall-clock number** — what's on record is qualitative ("rehearsed to completion... exit code 0, no error, no partial state," `MIGRATION-166-CHECKPOINT.md` §2; identical in `MIGRATION-PACKET-FINAL.md` §5). This packet cannot independently produce a timed number without database access; the SQL's own content gives no reason to expect this matters for a brand-new empty table. Ambient context: `web-v2/lib/db/pool.ts` sets a 30s `statement_timeout` for the app's own pooled connections — not directly applicable to a `psql -f` DDL session, but the ceiling this codebase otherwise treats as "a slow query."

## 5. Transaction behavior

Wrapped in one explicit `BEGIN; … COMMIT;` block (commit `3a5139a57`, tagged `MIGRATIONTXN-1`). Reasoning per the file's own header: Postgres DDL is atomic per-statement but not atomic as a 7-statement batch, so a mid-sequence failure without explicit transaction wrapping could leave earlier objects committed with no clean partial-vs-full signal. `CREATE INDEX CONCURRENTLY` is explicitly **not** used — the file states why: these are new, empty tables, so there is no concurrent-write traffic a `CONCURRENTLY` build would be protecting. Nothing here needs to run outside a transaction.

## 6. Backfill requirements

**None, stated explicitly.** The table starts empty and records decisions going forward only. The file's own header states directly what happens to `training_plans.adaptation_log`: "NOTHING, in this migration... that is deliberate." No `INSERT INTO plan_decision_ledger SELECT ...` exists anywhere in the file. Retiring `adaptation_log` would need its own separate migration and its own separate approval — explicitly named as out of scope here, so as not to "smuggle a destructive step into an additive migration."

## 7. Compatibility during a rolling deploy

Both directions are already addressed by code merged and live in production today, not hypothetically:

- **New code, table absent:** `decision-ledger.ts`'s `ledgerTableExists()`/`ledgerTableExistsInTransaction()` probe `to_regclass('public.plan_decision_ledger')` and return a typed `'table_absent'` state — never a thrown error, never a fabricated success. `mutate.ts`'s `landDecisionInTransaction` (lines 1133–1193) branches on this: for a mutation the ledger isn't required for (plan authorship), it logs a warning and proceeds unchanged; for a mutation that IS required (accepting a proposal, Move-a-Run, any undo), it throws `LedgerRefusedMutation('ledger_unwritten', ...)`, caught cleanly by the outer boundary (line 1751) rather than crashing. This is the currently-live production behavior, confirmed unchanged in `MIGRATION-166-RECHECK-2026-09-08.md` §4.
- **Old code, table now present (process hasn't restarted):** `MIGRATIONPROBE-1` (`decision-ledger.ts` lines 136–198, tested in `_migration_probe.test.ts`) caches a definite `absent` result for only 60 seconds before re-probing, so a long-running process notices the table appearing without a restart. A **positive** probe is cached permanently (a table cannot un-exist). A **failed** probe is never collapsed into `absent` — it reports a distinct `failed` state (Rule 11), tested directly. Since this migration makes no schema change any *old* code path reads or writes, an old process never touches the new table at all — there is no "old code expects the old shape" failure mode, because there is no old shape being replaced.

## 8. Deployment order

Already resolved by fact, not recommendation: the ledger-writing application code is **already merged and live in production today**, running in its `table_absent`-tolerant mode (`MIGRATION-166-CHECKPOINT.md` §7; `MIGRATION-166-RECHECK-2026-09-08.md` §4, both re-verified against live production). Code-before-migration is the current live state, and the code degrades safely in exactly that ordering. The migration needs no accompanying code deploy — applying it standalone immediately activates the write paths (proposal-acceptance/Move-a-Run stop refusing; the next `run-adaptations` cron pass, `0 3 * * *` UTC, starts writing real rows). Running the migration and a code deploy "simultaneously" carries no more risk than applying it alone, since both pre- and post-migration code behavior is already exercised (`_migration_probe.test.ts`).

## 9. Failure behavior / idempotency

`CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout, one `BEGIN`/`COMMIT`. Any statement failing rolls back the entire transaction — nothing partial is left. Re-running after a full-transaction failure is safe (the `IF NOT EXISTS` guards make a retry a no-op-then-continue). **One named risk** (`MIGRATION-PACKET-FINAL.md` §8): `CREATE TABLE IF NOT EXISTS` would silently no-op if a same-named, differently-shaped table already existed, and `psql` would still print `CREATE TABLE` — this is why the verification queries below check exact column count/names, not just existence. Current production has no `plan_decision_ledger` table at all (`to_regclass` returns `NULL`, confirmed both 2026-09-07 and 2026-09-08), so this risk doesn't currently apply, but the verification step should still run after the fact.

## 10. Rollback plan

Exact reverse statement, from the migration file's own header: `DROP TABLE IF EXISTS plan_decision_ledger;` — dropping the table drops its indexes, constraints, and comment with it; nothing else needs a separate reverse statement. Safety: zero foreign keys into or out of this table means nothing else in the schema can be structurally broken by dropping it, and the `TABLE_ABSENT` degradation path means application code already tolerates the table's absence as a first-class, tested case — a rollback returns the system to a state the code already handles, not an error condition it was never built for. **What a rollback would destroy**: any ledger rows written in the interim (real decisions/mutations recorded after 166 landed) are not recoverable from a `DROP TABLE` — inherent to rolling back a durability feature, not a defect in the rollback statement.

## 11. Read-only verification queries (post-apply, no further writes)

From `MIGRATION-166-CHECKPOINT.md` §3, cross-checked in `MIGRATION-PACKET-FINAL.md` §6:

```sql
-- expect exactly 36 rows
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'plan_decision_ledger'
 ORDER BY ordinal_position;

-- expect 0 (freshly created, empty)
SELECT count(*) FROM plan_decision_ledger;

-- expect exactly 6 rows (5 named + the PK's implicit index)
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename = 'plan_decision_ledger' ORDER BY indexname;

-- expect 12 CHECK constraints
SELECT conname FROM pg_constraint
 WHERE conrelid = 'plan_decision_ledger'::regclass AND contype = 'c';
```

Additionally, a controlled, self-rolling-back write test (already rehearsed on a scratch database, per `MIGRATION-166-CHECKPOINT.md` §5 / `MIGRATION-PACKET-FINAL.md` §5.5), recommended to run against production immediately after 166 commits: `BEGIN; INSERT ... (all-zero user_uuid, matching no real account); SELECT count(*) — expect 1; ROLLBACK; SELECT count(*) — expect 0;`.

## 12. Scratch/staging evidence — asserted vs. independently confirmed

**Asserted in existing reports (not re-run in preparing this packet — no DB access available):**
- `MIGRATION-166-CHECKPOINT.md`: applied and rehearsed to completion on a disposable scratch Postgres, exit code 0, no partial state; a controlled `BEGIN/INSERT/ROLLBACK` write test with exact transcript; a deliberate bad-value insert (`authority='system'`) rejected by its CHECK constraint before correction.
- `MIGRATION-166-RECHECK-2026-09-08.md`: a fully independent re-verification — production pre-state re-read fresh, migration file re-hashed against git (byte-identical), columns/indexes/constraints re-counted from source rather than trusting prior arithmetic, and the RO-role write refusal falsified live (§13 below).
- `MIGRATION-PACKET-FINAL.md`: independently re-derived, full rehearsal of all four pending migrations (166–169) end-to-end on two separate scratch databases, each at exit code 0; a second, separate controlled-write rehearsal specific to 166 per David's own "verify schema → verify permissions → one controlled write → verify atomicity" sequencing.
- **Beyond the checkpoint reports:** `web-v2/lib/plan/_ledger_atomicity.db.test.ts` proves, against a real Postgres schema clone of production's actual schema (built by `_build_roundtrip_scratch.sh`), that a ledger-write failure rolls back the accompanying plan mutation — the atomicity claim is asserted by a test that fails loudly if untrue, not just a comment. `docs/PRODUCT_DECISIONS.md`'s `LEDGERRESPONDED-1` entry documents a real bug (`plan_decision_ledger_response_is_timed` rejecting every accepted-proposal row) found by an end-to-end round-trip test running the full coaching loop against a real local database, then fixed — direct evidence the constraints are exercised in practice, and that the process has already caught at least one real defect before this went to review.

**Independently confirmed while preparing this packet:** the live migration file read byte-for-byte; columns (36), indexes (5 explicit + PK), and CHECK constraints (12) recounted directly from current source rather than trusted from any report; the application source (`mutate.ts`, `decision-ledger.ts`) read directly and confirmed to match the `table_absent`/probe-caching behavior the reports describe; `scripts/check-decision-ledger.sh` and `_migration_probe.test.ts`/`_ledger_atomicity.db.test.ts` confirmed to exist and contain the guards/tests named.

**Not confirmed, and stated plainly:** no database credentials were available while preparing this packet; no query was run against production, `DATABASE_URL_RO`, or any scratch database. Every claim about actual query output, timing, or live production state above is cited to the prior reports' own transcripts, not re-executed here.

## 13. Proof `DATABASE_URL_RO` cannot execute this migration

**Falsified directly against live production**, per `MIGRATION-166-RECHECK-2026-09-08.md` §1 (2026-09-08 06:39 UTC, quoted verbatim):

```
CREATE TABLE public._probe_write_check(x int);
  -> ERROR: permission denied for schema public
UPDATE users SET email = email WHERE false;
  -> ERROR: permission denied for table users
```

`pg_roles` confirms `faff_readonly` (the role behind `DATABASE_URL_RO`) has `rolsuper=f rolcreatedb=f rolcreaterole=f`. This is a direct, falsified test of the exact statement class this migration issues (`CREATE TABLE` was tried and rejected with `permission denied for schema public`), not an inference from generic Postgres role semantics. This role has no superuser/`CREATEROLE` bypass, so there is no path by which a read-only audit agent could accidentally apply this migration. (A `CREATE TEMP TABLE` does succeed for this role — temp-table privilege is separate from schema-object privilege in Postgres — but that creates no persistent object and cannot execute this migration, which targets `public.plan_decision_ledger` explicitly.) Separately, `web-v2/lib/db/pool.ts` confirms the running application's own connection uses `DATABASE_URL` (a different, privileged role) exclusively — `DATABASE_URL_RO` is never used by the app itself, only by audit/read-only tooling.

---

**Item most worth a second look before David decides:** §4 (execution time) has no independently-measured wall-clock number on record — only qualitative "completed successfully" rehearsal transcripts. The SQL's own content gives no reason to expect this matters for a brand-new empty table, but it is named here as the one genuinely unmeasured item rather than silently treated as resolved.
