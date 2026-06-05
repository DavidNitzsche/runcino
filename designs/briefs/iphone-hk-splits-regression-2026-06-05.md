# iPhone HK splits regression · per-mile data missing on canonical row

**Status**: NEEDS WIRING · iPhone agent investigation required
**Spotted**: 2026-06-05 — David's 6mi easy showed "No mile splits available." despite n_splits = 0 across all recent runs.
**Audit cite**: This is **not** a watch agent issue. The Faff watch sends per-phase data correctly. The regression is in the iPhone-side HK per-mile split derivation.

---

## What the runner sees

David's TODAY screen, post-run hero:

```
Easy done.                       ✓ ON PLAN
Easy 6.0 mi. Boring is good · that's the whole point of easy days.

MILE SPLITS                      avg 8:21/mi
No mile splits available.
```

`avg 8:21/mi` proves the total run data is intact (distance + duration). What's missing is the per-mile breakdown.

## What's actually in the DB

Today's run, in `runs` table, both rows:

| id | source | n_splits | first split shape |
|----|--------|----------|-------------------|
| -102539783518325 (canonical) | `watch`       | 1 | `{mi:1, _raw:{type:'work', label:'6.0 mi easy', hrSamples:[…]}}` — the legacy phase-stub |
| -2142575830045023 (merged)   | `apple_watch` | 0 | n/a — HK row has zero splits |

The watch row landed at **09:34am Pacific**, before fix `fe6ef28b` deployed at 10:13am — so it still has the old single-phase stub. That's expected and will self-heal on next run.

**The real problem is the HK row (-2142575830045023) writing `n_splits = 0`** — that's the row that's supposed to carry the real per-mile data.

## Historical pattern · 14-day window

```
2026-06-05  apple_watch  6mi   n_splits=0   ← today
2026-06-04  apple_watch  8mi   n_splits=0
2026-06-03  apple_watch  6mi   n_splits=0
2026-06-02  apple_watch  7mi   n_splits=0
2026-06-01  apple_watch  5mi   n_splits=0
2026-05-31  apple_watch  12mi  n_splits=0
2026-05-29  apple_watch  8mi   n_splits=0
2026-05-27  apple_watch  6mi   n_splits=5   ← worked
2026-05-26  apple_watch  8mi   n_splits=6   ← worked
2026-05-25  apple_watch  6mi   n_splits=6   ← worked
…
2026-05-17  apple_health 12mi  n_splits=12  ← worked (under old source label)
2026-05-15  apple_health 6mi   n_splits=6   ← worked
```

**The regression started somewhere between 2026-05-27 and 2026-05-29.** Source label also changed from `apple_health` → `apple_watch` in that window — likely related.

Older HK rows DID populate per-mile splits (May 15, 17, 25, 26, 27 all show full per-mile coverage). Something landed around May 28-29 that broke the derivation OR added a server-side filter that drops them silently.

## Smoking gun · validator dropping splits with 4.5-minute over-counts

Query of `runs.data->'splits_validation'` across recent runs shows the iPhone IS sending per-mile splits, but the server-side validator is dropping them on EVERY run. The `splits_unreliable=true` flag bleeds from the loser HK row into the canonical via the absorber:

```
2026-06-03  watch    n=6   unreliable=true   val={"deltaS":126,"durationS":3034,"splitsSumS":3160,"droppedCount":6}
2026-06-02  watch    n=7   unreliable=true   val={"deltaS":315,"durationS":3625,"splitsSumS":3940,"droppedCount":7}
2026-06-01  watch    n=5   unreliable=true   val={"deltaS":269,"durationS":2584,"splitsSumS":2853,"droppedCount":5}
2026-05-31  watch    n=12  unreliable=true   val={"deltaS":61, "durationS":5941,"splitsSumS":6002,"droppedCount":12}
2026-05-29  watch    n=1   unreliable=true   val={"deltaS":-66,"durationS":3955,"splitsSumS":3889,"droppedCount":7}
```

iPhone-derived per-mile splits **sum to 1-5 minutes MORE than the workout's `duration_sec`** — the validator drops them per its 5s tolerance, and the canonical row ends up with `splits = []` from the HK side. Watch-source splits (phase-derived stubs) get kept but are not per-mile data.

**This is exactly the pause-handling bug `78a10810` (`fix(hk/splits): pause-aware per-mile elapsed time + reconciliation guard`, task #188) was supposed to close** — the fix landed server-side and was paired with the iPhone brief `designs/briefs/iphone-split-pause-fix.md`. Either:

1. The iPhone TF build David's on (#156 per the sync ledger) DOESN'T have the buildRoutePayload pause-mask fix yet, OR
2. The fix shipped but only handles `HKWorkoutEvent.pause` / `.resume` and misses some other pause-source (e.g. auto-pause triggered by `pauseOrResumeInProgress`, treadmill walks-between-phases, watch face dismiss, etc.)

## Suspect causes (in order of likelihood)

### 1. Server-side validator dropping iPhone splits · CONFIRMED above

`web-v2/app/api/ingest/workout/route.ts:178-200` has a splits validator added 2026-06-03 that drops the splits to `[]` if their summed time differs from total duration by more than 5 seconds:

```ts
const splitsCheck = validateSplitsAgainstDuration(rawSplits,
  Number(body.duration_sec ?? body.moving_sec ?? 0));
if (!splitsCheck.reliable && rawSplits.length > 0) {
  console.warn(
    `[ingest/workout] dropping unreliable splits · user=${userId.slice(0,8)} ` +
    `client_workout_id=${body.client_workout_id} · ` +
    `splits_sum=${splitsCheck.splitsSumS}s vs duration=${splitsCheck.durationS}s ` +
    `(delta ${splitsCheck.deltaS}s)`,
  );
}
return {
  splits: splitsCheck.reliable ? rawSplits : [],
  splits_unreliable: !splitsCheck.reliable && rawSplits.length > 0,
  …
};
```

The validator was specifically added because iPhone-derived splits use **raw GPS timestamps without consulting `HKWorkoutEvent` pause/resume events**. When the runner pauses mid-mile, GPS keeps emitting samples but `workout.duration` excludes paused time — so the splits sum to more than total duration and get dropped.

**Check first**: query `runs` for rows from 2026-05-29+ where `data->>'splits_unreliable' = 'true'`. If the validator IS dropping every run, that's the cause.

**Permanent fix lives at**: `designs/briefs/iphone-split-pause-fix.md` (which task #188 closed as completed but maybe wasn't fully landed in the iPhone build that's currently in production).

### 2. iPhone HK importer no longer extracting per-mile (POSSIBLE)

If `validateSplitsAgainstDuration` returns `reliable: true` on an empty array (it does — see line 483-484: `if (!Array.isArray(splits) || splits.length === 0 || durationS <= 0) return { reliable: true, … }`), then the rejection wouldn't surface. iPhone might just be sending zero splits and the backend silently writes `splits: []`.

**Check next**: in `native-v2/Faff/Faff/HealthKitImporter.swift`, find the per-mile derivation function (probably `buildRoutePayload` or similar). Check that it still:
1. Iterates `HKWorkoutRoute` samples
2. Bins them by cumulative distance into 1-mile buckets
3. Emits `[{mile:1, pace:'M:SS', avgHr:N, paceSPerMi:N, …}, …]` on the `splits` field of the POST body
4. Respects `HKWorkoutEvent` pause/resume per the iphone-split-pause-fix brief

### 3. Source rename masking the regression (CONTRIBUTING)

The `apple_health` → `apple_watch` source label change broke the historical comparison. Older data is labeled `apple_health`; newer is `apple_watch`. Whatever code path used to write splits under `apple_health` may not have been brought forward into the new path.

**Check**: `git log -p --since='2026-05-25' --until='2026-05-30' -G "apple_health\|apple_watch" -- native-v2/ web-v2/app/api/ingest/`

## Suggested investigation flow

1. **Server-side**: query production for `splits_unreliable = true` count over last 14d. If high, it's the validator.
2. **Server-side**: query for `data->>'splits_validation'` to see the actual delta-vs-duration violations. If the delta is large (>30s), iPhone is sending splits but pause handling is broken. If null and `splits_unreliable = false`, iPhone is sending zero splits.
3. **iPhone-side**: open `HealthKitImporter.swift` `buildRoutePayload` (or equivalent). Verify it still produces the `splits[]` array on outgoing payloads.
4. **iPhone-side**: check that pause-aware per-mile (`78a10810`) actually shipped in the TF build David's on (#156 per the iPhone sync ledger).

## Backend tolerance

If iPhone wants to ship a permanent fix, the backend already accepts these split shapes in the `splits[]` array:

```ts
{ mile: 1, pace: '8:21', avgHr: 132, paceSPerMi: 501, elevDeltaFt: -2 }
{ mile: 1, paceSecPerMi: 501, distanceMi: 1.0, durationSec: 501, avgHr: 132 }
{ mile: 1, pace_s_per_mi: 501 }
```

The validator forgives sub-1mi tail splits (it multiplies pace × distanceMi). The 5s tolerance is the hard cap.

## Watch agent is fine

For the record — the watch sends per-phase data correctly. Single-phase easy/long runs produce 1 phase covering the whole run; multi-phase tempo/intervals produce N phases. Today's 6mi easy correctly has 1 phase with all 6mi rolled up. The watch fix `fe6ef28b` (10:13am today) stopped the watch endpoint from converting that 1 phase into a misleading `splits: [{mi:1, ...whole-run-stats}]` stub — so the path is clean for HK splits to take over.

The watch is doing its job. The iPhone HK ingest is the hop where per-mile is being lost.

---

**Cite for the audit ledger**: this regression is the iPhone-side counterpart to the multi-tenant audit's Pattern 1 ("missing data hidden by fallbacks"). The backend's `splits_unreliable` stamp on the run row IS the canonical signal — what's missing is a query of how often it's tripping.
