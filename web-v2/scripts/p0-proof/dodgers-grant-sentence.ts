/**
 * S1.3 PROOF · what the runner ACTUALLY reads on the Dodgers weekend.
 *
 * Rule 13: a fix to something the runner sees is verified by producing the real
 * output from real data, not by reading the header comment that claims it. The
 * claim under test is that the grant no longer says "You have run 29.4mi across
 * two days before" — a sentence that was false in SHAPE, because that pair was a
 * 2.61 mi shakeout followed by the Big Sur Marathon.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): it proves the SENTENCE, not the placement.
 * It says nothing about whether the weekend should be prescribed at all — only
 * about whether the evidence offered for it is honestly stated.
 *
 * READ-ONLY. Uses DATABASE_URL_RO and issues no write of any kind.
 *
 * 2026-09-03 · the line below was added because `scripts/check-write-barrier.sh`
 * guard 3 counts every script that builds its own `pg.Pool` outside the
 * barrier's reach, and this one landed without the ratchet being raised, so
 * `prebuild` was failing on `main`. Importing the barrier is the fix the gate
 * asks for and it is a no-op outside a verification process, so nothing about
 * how this script runs changes. The header above already claims it issues no
 * write; this is that claim gated rather than asserted (Rule 20).
 */
import '../../lib/verify/install-barrier';
import { Pool } from 'pg';
import {
  CANONICAL_ROW_SQL,
  runDaySql,
  runDistanceMiSql,
  runTypeSql,
  runWorkoutTypeSql,
} from '../../lib/runs/run-shape';
import {
  resolvePairVolumeEvidence,
  resolvePairOrderingEvidence,
  DESIGNED_WEEKEND_LONG_CAP_MI,
  type HistoricalDayReading,
} from '../../lib/plan/designed-race-weekend';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_RO, max: 2 });
  const { rows } = await pool.query<{ d: string; mi: string; hard: boolean | null; was_race: boolean | null }>(
    `SELECT (${runDaySql('r')})::date::text AS d,
            SUM(${runDistanceMiSql('r')})::text AS mi,
            BOOL_OR(CASE WHEN COALESCE(${runWorkoutTypeSql('r')}, ${runTypeSql('r')}, '')
                              IN ('tempo','threshold','intervals','race','long','easy','recovery')
                         THEN COALESCE(${runWorkoutTypeSql('r')}, ${runTypeSql('r')}, '')
                              IN ('tempo','threshold','intervals','race')
                         ELSE NULL END) AS hard,
            BOOL_OR(EXISTS (SELECT 1 FROM races x WHERE x.user_uuid = r.user_uuid
                             AND x.meta->>'date' = (${runDaySql('r')})::date::text)) AS was_race
       FROM runs r
      WHERE r.user_uuid = $1::uuid AND ${CANONICAL_ROW_SQL.replace(/\bdata\b/g, 'r.data')}
      GROUP BY 1 ORDER BY 1`,
    [USER],
  );
  await pool.end();

  const days: HistoricalDayReading[] = rows
    .map((r) => ({ dateISO: r.d, mi: Number(r.mi ?? 0), wasRace: r.was_race === true, wasHardEffort: r.hard }))
    .filter((d) => Number.isFinite(d.mi) && d.mi > 0);

  const vol = resolvePairVolumeEvidence(days);
  const ord = resolvePairOrderingEvidence(days, DESIGNED_WEEKEND_LONG_CAP_MI);

  console.log(`days read: ${days.length}   races among them: ${days.filter((d) => d.wasRace).length}`);
  console.log(`ungraded (wasHardEffort null): ${days.filter((d) => d.wasHardEffort == null).length}`);
  console.log('');
  console.log('── PAIR VOLUME (the gate) ──');
  console.log(JSON.stringify(vol, null, 2));
  console.log('');
  console.log('── PAIR ORDERING (narrated) ──');
  console.log(JSON.stringify(ord, null, 2));
  console.log('');

  /* The heaviest two-day totals INCLUDING races, which is what the old, false
   * sentence was quoting. Printed so the difference is visible rather than
   * asserted. */
  const byDate = new Map(days.map((d) => [d.dateISO, d]));
  const pairs: { a: string; b: string; total: number; hasRace: boolean }[] = [];
  for (const d of days) {
    const next = new Date(Date.parse(`${d.dateISO}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const n = byDate.get(next);
    if (n) pairs.push({ a: d.dateISO, b: next, total: d.mi + n.mi, hasRace: d.wasRace || n.wasRace });
  }
  pairs.sort((x, y) => y.total - x.total);
  console.log('── heaviest two-day totals, races INCLUDED (what the old sentence quoted) ──');
  for (const p of pairs.slice(0, 5)) {
    console.log(`  ${p.total.toFixed(1)}mi  ${p.a} + ${p.b}  ${p.hasRace ? '← CONTAINS A RACE' : ''}`);
  }
  console.log('');
  console.log('── heaviest two-day totals, races EXCLUDED (what the gate may cite) ──');
  for (const p of pairs.filter((p) => !p.hasRace).slice(0, 5)) {
    console.log(`  ${p.total.toFixed(1)}mi  ${p.a} + ${p.b}`);
  }

  console.log('');
  console.log('════ THE SENTENCE THE RUNNER READS ════');
  const g = await renderGrant(vol, ord, 18, 43.5);
  if (!g.permitted) {
    console.log(`REFUSED · ${g.refusal.code}`);
    console.log(g.refusal.message);
  } else {
    console.log(g.grant.rationale);
    console.log('');
    console.log(`combinedMi asked for: ${g.grant.combinedMi}`);
  }
}



/* ── THE FULL SENTENCE, rendered ────────────────────────────────────────────
 * Appended as a second pass so the evidence above is measured before it is
 * spent. The request mirrors the live Dodgers weekend: a C-priority 10K with
 * an easy long run the next morning. */
export async function renderGrant(
  vol: ReturnType<typeof resolvePairVolumeEvidence>,
  ord: ReturnType<typeof resolvePairOrderingEvidence>,
  recentHabitLongMi: number,
  sustainedWeeklyMi: number,
) {
  const { resolveDesignedRaceWeekend } = await import('../../lib/plan/designed-race-weekend');
  return resolveDesignedRaceWeekend({
    raceSlug: 'dodgers-10k', raceName: 'the Dodgers 10K', raceDateISO: '2026-09-19',
    raceMi: 6.21, effectivePriority: 'C', prescribedRacePaceSec: 400,
    longDateISO: '2026-09-20', longMi: 17, longCarriesQuality: false,
    longCarriesProgressionFinish: false, longCarriesMarathonPaceFinish: false,
    gapDays: 1, recoveryDaysAfter: 3,
    evidence: { pairVolume: vol, pairOrdering: ord, recentHabitLongMi, sustainedWeeklyMi },
    authoredPurpose: 'A controlled 10K, then volume on tired legs.',
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
