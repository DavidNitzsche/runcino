/**
 * lib/faff/unlogged-race-alert.ts · "log your result" alert for the
 * Targets page (and any surface that wants it).
 *
 * 2026-08-17 · extracted from components/faff-app/seed.ts and re-keyed.
 * The old check was `!r.finishTime` — but races-state auto-fills
 * finishTime from a date+distance-matched training run (finishSource
 * 'run_match', ALWAYS provisional per race-data Rule 3). That auto-fill
 * suppressed the alert forever, so a raced A/B event with only a watch
 * match never asked for its real result. The alert now keys on
 * actual_result absence: anything short of finishSource
 * 'actual_result' (the canonical chip-time write) still needs logging.
 */

export interface UnloggedAlertRace {
  slug: string;
  name: string;
  date: string;
  priority: 'A' | 'B' | 'C' | null;
  finishSource: 'actual_result' | 'meta' | 'run_match' | null;
}

export function computeUnloggedRaceAlert(
  past: UnloggedAlertRace[] | null | undefined,
  nowMs: number = Date.now(),
): { slug: string; name: string; daysSince: number } | null {
  if (!past || past.length === 0) return null;
  const candidate = past.find(
    (r) => r.finishSource !== 'actual_result' && (r.priority === 'A' || r.priority === 'B'),
  );
  if (!candidate?.date) return null;
  const daysSince = Math.round(
    (nowMs - Date.parse(candidate.date + 'T12:00:00Z')) / 86_400_000,
  );
  if (daysSince > 30) return null;
  return { slug: candidate.slug, name: candidate.name, daysSince };
}
