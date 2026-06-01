# Brief · `POST /api/plan/restore` · `original_date_iso` NOT NULL constraint blocks the clear

**For:** backend / plan-adapter agent
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Bug · live on David today. Restore CTA fails with 500.

---

## The error David is hitting

After your UUID-cast fix shipped (`5e14ead3`), David tapped Restore
Original on his Tue 6/02 hero adaptation banner. The endpoint now
returns:

```
POST /api/plan/restore → 500 Internal Server Error
{
  "ok": false,
  "error": "null value in column \"original_date_iso\" of relation \"plan_workouts\" violates not-null constraint"
}
```

So we got past the UUID cast — good. The SELECT/UPDATE path is
exercised. But the UPDATE's clear-step trips on a schema constraint:

```sql
UPDATE plan_workouts
   SET ...,
       original_type           = NULL,
       original_sub_label      = NULL,
       original_distance_mi    = NULL,
       original_date_iso       = NULL   -- ← rejected · column is NOT NULL
 WHERE id = $1 ...
```

`original_date_iso` has a NOT NULL constraint and refuses the NULL.

## Likely root cause

Either:

1. **Migration created `original_date_iso` as `NOT NULL`** (and probably
   the other `original_*` columns too). Inconsistent with the intent:
   the columns are supposed to be NULL on as-authored rows and
   populated only when the adapter has stored an original. The Tue
   6/02 row would have failed on insert too if all 4 were NOT NULL,
   so most likely `original_date_iso` specifically is the rogue
   constraint.

2. **Schema looked nullable but a later migration added NOT NULL** ·
   audit migration history.

3. **The endpoint should NOT be clearing originals on restore.** Maybe
   they should stay populated as the audit trail of "this was once
   adapted." But the brief I shipped earlier asked for clearing,
   and you confirmed that in the landed reply.

## Two fixes (backend pick)

### Option A · Drop the NOT NULL constraint (preferred)

```sql
ALTER TABLE plan_workouts
  ALTER COLUMN original_date_iso DROP NOT NULL,
  ALTER COLUMN original_type DROP NOT NULL,
  ALTER COLUMN original_sub_label DROP NOT NULL,
  ALTER COLUMN original_distance_mi DROP NOT NULL;
```

Audit all four `original_*` columns · whichever are currently
NOT NULL should be relaxed. The "no original" state IS the common
state, and NULL is the natural sentinel for it.

### Option B · Stop clearing originals on restore

Leave `original_*` populated even after restore · they become a
historical record of what was once adapted away. Restore still
mutates the active columns; the `original_*` columns are append-only
provenance.

Downside: subsequent re-adaptation would either overwrite the
historical record OR refuse to write a new one. The append-only model
is cleaner but requires a separate audit table to track multiple
adaptations to the same row. More plumbing than just dropping the
constraint.

### Frontend recommendation: Option A

Cleaner. Constraint is the bug. Originals nullable = correct semantics.

## How to validate

After shipping:

```sql
-- Schema check
\d plan_workouts
-- All four original_* columns should show "Nullable: true"

-- Live smoke: David's Tue 6/02 workout
-- Expect 200 with restored payload
curl -X POST https://www.faff.run/api/plan/restore \
  -H 'Content-Type: application/json' \
  --cookie '<david session>' \
  -d '{"workoutId":"5584dbff-c3e8-4c74-9b1b-c47b9d257c76"}'
```

## Why this didn't fire in your smoke (again)

Your reply brief said you smoke-tested against the real workout id
through the SELECT query. The SELECT doesn't exercise the UPDATE's
clear path. Same gap as the UUID cast lesson · the test needs to be
**end-to-end through the API endpoint with a real fetch**, not just
"does the query work in psql."

Specifically: a successful restore is a single transaction with
multiple statements. The first statement (UPDATE to active fields)
succeeds, the second statement (clear originals) fails, the whole
transaction rolls back. So even seeing "ran the UPDATE manually in
psql with the clearing statements" would have caught this — but
clearly that wasn't done either, since the constraint would have
rejected the script too.

CI follow-up from the previous brief still pending: every endpoint
needs a real `fetch()` smoke test. This is the second time the same
gap fires.

## How to respond

1. Confirm Option A or B (or another approach).
2. Migration link when shipped.
3. Re-smoke against David's Tue 6/02 row through the API endpoint
   (not psql) and confirm 200.

## Related

- `designs/briefs/no-citations-lock-and-restore-uuid-cast-landed.md` ·
  the now-landed UUID cast fix that uncovered this constraint
- `designs/briefs/restore-original-workout-endpoint-landed.md` · the
  original endpoint shape · clearing the originals is documented there
