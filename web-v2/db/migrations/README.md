# v2 migrations

Numbered 100+ to leave room above the legacy 001-004 sequence in
`legacy/web/db/schema/`. These run against the same Railway database —
new tables coexist with existing schema until cutover.

## Apply order

```bash
psql $DATABASE_URL -f web-v2/db/migrations/100_check_ins.sql
psql $DATABASE_URL -f web-v2/db/migrations/101_coach_intents.sql
psql $DATABASE_URL -f web-v2/db/migrations/102_course_library.sql
psql $DATABASE_URL -f web-v2/db/migrations/103_learn_articles.sql
```

All use `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` so they
are idempotent.

## What they unlock

| Migration            | Closed loop | Surfaces affected |
| -------------------- | ----------- | ----------------- |
| 100_check_ins        | §8.1 reply chips                | TODAY |
| 101_coach_intents    | §8.6 gap-input acknowledgement  | all   |
| 102_course_library   | §8.2 GPX ingestion              | RACE DETAIL, TODAY race horizon |
| 103_learn_articles   | §8.5 research reader            | TODAY, HEALTH (fun_fact cards) |
| 152_personal_goals   | non-race goals CRUD             | TARGETS (NewGoalSheet), iPhone postGoal |
| 153_coach_reads_cache| coach calendar (ICS) storage    | TODAY (coached mode) |
| 154_sick_recovery    | illness trend log + recovery    | TODAY (sick state), lock-screen ack |

## Applied-by-hand, and what that costs

These are applied by hand, so **a deploy that names a new column 500s every
read until the ALTER runs**. Two consequences worth holding:

1. **Order.** A migration that adds a TABLE can land in either order — the
   statements naming it already fail today, and the code that runs them
   already treats that failure honestly. A migration that adds a COLUMN to a
   live table must land **before** the code that names it.
2. **Or write the column read so it does not care.** The precedent is
   `app/api/shoe/route.ts`, which reads `shoe_type` as
   `to_jsonb(shoes.*) ->> 'shoe_type'` — NULL for a column that does not
   exist, and NULL already means "the default" — so the same code is correct
   on both sides of migration 151.

152/153/154 are all CREATE TABLE, so they are case 1 and were applied to prod
on 2026-08-24. Pre-state and the exact inverse:
`docs/2026-08-24-missing-tables-prestate.sql`.

## Backward compatibility

Nothing in legacy/web reads or writes these tables; the migrations are
purely additive. Cutover from legacy → v2 doesn't require any data
migration on these tables (they're empty until v2 starts writing).
