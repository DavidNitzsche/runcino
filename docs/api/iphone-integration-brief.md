# iPhone Integration Brief

S6 deliverable 3 · what the iPhone app needs from the Runcino backend.

This is the actionable output of the categorization.  It enumerates
the routes iPhone can use day-1, the routes that need iPhone-specific
equivalents, and the routes that don't exist yet but need to before
native development starts.

## What iPhone gets for free (tier 1 · ready to consume)

Every route in [`tier-1-stable-public.md`](./tier-1-stable-public.md)
is iPhone-callable with one constraint: **the auth shape needs to
change** (see [What's missing](#whats-missing) below).  Assuming
token-based auth is added, the following surfaces map directly:

### Profile screen (iOS)
- `GET/POST /api/profile/max-hr` — manual override + computed value
- `GET/POST /api/profile/resting-hr` — RHR value
- `GET/POST /api/profile/accent` — UI accent
- `GET/POST /api/profile/vo2-max` — HealthKit signal (wellness only)
- `GET /api/profile/writeback` + `POST /api/profile/writeback` — Strava sync trigger
- `POST /api/profile/acknowledge-pace-migration` — one-time banner dismiss
- `POST /api/profile/max-hr/validate/dismiss` — max HR banner dismiss
- `POST /api/profile/adaptive-vdot` — L7 verdict apply/dismiss
- `POST /api/profile/vdot-shift/action` — large-shift guard apply/snooze/dismiss

### Today screen (iOS hero)
- `GET /api/fitness` — pace zones, VDOT, HR bands
- `GET /api/plan/active` — active plan with today's workout
- `POST /api/plan/skip` — skip today's workout

### Races screen (iOS)
- `GET /api/races` — saved race list
- `POST /api/races` — create/update race
- `GET /api/races/[slug]` — race detail + actual result
- `POST /api/races/[slug]/priority` — mark A/B/C

### Health screen (iOS)
- `GET/POST /api/checkin` — daily check-in
- `GET/POST /api/recovery` — recovery activities
- `DELETE /api/recovery/[id]` — undo recovery entry

### Activity history (iOS)
- `GET /api/runs/[id]` — single run detail
- `POST /api/runs/[id]/shoe` — assign shoe to run
- `GET /api/runs/by-date` — date-range aggregations for charts
- `GET /api/strava/bests` — lifetime PRs

### Shoes screen (iOS)
- `GET/POST /api/shoes` — list + create
- `GET/POST/DELETE /api/shoes/[id]` — detail + update + soft-delete

### Activity gap surface (iOS hero)
- `GET /api/profile/activity-gap/mark` — record planned/injured/unexpected

### Connectors (iOS settings)
- `GET /api/connectors` — integration status
- `GET /api/connectors/[provider]/disconnect` — revoke
- `POST /api/strava/sync-me` — manual refresh trigger

That's ~30 tier-1 endpoints ready as-is once auth is solved.

---

## What's missing (build before iPhone work starts)

These don't exist yet.  Until they ship, iPhone development is
blocked on them.

### 1. Token-based auth endpoint
**Required for**: every authenticated request from iPhone.

Web uses cookie session auth.  Native clients can't share cookies with
the web app's browser session.  iPhone needs:

```
POST /api/auth/token
  Request: { email, password } OR { refreshToken }
  Response: { accessToken: string, refreshToken: string, expiresIn: number, user: { id, email } }
```

```
POST /api/auth/token/refresh
  Request: { refreshToken }
  Response: { accessToken, refreshToken, expiresIn }
```

```
POST /api/auth/token/revoke
  Request: { refreshToken }
  Response: { ok: true }
```

Then `requireActiveUser` needs to accept `Authorization: Bearer <token>`
in addition to cookie session.  This is the single biggest piece of work
before iPhone integration; touch surface is small but it gates every
authenticated request.

**Suggested storage**: `user_refresh_tokens` table — `(id, user_id, token_hash, created_at, last_used_at, revoked_at)`.

### 2. HealthKit ingest endpoint
**Required for**: passive HR / sleep / VO2max data flowing in from iOS.

```
POST /api/health/ingest
  Auth: token (Bearer)
  Request: {
    samples: [{
      type: 'resting_hr' | 'sleep_hours' | 'vo2_max' | 'workout_hr_avg',
      value: number,
      dateISO: string,
      source: 'apple_health' | 'garmin' | ...,
    }]
  }
  Response: { ok: true, ingested: number }
```

Today, `/api/profile/resting-hr` is manual-write only and `vo2-max`
is single-value.  iPhone needs to push HealthKit samples in batches.
Server-side: routes the samples to the appropriate column or table
(profile.rhr for RHR, profile.vo2max_apple for VO2max, etc.) with
data-quality checks.

### 3. Push notification subscription
**Required for**: notifying iPhone of L7 verdicts, large-shift guards, race-day reminders.

```
POST /api/notifications/subscribe
  Auth: token
  Request: { deviceToken: string, platform: 'ios' }
  Response: { ok: true, subscriptionId }
```

```
POST /api/notifications/unsubscribe
  Auth: token
  Request: { subscriptionId }
  Response: { ok: true }
```

Server-side: store APNs device tokens against `user_id`.  Hook into
verdict-firing flows (when AdaptiveVdotBanner would render or
VdotShiftBanner crosses threshold) to fan out push notifications.

### 4. Mobile Strava OAuth flow
**Required for**: connecting Strava from iPhone.

Web uses redirect-based OAuth (`/api/strava/connect` → Strava authorize
→ `/api/strava/callback`).  iOS native flow should use
`ASWebAuthenticationSession`, which means the callback returns to a
custom URL scheme rather than a web path.

```
POST /api/strava/connect/mobile
  Auth: token
  Request: { redirectScheme: 'runcino://strava-callback' }
  Response: { authorizeUrl: string, state: string }
```

```
POST /api/strava/callback/mobile
  Auth: state cookie OR Bearer token
  Request: { code, state }
  Response: { ok: true, connector: { id, status } }
```

Same token exchange + connector_tokens write as the web flow, but
JSON response instead of redirect.

### 5. Onboarding via API (not form)
**Required for**: first-launch iPhone signup flow.

```
POST /api/onboarding/complete/mobile
  Auth: token
  Request: { name, age, sex, location, runner_since_year, max_hr?, vdot?, ... }
  Response: { ok: true, user }
```

Same business logic as `/api/onboarding/complete` (tier 2) but accepts
JSON body and returns the full user object instead of redirecting.

---

## What needs redesign (tier 2 endpoints iPhone shouldn't reuse)

These exist and work, but for web SSR.  iPhone should build granular
equivalents.

### `/api/overview` (the big envelope)

Currently returns 14 fields packed for `/overview` SSR.  iPhone should
NOT reuse this shape — too coupled to web's render needs.  Instead, the
Today screen should compose from:

- `GET /api/fitness` — pace zones
- `GET /api/plan/active` — today's workout
- `GET /api/profile/activity-gap` — gap state (need to extract from `computeStravaGap` into a tier-1 GET endpoint)
- `GET /api/checkin?date=today` — today's check-in (if present)
- `GET /api/health/readiness` — readiness score (need to extract from `computeReadinessScore` into a tier-1 GET endpoint)

The latter two are gaps — `/api/profile/activity-gap` and `/api/health/readiness` don't exist today as standalone GETs.  Adding them would let iPhone compose Today without the envelope.

### `/api/training`, `/api/log`, `/api/health`, `/api/profile`, `/api/races-page`

Same shape as `/api/overview`: large SSR envelopes.  iPhone's analogous
screens should compose from tier-1 endpoints.  The list above already
covers most data needs; missing tier-1 endpoints are documented in the
next section.

### `/api/coach/today`

Returns a coach-tinted summary with citations.  Legacy from Stage 3;
iPhone should compose from `/api/fitness` + `/api/plan/active` + the
adaptive-banner endpoints instead, which give the same information with
clearer source-of-truth boundaries.

---

## Tier-1 gaps to fill (lift from tier 2)

These computations exist server-side but aren't exposed as tier-1
endpoints.  Worth extracting before iPhone integration:

### `GET /api/profile/activity-gap`
Currently `computeStravaGap()` runs inside `/overview` SSR.  Extract
into a standalone tier-1 GET:

```
GET /api/profile/activity-gap
  Auth: cookie OR token
  Response: {
    state: 'silent' | 'e4-3to4' | 'e4-5to7' | 'e1-8to14' | 'e1-15plus',
    daysSinceLastRun: number | null,
    lastRunDate: string | null,
    mark: 'planned' | 'injured' | 'unexpected' | null,
    markedAt: ISO | null,
    signalsSuspended: boolean,
    plannedBreakActive: boolean,
  }
```

### `GET /api/health/readiness`
Currently `computeReadinessScore()` runs inside `/overview` SSR.

```
GET /api/health/readiness?date=ISO
  Auth: cookie OR token
  Response: {
    score: number | null,
    state: 'green' | 'yellow' | 'red',
    recommendation: string,
    inputs: [{ name, delta, note }],
    missingInputs: string[],
    suppressReason?: 'injured' | 'no-data',
    crossRef?: { text, href },  // V7 V5→C6
  }
```

### `GET /api/health/z2-coverage`
V5 Z2 stimulus check.  Currently inside `/overview` SSR.

```
GET /api/health/z2-coverage
  Auth: cookie OR token
  Response: {
    shouldRender: boolean,
    suppressReason?: 'no-hrr-framework' | 'too-few-runs' | 'z2-share-ok' | 'race-week' | 'post-race-recovery' | 'no-data' | 'injured',
    z2CeilingBpm: number | null,
    ePaceRangeDisplay: string | null,
    last7d: { easyRunCount, runsInZ2, easyMiles, z2Miles, z2SharePct },
    last28d: { z2Miles, easyMiles, z2SharePct },
    thresholdUnderReach: { date, name, paceDisplay, avgHr, z4FloorBpm } | null,
  }
```

### `GET /api/health/z2-sparkline`
C2 sparkline.  Today only consumed by `/profile` Coach Reads SSR.

```
GET /api/health/z2-sparkline
  Auth: cookie OR token
  Response: {
    z2Band: { lo, hi } | null,
    points: [{ weekStartIso, paceSPerMi, z2Miles, workoutCount }],
    paceRange: { min, max } | null,
    hasSignal: boolean,
    crossRef?: { text, href },  // V7 suspect-ceiling → sparkline
    recalibrationHedge?: string,
  }
```

### `GET /api/races/[slug]/trajectory`
V3 trajectory.  Currently inside `/races` SSR.

```
GET /api/races/[slug]/trajectory
  Auth: cookie OR token
  Response: {
    state: 'ahead' | 'on-track' | 'behind' | 'collecting-evidence',
    signals: { s1, s2, s3 },
    headline: string,
    falsifier: string,
  }
```

### `GET /api/races/[slug]/projection`
C9 race projection chart data.

```
GET /api/races/[slug]/projection
  Auth: cookie OR token
  Response: {
    weeksToRace: number,
    currentVdot: number,
    goalVdot: number | null,
    goalFinishS: number,
    distanceMi: number,
    points: [{ weekIdx, maintainVdot, planVdot, maintainFinishS, planFinishS }],
    hasMeaningfulPlanTrajectory: boolean,
  }
```

### `GET /api/adaptive/vdot-verdict`
The L7 verdict surface.  Currently inside `/profile` SSR.

```
GET /api/adaptive/vdot-verdict
  Auth: cookie OR token
  Response: {
    kind: 'no-finding' | 'insufficient-data' | 'race-week-suspended' | 'vdot-bump-suggested' | 'vdot-downgrade-investigate',
    currentVdot: number,
    dismissed: boolean,
    manualOverride: number | null,
    suggestedVdot?: number,
    suggestedDeltaPoints?: number,
    evidence?: [...],
    reason?: string,
    falsifier?: string,
    crossRef?: { text, href },  // V7 Signal 4 → VDOT
  }
```

This is the most adaptive-state-laden endpoint we'd add.  Worth
investing in carefully; the `kind` discriminator is the contract iPhone
relies on.

### `GET /api/profile/max-hr/validation`
Already exists as a POST (`/api/profile/max-hr/validate`).  Rename to
GET (no side effect) and add to tier-1 for iPhone.  Today's POST shape
becomes a documented dual.

---

## Suggested S6 follow-on work order

If the iPhone phase is the next priority:

1. **Auth token endpoints** (1 PR, ~3-5 days) — unblocks everything.
2. **Lift tier-2 computations to tier-1 GETs** (1-2 PRs, ~2-3 days) — each is mechanical: existing helper functions wrap as route handlers.
3. **HealthKit ingest endpoint** (1 PR, ~1 day) — additive; doesn't touch existing routes.
4. **Push notifications subscription + fan-out** (2 PRs, ~3-5 days) — APNs integration + verdict-firing hooks.
5. **Mobile OAuth flow** (1 PR, ~2 days) — additive; web flow unchanged.
6. **Mobile onboarding** (1 PR, ~1 day) — JSON twin of existing route.

Rough total: ~2 weeks of backend work before iPhone client can be
meaningfully developed.

---

## Open product question

The categorization itself doesn't answer the open question of whether
iPhone is **the primary surface** with web becoming administrative, OR
**a coherent second surface** of the same product.

What this brief surfaces is the **architectural shape under either**:

- **Same product, two surfaces** → keep tier-2 web routes; build tier-1
  GETs alongside.  Both surfaces consume the same tier-1 layer.  Web
  retains its SSR envelopes for fast page loads; iPhone uses granular
  endpoints for fluid native UX.

- **iPhone primary, web administrative** → tier-2 web routes shrink to
  admin-tooling shape over time.  Tier-1 endpoints become the primary
  interface for the runner-facing surfaces; web becomes a thinner
  wrapper around them (or refocuses on operational/coach-facing
  views).

Either way, the work in [What's missing](#whats-missing) and
[Tier-1 gaps to fill](#tier-1-gaps-to-fill-lift-from-tier-2) is shared
foundation.  The categorization decouples that decision from this work.
