/**
 * lib/faff/effort-map.ts · canonical plan-type → EffortKey mapping for
 * the web seed (week strip, season grid, activity list, hero).
 *
 * Extracted from components/faff-app/seed.ts (2026-08-17) so the
 * mapping is unit-testable — the day it broke, a race_week_tuneup fell
 * through every branch and rendered as a cyan EASY hero on a taper-week
 * race-pace rehearsal.
 */

import type { EffortKey } from '@/components/faff-app/constants';

export function mapType(t: string | null | undefined): EffortKey {
  const low = (t ?? '').toLowerCase();
  // 2026-06-10 honesty pass: a day with NO planned workout is "nothing
  // planned" — render it as rest, never invent an easy run for it.
  // glance-state emits 'unplanned' for plan-less users (coached mode,
  // pre-plan); the old fallthrough turned that into a week of phantom
  // "Easy" days with 8:45 target paces and MISSED prompts.
  if (low === '' || low === 'unplanned') return 'rest';
  if (low.includes('rest')) return 'rest';
  // 2026-06-08 · race must resolve BEFORE the easy fallback. Previously
  // 'race' fell through to 'easy', so race morning rendered a cyan EASY
  // hero (the orange MESH.race + 'RACE' title were unreachable). Guard the
  // 'race_pace'/'race_simulation' quality subtypes so they DON'T match
  // here — only a true race-effort row ('race', 'race_a'…) maps to 'race'.
  if (low === 'race' || low.startsWith('race_a') || low.startsWith('race_b') || low.startsWith('race_c')) return 'race';
  // 2026-08-17 · race_week_tuneup is T-pace quality (same convention as
  // /api/today/purpose + watch complete), not an easy jog. It matched
  // none of the branches below and fell through to 'easy', so the web
  // hero and week strip rendered a taper-week race-pace rehearsal as
  // EASY. Bucket it with tempo; the hero title still says TUNE-UP via
  // purpose.typeTitle (lib/coach/workout-title.ts).
  if (low === 'race_week_tuneup' || low.includes('tuneup') || low.includes('tune_up') || low.includes('tune-up')) return 'tempo';
  if (low.includes('long')) return 'long';
  if (low.includes('tempo') || low.includes('threshold')) return 'tempo';
  if (low.includes('interval') || low.includes('vo2') || low.includes('track')) return 'intervals';
  if (low.includes('recovery') || low.includes('shake')) return 'recovery';
  return 'easy';
}
