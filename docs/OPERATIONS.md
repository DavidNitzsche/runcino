# Operations

Three things only Claude can't do. You handle them in their respective dashboards. Claude prepares the change, hands off, you execute.

---

## 1. Railway

**What it does.** Hosts the Next.js app (`web-v2/`) at `www.faff.run`. Auto-deploys on push to `main`.

**Auto-deploy is wired.** Every `git push origin main` triggers a Railway rebuild within ~2 min. Claude pushes; no manual action needed for normal deploys.

**Manual ops (your hands only):**

| Action | Where | How |
|---|---|---|
| **Check deploy status** | Railway dashboard → service → `Deployments` | Green = live, yellow = building, red = failed |
| **View logs** | Railway dashboard → service → `Logs` | Filter by deploy if needed |
| **Restart service** | Railway dashboard → service → `Settings → Restart` | ~30s downtime |
| **Roll back** | Railway dashboard → `Deployments` → click any prior green deploy → `Redeploy` | Instant |
| **Add / change env var** | Railway dashboard → service → `Variables` → `New Variable` (or edit existing) | Auto-triggers redeploy |

**Current env vars in prod:**

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (Railway-managed, don't touch) |
| `ANTHROPIC_API_KEY` | Coach LLM (non-/today surfaces) |
| `STRAVA_CLIENT_ID` | Strava OAuth — public app ID |
| `STRAVA_CLIENT_SECRET` | Strava OAuth — server secret |
| `STRAVA_OAUTH_REDIRECT` | OAuth callback URL — set to `https://www.faff.run/api/auth/strava?action=callback` |
| `DEFAULT_USER_ID` | Your UUID for single-user beta fallback |

**If Claude says "set X=Y in Railway":**
1. Railway dashboard → service → `Variables`
2. Edit existing or `+ New Variable`
3. Save (redeploys automatically)
4. Confirm the redeploy lands green in `Deployments` tab
5. Tell Claude to verify

---

## 2. Strava OAuth

**What it does.** Each user connects their own Strava via OAuth. The Faff Strava app is registered with Strava. Claude handles all the in-app OAuth flow code; you handle the Strava developer app config.

**Strava developer app config (one-time, already done):**
- URL: https://www.strava.com/settings/api
- Login as the Faff app owner
- App name: "Faff" (or whatever it's set to)
- Authorization Callback Domain: `www.faff.run`
- Scopes requested in code: `read,activity:read_all,activity:write`
- Client ID + Client Secret: copy into Railway env vars

**Manual ops (your hands only):**

| Action | Where | How |
|---|---|---|
| **Rotate client secret** | Strava settings → API → `New Secret` | Copy new secret → update Railway env → restart |
| **Change requested scopes** | Code-side, Claude does it | But: **every existing user must re-OAuth to pick up new scopes** — Strava doesn't grant scopes retroactively |
| **Change callback domain** | Strava settings → API → Authorization Callback Domain | Has to match what `STRAVA_OAUTH_REDIRECT` in Railway env points to |
| **Check API rate limit** | Strava settings → API → usage | 200/15min, 2000/day per app |

**The 401 gotcha (2026-05-27).** Older user tokens may have been issued before `activity:write` was added to scopes. They'll 401 on Strava upload forever. Fix: re-OAuth via the "Reconnect Strava" button on a failed push (already wired). If you ever change scopes again, every user needs to reconnect — no way around it.

**If a user reports Strava broken:**
1. Have them tap "Reconnect Strava" (appears on a failed push)
2. They re-OAuth, new token includes current scopes
3. Done

---

## 3. TestFlight (iPhone app)

**What it does.** Ships builds of the SwiftUI app (`native-v2/`) to TestFlight. Requires Apple Developer membership + signing cert. Claude writes Swift code; you build, sign, and upload via Xcode.

**One-time setup (already done):**
- Apple Developer account: enrolled ($99/yr)
- App ID: registered (`com.faff.app` or whatever it is)
- Signing cert: in Xcode
- HealthKit capability + usage strings: in Info.plist
- App Store Connect listing: created

**Standard release flow:**

| Step | Where | How |
|---|---|---|
| **1. Bump build number** | Xcode → project settings → General → `Build` field | Increment by 1 |
| **2. Archive** | Xcode → `Product → Archive` | Wait ~2-5 min for build |
| **3. Upload** | Xcode Organizer (auto-opens after archive) → select archive → `Distribute App → App Store Connect → Upload` | Sign with cert, ~2-3 min upload |
| **4. Wait for processing** | App Store Connect → TestFlight | ~5-15 min before build appears |
| **5. Send to testers** | App Store Connect → TestFlight → Internal Testing → click the build → add to group | Auto-delivers to all internal testers within minutes |

**Crash logs:**
- App Store Connect → TestFlight → Crashes tab
- Or Xcode → Organizer → Crashes tab (symbolicated)
- Paste relevant crash log into chat; Claude diagnoses

**Watch app:** ships in the same archive. No separate flow.

**If Claude says "ready to ship build N":**
1. Open Xcode
2. Bump build number to N
3. Archive → Upload (steps 1-3 above)
4. Once processed, push to internal testers
5. Confirm in chat; Claude continues with next batch

---

## How Claude hands off to you

For any of the three above, Claude provides in chat:

1. **What you're doing** in one sentence
2. **Where** (which dashboard / which app)
3. **Exact value to paste** (env var value, build number, etc.)
4. **What to verify** after (URL to hit, version to confirm)

If those four pieces aren't there, ask Claude to write the handoff properly.
