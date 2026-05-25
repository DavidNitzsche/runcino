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

## Backward compatibility

Nothing in legacy/web reads or writes these tables; the migrations are
purely additive. Cutover from legacy → v2 doesn't require any data
migration on these tables (they're empty until v2 starts writing).
