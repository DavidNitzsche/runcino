# Brief · iPhone HK ingest · sleep stages + menstrual cycle + active energy

**For:** iPhone agent
**From:** backend
**Date:** 2026-06-01
**Status:** Ask · backend is wiring the Health page surface in
parallel · these three additions unlock the highest-value tiles

---

## Context

Backend just audited the Health page mockup against the data we
have and the Research/ doctrine. We're shipping 5 Quick Win tiles
that use signals iPhone already ingests (wrist temp, resp rate,
spo2, body fat, lean mass).

Three additions need iPhone-side HK ingest work to unlock further
tiles on the Health page redesign.

---

## 1 · Sleep stages

### What we have today

`health_samples.sample_type = 'sleep_hours'` · one row per night
with total hours asleep. That's it.

### What HK ships

`HKCategoryTypeIdentifierSleepAnalysis` returns segmented samples
labeled with one of:

- `HKCategoryValueSleepAnalysisAsleepCore` (light)
- `HKCategoryValueSleepAnalysisAsleepDeep` (deep)
- `HKCategoryValueSleepAnalysisAsleepREM` (REM)
- `HKCategoryValueSleepAnalysisAwake` (interruption)
- `HKCategoryValueSleepAnalysisInBed` (in-bed, not asleep)

Apple Watch ships these for every night the runner wears it.

### What backend needs

New rows in `health_samples` with:

```
sample_type = 'sleep_deep_minutes' | 'sleep_rem_minutes' | 'sleep_light_minutes' | 'sleep_awake_minutes'
value       = minutes in that stage that night
sample_date = night-of date (same as sleep_hours convention)
recorded_at = bedtime stamp
```

One row per stage per night = 4 rows per night minimum. The runner
sees 8h total sleep · with stages we surface "1h45 deep · 1h30 REM
· 4h light · 45min awake" which is the actual recovery signal.

### Why it matters

Research/00b §recovery · "deep sleep early in night drives
parasympathetic recovery · REM in second half drives motor memory
consolidation." Two completely different recovery functions, both
gated by total sleep but not interchangeable.

### Doctrine sources

- Research/00b-recovery-protocols.md §sleep-stages
- Plews (separate from his HRV work) on sleep architecture in
  endurance athletes

---

## 2 · Menstrual cycle phase

### Gating · CRITICAL

**Only ingest + surface this for runners who self-identify as female
in settings.** The HK permission prompt + the data field + the
Health-page tile should ALL be gender-gated. For male / non-binary /
prefer-not-to-say users, this entire path is invisible.

Backend will add a `profile.identity.biological_sex` enum
(`female` | `male` | `not_specified`) so iPhone can branch on it.
Default for existing users = `not_specified` until they edit
settings. Cycle ingest fires only when `biological_sex === 'female'`.

### What we have today

Nothing.

### What HK ships

- `HKCategoryTypeIdentifierMenstrualFlow` (start day, intensity)
- `HKCategoryTypeIdentifierCervicalMucusQuality` (optional)
- `HKCategoryTypeIdentifierBasalBodyTemperature` (rises in luteal)

From the start-of-flow date, we can derive cycle day + phase.

### What backend needs

```
sample_type = 'menstrual_cycle_day'
value       = day-of-cycle (1-35ish)
sample_date = today
```

Plus a derived phase row when phase is unambiguous:

```
sample_type = 'menstrual_cycle_phase'
value       = encoded phase (1=menstrual, 2=follicular, 3=ovulatory, 4=luteal)
```

### Why it matters

Research/13 §sex-specific · "luteal phase HRV runs ~5-10ms lower
regardless of fitness · don't pull back when biology explains it."
Without the cycle phase, the engine reads a lower HRV in the luteal
phase and recommends easing the run · false-positive recovery flag.
With the phase, the readiness model can adjust the threshold.

Also: training adapts differently across the cycle. Mid-luteal
endurance is solid · ovulation week is when peak power efforts
land. Surfacing the phase lets the runner SEE that and plan.

### Doctrine sources

- Research/13-sex-specific-training.md §menstrual-cycle
- Plews et al. on HRV cycle effects

### Privacy / opt-in

Apple Health requires explicit cycle-tracking authorization. Make
the prompt clear that we use it for "training adjustments not
period predictions" so it doesn't read as creepy. Default to OFF;
prompt during onboarding or via a Health settings toggle.

---

## 3 · Active energy time-series (still open)

Already filed in
`designs/briefs/iphone-calories-and-absorption-brief.md`. Still
shows 1 sample per 7 days instead of ~180 per run. Bumping for
visibility · this also blocks honest run-card calorie display
(currently using estimator fallback).

---

## Priority

If iPhone agent only has bandwidth for one:

1. **Sleep stages** is the highest-leverage. Unlocks two new
   readiness pillars (deep-sleep adequacy + sleep architecture
   regularity). Most runners are missing both signals today.

2. **Active energy** is the lowest-effort fix · it's a query-type
   change (HKStatisticsQuery → HKSampleQuery / HKAnchoredObjectQuery).

3. **Menstrual cycle** matters for half the future user base but
   doesn't affect David's account today. Defer if needed.

---

## What backend will do meanwhile

Backend is wiring the Quick Win tiles + computing HRV CV (Plews
early-overreach signal) + aerobic decoupling helper + sleep
consistency (bedtime variability from existing sleep_hours). No
ingest changes needed for those.

Once sleep stages land, backend will:
- Add per-stage tiles to the Health page (deep / REM / light /
  awake totals + 7-day trend)
- Add deep-sleep adequacy as a 6th readiness pillar
- Sleep architecture regularity tile (REM ratio across nights)

Once cycle phase lands:
- Add cycle phase awareness to the readiness engine
- HRV thresholds adjust per phase
- Cycle phase chip on the morning brief

---

## How to respond

1. Confirm priority + ETA for the items.
2. PR link when shipped · backend will smoke against fresh samples
   landing in health_samples.

---

## Related

- `designs/briefs/health-page-coverage-audit.md` · the broader
  Health page audit
- `designs/briefs/iphone-calories-and-absorption-brief.md` · the
  open calories ingest item this re-flags
