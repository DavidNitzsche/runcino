# Tier 2 · Web-app-internal

Routes that exist to power Next.js server components or web-only flows.
**Do not consume from iPhone.**  Each row marks WHY it's tier 2 — useful
context for designing iPhone-specific equivalents.

## SSR page bundles

These return wide envelopes optimized for one page's SSR pass.  iPhone
should build granular requests using tier-1 endpoints, not consume
these.

| Route | Page | Why tier 2 |
|---|---|---|
| `GET /api/overview` | `/overview` | 14-field envelope · iPhone uses granular tier-1 endpoints |
| `GET /api/training` | `/training` | Plan + proofSessions + trajectory bundle |
| `GET /api/log` | `/log` | Heatmap + PR + recent runs bundle |
| `GET /api/health` | `/health` | Checkin + recovery + wellness bundle |
| `GET /api/profile` | `/profile` | Identity + PRs + goals + engine bundle |
| `GET /api/races-page` | `/races` | Race list + stats bundle |
| `GET /api/coach/today` | various | Coach narrative + workout (Stage 3 wired, no Anthropic call) |
| `GET /api/brief` | TBD | Daily briefing generator — usage not surfaced yet |

## Auth (cookie-based — won't work from native)

| Route | Method | Why tier 2 |
|---|---|---|
| `POST /api/auth/login` | password + cookie | Native iPhone needs token-based auth endpoint |
| `POST /api/auth/signup` | password + cookie | Same |
| `GET /api/auth/me` | cookie check | Same |
| `POST /api/auth/logout` | cookie clear | Same |
| `POST /api/onboarding/complete` | cookie | Onboarding flow is web-only today |

## Strava OAuth (browser-only flow)

| Route | Method | Why tier 2 |
|---|---|---|
| `POST /api/strava/connect` | redirect to Strava | iPhone needs mobile OAuth flow (ASWebAuthenticationSession) |
| `GET /api/strava/callback` | OAuth code handler | Returns redirect, not JSON — iPhone needs a different shape |

## Plan management (currently web-form-driven)

| Route | Method | Why tier 2 |
|---|---|---|
| `GET /api/plan` | cookie | Tier-1 `plan/active` is the preferred surface |
| `POST /api/plan` | create | Lifecycle kickoff via web form; iPhone needs simpler create |
| `GET /api/plan-range` | cookie | Pulls N months of plan for `/plan` page |
| `GET /api/plan-week` | cookie | Single-week detail |
| `POST /api/plan-reset` | cookie | Destructive — wipes mutations, regenerates.  Admin-tier in spirit. |

## Race-builder (anonymous-friendly)

| Route | Method | Why tier 2 |
|---|---|---|
| `POST /api/build-plan` | optional auth | GPX + goal → pacing plan; designed for web RaceBuilder |
| `POST /api/extract-aid-stations` | optional auth | GPX → aid-station mile markers |
| `GET /api/elevation` | optional auth | GPX → elevation profile |
| `GET /api/weather` | optional auth | Forecast for race date/location |
| `GET /api/races/feasibility` | optional auth | Goal feasibility check — uses different fitness path than tier-1 race-feasibility |

## Race ops

| Route | Method | Why tier 2 |
|---|---|---|
| `POST /api/races/[slug]/rebuild` | optional auth | Rebuild single race plan through pacing pipeline |
| `POST /api/races/rebuild-all` | optional auth | Backfill every race through pacing pipeline (post-math change) |
| `GET /api/race-retrospect` | optional auth | Post-race analysis · pacing adherence + splits |
| `GET /api/retrospective` | optional auth | Suspected duplicate of `race-retrospect` — verify before promoting |

## Strava cache (used by SSR bundles)

| Route | Method | Why tier 2 |
|---|---|---|
| `GET /api/strava/activities` | optional auth | Paginated activity list — used by web pickers |
| `GET /api/strava/activity/[id]` | optional auth | Single cached activity |
| `POST /api/strava/sync` | none | Background full sync — used by webhook/cron only |
| `POST /api/strava/webhook` | webhook signature | Strava → us webhook receiver |

## Misc

| Route | Method | Why tier 2 |
|---|---|---|
| `POST /api/profile/edit` | cookie | Profile field updates (name, age, etc.) |
| `GET /api/profile/max-hr/validate` | cookie | Computes validation check; banner uses result |
| `POST /api/goal` | cookie | Goal create/update |
| `GET /api/goals` | cookie | Goal list |
| `GET /api/health/checkin` | optional auth | Alias for `/api/checkin` (backward compat) |
| `GET /api/fitness` (other path?) | — | See tier 1 |
| `POST /api/log` | cookie | Manual log entry (legacy) |
| `POST /api/checkin` (alt) | — | See tier 1 |

---

## Why tier 2, not tier 1

These routes work — they're not broken.  They're tier 2 because:

1. **Shape is optimized for web** · big envelopes packed to avoid waterfall fetches during SSR.  iPhone with proper async patterns wants finer-grained calls.
2. **Auth shape won't translate** · cookie session, OAuth redirect, webhook signatures.  Each needs a mobile-specific path.
3. **Lifecycle is web-form-shaped** · onboarding, plan-reset, race-rebuild assume an HTML form context.

The fix isn't to "make these tier 1."  It's to design iPhone-specific
endpoints alongside them, with the same data layer underneath.  See
[`iphone-integration-brief.md`](./iphone-integration-brief.md).
