# Staging environment (P37)

Today: every push to `main` deploys to `www.faff.run` directly. No
gate, no smoke test layer.

## Recommended setup (Railway)

1. **Branch:** create a `staging` branch off main, push to remote.
2. **Railway service:** in the Railway project, add a new service
   pointing at the same repo, branch = `staging`. Domain:
   `staging.faff.run` (CNAME the Railway-issued cname).
3. **Env vars:** copy from prod, but set:
   - `DATABASE_URL` — pointing at a separate Railway Postgres add-on
     OR add a `STAGING_SCHEMA` prefix to keep one DB cheap.
   - `STRAVA_OAUTH_REDIRECT=https://staging.faff.run/api/auth/strava?action=callback`
   - `NEXT_PUBLIC_ENV=staging` (purely cosmetic — display "STAGING" badge).
4. **Cutover flow:**
   ```bash
   # work as usual on main
   git push origin main

   # promote to staging
   git checkout staging
   git merge main
   git push origin staging
   # → staging.faff.run picks it up

   # smoke test against staging
   curl https://staging.faff.run/api/briefing?surface=today | jq .voice
   node web-v2/scripts/voice-eval/run.mjs --prod=https://staging.faff.run

   # promote to prod
   # (production deploys from main; main already has the code, so
   #  nothing to do once staging looks good)
   ```

## What it gives you

- A place to ship work-in-progress and have someone test before
  customers see it.
- A place to validate migrations before they hit prod tables (the
  current pattern of "apply migration directly" carries some risk).
- A target URL for the voice-eval runner that doesn't pollute prod
  cache.

## Not done yet

This is the playbook. Actually provisioning the Railway service +
DB requires David's Railway login. Will do on request.
