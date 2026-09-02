# Rollback, undo, and what a rebuild can actually touch

Measured read-only against production, 2026-09-02, before any rebuild.
This answers his post-rebuild proof 6 — *confirm the undo mechanism and
rollback state* — in advance, so the mechanism is known before it is needed
rather than discovered after.

## The undo is real, and it is one reversible statement

`clearActivePlansFor` **archives** a plan by stamping `archived_iso`. It never
deletes the plan's `plan_workouts` rows. His account holds **48 plan versions**,
every one of them still carrying its rows:

| State | Plan | Authored | Rows |
|---|---|---|---|
| **ACTIVE** | `pln_9a57561debb776e5` | 2026-08-30 20:40 | 103 |
| archived | `pln_0e635603799fd7b1` | 2026-08-26 02:34 | 7 |
| archived | `pln_974c307d22ee0f61` | 2026-08-25 02:29 | 7 |
| archived | `pln_eb73331e19230ad9` | 2026-08-17 13:19 | 14 |
| archived | `pln_36fe43db78fe177d` | 2026-08-17 11:04 | 14 |
| archived | `pln_c0ff77ee065b8fe4` | 2026-06-06 21:02 | 77 |

So rollback is: archive the new plan, clear `archived_iso` on
`pln_9a57561debb776e5`. The 103 rows are still there, unmodified, and come back
exactly as they are today. Nothing needs to be regenerated to undo.

Worth naming plainly: **the property that makes rollback safe is the same one
that caused a defect.** Retained rows on archived plans are the Rule 14 bug
class — a query joining on `user_uuid` alone reads all 48 versions and once
counted 59 "quality sessions" in a single week. The retention is an asset here
and a liability there. It is not a reason to change the retention; it is a
reason the scoping predicate has to be right, which is what `ACTIVEPLAN-1`
gates.

## A rebuild orphans nothing

Two questions, both measured rather than assumed.

**Do completed runs point at plan rows by id?** No. A run carries
`client_workout_id` (`<uuid>-<date>#<time>`), `workoutType`, and
`workoutTypeSource: "plan"` — the pairing is **by date**, not by row id. New
plan rows with new ids therefore cannot orphan a completed run. This is why
proof 2 is achievable at all.

**Does anything else reference these row ids?** Two tables can —
`plan_mutations.workout_id` and `plan_workout_proposals.plan_workout_id`. Both
currently hold **zero** rows pointing at the live plan.

That zero carries a second meaning worth recording. No mutation has ever been
written against this plan, in either direction. It is independent confirmation
of the Rule 21 finding from a different table than the one that established it:
the adaptation engine has not moved this block, up or down.

## What the rebuild will actually run through

The rebuild is not a local script. It is `POST /api/cron/silent-rebuild` →
`fireAutoRebuild`, which runs in **production**. Two consequences:

1. **The anchoring fix must be deployed before the rebuild, not merely merged.**
   Rule 19 applies exactly: green is not deployed. The deploy is confirmed by
   status, before the write.
2. `fireAutoRebuild` writes a `plan_proposals` row with `auto_applied`, so the
   rebuild leaves an audit record of itself rather than happening silently.
   That row is part of the post-rebuild evidence.
