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

## Cutover checklist (P6 → production)

Before flipping `www.faff.run` to web-v2:

1. **Verify v2 staging at next.faff.run for ≥ 7 days w/ David's daily use.**
   - All briefings produce valid voice (no eval FAIL exits).
   - Reply-chip → check_ins writes succeed.
   - GPX placeholder renders cleanly on race-detail.
   - At least one §8.6 closed-loop run (gap input → next briefing acks).

2. **Database state.**
   - All 4 v2 migrations applied (100-103).
   - check_ins / coach_intents tables populated by David's usage.
   - Existing legacy tables untouched.

3. **Root config flip.**
   In `package.json` + `railway.json`, change `cd legacy/web` → `cd web-v2`.
   - **Test the flip locally first.** `npm install && npm run build`
     from the repo root should now build web-v2.
   - Commit this as the cutover commit. Push deploys it.

4. **iOS cutover.**
   - Run `xcodegen generate` in `native-v2/`.
   - Build/run on a real device (Watch paired) to verify
     applicationContext push works.
   - Submit to TestFlight as a new build of the existing Faff app id
     (`run.faff.app`). The watch app inside ships unchanged.
   - When the TestFlight build promotes, the existing watch app
     continues running — no separate watch deploy.

5. **DNS final.**
   - Keep `legacy.faff.run` pointed at legacy/web service for one
     month post-cutover.
   - Drop legacy/ once v2 has shown 30 days of clean operation.

## Rollback after cutover

If v2 breaks in production:

1. Revert the package.json + railway.json cutover commit (`git revert`).
2. Push — Railway rebuilds from legacy/web.
3. legacy.faff.run alias remains, so DNS doesn't need touching.

Worst case 5-10 minute outage during the rebuild.
