# Operations — everything David handles

The single source of truth for credential-gated operations. Claude does
NOT have access to any of the dashboards, signing certs, OAuth apps, or
external accounts listed here. When Claude needs one of these actions,
Claude prepares the change locally and hands off to you via this doc.

**If you're a new agent reading this**: every action below requires
either David's hands-on click in a dashboard, or his terminal with a
credential you don't have. Don't try to automate any of it. Surface
what you need; David executes.

---

## Table of contents

1. [Railway — hosting & deploys](#1-railway--hosting--deploys)
2. [Railway — env vars](#2-railway--env-vars)
3. [Postgres database](#3-postgres-database)
4. [Strava OAuth (per-user)](#4-strava-oauth-per-user)
5. [Anthropic API](#5-anthropic-api)
6. [Apple Developer + TestFlight](#6-apple-developer--testflight)
7. [Apple HealthKit entitlements](#7-apple-healthkit-entitlements)
8. [Domain & DNS (faff.run)](#8-domain--dns-faffrun)
9. [GitHub repo + branches](#9-github-repo--branches)
10. [Emergency procedures](#10-emergency-procedures)
11. [Credential rotation schedule](#11-credential-rotation-schedule)

---

## 1. Railway — hosting & deploys

**What it is.** Railway hosts the Next.js web app (`web-v2/`) and the
Postgres database. The production domain `www.faff.run` points at the
Railway-deployed app.

**Deploy trigger.** Auto-deploy on push to `main`. There's no manual
deploy step — every `git push origin main` triggers a Railway rebuild
within ~2 min.

**What Claude does:**
- Commit and push to main (always — see memory: `feedback_always_push_main.md`)
- Run typecheck before push (pre-push hook enforces it)
- Confirm via curl that the deploy is live before reporting success

**What only you (David) can do:**
- Log into railway.app → faff.run project
- View deploy logs (click the deploy in Railway dashboard)
- Restart the service (`Settings → Restart`)
- Roll back to a previous deploy (click any prior deploy → `Redeploy`)
- Cancel a stuck build (`Cancel` on the in-progress deploy card)
- Change build settings (root directory, build command, start command)

**Common ops:**

| What | Where | How |
|---|---|---|
| See if deploy is live | Railway dashboard `Deployments` tab | Look for green checkmark + "Active" |
| Tail prod logs | Railway dashboard → service → `Logs` | Filter by service if multiple |
| Restart the service | Railway dashboard → service → `Settings → Restart` | ~30 sec downtime |
| Roll back | Railway dashboard → `Deployments` → prior deploy → `Redeploy` | Instant |

**If Claude says "deploy is live as of commit X" but the change isn't
showing**, check Railway dashboard for the latest deploy status. If it's
older than the commit, the build either failed or is still running.

---

## 2. Railway — env vars

**What it is.** Production secrets and config live in Railway's
environment variables panel. The app reads them via `process.env.X`.

**Currently set in prod** (per `docs/coach/DEPLOY.md`):

| Var | Purpose | Who rotates |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | Railway (auto) |
| `ANTHROPIC_API_KEY` | Coach LLM (other surfaces) | David |
| `STRAVA_CLIENT_ID` | OAuth — public app ID | David |
| `STRAVA_CLIENT_SECRET` | OAuth — server secret | David |
| `STRAVA_OAUTH_REDIRECT` | OAuth callback URL | David (set once) |
| `DEFAULT_USER_ID` | Beta single-user fallback (David's UUID) | David |
| `COACH_PAUSED` | Kill switch for LLM coach (no longer needed for /today) | David |

**What Claude does:**
- When a new env var is needed, Claude adds the reader code (`process.env.X`)
- Claude writes the var name + purpose into the commit message
- Claude tells you in chat: "set `X=Y` in Railway before the deploy lands"

**What only you can do:**
- railway.app → service → `Variables`
- Add / edit / delete variables
- Apply (Railway redeploys automatically when vars change)

**Convention.** Claude never logs or echoes secret values. If you paste
one into chat for debugging, treat the chat as compromised and rotate.

---

## 3. Postgres database

**What it is.** Railway-hosted Postgres. Lives in the same Railway
project as the web app. `DATABASE_URL` env var is the connection string.

**What Claude does:**
- Writes migration SQL into `web-v2/` (or wherever they live)
- Writes the read/write queries against the schema
- Provides a recompute endpoint if a backfill is needed (e.g.,
  `/api/admin/recompute-runs` — Claude wrote it, you can curl it)

**What only you can do:**
- Connect directly to prod DB via Railway's connection string (use
  `psql $DATABASE_URL` or a GUI like TablePlus)
- Run ad-hoc SQL against prod
- Apply migrations to prod (typically `psql $DATABASE_URL < migration.sql`)
- Take backups (Railway has automatic daily backups; manual via
  `pg_dump $DATABASE_URL > backup.sql`)
- Restore from backup
- Reset / drop / recreate the database

**Migrations.** No formal migration tool is wired up. Migrations live as
SQL files in `web-v2/` and you apply them by hand. When Claude writes a
new migration:

1. Claude writes `web-v2/db/migrations/NNN_name.sql`
2. Claude commits it
3. Claude tells you: "apply migration NNN before the next deploy"
4. You: `psql $DATABASE_URL < web-v2/db/migrations/NNN_name.sql`
5. You confirm; Claude proceeds

**Direct prod queries.** If Claude says "you need to run this SQL to
fix the dup rows" — copy the SQL, run via psql, paste the result back.

---

## 4. Strava OAuth (per-user)

**What it is.** Each user connects their own Strava account via OAuth.
The Faff Strava app is registered at `developers.strava.com`. Tokens are
per-user, stored in the `connector_tokens` and `profile.strava_*`
columns.

**Strava developer app config:**
- App URL: https://www.strava.com/settings/api
- Client ID: (in Railway env as `STRAVA_CLIENT_ID`)
- Client Secret: (in Railway env as `STRAVA_CLIENT_SECRET`)
- Authorization callback domain: `www.faff.run`
- Callback URL (set in code via env): `STRAVA_OAUTH_REDIRECT`
- Scopes requested: `read,activity:read_all,activity:write`

**What Claude does:**
- Writes the OAuth flow handlers (`/api/auth/strava` route)
- Stores tokens correctly (writes to both `connector_tokens` AND
  legacy `profile.strava_*` columns for backwards compat)
- Refreshes expired tokens automatically (`lib/strava/auth.ts`
  `getStravaToken`)
- Handles 401 from Strava API with a "Reconnect Strava" CTA

**What only you can do:**
- Log into developers.strava.com with the Faff app owner account
- Change the requested OAuth scopes (e.g., adding `profile:write`)
- Rotate the client secret
- Change the callback domain (e.g., if faff.run ever changes)
- Approve any Strava API rate-limit / quota requests
- Reconnect your own Strava account when scopes change — important:
  **adding a new scope requires every user to re-OAuth** to pick up
  the new permission. Strava doesn't retroactively grant scopes on
  existing tokens.

**Gotcha: the 2026-05-27 401 fix.** Your `connector_tokens` row was
created before `activity:write` was added to the requested scopes.
Refresh tokens preserve original granted scopes, so every refresh kept
returning read-only tokens, and Strava upload kept 401-ing. Fix:
re-OAuth (now possible via the "Reconnect Strava" button on a failed
push). If this happens to a new user, same procedure.

---

## 5. Anthropic API

**What it is.** Anthropic API key powers the LLM-driven surfaces
(non-/today coach briefings, check-in text extraction when it returns).

**What Claude does:**
- Uses the API key via `process.env.ANTHROPIC_API_KEY`
- Prompt caching enabled where it helps
- Logs token usage to `coach_usage` table for cost tracking
- The `/today` surface is now deterministic — no Anthropic calls
- Other surfaces still call Anthropic

**What only you can do:**
- Log into console.anthropic.com
- Generate a new API key
- Set the key in Railway env (`ANTHROPIC_API_KEY`)
- Set spend limits in the Anthropic console
- Pay the bill / handle billing
- Approve any model access changes (e.g., new Sonnet versions)

**Cost monitoring.** `coach_usage` table has token + spend per call.
Claude can write a `/api/admin/usage` endpoint for you to spot-check.
For real billing data, the Anthropic console is canonical.

**Rotation.** If a key is compromised:
1. Generate new key in Anthropic console
2. Set new value in Railway env
3. Old key auto-revokes within ~5 min (or revoke manually in console)

---

## 6. Apple Developer + TestFlight

**What it is.** The iPhone app (`native-v2/`) ships through TestFlight.
Requires Apple Developer Program membership ($99/yr) and a signing
identity.

**Apple Developer setup (one-time, already done):**
- Apple Developer account: enrolled
- Team ID + signing cert in Xcode
- App ID: `com.faff.app` (or whatever's registered)
- Provisioning profiles: auto-managed by Xcode
- App Store Connect listing: created

**What Claude does:**
- Writes SwiftUI code in `native-v2/`
- Updates Info.plist as needed (HealthKit usage strings, etc.)
- Tells you when a new build is ready to submit
- Cannot build, sign, or upload — Xcode + Apple ID required

**What only you can do:**
- Open the project in Xcode
- Product → Archive (builds the .ipa)
- Window → Organizer → Distribute App → App Store Connect → Upload
- Wait for App Store Connect to process the build (~5-15 min)
- Add the build to TestFlight internal/external testers
- Submit for App Store review (if doing a real release, not just TF)

**TestFlight flow:**

| Step | Where | How |
|---|---|---|
| 1. Bump build number | Xcode → project settings | Increment "Build" |
| 2. Archive | Xcode → Product → Archive | Wait for build |
| 3. Upload | Organizer → Distribute App → App Store Connect | Sign + upload |
| 4. Wait for processing | App Store Connect | ~5-15 min |
| 5. Internal testers | App Store Connect → TestFlight → Internal Testing | Add build |
| 6. Push to testers | Same, click `+` on the build | Auto-delivers |

**Crash logs.** When a build crashes:
- App Store Connect → TestFlight → Crashes
- Xcode → Organizer → Crashes tab (symbolicated)
- Paste relevant crash log into chat; Claude diagnoses

**Watch app.** The Watch target ships as part of the same build. No
separate TestFlight flow. Same archive includes both.

---

## 7. Apple HealthKit entitlements

**What it is.** Reading sleep / HRV / RHR / VO2 / workouts from
HealthKit requires entitlements and Info.plist usage strings. Writing
workouts also requires entitlements.

**Setup (one-time, already done):**
- HealthKit capability enabled on the App ID
- `NSHealthShareUsageDescription` in Info.plist (read)
- `NSHealthUpdateUsageDescription` in Info.plist (write)
- Watch app: same entitlements separately
- HealthKit privacy strings reviewed by Apple at submission

**What Claude does:**
- Writes the HealthKit read/write Swift code
- Updates Info.plist usage strings when text needs to change
- Tells you when a new data type is being requested

**What only you can do:**
- Enable / disable specific HealthKit data types in the App ID config
  (developer.apple.com → Certificates, Identifiers & Profiles)
- Approve the entitlements at App Store submission review
- Change the usage description strings shown to end users (Claude can
  draft them, you sign off)

---

## 8. Domain & DNS (faff.run)

**What it is.** `faff.run` is the production domain. `www.faff.run`
points at Railway. The root `faff.run` redirects to `www`.

**What Claude does:**
- Knows the prod URL is `https://www.faff.run`
- Tests endpoints against that URL
- Does NOT touch DNS

**What only you can do:**
- Log into the domain registrar (wherever you bought faff.run)
- Update DNS records (CNAME `www` → Railway target, etc.)
- Add new subdomains (e.g., `api.faff.run` if ever needed)
- Renew the domain registration
- Configure SSL certs (Railway auto-provisions Let's Encrypt for
  www; you'd configure on the registrar side for anything else)

**If `www.faff.run` stops resolving:**
1. Check registrar — domain expired?
2. Check Railway domain config — is `www.faff.run` still attached
   to the service?
3. Check DNS propagation: `dig www.faff.run`

---

## 9. GitHub repo + branches

**What it is.** Code lives at `github.com/DavidNitzsche/runcino`. `main`
is the working branch; everything ships from there.

**What Claude does:**
- Commits to `main`
- Pushes to `main` (always — see memory)
- Never force-pushes to main
- Never deletes branches
- Creates PRs when explicitly asked (rare — David's workflow is
  direct-to-main)

**What only you can do:**
- Manage GitHub access (add/remove collaborators)
- Approve any PRs from external contributors (if/when)
- Manage branch protection rules
- Rotate any GitHub tokens used by CI/CD

**If you need to revert a bad commit Claude made:**
```bash
git revert <commit-sha>
git push origin main
```
or for the last commit only:
```bash
git revert HEAD
git push origin main
```
Don't `git reset --hard` and force-push — keeps history honest.

---

## 10. Emergency procedures

### Site is down

1. **Railway status.** railway.app/status or hit the service in the
   Railway dashboard. If it's down on their end, wait it out.
2. **Recent deploy broke it.** Roll back: Railway → Deployments →
   previous green deploy → `Redeploy`. ~30s to restore.
3. **DB connection.** If logs show `connection refused` or similar,
   check `DATABASE_URL` is still set correctly. Railway shouldn't
   change it but bumps happen.
4. **Domain.** If `www.faff.run` doesn't resolve, DNS issue at the
   registrar.

### Strava push broken for all users

1. Check Strava developer dashboard for any app-level alerts (rate
   limit exceeded, terms violation, etc.)
2. Try a manual push test with the curl in `lib/strava/push.ts`
   comments
3. If the client secret was rotated and not updated in Railway env,
   that's the cause — sync them

### Coach voice posting wrong / hallucinating

- /today is deterministic now (2026-05-27); shouldn't hallucinate
- If you see drift on /today, the template branch is wrong — file in
  chat with the actual brief text + the state
- For other surfaces (still LLM): check Anthropic API status, check
  `coach_usage` table for unusual token spikes

### Database corruption / data loss

1. **Don't panic.** Railway has automatic daily backups.
2. Railway dashboard → Postgres → `Backups` tab
3. Restore from the most recent backup (will revert data to that point)
4. Anything between the backup and now is lost — accept it or try to
   reconstruct from Strava/HealthKit re-sync

### Anthropic spend spike

1. Anthropic console → Usage → check for unusual call volumes
2. If runaway: pull the `ANTHROPIC_API_KEY` from Railway env (sets it
   to empty → all LLM calls fail gracefully → coach renders "paused"
   message)
3. Investigate the spike (probably a stuck cron, runaway brief regen)
4. Restore key once fixed

---

## 11. Credential rotation schedule

| Credential | Where | Rotation frequency | Last rotated |
|---|---|---|---|
| Anthropic API key | Anthropic console | Annual or on suspicion | unknown |
| Strava client secret | developers.strava.com | Annual or on suspicion | unknown |
| Postgres password | Railway auto-managed | Auto on Railway service restart sometimes | n/a |
| DEFAULT_USER_ID (env) | Railway env var | Never (it's your UUID) | n/a |
| Apple signing cert | Apple Developer | Annual (Apple expires them) | check Xcode |
| Domain registration | Registrar | Annual | check registrar |

**No automated rotation.** Set calendar reminders for Apple cert + domain.

---

## What Claude prepares before handing off to you

For any handoff, Claude provides in chat:

1. **What you're doing** in one sentence
2. **Where you're doing it** (which dashboard / which terminal)
3. **Exact value to paste** (env var value, SQL to run, etc.)
4. **What to verify** after (URL to hit, log line to look for)

Example of a clean handoff:

> "Set `STRIPE_WEBHOOK_SECRET=whsec_xxx` in Railway env (Variables tab),
> then trigger a deploy. After it's live, hit `https://www.faff.run/api/stripe/health`
> — should return `{ "ok": true, "webhook": "verified" }`."

If Claude says "you need to do something" without those four pieces,
ask Claude to write the handoff properly.
