# Migration 166 · checkpoint re-verified fresh — 2026-09-08 06:39 UTC

Companion to `MIGRATION-166-CHECKPOINT.md` (written ~2026-09-07 21:00 PDT).
That file is untracked in the shared checkout; this one is written beside it
rather than editing it in place, so nothing this session does can collide with
the orchestrating session's own uncommitted copy. **Read them together — this
one is the fresher evidence.**

**Verdict: NO DRIFT.** Every claim in §1, §2, §3 and §4 of the checkpoint still
holds, re-verified against current production and against `origin/main` at
`dd1761718993833f38bf2975e040a1cb693a6f2f`.

**NOTHING WAS APPLIED.** Migration 166 remains gated on David's explicit
approval. This session had no write privilege to production and did not seek
one.

---

## 1 · Production pre-state, re-read tonight

Read over `DATABASE_URL_RO` at **2026-09-08 06:39:13 UTC**:

| Check | Checkpoint said | Tonight | Drift |
|---|---|---|---|
| `to_regclass('public.plan_decision_ledger')` | `NULL` | `NULL` (empty) | none |
| `gen_random_uuid()` | callable | callable — returned `f136a402-75d6-4dad-b87a-db7099c0121d` | none |
| `current_user` on the RO connection | `faff_readonly` | `faff_readonly` | none |
| server | (not stated) | PostgreSQL 18.6 (Debian) | — |

**The RO role's write refusal was falsified rather than assumed** (Rule 18):

```
CREATE TABLE public._probe_write_check(x int);
  -> ERROR: permission denied for schema public
UPDATE users SET email = email WHERE false;
  -> ERROR: permission denied for table users
```

`pg_roles` confirms `faff_readonly` is `rolsuper=f rolcreatedb=f
rolcreaterole=f`. (A `CREATE TEMP TABLE` DOES succeed — the role holds TEMP
privilege on the database. That touches no persistent object and is not a
counter-example, but it is recorded here so nobody re-derives it as a surprise.)

## 2 · The migration file is byte-identical to what the checkpoint described

Not "looks the same" — the git object was compared:

```
path        web-v2/db/migrations/166_plan_decision_ledger.sql
size        16853 bytes
sha256      239335e766e07b26e81a2da34070364093ecc3ab4c74b892265996441a557ee8
blob        f9b7199050b8f5b8cacd2ec3bbe85cbf189450f4  (working tree)
            f9b7199050b8f5b8cacd2ec3bbe85cbf189450f4  (HEAD:<path>)
```

Identical hashes: the file in the tree IS the committed file, unmodified. Its
last three commits are `3a5139a57` (MIGRATIONTXN-1, wrapped it in an explicit
transaction), `c5b133b3f` (LEDGERATOMIC-1) and `209e0afda` (the original). No
commit has touched it since the checkpoint was written.

## 3 · The structural claims, RE-COUNTED from the file rather than trusted

Rule 18's "read the numbers out of the source at run time, do not hardcode both
sides", applied to a document instead of a gate:

| Checkpoint claim | Re-counted | Agrees |
|---|---|---|
| one `BEGIN; … COMMIT;` block | 1 `BEGIN;`, 1 `COMMIT;` | yes |
| one `CREATE TABLE IF NOT EXISTS` | 1 statement (a second `CREATE TABLE` string occurs in a comment at line 109) | yes |
| **36 columns** | **36**, enumerated: `id, user_uuid, plan_id, plan_lineage_id, replaced_plan_id, plan_version, scope, workout_ids, scope_from_iso, scope_to_iso, lever, direction, evidence, provenance, source_mode, before_state, after_state, authority, authority_verdict, hold, decision, proposal_id, proposal, runner_response, responded_at, mutation_outcome, mutation_violations, explanation, model_version, at, superseded_by, superseded_at, undone_at, undo_reason, idempotency_key, created_at` | yes |
| **5 indexes** | 5 `CREATE INDEX` | yes |
| **12 CHECK constraints** | 12 `CHECK (` | yes |
| **no foreign keys** | 0 `REFERENCES` | yes |
| no `GRANT` / `ALTER` / `DROP` | 0 statements matching | yes |
| one `COMMENT` | 1 `COMMENT ON` | yes |

## 4 · The §7 behavioural claims still hold

- `class LedgerRefusedMutation extends Error` is still present in
  `web-v2/lib/plan/mutate.ts` (line 1046), and the ledger-refusal path is still
  the one `lib/audit/_decision_ledger_gate.test.ts` asserts on.
- `table_absent` is still the resolved state the writers report while the table
  is missing — `lib/brain/ledger/_migration_probe.test.ts` asserts
  `(await recordDecision(...)).state === 'table_absent'` directly.
- The only commit touching `lib/plan/mutate.ts`, `lib/brain/ledger/**` or
  `web-v2/db/migrations/**` since the checkpoint was written is `32d2719d7`
  (AUTHOREDSTATE-READBACK-1), which is about the authorship-drift check seeing
  embedded races and does not touch the ledger contract.

## 5 · What is still owed, and by whom

Unchanged from the checkpoint's §6: **passing this checkpoint is approval for
166 only.** 167, 168, 169 and both backfills each need their own explicit
per-statement go, in order, when David chooses to give it.

The application command, the post-commit verification queries and the
controlled rolled-back write are all in `MIGRATION-166-CHECKPOINT.md` §2, §3
and §5 and are NOT restated here (Rule 17: the runner reads a sentence once).
Nothing in them needs revision.
