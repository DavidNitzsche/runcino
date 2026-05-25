# Deploy plan — legacy + v2 coexistence

## Domains

| Domain                  | Points at        | When            |
| ----------------------- | ---------------- | --------------- |
| `www.faff.run`          | legacy/web       | today, until cutover |
| `legacy.faff.run`       | legacy/web       | from P0.8 onward, permanently as fallback |
| `next.faff.run`         | web-v2 staging   | from P0.8 onward, where David tests v2 daily |
| (cutover)               | web-v2           | when v2 is unambiguously better |

## Setup steps (one-time, by David in Railway console)

1. **Add a second Railway service** for v2:
   - Repo: same `DavidNitzsche/runcino`
   - Root config: `web-v2/railway.json` (already in repo)
   - Branch: `main`
   - Custom domain: `next.faff.run`
   - Env vars: `DATABASE_URL` (same Railway pg), `ANTHROPIC_API_KEY`
   - Builder: NIXPACKS (auto-detect Next.js)

2. **Add `legacy.faff.run` as a domain alias** of the existing service.
   The current root `railway.json` already builds from `legacy/web` so the
   service keeps working unchanged.

3. **Cutover (later)**: swap which service serves `www.faff.run`.
   Both services share the same database, so no data migration needed.

## Migrations

Before the next deploy of v2, apply the SQL migrations against prod:

```bash
psql $DATABASE_URL -f web-v2/db/migrations/100_check_ins.sql
psql $DATABASE_URL -f web-v2/db/migrations/101_coach_intents.sql
psql $DATABASE_URL -f web-v2/db/migrations/102_course_library.sql
psql $DATABASE_URL -f web-v2/db/migrations/103_learn_articles.sql
```

These are additive + idempotent; legacy/web ignores them.

## iOS

`legacy/native` (existing Faff TestFlight target) stays as the user-facing
iOS app until P5 ships `native-v2`. Update the iOS `API.baseURL` to
`next.faff.run` once you're ready to dogfood v2 from your phone.

## Rollback

If `next.faff.run` is broken, nothing else is affected — `www.faff.run`
continues serving from `legacy/web`. Worst case after cutover, point
`www.faff.run` back at the legacy service in the Railway console.
