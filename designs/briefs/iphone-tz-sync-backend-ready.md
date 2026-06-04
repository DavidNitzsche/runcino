# Brief · iPhone · TZ sync (BACKEND READY)

**For:** iPhone agent
**From:** backend
**Date:** 2026-06-03
**Status:** Backend ready · ask iPhone to add 2 lines

---

## Context

David, 2026-06-03: *"why cant the app be in the users timezone? 100%
fail proof."* Backend just rolled out runner-TZ across 30+ "today"
callsites · server UTC was breaking the recovery panel, readiness
brief, ACWR, sleep streak, plan adapter, etc. for any runner not on
UTC. Live data fix landed for David (`profile.timezone =
America/Los_Angeles`).

For every NEW runner, the backend auto-populates `profile.timezone`
silently from the first sync payload that includes a `timezone` field.
No Settings UI · the watch + iPhone already know their TZ.

This brief is the 2-line change that turns auto-detect on for every
runner who pairs a device.

---

## What we need from iPhone

### 1 · Watch workout payload

`POST /api/watch/workouts/complete` body — add one field:

```diff
 {
   workoutId,
   startedAt,
   totalDistanceMi,
   totalDurationSec,
   ...
+  timezone: TimeZone.current.identifier,  // "America/Los_Angeles"
 }
```

### 2 · HealthKit sync payload

`POST /api/ingest/health` body — same field at the root level:

```diff
 {
+  timezone: TimeZone.current.identifier,
   samples: [
     { sample_type: "sleep_hours", value: 7.2, sample_date: "2026-06-03", recorded_at: "..." },
     ...
   ]
 }
```

That's it. Both routes already consume the field if present.

---

## Backend behavior (already deployed)

Per sync, backend calls `captureTimezoneFromDevice(userUuid, payloadTz)`:

- Validates the string is a real IANA name (`Intl.DateTimeFormat` throws
  on bad TZ → silent ignore)
- If `profile.timezone IS NULL` → writes it, invalidates the in-process
  cache, next read picks up the new value
- If `profile.timezone IS NOT NULL` → silent no-op (manual override
  stays sticky)

Watch workouts ALSO get a `timezone` field stored on the run row:
`runs.data->>'timezone'` · per-run granularity for travel-aware
recovery anchors (a run that happened in Tokyo stays tagged Tokyo even
if the runner is back home today).

---

## Future · vacation detection (not for this build)

Once `runs.data->>'timezone'` accumulates a few days of data per
runner, the engine can detect sustained TZ changes (≥48h foreign-TZ
syncs) and surface "you've been in Tokyo for 2 days · switch home
base?" That's a follow-on · this brief just lights up the auto-detect.

---

## Files touched (backend, already shipped)

- `lib/runtime/runner-tz.ts` · helper + `captureTimezoneFromDevice`
- `app/api/watch/workouts/complete/route.ts` · consumes `body.timezone`,
  stores on run row, calls capture
- `app/api/ingest/health/route.ts` · consumes `body.timezone`, calls
  capture
- (commits 1f21a0c5 → 0a98a133, deployed to Railway 2026-06-03)

Supersedes `iphone-timezone-ingest-brief.md` (2026-06-01 · proposed
a separate time-series; current shape is simpler · single column on
profile, plus per-run TZ on the run row).

---

## Test plan

- Pair a new watch · do a workout · verify `profile.timezone` populates
- Manually NULL out `profile.timezone` for a test user · sync HK
  samples · verify it auto-repopulates
- Set `profile.timezone = 'America/New_York'` manually · sync from a
  device reporting Pacific · verify the manual value stays (sticky)

---

## Citation

Doctrine: `lib/runtime/runner-tz.ts` header · single source of truth.
