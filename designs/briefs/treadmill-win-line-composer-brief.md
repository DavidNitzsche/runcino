# Brief · Backend · Treadmill-aware win-line composer

**For:** backend / coach-engine agent
**From:** iPhone agent
**Date:** 2026-06-01
**Status:** Optional follow-on to the treadmill ingest brief
(`designs/briefs/treadmill-backend-wire-brief.md`, shipped same day).
The iPhone-side wire is live in build 136+; per-phase actualSpeedMph,
actualInclinePct, and avgHr land in `runs.data.splits[]`. The win-line
composer (`lib/coach/run-win.ts` or wherever `RunRecap.win` is built)
is still pace-based, so treadmill sessions either fall through to a
null win line or get a slightly off-target outdoor-style line.

---

## TL;DR

Detect treadmill runs (`data.source === 'treadmill'` OR
`data.indoor === true`) and route them through a small set of
treadmill-specific win-line patterns based on speed adherence, incline
discipline, and rep build. Outdoor logic stays untouched. Null
fall-through is fine when none of the patterns fire (matches the
existing no-fabrication doctrine).

---

## Why bother

Build 136 lets a runner do a structured treadmill session (4x800 at
7.0 mph / 1.5% incline, etc.) and have it land in the runs table
correctly. The post-run sheet then shows the recap. Right now the
green win-line check that fires for outdoor runs ("Held the line ·
6:38 dead even") either:

- Doesn't fire (recap.win = null · the iPhone hides the green check
  and falls back to the regular body) · functional but flat
- Fires with outdoor pace language that mis-frames a treadmill run
  ("Negative split" doesn't mean much when you set the speed)

The recap surface is the single most-read coach voice moment per
session · the post-run sheet's headline. Getting it treadmill-aware
matches the runner's lived experience and reinforces "the coach is
paying attention to what I'm actually doing."

---

## Signals available on a treadmill run

From the per-phase `splits[]` array (the iPhone payload structure):

```ts
splits[i] = {
  mi: 1,
  label: "WORK 1",                     // phase label
  distanceMi: 0.78,                    // duration × speed / 3600
  durationSec: 360,                    // 6 min
  paceSecPerMi: 462,                   // 7:42/mi (60 / 7.8 mph)
  avgHr: 162,                          // live HK stream · null no watch
  maxHr: 174,                          // live HK stream · null no watch
  type: "work",                        // warmup | work | recovery | cooldown
  completed: true,                     // false if skipped
  actualSpeedMph: 7.8,                 // runner-input
  actualInclinePct: 1.5,               // runner-input
}
```

Three signals worth building patterns around:

### 1 · Speed adherence

Variance across the work phases · low CV (coefficient of variation
< 5%) means the runner held the prescribed speed steady through every
rep. High CV (> 10%) means they drifted or sped up partway through.

```ts
const workPhases = splits.filter(s => s.type === 'work' && s.completed)
const speeds = workPhases.map(s => s.actualSpeedMph).filter(Number.isFinite)
const meanSpeed = mean(speeds)
const cv = stddev(speeds) / meanSpeed
const heldSteady = cv < 0.05 && workPhases.length >= 2
```

### 2 · Incline discipline

Did they hold the prescribed incline (typically 1.0% for "outdoor
equivalence" per Daniels) or drop it mid-session?

```ts
const inclines = workPhases.map(s => s.actualInclinePct).filter(Number.isFinite)
const heldIncline = inclines.every(i => i >= 1.0)  // never dropped to flat
const climbed = inclines.some(i => i >= 3.0)        // hill simulation
```

### 3 · Rep build · speed-progressive intervals

Did each rep go faster than the last? (Negative-split rep workout.)

```ts
const speedsSorted = [...speeds]
const built = speeds.every((v, i) => i === 0 || v >= speeds[i - 1] - 0.05)
                  && speeds[speeds.length - 1] > speeds[0] + 0.2
```

### 4 · Disciplined recovery jogs

Recovery phases that didn't get hammered. Runner held planned
recovery speed (e.g. 5.0 mph) instead of running them at near-work
intensity.

```ts
const recovs = splits.filter(s => s.type === 'recovery' && s.completed)
const recovSpeedAvg = mean(recovs.map(s => s.actualSpeedMph).filter(Number.isFinite))
const targetRecovSpeed = ...derive from plan...
const disciplinedRecov = recovSpeedAvg <= targetRecovSpeed + 0.3
```

---

## Win-line patterns (priority-ordered · first one that fires wins)

```ts
function treadmillWinLine(splits, planned): string | null {
  const workPhases = splits.filter(s => s.type === 'work' && s.completed)
  if (!workPhases.length) return null  // recovery-only treadmill session

  const speeds = workPhases.map(s => s.actualSpeedMph).filter(Number.isFinite)
  const meanSpeed = mean(speeds)
  const cv = speeds.length > 1 ? stddev(speeds) / meanSpeed : 0
  const inclines = workPhases.map(s => s.actualInclinePct).filter(Number.isFinite)
  const meanIncline = mean(inclines)
  const heldIncline = inclines.every(i => i >= 1.0)
  const climbed = inclines.some(i => i >= 3.0)

  // 1 · Hill simulation — runner ran climbs on the treadmill
  if (climbed) {
    return `Held the climbs · ${fmt(meanIncline)}% average over ${workPhases.length} ${pluralize('rep', workPhases.length)}`
  }

  // 2 · Rep build — every rep faster than the last
  const built = speeds.every((v, i) => i === 0 || v >= speeds[i - 1] - 0.05)
              && speeds.length >= 3
              && speeds.at(-1)! > speeds[0] + 0.2
  if (built) {
    return `Building rep by rep · ${fmt(speeds[0])} → ${fmt(speeds.at(-1)!)} mph`
  }

  // 3 · Held the line — steady speed across all reps
  if (cv < 0.05 && speeds.length >= 2 && heldIncline) {
    return `Held the line · ${fmt(meanSpeed)} mph, steady incline`
  }

  // 4 · Disciplined recovery — recovery phases stayed easy
  const recovs = splits.filter(s => s.type === 'recovery' && s.completed)
  if (recovs.length >= 2 && workPhases.length >= 2) {
    const recovSpeedAvg = mean(recovs.map(s => s.actualSpeedMph).filter(Number.isFinite))
    if (recovSpeedAvg <= meanSpeed - 1.5) {
      return `Disciplined recovery jogs · the reps did the work`
    }
  }

  return null  // no pattern fired · iPhone shows the regular body
}
```

`fmt(x)` is your existing 1-decimal mph formatter.

---

## Where to plug in

`lib/coach/run-recap.ts` (or wherever `RunRecap.win` is composed) ·
guard treadmill-aware logic on `data.source === 'treadmill' ||
data.indoor === true`:

```ts
if (run.source === 'treadmill' || run.indoor === true) {
  const win = treadmillWinLine(run.splits, run.plannedWorkout)
  if (win) return { ...recap, win }
  // null fall-through · regular body renders without the green check
}
```

Outdoor pace-based win-line logic stays unmodified for non-treadmill
sources.

---

## Voice doctrine reminder

From `Design/running-app-design-brief.md` and prior win-line work:

- Short, direct, no hype
- No exclamation marks, no emoji, no em dashes
- Treadmill voice should feel mechanical-aware ("held the line",
  "the climbs") without sounding clinical
- Never fabricate · null beats a generic "Nice run" filler

The four patterns above are factual observations the runner could
have made themselves looking at the splits · the coach just surfaces
them faster.

---

## Test plan

1. **Steady 4x800 at 7.0/1.5%** · `cv < 0.05`, `heldIncline=true` →
   "Held the line · 7.0 mph, steady incline"
2. **Ladder 5/6/7/8 mph reps** · `built=true` → "Building rep by rep ·
   5.0 → 8.0 mph"
3. **5x400 with 4% incline** · `climbed=true` → "Held the climbs ·
   4.0% average over 5 reps"
4. **Hard reps with very easy recovery jogs** · `disciplinedRecov` →
   "Disciplined recovery jogs · the reps did the work"
5. **Drifted speeds (started 8.0, ended 6.0)** · no pattern fires →
   `null` (regular body renders)
6. **Outdoor run** · treadmill logic skipped entirely · existing
   pace-based composer runs

---

## Related

- Ingest brief (companion): `designs/briefs/treadmill-backend-wire-brief.md`
- iPhone wire-up: `designs/briefs/treadmill-wire-up-brief.md`
- Existing win-line composer (presumed): `lib/coach/run-recap.ts`,
  `lib/coach/run-win.ts`
- Source: `runs.data.source === 'treadmill'` or `runs.data.indoor === true`
- Per-phase fields preserved by backend: `actualSpeedMph`,
  `actualInclinePct`, `avgHr`, `maxHr`, `paceSecPerMi`, `completed`
