# Brief · Backend · Treadmill completion ingest

**For:** backend / coach-engine agent
**From:** iPhone agent
**Date:** 2026-06-01
**Status:** Ask · companion to `treadmill-wire-up-brief.md` (iPhone-side
build 136). These two ship together so the first real treadmill run
lands cleanly in `runs` + the coach reads it correctly.

---

## TL;DR

`POST /api/watch/workouts/complete` is the single ingest path for
non-Strava runs. The iPhone is about to start using it for treadmill
sessions in addition to Faff-watch sessions. Three field-shape
changes needed so treadmill runs don't masquerade as Faff-watch
outdoor runs:

1. Respect `body.source` instead of hardcoding `source: 'watch'`
2. Forward `body.indoor` into `data.indoor`
3. Preserve `actualSpeedMph` + `actualInclinePct` in
   `deriveSplitsFromPhases` per-phase output

Everything else (idempotency on `workoutId`, autoMerge, briefing
cache bust, `body.kcal` tier 1, Strava auto-push) keeps working
unchanged — treadmill just lands as a non-Strava-pushable run.

---

## Current behavior · what's wrong

`web-v2/app/api/watch/workouts/complete/route.ts` line 72 hardcodes
the source:

```ts
const data: any = {
  ...,
  source: 'watch',   // ← hardcoded · ignores body.source
  ...
};
```

A treadmill POST with `body.source = 'treadmill'` lands as
`data.source === 'watch'`. Downstream:

- Activity feed groups it under "Faff Watch runs" instead of
  treadmill
- Run-detail surface expects GPS data (no map, but the layout still
  reserves space)
- Run-recap composer (`lib/coach/run-win.ts`) treats it as an
  outdoor session and tries to compose win lines from non-existent
  pace splits

`deriveSplitsFromPhases` (line 181 same file) maps a fixed set of
fields per phase:

```ts
.map((p, i) => ({
  mi: i + 1,
  label: p.label ?? p.type ?? `Phase ${i + 1}`,
  distanceMi: p.actualDistanceMi ?? null,
  durationSec: p.actualDurationSec ?? null,
  paceSecPerMi: p.actualPaceSPerMi ?? null,
  avgHr: p.avgHr ?? null,
  maxHr: p.maxHr ?? null,
  avgCadence: p.avgCadence ?? null,
  type: p.type ?? null,
  completed: p.completed ?? null,
}));
```

`actualSpeedMph` and `actualInclinePct` from the iPhone payload get
silently dropped here.

---

## Asks

### 1 · Respect `body.source`

```ts
const data: any = {
  ...,
  source: body.source ?? 'watch',   // ← changed
  ...
};
```

Whitelist: `'watch' | 'treadmill'`. Anything else → fall back to
`'watch'` (current behavior). Logs the rejected value so a future
iPhone bug shows up in the server logs instead of silently mis-
sourcing the run.

### 2 · Forward `body.indoor` into `data.indoor`

Adds a top-level boolean to the row's data jsonb so consumers can
distinguish "indoor by definition" from "outdoor with no GPS
exported."

```ts
const data: any = {
  ...,
  source: body.source ?? 'watch',
  indoor: body.indoor === true,     // ← new field · default false
  ...
};
```

Side effect on `has_route` computation (lib/coach/run-state.ts:535)
already returns false when no polyline, so the route map empty
state is already correct. The `indoor` flag is for finer downstream
gating:

- `lib/coach/run-recap.ts` · skip "you climbed N ft" facts when
  indoor (no real elev signal)
- Activity feed icon · treadmill glyph vs running figure
- Future: dedicated treadmill-aware coach voice

### 3 · Preserve per-phase treadmill fields in `deriveSplitsFromPhases`

```ts
.map((p, i) => ({
  mi: i + 1,
  label: p.label ?? p.type ?? `Phase ${i + 1}`,
  distanceMi: p.actualDistanceMi ?? null,
  durationSec: p.actualDurationSec ?? null,
  paceSecPerMi: p.actualPaceSPerMi ?? null,
  avgHr: p.avgHr ?? null,
  maxHr: p.maxHr ?? null,
  avgCadence: p.avgCadence ?? null,
  type: p.type ?? null,
  completed: p.completed ?? null,
  // 2026-06-01 · treadmill-only fields. Null on outdoor watch runs.
  actualSpeedMph: p.actualSpeedMph ?? null,
  actualInclinePct: p.actualInclinePct ?? null,
}));
```

These flow through to `runs.data.splits[i]` and the run-detail
endpoint surfaces them in the response. The iPhone post-run sheet's
form grid will render them ("7.0 mph · 1.5% incline") when present.

---

## Optional · run-recap composer awareness

`lib/coach/run-win.ts` (the win-line composer that ships per-type
coach voice) is currently pace-based. For treadmill sessions the
relevant signals are:

- **Speed adherence** · variance across the work phases (low CV =
  steady, high CV = drifted)
- **Incline discipline** · did they hold the prescribed incline or
  drop it mid-session
- **Reps completed** · same as outdoor intervals

Suggested treadmill-only win line patterns (composer falls through
to `null` when none fire · matches the existing "no fabrication"
doctrine):

- All work phases at planned mph ± 0.2 → "Held the line · {mph} mph,
  steady incline"
- Each work rep faster than the last → "Building rep by rep · last
  one was the strongest"
- Recovery phases hit planned pace (didn't run too hard) →
  "Disciplined recovery jogs · the reps did the work"

If composer scope is too tight for v1, ship without it · `null` win
line is fine (the iPhone hides the green check and falls back to
the regular post-run body).

---

## Optional · activity feed icon

`web-v2/components/faff-app/views/ActivityView.tsx` (or the iPhone's
`Views/ActivityView.swift` row builder) shows a running-figure glyph
on the run row. When `source === 'treadmill'`, swap to a treadmill
glyph so the runner can scan their week at a glance and see indoor
vs outdoor.

iPhone-side SF Symbol: `figure.indoor.run`. Web-side TBD per design.

---

## Test plan

Once the changes land:

1. **iPhone smoke** · runner taps Treadmill, completes a 4-segment
   session, POSTs. Verify `runs.data.source === 'treadmill'` and
   `runs.data.indoor === true`.
2. **Per-phase preservation** · verify `runs.data.splits[i]
   .actualSpeedMph` and `actualInclinePct` are non-null on the
   posted phases.
3. **Run-recap reads cleanly** · `/api/runs/[id]/recap` returns
   verdict/facts without crashing on the missing GPS data.
4. **Activity feed** · the treadmill row appears alongside outdoor
   runs (under the same date), distinguishable by source.

---

## Why this matters

David flagged the treadmill picker option in build 135 and asked
"does treadmill actually work end-to-end?" Today it doesn't · it's a
visual stub that doesn't POST. The iPhone agent's build 136 wires
the POST path; this brief lets the backend accept those POSTs as
treadmill-shaped runs instead of mis-labeling them as Faff-watch
runs.

---

## Related

- iPhone wire-up (companion): `designs/briefs/treadmill-wire-up-brief.md`
- Existing endpoint: `web-v2/app/api/watch/workouts/complete/route.ts`
- Existing schema: runs.data jsonb (no migration needed · jsonb is
  shape-agnostic)
- Existing consumers that may want awareness:
  - `lib/coach/run-state.ts` (loadRunDetail)
  - `lib/coach/run-recap.ts`
  - `lib/coach/run-win.ts`
  - `components/faff-app/views/ActivityView.tsx`
