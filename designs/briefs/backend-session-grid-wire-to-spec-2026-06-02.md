# Brief · Backend → Web · SESSION breakdown grid is hardcoded mock data

**From:** backend agent
**To:** web agent
**Re:** Today page SESSION grid mismatch (David flag 2026-06-02)
**Date:** 2026-06-02
**Status:** Web work outstanding · no backend code change needed

---

## TL;DR

David flagged: Today card title says **"4×1 mi @ I · 3 Min Jog"** but the
SESSION breakdown grid below it shows **"Warm-up 1.5 mi · 6 × 800 m @
2:55 · Cool-down 1.5 mi"**. Two different workouts on the same row.

Root cause · `web-v2/components/faff-app/constants.ts:42-46`:

```ts
intervals: [
  { l: 'Warm-up',     sub: '1.5 mi easy',         w: 18, c: '#14C08C' },
  { l: '6 × 800 m',   sub: '@ 2:55 · 400m float', w: 64, c: '#FC4D64' },
  { l: 'Cool-down',   sub: '1.5 mi easy',         w: 18, c: '#14C08C' },
],
```

These `SEGS` are hardcoded prototype data from the Faff design handoff
that **never got rewired** to read the real `workout_spec` jsonb from
`plan_workouts`. Every "intervals" day on Today renders that exact
6×800m breakdown regardless of what the engine actually prescribed.

---

## What to fix

Replace the constants.ts `SEGS` map lookup with a derive-from-spec
helper at the call site. Read `workout_spec` from the planned workout
row (already loaded into the today seed) and build the grid from its
structured fields.

### workout_spec shape · already on the row

The spec is plan_workouts.workout_spec jsonb. Structures vary by type:

```ts
// type: 'tempo'
{
  kind: 'tempo',
  warmup_mi: 2.0,
  tempo_distance_mi: 4.0,
  tempo_pace_s_per_mi: 408,    // seconds per mile
  cooldown_mi: 2.0,
  hr_target_bpm: 156,
}

// type: 'threshold' or 'intervals'
{
  kind: 'threshold' | 'intervals',
  warmup_mi: 1.5,
  rep_count: 4,
  rep_distance_mi: 1.0,        // newer rows
  rep_distance_m: 1000,        // older rows (metres · convert /1609.34)
  rep_pace_s_per_mi: 412,
  rep_rest_s: 60,              // jog rest between reps
  cooldown_mi: 1.0,
  lthr_bpm: 162,
}

// type: 'easy' / 'recovery' / 'long' / 'shakeout'
{
  kind: 'easy' | 'recovery' | 'long',
  pace_target_s_per_mi_lo: 525,
  pace_target_s_per_mi_hi: 575,
  hr_cap_bpm: 142,
  fuel_mi: [5, 9, 13],   // long-run fuel timings · only on 'long'
}
```

### Suggested render rules

| spec.kind   | Grid segments (left → right)                                        |
|-------------|----------------------------------------------------------------------|
| `tempo`     | Warm-up · Tempo block · Cool-down                                    |
| `threshold` | Warm-up · N × repMi (@pace · restS jog) · Cool-down                  |
| `intervals` | same shape as threshold · just differs in rep pace + rest seconds    |
| `easy`/`recovery`/`shakeout` | Single bar · "Easy aerobic · X mi @ paceLo-paceHi"     |
| `long`      | Single bar · "X mi @ longPace" + fuel marker dots at fuel_mi values  |
| `race`      | Single bar · "Race · X mi @ targetPace"                              |
| `rest`/`cross`/`strength`/null spec | No grid · show subLabel only                  |

### Width math

`SEGS[].w` is a percentage. Derive from real distance:

```ts
function specToSegments(spec, totalMi) {
  if (!spec || !totalMi) return null;
  const wu = Number(spec.warmup_mi ?? 0);
  const cd = Number(spec.cooldown_mi ?? 0);
  const coreMi = totalMi - wu - cd;
  return [
    { label: 'Warm-up',  sub: `${wu} mi easy`,                 w: Math.round((wu/totalMi)*100),   c: TEAL },
    { label: coreLabel(spec),  sub: coreSub(spec),             w: Math.round((coreMi/totalMi)*100), c: EMBER },
    { label: 'Cool-down', sub: `${cd} mi easy`,                w: Math.round((cd/totalMi)*100),   c: TEAL },
  ];
}
```

For threshold/intervals · the core sub-label is:
```ts
function coreLabel(spec) {
  const reps = spec.rep_count;
  const repMi = spec.rep_distance_mi
    ?? (spec.rep_distance_m ? spec.rep_distance_m / 1609.34 : null);
  // Use the actual repMi: '4 × 1 mi' for 1.0, '5 × 1k' if reps × 0.62
  if (repMi && Math.abs(repMi - 1.0) < 0.05) return `${reps} × 1 mi`;
  if (repMi && Math.abs(repMi - 0.621) < 0.02) return `${reps} × 1km`;
  return `${reps} × ${repMi?.toFixed(2)} mi`;
}
function coreSub(spec) {
  const pace = secToMmSs(spec.rep_pace_s_per_mi);
  const rest = `${spec.rep_rest_s}s jog`;
  return `@ ${pace} · ${rest}`;
}
```

### Fallback

When `workout_spec` is null (rest / cross / strength / older rows that
never got the backfill cron):

- Don't render the grid at all
- Show the `subLabel` from the row as a single-line description

The `constants.ts SEGS` map can be deleted once this lands · nothing
else reads from it.

---

## Why backend is NOT writing this

The endpoint already returns `workoutSpec` on the today payload (the
TodayPurpose response carries it, and the planned-workout loader has
it). The mismatch is purely on the render side reading the wrong
source · faster + cleaner for web to fix at the component layer than
for backend to bake a "session grid view-model" into the API.

---

## Known unrelated bug · spec ≠ sub_label on some rows

Separate from this fix, there's a generator-level bug where for some
quality rows:
- `sub_label` says "4×1 mi @ I · 3 min jog" (a prescription template
  string)
- `workout_spec` says rep_count=5, rep_distance_mi=0.62 (a 5×1km
  structure)

These describe different workouts. After the SEGS rewire lands, the
grid will read the spec (so it'll say "5 × 1km"), but the sub_label
header will still say "4×1 mi". Backend will fix this in a follow-up
that harmonizes the prescription resolver with spec-builder · don't
block on it for the grid wire-up.

Tracking: `designs/briefs/open-questions-spec-sub_label-mismatch-2026-06-02.md`

---

## Smoke

After the wire-up, the Today screenshot scenario from David's flag
should render:

- Card title (from sub_label): "4×1 mi @ I · 3 Min Jog"
- Card distance (post backfill): 6.3 mi total
- SESSION grid (from spec):
  - Warm-up 1.5 mi · 1.5 mi easy
  - 5 × 1km · @ 4:43 · 90s jog        ← from spec, was hardcoded "6 × 800 m"
  - Cool-down 1.0 mi · 1.0 mi easy

The grid + total finally reconcile · 1.5 + 5 × 0.62 + (4 × 90/540) + 1.0 ≈ 6.3 mi.

---

## Related

- `web-v2/components/faff-app/constants.ts:40-58` · the SEGS source
  to delete / rewire
- `web-v2/lib/plan/spec-builder.ts:totalDistanceMiFromSpec` · the
  total-miles helper · use the same field-precedence logic for the
  grid rendering
- `designs/briefs/backend-plan-diff-endpoint-2026-06-02.md` · the
  diff page also reads workout_spec so the helper you write here is
  reusable
