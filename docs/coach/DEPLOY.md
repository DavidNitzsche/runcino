# Deploy — full replace cutover

**Decision (David, 2026-05-25): full replace. No legacy fallback in production.**

`www.faff.run` builds from `web-v2/` as of this commit. The legacy app
remains in the repo at `legacy/web/` for reference but is not deployed.

## Domains

| Domain          | Builds from | When           |
| --------------- | ----------- | -------------- |
| `www.faff.run`  | web-v2      | now            |

That's it. Single deploy target.

## Railway

Root `railway.json` points at `web-v2/`. Next push to `main` triggers a
Railway rebuild against the new app. No console changes required — the
existing service just builds the new directory.

Required env vars (already set on Railway from the legacy deploy):
- `DATABASE_URL` — Railway pg, shared with v2
- `ANTHROPIC_API_KEY` — coach engine

## Database

All 4 v2 migrations (100-103) are already applied to prod:
- `check_ins` — §8.1 reply chip loop
- `coach_intents` — §8.6 acknowledgement log
- `course_library` + `races.course_geometry` — §8.2 GPX ingestion
- `learn_articles` — §8.5 reader

Schema is fully backward-compatible. Existing tables (profile, races,
training_plans, plan_weeks, plan_phases, plan_workouts,
strava_activities, health_samples, shoes) are unchanged.

## iOS

`legacy/native/Faff/Faff.xcodeproj` is the current TestFlight target.
To swap to v2:

```bash
brew install xcodegen  # if not already
cd native-v2
xcodegen generate
open Faff.xcodeproj
# Build + submit to TestFlight under the existing run.faff.app bundle id
```

The watch app at `legacy/native/Faff/FaffWatch Watch App/` ships
inside the legacy Xcode project — it stays in legacy and continues
working unchanged via the wire contract (see WATCH_CONTRACT.md).

When native-v2's Xcode project is built and TestFlight'd, point its
target at the watch source files in legacy/ to include the watch
app in the new build. (One-time setup in Xcode.)

## Rollback

If web-v2 in production breaks:

1. `git revert <the cutover commit>` (the one that flipped root configs).
2. `git push origin main` — Railway rebuilds from legacy/web.
3. ~5-10 minute outage during the rebuild.

The legacy code stays intact in /legacy throughout. Rollback is a
one-command operation if needed.

## Monitoring after cutover

Watch for:
- `/api/briefing` 500s (Anthropic API hiccups, prereq logic bugs)
- Empty `topics[]` arrays (LLM not following the schema)
- Voice eval FAIL exits in CI (`scripts/voice-eval/run.mjs`)
- `check_ins` table growth (reply chips actually being tapped)
- `coach_intents` for `profile_field_added` (gap input loop firing)

David is the primary user. Voice drift, broken loops, wrong data —
flag in conversation and we ship a fix.
