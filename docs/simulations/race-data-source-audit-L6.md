# L6 · Race-data source-of-truth audit · 2026-05-19

**Verdict: CLEAN.** Every component that displays race-result data now reads from `races.actual_result` as primary source-of-truth. No holdouts.

This document is the L6 deliverable David requested:
> "sanity-check pass on EVERY card that displays race-related data: confirm each is reading from races.actual_result as source of truth, list any holdouts."

---

## The contract

`races.actual_result.finishS` is the canonical race-performance source.
`strava_activities.data.canonicalFinishS / movingTimeS` is raw watch data — never the source-of-truth for race-result displays.

When the two disagree (chip vs gun), curated wins per the Option-B locked decision. The chip-time divergence banner on `/races/[slug]` makes that gap legible to the user.

---

## Component → source map

### Race-result consumers (must read from races first)

| Component | Source | Verdict |
|---|---|---|
| `compute-vdot.ts` | races only · strict Option-B | ✅ races-first |
| `fitness-resolver.ts` → resolveVdot | computeAggregateVdot | ✅ races-first (transitive) |
| `validate-race-feasibility.ts` | agg.sources from computeAggregateVdot | ✅ races-first (transitive) |
| `/races/page.tsx` · Recent Races strip | races table | ✅ races-first |
| `/races/page.tsx` · Personal Records card | races first, Strava fallback labeled "training effort" | ✅ races-first (fixed in `18cb512`) |
| `/races/[slug]/page.tsx` · hero + readiness | getRaceDB | ✅ races-first |
| `/races/[slug]/page.tsx` · chip-time divergence banner | race.actualResult, compared to strava_activities for the delta | ✅ races-first |
| `/api/race-retrospect/route.ts` | race.actualResult | ✅ races-first |
| `/api/races-page/route.ts` | listRacesDB | ✅ races-first |
| `lib/coach-state.ts` → savedRaces, bestForVdot | listRacesDB | ✅ races-first |
| `coach-state.recent` | listRacesDB filtered to past + actualResult present | ✅ races-first |

### Non-race-result consumers (Strava is the right source)

| Component | Source | Notes |
|---|---|---|
| `validate-max-hr.ts` · pickTopPeaks | strava_activities.data.maxHr / avgHr | ✓ correct — HR readings come from training runs, not curated race entries |
| `lib/strava-activities.ts` | strava_activities | ✓ correct — caching layer for raw Strava data |
| `/api/strava/sync/route.ts` | strava_activities (writes) | ✓ correct — the sync layer |
| `/api/admin/audit-races/route.ts` | both | ✓ correct — diagnostic tool surfaces both for comparison |
| `/api/admin/race-hr-diagnostic/route.ts` | strava_activities | ✓ correct — HR data tool, not race-result tool |

---

## Historical bugs caught by this audit pattern

| Bug | Symptom | Component | Fixed |
|---|---|---|---|
| Phantom 5K | VDOT 33.6 contributor at 3% weight | compute-vdot read canonicalLabel from strava_activities directly | `1d4450f` (strict Option-B) |
| Missing Sombrero | Goal-tier HM dropped from aggregate | compute-vdot dedup-by-canonical-distance lost the slower of two HMs | `1d4450f` (no-dedup) |
| Empty PR card | "No PRs yet — log past races to populate" despite 4+ curated races | /races page PR card read ONLY from strava_activities.canonicalLabel | `18cb512` (L5) |

The pattern: anywhere race results need to display, the first read goes to `races.actual_result`. Strava is fallback or context, never primary.

---

## What to check before merging any new race-data-consuming component

1. Does it display a race result (finish time, finish pace, PR, race comparison)?
2. If yes, does it read from `races` table first?
3. If it falls back to Strava data, does it label that fallback as provisional (e.g., "training effort", "Strava elapsed")?
4. Does it skip strava_activities entries that should be ignored (auto-detected best-effort segments inside training runs, not actual races)?

The audit script `web/app/api/admin/audit-races/route.ts` continues to be the diagnostic for ongoing data drift — re-run after each new race added to verify curated entries are linked and divergences are surfaced.

---

*Audit pass complete 2026-05-19 round 2. Re-run if a new race-data-consuming component lands.*
