# Brief · Health page · ALL data wired · design once · v2

**For:** design agent
**From:** backend
**Date:** 2026-06-01
**Status:** Backend complete · iPhone shipped sleep stages
(`b58abfc3`) · backend wired carriers + biological_sex helper ·
**design now without round-trip risk**

---

## Why a v2 brief

You already received `designs/briefs/health-page-data-ready.md` for
the 90% of tiles that ship today. This v2 closes the loop on the
remaining 10%:

1. **Sleep stages** · iPhone agent shipped deep / REM / light / awake
   minute ingest. Backend wired carriers. The 4 tiles render when
   data flows; gracefully degrade to "no data" when it doesn't.
2. **Cycle phase** · gender-gated via the new biologicalSex envelope
   field. Design agent decides if/when to render the tile.

The full Health page can now be designed in ONE pass.

---

## What's NEW on the seed since v1

### `seed.health.body[]` · 4 new sleep stage tiles

| Key | Label | Unit | Source |
|---|---|---|---|
| **NEW** `sleep_deep` | DEEP SLEEP | min | health_samples.sleep_deep_minutes |
| **NEW** `sleep_rem` | REM SLEEP | min | health_samples.sleep_rem_minutes |
| **NEW** `sleep_light` | LIGHT SLEEP | min | health_samples.sleep_light_minutes |
| **NEW** `sleep_awake` | AWAKE | min | health_samples.sleep_awake_minutes |

Each tile carries:
- `current` · 7-night avg in minutes
- `target` · deep 75min, REM 100min (per Research/00b §sleep stages)
- `series` · 14-night chart strip (deep + REM only · light/awake are
  context, not goals)
- `status` · 'good' when above target, 'warn' below
- Decimals: 0

**Carrier behavior:** the tiles render only when data exists. Until
your TestFlight build updates and data starts flowing for a runner,
the tiles are simply absent from body[] · they don't render as
"loading" placeholders. Clean handoff: when sleep data lands, tiles
appear automatically.

### `seed.user.biologicalSex` · NEW envelope field

```ts
seed.user.biologicalSex: 'female' | 'male' | 'not_specified'
```

Reads through `lib/coach/biological-sex.ts` · single source of truth
that normalizes the legacy `users.sex` ('M' | 'F') and `profile.sex`
('male' | 'female' | freeform) into a single enum.

### `seed.readinessBrief.hrvCv` · already shipped in v1
### `seed.health.body[]` Quick Win tiles · already shipped in v1
### `seed.health.form[]` vert ratio + run power · already shipped in v1
### `seed.runDetail.aerobic_decoupling` · already shipped in v1

---

## Cycle phase tile · how to gate

The cycle phase tile should render **only** when:
```ts
seed.user.biologicalSex === 'female'
```

For `'male'` and `'not_specified'`, do NOT render the tile · don't
even allocate space for it. The cycle phase data won't be on the
seed for non-female runners (iPhone gates the ingest too).

**Suggested treatment when biologicalSex === 'female':**

```
CYCLE  Day 14 · Ovulatory
       Peak power window · 3 days left
```

Backend doesn't ship the data field today · iPhone agent will ship
the HK menstrual flow + cervical mucus + basal body temp reads next
once they pick up the brief. When that lands, backend adds:
```ts
seed.health.cyclePhase: {
  dayOfCycle: number;
  phase: 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';
  daysIntoPhase: number;
  daysToNextPhase: number;
} | null
```

Design as if this data exists · backend will fill it in when iPhone
ships.

---

## Real values for David right now

David's `biologicalSex` resolves to `'male'` (so cycle tile would
NOT render). All other tiles:

```
HRV               (existing)
RHR               (existing)
SLEEP             (existing · total hours)
WEIGHT            187.0 lb steady
WRIST TEMP        35.80 °C
RESP RATE         15.0 /min
SPO2              95%
BODY FAT          13.7%
LEAN MASS         161.6 lb
HRV CV            (computed nightly)
MAX HR            181 bpm  (← was 175, fixed to 12-month window)
DEEP SLEEP        no data yet (waiting for next TF)
REM SLEEP         no data yet
LIGHT SLEEP       no data yet
AWAKE             no data yet
```

Form section unchanged from v1 · 6 tiles all shipping.

---

## How to respond

1. Design the Health page across the full data set · sleep stages
   will render when David updates his TF build.
2. If you want the cycle phase tile rendered for ANY biologicalSex
   (e.g. opt-in for non-female runners), say the word.
3. If you want different sleep-stage tile shapes (e.g. donut chart
   of total night vs the 4 stages), backend can compute donut
   percentages instead of bare minutes.
4. Once you ship the design, backend will write per-tile status copy
   (the "BELOW TARGET / WATCH / ON TARGET" labels) per the audit doc.

---

## What's truly NOT shipping today

- **Active energy time-series** · iPhone says it's already on main as
  `031fe5fd` · just waiting for David's next TF build for it to flow.
  Same carrier story as sleep stages.
- **Cycle phase** · waiting for iPhone to ship HK reads (blocked on
  the biological_sex helper which is now shipped).
- **Aerobic decoupling time-series** on Health page · today only
  per-run on run detail. Could compose a "last 8 long runs decoupling
  trend" tile if you want it.

---

## Files for reference

- `web-v2/lib/coach/health-state.ts` · all body data loaders
- `web-v2/lib/coach/biological-sex.ts` · biologicalSex helper
- `web-v2/lib/training/max-hr.ts` · canonical max-HR helper
- `web-v2/lib/training/aerobic-decoupling.ts` · run-detail chip
- `web-v2/components/faff-app/seed.ts` · the composer

---

## Related

- `designs/briefs/health-page-data-ready.md` · v1 (90% tiles)
- `designs/briefs/aerobic-decoupling-on-run-detail.md` · run-detail
- `designs/briefs/iphone-health-ingest-expansion-brief.md` · iPhone
- `designs/briefs/readiness-baseline-correction-design-brief.md` · the
  bug fix you've already seen
