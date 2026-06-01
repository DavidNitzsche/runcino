# Brief reply · KEY WORKOUTS · trainingInfluence + adaptations dedup · LANDED

**From:** backend / coach-engine + plan-adapter
**To:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Shipped · live on main (`2b7b4889`)
**Brief:** `designs/briefs/key-workouts-training-trajectory-and-adapt-dedup-brief.md`

---

## What landed

Both fields exactly per the brief, on the existing seed shape. No
defensive frontend backstops needed — backend ships the conclusion.

### 1 · `trainingInfluence` per done quality/long workout

New field on `seed.season.weekDays[].days[]`:

```ts
trainingInfluence?: {
  kind: 'on_track' | 'consistent' | 'working' | 'slipping' | 'compromised';
  copy: string;
} | null;
```

Composer at `lib/coach/training-influence.ts` reads:

- Workout type → expected stimulus (`intervals`, `tempo`, `threshold`, `long`)
- Planned pace vs done pace (work-pace for quality, avg for long)
- HR-on-pace delta (≤ −4 bpm = "working" signal · genuine adaptation)
- Same-type streak (3+ same-type quality wins in a row = "consistent")
- Adapter state (`wasAdapted && !wasRestored` = "compromised")
- Race distance (trajectory anchored to goal)

Returns `null` on:
- Undone workouts
- Off-plan runs
- Non-quality types (easy/recovery/rest don't move trajectory in this panel)
- Missing pace data when not in compromised state

### Copy examples per kind

| Kind | Example |
|---|---|
| `on_track` | "Threshold pace hit. Race-pace work compounding." |
| `consistent` | "3 threshold workouts in a row. Aerobic stimulus building." |
| `working` | "Pace held with HR 5 bpm lower than usual. Aerobic engine sharper." |
| `slipping` | "Threshold pace 14s slow. Aerobic stimulus not landing." |
| `compromised` | "Threshold work eased. Cumulative tempo behind plan." |

No citations · doctrine lives in code comments, conclusion lives on screen.

### 2 · `adaptations[].supersededByOverride` · Option B

Each entry in `seed.season.adaptations` now carries:

```ts
supersededByOverride: boolean;
```

`true` when a later `plan_adapt_overridden` row exists for the same
`workoutId`. Logic is "most-recent intent wins per workoutId" — handles
the multi-bounce case (downgrade → restore → re-downgrade → restore again).

`plan_adapt_overridden` rows themselves are also emitted in the array
with `kind: 'overridden'` (newly allowed in the union) and
`supersededByOverride: false`. Frontend can render an Overrides history
view later without a backend re-ship.

**Filter pattern for the KEY WORKOUTS panel** (drops both stale
adaptations and override rows from the standard render path):

```ts
adaptations.filter(a => !a.supersededByOverride && a.kind !== 'overridden')
```

Restores the pre-restore semantics on the chip.

### Type extensions

```ts
// constants.ts (PlannedDay shape — already had this from prior brief)
// no changes here

// types.ts
season.weekDays[].days[].trainingInfluence?: { kind, copy } | null;
season.adaptations[].kind  // added 'overridden'
season.adaptations[].supersededByOverride: boolean;  // new required field
```

---

## What David sees on his restored Tue 6/02 workout

The Tue 6/02 row was downgraded to easy then will be restored when he
taps Restore Original. After the restore:

1. `coach_intents` has both rows:
   - `plan_adapt_downgrade` (ts T1) — the original downgrade
   - `plan_adapt_overridden` (ts T2, T2 > T1) — the restore

2. Backend emits adaptations as:
   ```ts
   [
     { workoutId, kind: 'downgrade', supersededByOverride: true,  ts: T1 },
     { workoutId, kind: 'overridden', supersededByOverride: false, ts: T2 },
   ]
   ```

3. Frontend filter drops both → no "Adapted: eased to easy" line on the chip.

4. trainingInfluence will land as `null` until the run is executed,
   then settle to `on_track` / `working` / `slipping` based on the
   restored threshold's actual pace.

---

## Doctrine reads

trainingInfluence doctrine the composer pulls (none surface as
citations — they shape the conclusion):

- Daniels §threshold density · threshold-pace work compounding
- Coggan TSS framework · workout stimulus calibration
- Plan phase context · BUILD weeks reward consistency, TAPER weeks
  reward freshness
- Same-type streak threshold of 3 — the point where one-off becomes
  pattern

The hr-on-pace-delta loader isn't wired in this commit (set to `null`
in the input). Same-type streak from `sameTypeStreakById` is wired
from chronological walk of done quality days. As HR data lands more
consistently, the `working` kind will fire more often. Tracked as a
follow-up below.

---

## Follow-ups

These would tighten the influence signal but aren't blocking:

1. **HR-on-pace delta wiring** — `composeTrainingInfluenceForDay`
   passes `hrOnPaceDelta: null` for now. Wire the existing
   `computeHrOnPaceDelta` (in lib/coach/run-state.ts) into a batch
   loader so the seed has all the deltas without an N+1.
2. **Phase context** — `phaseLabel: null` for now. Thread `plan_phases`
   into the day shape so "stimulus expectations differ by phase" copy
   variation lands.
3. **Influence variation by goal distance** — current copy is
   distance-agnostic. Could lean into "for a half marathon" or "for
   the marathon" copy when meaningful.

None of these block David's KEY WORKOUTS panel rendering correctly
today. They just make the copy more precise.

---

## Files touched

```
A  web-v2/lib/coach/training-influence.ts        (new composer · 175 lines)
M  web-v2/components/faff-app/seed.ts             (adaptSeason wiring)
M  web-v2/components/faff-app/types.ts            (field type extensions)
```

Commit: `2b7b4889` on `main`.

---

## How to verify

David's recent data has:
- 5/31 Sun: 12.4 mi long, done
- 5/27 Wed: 5.9 mi (counted as easy in plan, donePaceSec captured)
- 5/26 Tue: 7.6 mi (was a threshold workout per the plan)

The KEY WORKOUTS panel after this ships should:
- Show `working` or `on_track` on the long if pace held + HR was reasonable
- Show `compromised` on Tue 6/02 once it's in the past (after restore +
  whatever effort David puts in)
- Show NO "Adapted: eased to easy" stale line on the restored chip

---

## Related

- `designs/briefs/restore-original-workout-endpoint-landed.md` · the
  restore endpoint that writes `plan_adapt_overridden`
- `designs/briefs/no-citations-lock-and-restore-uuid-cast-landed.md` ·
  the no-citations rule applies here too (copy is conclusion-only)
- `web-v2/components/faff-app/views/TrainView.tsx` · the KEY WORKOUTS
  panel that consumes both fields
