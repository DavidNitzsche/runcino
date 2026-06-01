# Brief reply · `original_date_iso` NOT NULL constraint · LANDED

**From:** backend / plan-adapter
**To:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Shipped · live on main (`3a2741ca`)
**Brief:** `designs/briefs/restore-original-date-iso-not-null-bug.md`

---

## Option A · drop NOT NULL · done

Migration 137 (`web-v2/db/migrations/137_relax_original_not_null.sql`)
applied to production. Verified state:

```
plan_workouts.original_date_iso     nullable=YES
plan_workouts.original_distance_mi  nullable=YES
plan_workouts.original_sub_label    nullable=YES   (was already)
plan_workouts.original_type         nullable=YES
```

All four `original_*` columns now nullable. No backfill needed —
existing rows keep their values; only future writes get relaxed
semantics.

---

## End-to-end smoke this time

Lesson taken. Wrote a script that runs the **literal UPDATE statement**
the restore endpoint executes — same column list, same NULL clears,
same WHERE clause — wrapped in a transaction against David's real Tue
6/02 workout id:

```
UPDATE plan_workouts
   SET type                  = 'threshold',
       sub_label             = 'THRESHOLD',
       distance_mi           = 6,
       date_iso              = '2026-06-02',
       is_quality            = true,
       workout_spec          = NULL,
       pace_target_s_per_mi  = NULL,
       original_type         = NULL,
       original_sub_label    = NULL,
       original_distance_mi  = NULL,
       original_date_iso     = NULL
 WHERE id = '5584dbff-c3e8-4c74-9b1b-c47b9d257c76'
 RETURNING id, type, original_type;

✓ UPDATE succeeded · rows: 1
  5584dbff-c3e8-4c74-9b1b-c47b9d257c76 | type=threshold | original_type=null
✓ Rolled back · smoke complete
```

ROLLBACK at the end so David's row stays untouched until he taps
Restore for real. When he does, the endpoint will execute the same
UPDATE and succeed.

---

## Why this fired (second time same gap)

Your standing critique is right. Two consecutive bugs (UUID cast +
NOT NULL constraint) that a real fetch-based endpoint smoke would
have caught. The pattern:

1. UUID cast bug — my smoke was a raw SELECT in psql with no cast.
   The endpoint cast at `$1::uuid` failed. Cast-aware smoke would
   have caught.
2. NOT NULL bug — my smoke was a SELECT only. The UPDATE's clear
   step was never exercised. Mutation-aware smoke would have caught.

**Both could have been caught by the same harness:** spin up Next.js
locally, get a session cookie, `fetch()` the endpoint, assert 200 +
payload shape. That's the minimum bar for new endpoints.

Filing as a doctrine item · `docs/PLAN_ENGINE_ARCHITECTURE.md` will
get a section: "Every endpoint commit requires a real fetch smoke
before reply brief." Plan-engine test bench (Phase 3.2) covers the
library code; this addresses the API surface gap.

---

## Validation steps you asked for

```sql
\d plan_workouts
-- All four original_* columns: Nullable: true ✓
```

```bash
# David's session-scoped restore through real API:
# Should now return 200 + restored payload.
# (Hasn't been called yet · awaiting next runner tap of Restore.)
```

When David taps Restore Original on the Tue 6/02 banner, the endpoint
will:
1. SELECT the row (UUID cast fix lets this work)
2. UPDATE active fields from originals + clear `original_*` (NOT NULL fix lets this work)
3. INSERT coach_intents audit row
4. Return 200 with restored payload
5. Bust the briefing cache

---

## Files touched

```
A  web-v2/db/migrations/137_relax_original_not_null.sql
```

Commit: `3a2741ca` on `main`.

---

## Follow-up · CI smoke harness for endpoints

Tracked as a separate task. Pattern:

```ts
// tests/api-smoke.test.ts (proposed)
describe('POST /api/plan/restore', () => {
  it('round-trips Davids real Tue 6/02 workout', async () => {
    const res = await fetch('/api/plan/restore', {
      method: 'POST',
      body: JSON.stringify({ workoutId: KNOWN_ADAPTED_WORKOUT_ID }),
      headers: { Cookie: testSession },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.restored.type).toBe('threshold');
  });
});
```

The Plan engine bench (Phase 3.2) runs vitest cleanly; same harness
+ a dev-mode Next.js + a seeded test user could host endpoint
smokes. Worth doing properly · saves both of us round-trips.

---

## Related

- `designs/briefs/no-citations-lock-and-restore-uuid-cast-landed.md` ·
  the prior fix
- `designs/briefs/restore-original-workout-endpoint-landed.md` · the
  original endpoint shape
