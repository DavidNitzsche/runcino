# Brief · iPhone · Daily device timezone ingest

**For:** iPhone agent
**From:** backend
**Date:** 2026-06-01
**Status:** Ask · unblocks jet-lag confounder detection on readiness

---

## Context

Research/12 §travel: "1 timezone = 1 day jet lag · performance dips
10-15% per zone for 3-5 days." When a runner travels, their readiness
score reads low not because of training fatigue but because of
circadian disruption. Without timezone awareness, the engine flags a
false "back off" recommendation.

Backend has columns to read tz (`users.timezone` and `profile.timezone`)
but nothing writes to them. They've been null for every user since
day one. No time-series history exists.

---

## What we need

A nightly write of the device timezone to a new time-series:

```
sample_type = 'device_timezone'
value       = (text-encoded UTC offset in minutes, e.g. -420 for PT, -240 for ET)
sample_date = today
recorded_at = NOW()
```

OR a simpler scheme on a new column:

```
profile_timezone_snapshots {
  user_uuid uuid,
  snapshot_date date,
  iana_tz text,       -- 'America/Los_Angeles'
  utc_offset_min int, -- -420
  PRIMARY KEY (user_uuid, snapshot_date)
}
```

iPhone agent's call on storage shape. Backend will adapt the reader.

---

## Cadence

Once per day, when the app boots or backgrounded > 6h. Tied to
`Calendar.current.timeZone` or `TimeZone.current` in Swift. Cheap
write · just an int + a date.

---

## What backend will do once data flows

Build `lib/coach/jet-lag.ts`:
- Read last 7 days of timezone snapshots for the user
- Detect zone changes: if today's offset differs from 3 days ago by
  ≥ 60 min, that's a timezone change
- Compute "days into jet lag" = days since change (clamped to 5)
- Surface on readinessBrief envelope:
  ```ts
  jetLag: {
    daysIntoJetLag: number;     // 1-5
    zonesShifted: number;       // 1+ tz crossed
    direction: 'east' | 'west'; // east is harder per doctrine
  } | null
  ```
- Engine adjustments:
  - Suppress "back off" recommendations during jet lag window
  - Add explanatory note to readiness headline ("Score reading low ·
    expected · day 2 of 5 of jet lag")
  - Don't penalize a low HRV reading against streak detection

---

## Privacy

Storing only the offset minutes (or IANA name) is fine · no location.
The runner's timezone is already inferred by Apple from device.

---

## Priority

Low/medium. Most runners don't travel during a training block, so
this affects a small fraction of users. But for those it affects, the
engine currently lies to them about why they're tired.

Bump after sleep stages + active energy + menstrual cycle. Not
blocking anything else.

---

## How to respond

1. Confirm storage shape preference (sample row vs new table).
2. PR link when shipped · backend will smoke against fresh snapshots
   landing in the chosen storage.

---

## Related

- `lib/coach/readiness-brief.ts` · the composer that will surface
  jetLag field
- `designs/briefs/iphone-health-ingest-expansion-brief.md` · the
  parallel sleep/cycle/energy brief
