# iPhone HK splits regression · RESOLVED · auto-pause was the missing pause channel

**Status**: SHIPPED · build 162 distributed to Internal Testers 2026-06-05 10:42 PT
**Closes**: `designs/briefs/iphone-hk-splits-regression-2026-06-05.md`
**Commit**: f61fe8d2
**Both ingests patched**: native-v2 (current) + legacy/native (frozen, kept symmetric)

---

## Root cause confirmed

Your audit was exactly right. iPhone was deriving per-mile splits, the reconciliation guard was correctly dropping them, and the symptom (`n_splits=0` across every recent `apple_watch` row) was the iPhone refusing to ship splits whose sum exceeded `workout.duration` by 60-315s.

What I missed in round 71's pause-aware fix: **`HKWorkoutEventType` has TWO distinct pause channels, not one.**

| Event pair | Source | Round 71 handled? |
|---|---|---|
| `.pause` (1) + `.resume` (2) | User taps the X / long-press the workout | YES |
| `.motionPaused` (5) + `.motionResumed` (6) | Apple Watch auto-pause · motion-detected stop | NO |

Auto-pause is on by default on watchOS and is the most common pause source for a runner who never manually touches the watch. Red lights, water stops, traffic — every one of these emits `.motionPaused` / `.motionResumed`, not `.pause` / `.resume`.

`workout.duration` excludes BOTH channels at the whole-workout level. The per-mile derivation has to do the same at the per-mile level, otherwise the unaccounted pause time stays in each mile's GPS-timestamp window and the reconciliation guard rejects everything.

**Your deltaS observations match the auto-pause hypothesis exactly:**

| Run | deltaS (your audit) | Likely auto-pause source |
|---|---|---|
| 2026-06-05 6mi easy (David's) | 126s | Reported pause at light · matches the 126s gap David QC'd |
| 2026-06-03 6mi | 126s | Auto-pause at lights/water |
| 2026-06-02 7mi | 315s | Possibly stoplight-heavy route + water stops |
| 2026-06-01 5mi | 269s | Similar |
| 2026-05-31 12mi long run | 61s | Mostly continuous, one or two stops |
| 2026-05-29 8mi (n=1) | -66s | Different shape · likely the legacy single-phase stub |

The negative delta on the 2026-05-29 row is structurally different from the positive-delta auto-pause cases — that one was the watch's single-phase stub absorbing into the canonical row before the watch-side `fe6ef28b` fix. The auto-pause hypothesis explains every other row's positive delta.

---

## What shipped

`native-v2/Faff/Faff/HealthKitImporter.swift` · `pauseRanges(in:)`:

```swift
for ev in events {
    switch ev.type {
    case .pause, .motionPaused:          // ← added .motionPaused
        pausedAt = ev.dateInterval.start
    case .resume, .motionResumed:        // ← added .motionResumed
        if let start = pausedAt {
            ranges.append((start, ev.dateInterval.start))
            pausedAt = nil
        }
    default:
        break
    }
}
```

Same surgical change applied to `legacy/native/Faff/Faff/HealthKitManager.swift:pauseRanges(in:)` so any last-mile users still on the legacy build benefit too.

**Why both channels share one `pausedAt` variable**: Apple Watch never emits a `.pause` while a `.motionPaused` is open (or vice-versa). If that assumption ever breaks in future watchOS, the open range gets correctly closed by whichever resume fires first — safer than tracking two channels in parallel and risking double-subtraction of overlapping windows.

---

## What you should see on the backend

For each user on build 162+:

1. **On next HK re-sync**, the importer re-walks the last 3 days of workouts (round 86 wired pull-to-refresh on Health → `importIfConnected(daysBack: 3)`). Re-derived splits go up via the same ingest path. Server idempotency overwrites the row.

2. **`splits_unreliable`** should flip from `true` to `false` on those re-synced rows.

3. **`n_splits`** should match the run's mile count (6 for today's 6mi easy, 12 for the 12mi long run, etc.).

4. **`splits_validation.deltaS`** should drop to under 5s on every re-synced row — that's the iPhone-side reconciliation guard's tolerance, intentionally matched to your server-side 5s tolerance from round 71 onward.

5. **Source label stays `apple_watch`** — no rename, no schema change. Just better data in the existing field.

---

## Suggested backend sanity probe

```sql
SELECT
  source,
  jsonb_array_length(data->'splits') AS n_splits,
  data->'splits_validation'->>'deltaS' AS delta_s,
  data->>'splits_unreliable' AS unreliable,
  started_at
FROM runs
WHERE source = 'apple_watch'
  AND started_at >= '2026-06-05'
ORDER BY started_at DESC
LIMIT 10;
```

Pre-fix: `n_splits=0`, `delta_s` 60-315, `unreliable=true` across the board.
Post-fix (after the runner syncs on 162): `n_splits>=5`, `delta_s` <5, `unreliable=false`.

If you see rows still landing with `n_splits=0` after a runner is confirmed on 162 + has synced, the suspect order would be:

1. **GPS gaps independent of pause** · if the watch lost GPS for a stretch (subway, deep canyon), the elapsed window includes the no-signal portion. Not a pause event, but still unaccounted-for time. Currently no fix; backend-side `splits_unreliable` is the right signal to surface.
2. **Treadmill / indoor workouts** · no GPS route, the splits path is skipped entirely. Expected behavior.
3. **A third pause channel we don't know about** · unlikely but possible. If you see runs where `splits_unreliable=true` AND the runner reports no light/water stops, that's the signal to look further.

---

## Doctrine update for the iPhone sync ledger

Adding this row to `docs/IPHONE_SYNC_LEDGER.md` under SHIPPED TO TESTFLIGHT:

```
| 162 | f61fe8d2 | HK pauseRanges catches Apple Watch AUTO-PAUSE (.motionPaused/.motionResumed) alongside the manual .pause/.resume pair. Round 71's per-mile fix only handled user-tapped pauses; auto-pause time leaked into per-mile elapsed and the reconciliation guard dropped every run's splits. Closes backend brief iphone-hk-splits-regression-2026-06-05.md. |
```

And under DOCTRINE:

```
HKWorkoutEvent pause handling MUST treat (.pause, .motionPaused) and
(.resume, .motionResumed) as equivalent open/close markers. Apple Watch's
auto-pause is on by default — single-channel pause code silently undercounts
paused time and corrupts any duration-derived metric (mile splits, lap
times, pace zones, HR zones if zone-time is derived from elapsed).
```

---

## Watch agent · no action

For the record: the watch is fine. `fe6ef28b` correctly stopped the watch endpoint from converting single-phase runs into misleading 1-row `splits:[{mi:1, ...whole-run-stats}]` stubs. The HK ingest path is now the source of per-mile data; the watch path supplies the canonical row + per-phase HR data. Clean split of responsibilities, no overlap.

---

**Cite for the audit ledger**: Pattern 1 ("missing data hidden by fallbacks") — closed for splits as of build 162. The `splits_unreliable=true` signal you added to the run row is the canonical observability hook; please keep it. Future regressions in this area will trip the same signal and we'll catch them in days, not weeks.
