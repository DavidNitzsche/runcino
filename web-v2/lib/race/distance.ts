/**
 * lib/race/distance.ts · THE shared distance-label → miles parser.
 *
 * 2026-07-06 · phone+watch audit P1-17 · races.meta.distanceMi was never
 * written by any app path (POST /api/race and onboarding write distanceLabel
 * only), and half a dozen local `distanceMiFromLabel` forks had drifted
 * (races-state.ts knew 4 labels, race/route.ts knew 8 + numeric parse).
 * This is the merged superset. Two jobs:
 *
 *   1. WRITE-time: race create/edit paths derive meta.distanceMi from the
 *      label so the race-morning composers (execution-plan, pacing, fueling)
 *      stop 404ing on app-created races.
 *   2. READ-time backfill: races-state + execution-plan fall back to this
 *      for existing rows written before distanceMi landed — no DB writes,
 *      existing races light up immediately.
 *
 * Values are the codebase-canonical 26.2 / 13.1 / 6.2 / 3.1 convention
 * (matches distanceMiOf in lib/plan/generate.ts, distFromLabel in
 * lib/training/vdot-inputs.ts, and the projection-snapshot bands), NOT the
 * exact metric conversions — every downstream band check (`BETWEEN
 * $2*0.95 AND $2*1.05`) is tuned to these.
 */

/** Map a race-distance label ("Half Marathon", "5K", "10 mile", "50km")
 *  to miles. Returns null when the label is missing or unparseable —
 *  callers must treat null as "no distance", never default it. */
export function distanceMiFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const s = String(label).toLowerCase().trim();
  if (!s) return null;
  // Named distances · substring match so "Boston Marathon"-style labels and
  // the onboarding "Half Marathon" both resolve. Half MUST be checked before
  // the bare-marathon branch excludes it.
  if (s.includes('marathon') && !s.includes('half')) return 26.2;
  if (s.includes('half') || s.includes('21k') || s.includes('21.1')) return 13.1;
  // Ultra distances · 2026-07-06 phone+watch audit P1-41 / P2-70. The phone
  // Add Race sheet offers "50K" / "50M" / "100K" / "100M"; none resolved here
  // ("50m"/"100m" lack a mi/km unit for the numeric fallback, and decorated
  // names like "Javelina 100M" never full-match it), so every ultra fell
  // through to callers' 13.1 defaults — a silent half-marathon plan for a
  // 100-miler. Named substring branches, checked BEFORE 15k/10k/5k so the
  // longer literals win. "M" in a distance label reads as miles (the phone's
  // convention); values follow the parser's canonical rounding (50K = 50 km
  // → 31.07 mi, matching the numeric fallback's km conversion).
  if (s.includes('100k')) return 62.14;
  if (s.includes('100m') || s.includes('100 mile')) return 100;
  if (s.includes('50k')) return 31.07;
  if (s.includes('50m') || s.includes('50 mile')) return 50;
  if (s.includes('15k')) return 9.3;
  if (s.includes('10k')) return 6.2;
  if (s.includes('5k')) return 3.1;
  if (s.includes('10 mile') || s.includes('10-mile') || s === '10mi') return 10.0;
  if (s.includes('20 mile') || s.includes('20-mile') || s === '20mi') return 20.0;
  if (s === '26.2') return 26.2;
  if (s === '13.1') return 13.1;
  // Numeric fallback: "6.2", "6.2 mi", "50km", "50k". Bare "k" after a
  // number reads as kilometers ("8k" → ~4.97 mi).
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(mi|mile|miles|km|k)?$/);
  if (m) {
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (!m[2] || m[2].startsWith('mi')) return n;
    return Math.round((n / 1.609344) * 100) / 100;
  }
  return null;
}
