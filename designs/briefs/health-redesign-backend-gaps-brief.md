# Brief · Health redesign · backend gaps to close

**For:** backend / coach-engine
**From:** frontend (faff-web)
**Date:** 2026-06-01
**Status:** Web shipped the structural rewrite per design handoff ·
these fields would light up the additional sections

---

## What shipped on web

The Health page was rewritten end-to-end per
`designs/from Design agent/health-page/README.md` (Faff Health
Redesign handoff). The structural change is live:

- Hero (gauge + drivers + 7-day trend)
- THE STORY + WATCHING TOMORROW (intelligence row)
- BODY metric grid (bar-cards · 14-bar mini chart with dashed target)
- SLEEP STAGES grid + architecture line
- FORM metric grid
- DEEPER INSIGHTS (training form only · others await backend)

Per the locked doctrine ("every section degrades to absent when its
field is null"), sections without data simply don't render. No
placeholders, no "coming soon" copy.

## Fields the design assumes but aren't on the seed yet

These are the README's "15 power moves" that the prototype's HTML
demoed but the seed doesn't carry today. Each unlocks a section
of the redesigned page when shipped.

### `seed.health.recoveryPhase` (RECOVERY PHASE card · #15)

```ts
recoveryPhase: {
  anchorSession: string;        // "Sunday's 14.0 mi long run · 1h 56m"
  anchorDateIso: string;
  pctRecovered: number;         // 0..100
  dayOfRecovery: number;        // 2
  daysExpected: number;         // 4
  pillars: Array<{ key: string; label: string; pctBack: number }>;
  muscleSignals: string[];      // ["Cadence 168 spm vs typical 172 · legs still neuromuscular-fatigued", ...]
  earliestQualityDateIso: string | null;
  earliestQualityDow: string | null;  // "Thursday"
} | null
```

Drives the post-hard-session recovery card. Renders when set ·
absent when the runner has no recent anchor session (rest week,
post-race lull).

### `seed.health.aerobicFitness` (right column of hero · #8)

```ts
aerobicFitness: {
  decouplingPctRecent: number;       // 6.1 (this week's avg)
  decouplingPctPrior: number;        // 9.2 (8-week-ago baseline)
  longRunsAnalyzed: number;          // 8
  trend: 'improving' | 'stable' | 'worsening';
  copy: string;                      // "Engine getting more efficient · race-ready by week 8."
} | null
```

Surfaces aerobic-decoupling trend over the last 8 long runs ·
backend has the per-run number on run-detail already (lib/training/
aerobic-decoupling.ts), needs the aggregate composer.

### `seed.readinessBrief.forecasts` (FORECASTS sub-section)

```ts
forecasts: Array<{
  pillar: string;          // 'HRV CV'
  copy: string;            // "crosses the 7% destabilizing band by Thursday if the climb holds"
  byDateIso?: string;      // optional · when the predicted event lands
}> | null
```

Predictive watch-list items. Surfaces under WATCHING TOMORROW
when present.

### Deeper insights · 4 new cards

```ts
seed.health.blockComparison: {
  thisBlockAvg: { sleep: number; hrv: number; rhr: number };
  priorBlockAvg: { sleep: number; hrv: number; rhr: number };
  priorBlockRaceName: string;          // "Berlin"
  copy: string;                        // "Recovering better"
  detail: string;                      // "Sleep avg 7.4h this block vs 6.8h before Berlin."
} | null

seed.health.dowPatterns: {
  weakestDow: string;                  // "Monday"
  weakestPillar: string;               // "HRV"
  copy: string;                        // "Sunday-recovery problem"
  detail: string;                      // "HRV consistently lowest on Mondays."
} | null

seed.health.qualityPredictors: {
  topPredictor: string;                // "Deep sleep"
  threshold: string;                   // "> 70 min"
  ratio: number;                       // 3 (× more likely)
  detail: string;                      // "Top-quartile runs follow nights with deep sleep > 70 min · 3x more likely."
} | null

seed.health.heatAcclim: {
  daysInHeat: number;                  // 9
  thresholdF: number;                  // 78
  hrPenaltyBpm: number;                // 3
  daysToFullAdapt: number | null;      // 5
  copy: string;                        // "Acclimating"
  detail: string;                      // "9 days in 78F+ · RHR climb plateauing. HR penalty down to +3 bpm, full adapt in ~5 days."
} | null
```

Each renders one DEEPER INSIGHTS card.

### `seed.health.cyclePhase` + `cyclePerformance` (female-only · #13)

Already in `health-state.ts` but not threaded to `seed.health` yet.
Cycle phase tile renders only when `seed.user.biologicalSex === 'female'`.

```ts
seed.health.cyclePhase: {
  dayOfCycle: number;
  phase: 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';
  phaseLabel: string;
} | null

seed.health.cyclePerformance: {
  bestPhaseLabel: string;              // "follicular"
  bestPhasePace: string;               // "6:38 avg"
  worstPhaseLabel: string;
  worstPhasePace: string;
  copy: string;
} | null
```

---

## What was threaded this commit

- `seed.health.sleepArchitectureVerdict` · already in `health-state.ts` ·
  threaded to FaffSeed so the SLEEP STAGES architecture line can render.
  Backend changes needed: none · just the seed-builder thread-through.

---

## Priority

Per the doctrine, no rush · the sections gracefully absent. Order
of impact:

1. **recoveryPhase** · highest-value card · the runner most often
   wants to know "when can I go hard again."
2. **aerobicFitness** · the trend that says "you're getting fitter" ·
   reusable for the run-detail surface too.
3. **forecasts** · ties into watch-tomorrow well.
4. **blockComparison / dowPatterns / qualityPredictors / heatAcclim** ·
   deeper-insights cards · render-when-present is fine.
5. **cyclePhase** · zero impact for David (male) · ship when iPhone
   ships the HK reads.

---

## Files

- `web-v2/components/faff-app/views/HealthView.tsx` · the rewritten view
- `web-v2/components/faff-app/types.ts` · FaffSeed shapes
- `web-v2/components/faff-app/seed.ts` · `adaptHealth` composer · where
  to thread new fields from `health-state.ts`
- `web-v2/lib/coach/health-state.ts` · most data already loads here ·
  just needs new composers + threading

---

## Related

- `designs/from Design agent/health-page/README.md` · the redesign brief
- `designs/from Design agent/health-page/Faff Health Redesign.html` ·
  the visual reference
- `designs/briefs/health-page-full-data-ready-v2.md` · the backend's
  "we wired everything" claim from earlier today (most was wired ·
  these are the remaining gaps)
