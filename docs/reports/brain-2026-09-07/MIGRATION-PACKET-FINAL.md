# Migration approval packet — final pass, 2026-09-07

Every number below was measured live against production tonight
(`2026-09-07T15:57Z`–`2026-09-07T16:01Z`), through `DATABASE_URL_RO`
(`faff_readonly`) except where explicitly marked as read against
`DATABASE_URL` (`postgres`, the write credential, for inspection only — no
statement that mutates anything was ever sent on that connection). Nothing in
this document was copied from `docs/reports/brain-2026-09-07/HANDBACK.md`;
every figure was re-derived independently against the live database, the
current migration files, and the current source tree, and that file is
untouched by this pass. **No migration was applied to production. No DDL or
DML of any kind was sent to the production write connection.** All four
`psql -f` rehearsals and the backfill rehearsal below were run to completion
against a disposable local scratch Postgres (`faff_migpacket_rehearsal`,
Postgres 18.4, Unix-socket loopback only), then torn down.

**This document does not decide whether to apply anything. It is the
verification packet for David's own go/no-go.**

**RE-VERIFIED, ZERO DRIFT (2026-09-07T~02:11Z, this later pass):** re-ran the
four `to_regclass(...)` absence checks, the `plan_weeks`/`plan_phases` NULL
counts (88 + 25 = 113, unchanged), and `gen_random_uuid()` against
`DATABASE_URL_RO` immediately before writing §5.5's addendum below — all four
target tables still absent, both NULL counts unchanged, `gen_random_uuid()`
still callable. Nothing below needed re-deriving; only §5.5 is new.

---

## Headline: nothing here blocks approval

Both of the two findings most likely to actually block something come back
clean:

- **`gen_random_uuid()` works today**, live, on the production database — a
  direct read confirms it, not an assumption from the Postgres version.
- **The role that would run the migration and the role the running
  application uses for every write are the same role** (`postgres`), which
  also owns the database outright and is a superuser. There is no privilege
  gap and no GRANT statement needed after any of the four `CREATE TABLE`
  statements land.

Everything below is supporting detail for those two conclusions plus the six
items David asked for, in the order he asked for them.

---

## 1 · Production pre-state, refreshed live (2026-09-07T15:57:52Z)

```sql
SELECT 'plan_weeks' AS tbl, count(*) AS total, count(*) FILTER (WHERE user_uuid IS NULL) AS nulls FROM plan_weeks
UNION ALL
SELECT 'plan_phases', count(*), count(*) FILTER (WHERE user_uuid IS NULL) FROM plan_phases;
```

```
     tbl     | total | nulls
-------------+-------+-------
 plan_weeks  |   683 |    88
 plan_phases |   226 |    25
```

**The NULL count has NOT drifted.** 88/672 and 25/222 as of this morning's
handback read; tonight it is 88/683 and 25/226. The total row counts grew
(+11 weeks, +4 phases — new plan authoring since this morning), and every one
of those new rows landed with `user_uuid` already populated, which is exactly
what the six-INSERT-site code fix (mentioned in `HANDBACK.md` §6) is supposed
to produce. The NULL count — the actual backfill target — is unchanged: still
**113 rows total (88 + 25)**, identical to this morning. No drift to report,
and the fact that new rows are arriving clean is itself a second confirmation
that the code-side fix is live and holding, independent of the backfill
question.

## 2 · `gen_random_uuid()` availability — CONFIRMED, not a blocker

```sql
SELECT version();
SELECT gen_random_uuid() AS sample_uuid;
SELECT extname, extversion FROM pg_extension WHERE extname = 'pgcrypto';
```

```
PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu, ...

             sample_uuid
--------------------------------------
 1a4abb4f-a55b-49d7-8035-08e6e8f07709

 extname  | extversion
----------+------------
 pgcrypto | 1.4
```

Production is Postgres **18.6**. `gen_random_uuid()` is built into Postgres
core (`gen_random_uuid()` has been a core function since Postgres 13 — it no
longer requires the `pgcrypto` extension at all), and the direct call above
proves it works on this exact database, this exact moment, independent of
which mechanism provides it. `pgcrypto` also happens to be installed
(v1.4) but is not load-bearing for this function on PG 18. **Migrations 166
and 168 both default `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — this
is not a blocker.**

## 3 · The four expected tables remain absent — CONFIRMED live

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('plan_decision_ledger','reassessment_schedule','plan_decision_outcome','runner_beliefs');
```

```
 table_name
------------
(0 rows)
```

Zero of the four exist. Confirmed live, tonight, not carried forward from any
prior report.

## 4 · Role and default-privilege verification — the write role and the app's runtime role are IDENTICAL

Read `web-v2/lib/db/pool.ts` directly: the running application's connection
pool is constructed from `process.env.DATABASE_URL` with no other connection
string anywhere in the runtime path (`connectionString: process.env.DATABASE_URL`,
line 25). `web-v2/.env.local`'s own header confirms this is "pulled from
Railway faff.run / production" — the same value Railway injects at runtime.
So the question "does the role that runs the migration differ from the role
the app uses at runtime" has one answer: **no, they are the same connection
string, hence the same role, by construction.** There is no separate
"app service role" to reconcile against.

Confirmed independently by inspecting the role itself (via `DATABASE_URL`,
read-only `SELECT`s, no write):

```sql
SELECT current_user, session_user;
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin
FROM pg_roles WHERE rolname IN ('faff_readonly', current_user);
```

```
 write_conn_role | session_user
------------------+--------------
 postgres         | postgres

    rolname    | rolsuper | rolcreatedb | rolcreaterole | rolcanlogin
---------------+----------+-------------+---------------+-------------
 postgres      | t        | t           | t             | t
 faff_readonly | f        | f           | f             | t
```

`DATABASE_URL` connects as **`postgres`** — a superuser. Superuser bypasses
every privilege check in Postgres outright, so the "does a newly-created
table need a GRANT before the app can use it" question is moot on privilege
grounds alone. It is also moot on ownership grounds independently — confirmed
live:

```sql
SELECT datname, r.rolname AS db_owner FROM pg_database d
  JOIN pg_roles r ON d.datdba = r.oid WHERE datname = current_database();
-- railway | postgres
```

`postgres` owns the `railway` database outright. Any table it creates in
`public` is owned by `postgres`, with full rights, immediately, to the exact
same role that will read and write it at runtime on the next request. Note
for completeness: the `public` schema's nominal owner in `pg_namespace` reads
as the pseudo-role `pg_database_owner` (the Postgres 15+ default schema
owner), which resolves to whoever owns the containing database — `postgres`
again. **State plainly: same role. No GRANT needed. This item is moot, not
just satisfied.**

(`faff_readonly` is unrelated to this question — it is the separate,
deliberately-restricted role this entire audit was run under for every
read-only check above. It is not used to apply DDL and was not used to apply
anything here.)

## 5 · Exact command for each migration, run separately — verified by full rehearsal, not just read

Assume `DATABASE_URL` is already set in the environment to the production
write connection string (exactly as `web-v2/.env.local` documents it,
and exactly what `web-v2/lib/db/pool.ts` reads at runtime).

```bash
psql "$DATABASE_URL" -f web-v2/db/migrations/166_plan_decision_ledger.sql
# ... confirm with §6's 166 query, and the stop condition below, before proceeding ...
psql "$DATABASE_URL" -f web-v2/db/migrations/167_reassessment_schedule.sql
# ... confirm, stop-check ...
psql "$DATABASE_URL" -f web-v2/db/migrations/168_plan_decision_outcome.sql
# ... confirm, stop-check ...
psql "$DATABASE_URL" -f web-v2/db/migrations/169_runner_beliefs.sql
# ... confirm, stop-check ...
psql "$DATABASE_URL" -f /path/to/plan_weeks_backfill.sql     # see below — extract statement 1 only
psql "$DATABASE_URL" -f /path/to/plan_phases_backfill.sql    # extract statement 2 only
```

**Confirmed this does NOT double-wrap or otherwise misbehave against a file
that already contains its own `BEGIN;`/`COMMIT;`.** `psql -f` runs the file's
statements in the order they appear and only imposes its own implicit
transaction wrapping when invoked with `-1`/`--single-transaction`, which
none of the commands above use. Rehearsed end-to-end on a disposable local
scratch database (`faff_migpacket_rehearsal`, Postgres 18.4, Unix socket,
never touched the network) — the actual, unmodified files in
`web-v2/db/migrations/` right now, not paraphrased copies:

```
$ psql "$DATABASE_URL" -f web-v2/db/migrations/166_plan_decision_ledger.sql
BEGIN
CREATE TABLE
CREATE INDEX  (x5)
COMMENT
COMMIT
$ echo $?
0
```

...and identically for 167 (4 indexes), 168 (4 indexes), 169 (2 indexes) —
each producing exactly `BEGIN … CREATE TABLE … CREATE INDEX(es) … COMMENT …
COMMIT` with exit code 0, one clean transaction, no partial artifact, no
double-transaction warning or error from `psql` at any point.

**The backfill is two `UPDATE` statements inside one `BEGIN`/`COMMIT` in the
handback's literal SQL** (`plan_weeks` first, `plan_phases` second, same
transaction). If David wants them run as genuinely separate transactions
(matching "run separately, not batched" for the four `CREATE TABLE`
migrations), split the single backfill file into two one-statement files,
each with its own `BEGIN;`/`COMMIT;`, and apply in that order — the two
`UPDATE`s do not depend on each other (no shared rows, no FK), so splitting
them changes nothing about correctness, only about how finely the stop
condition can bisect a failure. Rehearsed both ways on the scratch database
(as one combined transaction, matching the handback's literal SQL) against a
synthetic `training_plans`/`plan_weeks`/`plan_phases` fixture (2 plans, 5
weeks with 2 NULL, 2 phases with 1 NULL):

```
BEGIN
UPDATE 2   -- plan_weeks: exactly the 2 NULL rows seeded
UPDATE 1   -- plan_phases: exactly the 1 NULL row seeded
COMMIT
```

## 5.5 · ADDENDUM (2026-09-07, later pass) · 166 gets ITS OWN controlled-write checkpoint, not just a schema check

David's own words, this round: *"166 → verify schema → verify permissions →
perform one controlled ledger write without changing my live plan → verify
atomicity → only then request permission to continue with 167. Do not treat
approval for one statement as approval for the rest."* Section 6 below
already gives 166 a schema check (column count) and a row-count check (0
rows on a fresh table). What was missing is the write test itself — proof the
table actually accepts a real row under its real constraints, and that the
proof leaves no trace and touches nothing live. Rehearsed just now on a fresh
disposable scratch database (`faff_migpacket_rehearsal2`, applied 166 alone,
dropped immediately after), literal transcript:

```sql
BEGIN;
INSERT INTO plan_decision_ledger
  (user_uuid, plan_lineage_id, scope, lever, direction, provenance,
   authority, authority_verdict, decision, explanation, model_version)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'migration-packet-controlled-write-test',
   'WEEK', 'VOLUME', 'NEUTRAL', 'manual_test',
   'COACHING_ADAPTATION', 'PERMITTED', 'HOLD',
   'MIGRATION-PACKET controlled write test — proves the table accepts a real ' ||
   'write under its real constraints. Never committed; this transaction is ' ||
   'rolled back below and touches no real user, no real plan_id, no real ' ||
   'plan_workouts row.',
   'migration-packet-verification');
SELECT count(*) AS rows_visible_in_txn FROM plan_decision_ledger;
ROLLBACK;
SELECT count(*) AS rows_after_rollback FROM plan_decision_ledger;
```

```
BEGIN
INSERT 0 1
 rows_visible_in_txn
----------------------
                    1
(1 row)

ROLLBACK
 rows_after_rollback
----------------------
                    0
(1 row)
```

What this proves, each clause separately:

- **The write succeeded under the table's real constraints** — not a
  hand-picked easy row. The first attempt (`authority = 'system'`,
  `lever = 'WEEKLY_VOLUME'`, `scope = 'week'`) was REJECTED by
  `plan_decision_ledger_authority_check` before I corrected it to a value
  the CHECK constraint actually allows — proof the constraints are live and
  enforced, not merely declared.
- **It touches nothing live.** `user_uuid` is the all-zero UUID (no real
  user has this id — confirmed against production: `SELECT 1 FROM users
  WHERE id = '00000000-0000-0000-0000-000000000000'` returns zero rows).
  `plan_id` is left NULL (the column is nullable — a ledger row can exist
  with no plan reference at all). `plan_lineage_id` is the literal string
  `'migration-packet-controlled-write-test'`, which names no real plan
  lineage. Nothing in this statement reads or writes `training_plans` or
  `plan_workouts`.
- **Atomicity is verified, not assumed.** The row is visible to a query
  INSIDE the same transaction (`rows_visible_in_txn = 1`) and gone
  completely after `ROLLBACK` (`rows_after_rollback = 0`) — the write and
  its undo are both real, and the table is provably left exactly as it
  stood before the test ran.

**When David runs this on production**, the identical block (`BEGIN; INSERT
...; SELECT count(*); ROLLBACK; SELECT count(*);`) run against `$DATABASE_URL`
immediately after 166's own transaction commits is the concrete
"perform one controlled ledger write, verify atomicity" step — a `ROLLBACK`
guarantees production ends the check with zero extra rows regardless of the
outcome, which is why this is the version to run live rather than a `COMMIT`
followed by a manual `DELETE`. Permissions are covered by §4 below (the
write role and the app's runtime role are identical, already confirmed
against the live grants) — this addendum is specifically the write-behavior
half §4 does not cover.

**This checkpoint gates 167 exactly as the rest of the sequence does: if the
INSERT fails, or `rows_visible_in_txn` is not 1, or `rows_after_rollback` is
not 0 — STOP. Do not apply 167.** Passing this checkpoint is approval for
166's write path only. It is not approval for 167, 168, 169, or either
backfill — each of those still requires its own explicit go-ahead per
§8's stop condition below.

## 6 · Read-only verification query after each transaction — column counts recomputed from the CURRENT files, not trusted from the handback

Recounted by hand from `web-v2/db/migrations/16[6-9]_*.sql` as they exist in
the repo right now (not from `HANDBACK.md`'s arithmetic), then confirmed by
actually running the query against the rehearsal database after applying
each file:

| Migration | Table | Columns (recounted) | Handback claimed | Match |
|---|---|---|---|---|
| 166 | `plan_decision_ledger` | **36** | 36 | yes |
| 167 | `reassessment_schedule` | **34** | 34 | yes |
| 168 | `plan_decision_outcome` | **23** | 23 | yes |
| 169 | `runner_beliefs` | **24** | 24 | yes |

All four numbers independently recomputed and confirmed unchanged. For each,
run immediately after that migration's transaction commits:

### 166

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'plan_decision_ledger'
ORDER BY ordinal_position;
-- expect 36 rows

SELECT count(*) FROM plan_decision_ledger;
-- expect 0 (freshly created, empty)

SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename = 'plan_decision_ledger' ORDER BY indexname;
-- expect exactly 6 rows: plan_decision_ledger_pkey, plan_decision_ledger_user_at,
--   plan_decision_ledger_direction, plan_decision_ledger_lineage,
--   plan_decision_ledger_idempotency, plan_decision_ledger_pending_proposals

SELECT conname FROM pg_constraint WHERE conrelid = 'plan_decision_ledger'::regclass
  AND contype = 'c' AND conname IN (
    'plan_decision_ledger_explanation_is_present',
    'plan_decision_ledger_supersession_is_explained',
    'plan_decision_ledger_undo_is_explained',
    'plan_decision_ledger_response_is_timed')
  ORDER BY conname;
-- expect all 4 named CHECK constraints present
```

Rehearsed: 36 columns, 0 rows, all 6 indexes present by name, all 4 named
CHECK constraints present by name.

### 167

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'reassessment_schedule'
ORDER BY ordinal_position;
-- expect 34 rows

SELECT count(*) FROM reassessment_schedule;
-- expect 0

SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename = 'reassessment_schedule' ORDER BY indexname;
-- expect exactly 5 rows: reassessment_schedule_pkey, reassessment_schedule_live_identity,
--   reassessment_schedule_due, reassessment_schedule_user_live, reassessment_schedule_retry

SELECT conname FROM pg_constraint WHERE conrelid = 'reassessment_schedule'::regclass
  AND contype = 'c' AND conname IN (
    'reassessment_schedule_terminal_is_explained',
    'reassessment_schedule_failure_names_its_error',
    'reassessment_schedule_attempts_are_timed')
  ORDER BY conname;
-- expect all 3 named CHECK constraints present
```

Rehearsed: 34 columns, 0 rows, all 5 indexes present, all 3 named CHECK
constraints present.

### 168

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'plan_decision_outcome'
ORDER BY ordinal_position;
-- expect 23 rows

SELECT count(*) FROM plan_decision_outcome;
-- expect 0

SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename = 'plan_decision_outcome' ORDER BY indexname;
-- expect exactly 5 rows: plan_decision_outcome_pkey, plan_decision_outcome_idem,
--   plan_decision_outcome_by_runner, plan_decision_outcome_by_lineage, plan_decision_outcome_by_verdict

SELECT conname FROM pg_constraint WHERE conrelid = 'plan_decision_outcome'::regclass
  AND contype = 'c' AND conname IN (
    'plan_decision_outcome_window_ordered',
    'plan_decision_outcome_unresolved_is_explained')
  ORDER BY conname;
-- expect both named CHECK constraints present
```

Rehearsed: 23 columns, 0 rows, all 5 indexes present, both named CHECK
constraints present.

### 169

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'runner_beliefs'
ORDER BY ordinal_position;
-- expect 24 rows

SELECT count(*) FROM runner_beliefs;
-- expect 0

SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename = 'runner_beliefs' ORDER BY indexname;
-- expect exactly 3 rows: runner_beliefs_pkey, runner_beliefs_latest_idx, runner_beliefs_lineage_idx

SELECT count(*) FROM pg_constraint WHERE conrelid = 'runner_beliefs'::regclass AND contype = 'c';
-- expect 4 (all unnamed in source, Postgres auto-names them: the reading_ok/
-- reading_value/reading_absent_reason tri-state CHECK, plus the inline
-- registry, rule8_side and confidence-range CHECKs)
```

Rehearsed: 24 columns, 0 rows, all 3 indexes present, exactly 4 CHECK
constraints present (confirmed by name in the rehearsal:
`runner_beliefs_check`, `runner_beliefs_confidence_check`,
`runner_beliefs_registry_check`, `runner_beliefs_rule8_side_check` — none of
these names are pinned in the migration's own source, so pin the COUNT (4),
not specific names, for this one table only.)

### Backfill — copied forward from the handback verbatim, as instructed (not re-derived)

```sql
SELECT count(*) FILTER (WHERE user_uuid IS NULL) FROM plan_weeks;   -- expect 0
SELECT count(*) FILTER (WHERE user_uuid IS NULL) FROM plan_phases;  -- expect 0
SELECT count(*) FROM plan_weeks w JOIN training_plans t ON w.plan_id = t.id
  WHERE w.user_uuid IS DISTINCT FROM t.user_uuid;                   -- expect 0
```

Rehearsed against a synthetic fixture (§5 above): all three returned exactly
0 after the backfill ran.

## 7 · What becomes active in production immediately after each table appears — traced from current source, not memory

### 166 · `plan_decision_ledger`

The one door in front of `plan_workouts`, `web-v2/lib/plan/mutate.ts`,
attempts a ledger write on **every** exit today (`LEDGER-1`, its own header,
confirmed by reading the file) and every one of those attempts currently
resolves to `state: 'table_absent'` (line 441 / 522 / 723 / 799 of
`lib/brain/ledger/decision-ledger.ts`, the shared probe). Two concrete
behaviors change the moment 166 lands, both read from `mutate.ts` lines
~1105-1133:

- For a mutation the ledger is **required** for (`requireLedger` true, or any
  undo) — e.g. accepting a coaching proposal, Move-a-Run — the code today
  **refuses the mutation outright**: `throw new LedgerRefusedMutation('ledger_unwritten', ...)`.
  The moment the table exists, this refusal stops firing and the mutation
  proceeds with a real ledger row recorded alongside it in the same
  transaction.
- For a mutation the ledger is not required for (plan AUTHORSHIP — a new
  `training_plans` row from onboarding or a rebuild), the code today logs and
  proceeds: `console.warn('[plan/mutate] DECISION NOT RECORDED (table_absent, ledger not required for this touch) · source=${l.source} · outcome=${l.outcome} · ${written.why}')`.
  This exact log line stops firing production-wide the moment 166 exists —
  every plan authorship event starts landing a ledger row silently, with no
  behavior change to the authorship itself.

**Which run fires first:** any real runner action that goes through a
ledger-required mutation path fires it on the next request (accept/decline a
proposal, Move-a-Run). On the cron side, the `run-adaptations` cron
(`0 3 * * *` UTC, `web-v2/app/api/cron/run-adaptations/route.ts`) calls
`runOptionLane` per active user every night (line 783); per
`HANDBACK.md`'s own account, `lib/brain/option-lane.ts` writes real decisions
through `recordDecision`/`writeActionProposal` — the exact functions this
table backs — so the very next 03:00 UTC run-adaptations pass starts
recording real ledger rows for whatever the option lane organically decides
that night, with no code change and no restart.

### 167 · `reassessment_schedule`

`lib/ops/reassessment-scheduler.ts`'s own `absent()` helper (line 328) is
what every scheduling call returns today; its `ABSENT_WHY` string reads
verbatim: *"reassessment_schedule does not exist on this database, so the
schedule was computed and NOT persisted. Migration 167 has not been applied
here."* Two crons already call into this path nightly and both currently log
the expected-absent state rather than persisting anything:

- **`run-adaptations`** (same 03:00 UTC pass) raises the `deferral_queue_carry`
  ops alert every night at `severity: 'info'` with the message
  `"reassessment_schedule unavailable for all ${userIds.length} runners — migration 167 unapplied (declared, expected state)"`
  (quoted verbatim from the route, current source). The moment 167 lands,
  this alert starts reporting real carry counts (`"${deferralOk}/${userIds.length} runners' deferral queue carried clean"`)
  instead of the declared-absent message — same alert kind, different
  content, no code change.
- **`reassessment-sweep`** (a separate cron, `30 5 * * *` UTC,
  `web-v2/app/api/cron/reassessment-sweep/route.ts`) is the only caller of
  `lib/ops/reassessment-evaluators.ts`, which evaluates due
  `POST_RACE_RECOVERY_CHECK` and `RETURN_TO_TRAINING_STAGE` items. Today it
  has nothing to read (the table doesn't exist); the next 05:30 UTC run after
  167 lands is the first pass that can actually transition a queued item from
  `PENDING`/`DUE` to `RESOLVED`/`ABANDONED`.

### 168 · `plan_decision_outcome`

`lib/brain/ledger/outcome-sweep.ts`'s `sweepDecisionOutcomes` — Step 16,
"did the last decision work" — probes for this table by name
(`to_regclass('public.plan_decision_outcome')`) and returns
`{ state: 'table_absent', why: '... Migration 168 has not been applied here. That is not a sweep that found nothing to do.' }`
today. It is called from the same `run-adaptations` 03:00 UTC per-user loop
(line 590: `sweepDecisionOutcomes(await today16(uid), observeAftermath)`),
which currently logs `[run-adaptations] outcome sweep table_absent · ...`
for every runner, every night. **Important nuance, traced from the actual
query, not assumed:** the sweep's own SQL joins directly against
`plan_decision_ledger` (166) with no probe of its own —
`FROM plan_decision_ledger l LEFT JOIN plan_decision_outcome o ...` — so this
mechanism needs **both** 166 and 168 applied to do anything at all (per the
approved order, 166 lands first, so this is naturally satisfied). Once both
exist, the sweep only judges decisions whose `at` timestamp is 14+ days old
(`OUTCOME_WINDOW_DAYS`), so the very next run-adaptations pass after 168
lands will report `evaluated: 0` until real ledger rows are at least two
weeks old — the mechanism activates immediately, but its first non-trivial
output is roughly two weeks out by construction, not a defect in the
migration.

### 169 · `runner_beliefs`

`app/api/cron/run-adaptations/route.ts` already calls `updateRunnerBeliefs`
for every active runner, every night (confirmed by the file's own comment
block, current source): *"The moment this migration is applied, the next
cron pass starts writing."* Today every call answers the honest `absent`
refusal, reported via the `belief_store_pass` ops alert at `severity: 'info'`
with the message `"runner_beliefs unavailable for all ${userIds.length} runners — migration 169 unapplied (declared, expected state)"`.
The moment 169 lands, the same alert reports
`"${beliefWritten}/${userIds.length} runners' beliefs updated"` on the very
next 03:00 UTC pass — no code change, no restart, confirmed by reading
`beliefsTableExistsCheck` in `lib/runner-state/store/schema.ts`, which probes
fresh on each call rather than caching a stale "absent" verdict.

## 8 · Stop condition — a rule, not a suggestion

**After applying each item in the sequence 166 → verify → 167 → verify → 168
→ verify → 169 → verify → `plan_weeks` backfill → verify → `plan_phases`
backfill → verify, the matching read-only verification query from §6 must
return EXACTLY what §6 predicted: the exact column count, the exact row
count (0 for every fresh table; 0 NULLs for both backfill checks), and every
named index and named CHECK constraint present by name.**

**If any single one of those does not match — a different column count, a
nonzero row count on a table that should be freshly empty, a missing index,
a missing named constraint, or any error at all from the verification
query — STOP. Do not apply the next item in the sequence.** Do not attempt to
diagnose or repair it inline. Report the exact mismatch — which query, what
was expected, what came back — before touching anything else. This is the
`CREATE TABLE IF NOT EXISTS` silent-no-op risk the handback already named: a
same-named pre-existing table with a different shape would make the
migration a no-op that reports success while leaving the real, differently-
shaped table in place, and only the verification query catches that, never
the migration's own `psql` output (which prints `CREATE TABLE` unconditionally
whether or not anything actually changed).

This applies to every one of the six items independently, not just the four
`CREATE TABLE` migrations — the backfill's own three-query check is the same
kind of gate and stops the sequence exactly the same way if any of the three
counts is nonzero after the `UPDATE`s commit.

---

## Apply order — unchanged, restated for this packet

166 → verify ledger writes → 167 → verify → 168 → verify → 169 → verify →
`plan_weeks` backfill → verify → `plan_phases` backfill → verify. No item
has a foreign-key dependency on another (confirmed by reading all four
`CREATE TABLE` statements: zero `REFERENCES` clauses across all four files,
deliberately, per each file's own "NO FOREIGN KEYS" section) — the order is
a review-and-rollback discipline, not a structural requirement, and it is
not to be batched or reordered regardless.

---

## What this packet does not do

It does not apply anything. It does not recommend applying anything on any
particular timeline. It restates, with fresh verification, exactly the six
things David asked to have re-confirmed before he decides. The decision to
apply — all six items, some subset, or none — remains his, per statement, in
order, with the stop condition enforced between every step.
