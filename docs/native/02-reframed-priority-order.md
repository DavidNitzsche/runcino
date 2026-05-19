# Reframed priority order · watch primary, iPhone bridge

Supersedes the priority section of [`../api/iphone-integration-brief.md`](../api/iphone-integration-brief.md).
The original brief assumed iPhone was the primary surface; David's
reframe clarified that **the Apple Watch is the actual product
surface** and iPhone is the bridge.

## Why this matters

The job-to-be-done that pulled "let's build native" into the
roadmap was: execute structured workouts without translating them
in my head while running.  That job lives on the wrist, not the
phone.  The phone's most important role becomes:

1. Hold the auth token
2. Sync today's workout to the watch
3. Ingest HealthKit data (sleep, HRV, RHR, workout completions)
4. Surface coaching insights when David is sitting still, not running

iPhone is still first-class, but optimized for **review + planning**
rather than execution.  Web app keeps its role as the deep-work
surface for plan editing, race planning, and the full Coach Reads
breakdown.

Three surfaces, one intelligence stack:

```
                   ┌─────────────────────────┐
                   │   Backend (V6/V7/L7)    │
                   │   shared intelligence   │
                   └──┬──────────────────┬───┘
                      │                  │
              ┌───────▼────┐      ┌──────▼────┐
              │  iPhone    │      │  Web app  │
              │  · bridge  │      │  · deep   │
              │  · ingest  │      │    work   │
              │  · review  │      └───────────┘
              └───┬────────┘
                  │
              ┌───▼────┐
              │ Watch  │
              │  · run │
              │  · DO  │
              └────────┘
```

---

## Reframed priority order

### Phase 1 · Backend gap work (~2 weeks)

1. **Token auth** (`POST /api/auth/token` + refresh + revoke)
   - Unchanged · gates every authenticated request
   - ~3-5 days
   - Per [iPhone integration brief §What's missing](../api/iphone-integration-brief.md#whats-missing) for endpoint shape

2. **Workout-to-watch endpoint** (NEW · `GET /api/watch/today`)
   - Returns structured workout in watchOS-consumable shape
   - Phases array with type · duration · pace target · haptic cue
   - Shape locked in [watchOS scoping doc §Workout-to-watch payload](./01-watchos-scoping.md#workout-to-watch-payload-shape)
   - Different from the natural-language prescription used by the web/iPhone TodayCard
   - ~2 days

3. **HealthKit ingest** (`POST /api/health/ingest`) — MOVED UP
   - Bidirectional · reads sleep/HRV/RHR/weight from HealthKit · writes workout completions back
   - Without this, the watch app is one-way display only · with it, the data loop closes
   - ~1-2 days
   - Endpoint shape per [iPhone integration brief §HealthKit ingest](../api/iphone-integration-brief.md#2-healthkit-ingest-endpoint)

4. **Tier-2 → tier-1 lifts** — SHIFTED PRIORITY
   - Compose iPhone TodayCard from individual endpoints (`/api/profile/activity-gap`, `/api/health/readiness`, `/api/health/z2-coverage`, `/api/health/z2-sparkline`, `/api/races/[slug]/trajectory`, `/api/races/[slug]/projection`, `/api/adaptive/vdot-verdict`, `/api/profile/max-hr/validation`)
   - Defer SSR-envelope cleanup on web
   - ~2-3 days
   - Compounding value: each lift scales both iPhone and (eventually) web away from envelope pattern

5. **Naming-duplicate cleanups**
   - `/api/goal` vs `/api/goals` · `/api/race-retrospect` vs `/api/retrospective` · `/api/health/checkin` vs `/api/checkin`
   - 30-minute cleanup pass · fold into the tier-2 lifts (same files often touched)

### Phase 2 · watchOS app development (~3-4 weeks)

Gated on [watchOS scoping doc](./01-watchos-scoping.md) approval.

6. **iPhone bridge app · MVP**
   - SwiftUI single-screen "today's workout · push to watch"
   - WCSession sender + HealthKit ingest receiver
   - Token auth client
   - ~1 week

7. **watchOS app · v1**
   - Per scoping doc · phases timer + state machine first · HKWorkoutSession integration second · transition haptics third
   - ~2-3 weeks
   - Blocked periodically on physical-device testing turnaround

### Phase 3 · Deferred until after Phase 2 ships

8. **Push notifications** — deferred per reframe
   - APNs subscription + verdict-firing fan-out
   - Useful once the watch flow is settled · noisy without it
   - ~3-5 days when it lands

9. **Mobile OAuth + onboarding** — minimal scope
   - Single user (David) initially · onboarding can be a paste-in token in v0
   - Full mobile OAuth flow when there's a second user
   - ~1-2 days when it lands

---

## What this does to the API surface map

### Tier 1 promotion (when these ship)

The following become tier 1 stable public endpoints:

- `POST /api/auth/token` + refresh + revoke
- `GET /api/watch/today` · structured workout for watch
- `POST /api/watch/workouts/complete` · workout completion writeback (companion endpoint, simpler than HealthKit ingest)
- `POST /api/health/ingest` · HealthKit sample push from iPhone
- All 7 tier-2-to-tier-1 lifts from the iPhone integration brief

### Tier 2 shrinks slightly

The lifts (`/api/health/readiness`, `/api/races/[slug]/trajectory`,
etc.) move OUT of tier 2 as their tier-1 versions ship.  The web
app gets refactored opportunistically to consume the tier-1
endpoints; web's tier-2 SSR-envelope routes (`/api/overview`,
`/api/training`, etc.) remain in place until web is refactored
(long-term cleanup, not urgent).

---

## Mapping the reframe to surfaces

### What lives on the watch
- **Today's structured workout · live execution**
  - This is the watch's whole job · everything else defers

### What lives on iPhone
- **Today's workout (review form)** · before the run, full natural-language description
- **Quick-glance review surfaces** · readiness · gap state · adaptive banners
- **HealthKit settings + permissions**
- **Workout-to-watch sync trigger**
- **Post-run reflection · what happened, what to do tomorrow**

### What stays on web
- **Plan editing** · 14-week schedule, swapping workouts, restructuring blocks
- **Race planning** · RaceBuilder, GPX import, pacing strategy
- **Full Coach Reads breakdown** · all five panels, VDOT explainer, contributors
- **Retrospectives** · post-race analysis, splits, narrative
- **Settings + integrations** · Strava connection, shoe rotation, profile edits

iPhone is for daily-touch and execution-adjacent.  Web is for
deep-work and history.  Watch is for running.

---

## Honest scoping question David surfaced

> "watchOS development is real work you haven't scoped. iOS
> development is well-trodden — you can probably handle it credibly.
> watchOS is different SDK constraints, different UX patterns,
> different testing pain."

The scoping doc surfaces this directly in its [§Honest constraints
section](./01-watchos-scoping.md#honest-constraints--what-i-can-and-cannot-do).
Summary:

- **I can write watchOS code · I cannot test it on real hardware.**
  Every workout-session behavior, sensor reliability question, and
  battery profile observation requires David's device-testing.

- **The MVP scope deliberately picks features that minimize
  device-testing burden** · companion app (not standalone), pace
  targeting (not HR-zone-based execution), haptic transitions (not
  voice cues), no Maps integration.

- **Realistic estimate: 3-4 weeks of work calendar time** with
  blocked periods waiting on David's verification.

The question of "do you build it or does watchOS dev get handled
differently" is David's call after reading the scoping doc.  I can
do it; the cost is real, and there are alternatives (hire someone,
defer the watch indefinitely, build a simpler thing first).

---

## Decision sequence

1. **Read [practical setup](./00-practical-setup.md)** · start the
   long-lead-time work (Apple Developer enrollment, D-U-N-S if
   needed, Xcode setup).  3-5 days propagation.

2. **Read [watchOS scoping](./01-watchos-scoping.md)** · push back
   or approve the MVP scope.  Decide on the bundle ID name.
   Decide whether I'm the one writing the watch code.

3. **If approved · Phase 1 backend work begins** · token auth +
   workout-to-watch endpoint in parallel with practical-setup
   propagation.  Both unblock the iPhone bridge work.

4. **Round 7 deck closes Phase 1** · when token auth + watch
   endpoint + HealthKit ingest ship.

5. **Round 8 deck closes Phase 2** · when the watch app ships to
   TestFlight on David's wrist.
