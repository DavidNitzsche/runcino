/**
 * lib/plan/adjudication/_promotion_replay.script.ts · RUN THE REAL PROMOTION
 * GATE, READ-ONLY, AGAINST EVERY ACTIVE PRODUCTION PLAN.
 *
 *     npm --prefix web-v2 run promotion-replay
 *
 * ── WHY THIS REPLACED `scripts/_promotion_replay.mjs` ──────────────────────
 *
 * The `.mjs` version RE-IMPLEMENTED the layer it was checking. It carried its
 * own `SUPPORTED_MAX = 0.10`, its own `classify`, its own one-stressor-at-a-time
 * walk and its own list of blocking reasons, and none of it called
 * `checkPromotion`. So its verdict was a report about a copy, and CLAUDE.md
 * Rule 18 says exactly what that is worth: "a verification query that reuses
 * the reader's filter reproduces the bug instead of revealing it."
 *
 * Concretely, its headline finding — "no demonstrated history to adjudicate
 * against" blocking six of seven plans — was ITS OWN rule and appears nowhere
 * in `checkPromotion`. The real gate blocked those plans for a different
 * reason, and finding that out required running the real gate.
 *
 * This file therefore reads production and does no coaching arithmetic of its
 * own. Every verdict below comes out of `adjudicateComposedBlock` /
 * `adjudicateColdStartBlock`, which come out of `checkPromotion`.
 *
 * It is a `.script.ts` run by a dedicated vitest config for the reason
 * `vitest.counterfactual.config.ts` already states: this repo has no `tsx`,
 * vitest is the TypeScript runner, and a harness that reads production cannot
 * pass on a clean checkout, so it stays out of `npm test`.
 *
 * ── WHAT IT WRITES ─────────────────────────────────────────────────────────
 *
 * Nothing. `DATABASE_URL_RO` only, `SELECT` only. No secret is printed: the
 * connection string is read from `.env.local` and never logged, and emails are
 * masked.
 *
 * ── RULE 22 · WHAT THIS CANNOT TELL YOU ────────────────────────────────────
 *
 * · WHETHER THE PLANS ARE GOOD. It asks whether their decisions are
 *   ADJUDICABLE. A block whose every week is defensible and badly chosen
 *   promotes.
 * · WHETHER THE HISTORY IT BUILDS IS THE RIGHT POPULATION. It reads canonical
 *   rows for the whole year (Rule 14), which is a judgement, and a runner whose
 *   watch has been off for six months looks like a cold start here.
 * · WHETHER THE COMPOSED WEEKS MATCH WHAT THE RUNNER SEES. It reads
 *   `plan_workouts`, which is what the app serves, but it reconstructs weekly
 *   totals by grouping, and a plan whose weeks are grouped differently upstream
 *   would produce different numbers.
 */
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
  adjudicateColdStartBlock, adjudicateComposedBlock, asCount, asMeasure,
  type ComposedWeekLike, type CorpusAdjudication,
} from '../adjudication-corpus';
import type { RaceDistanceKey } from './cold-start';
import type { RenderedHistory } from '../history-shapes';
/* Rule 14 · the canonical-row predicate has ONE definition and it is imported,
 * never re-typed. A verification query that re-rolls the reader's own filter
 * reproduces the bug instead of revealing it. The same applies to the distance
 * and day accessors: `runDistanceMiSql` / `runDaySql` know every spelling the
 * jsonb has carried, and a hand-rolled `data->>'distanceMi'` silently drops the
 * rows that use another one. */
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
import { runDaySql, runDistanceMiSql } from '@/lib/runs/run-shape';

const WEB = path.join(__dirname, '..', '..', '..');

function envRO(): string {
  const raw = readFileSync(path.join(WEB, '.env.local'), 'utf8');
  const line = raw.split('\n')
    .map((l) => l.match(/^DATABASE_URL_RO=(.*)$/))
    .find((m): m is RegExpMatchArray => m !== null) ?? null;
  if (line === null) {
    throw new Error('DATABASE_URL_RO is not set in web-v2/.env.local. This replay is read-only '
      + 'and will not fall back to a writable connection.');
  }
  return line[1].trim();
}

/** Emails are masked. Nothing identifying and no secret reaches the output. */
const mask = (e: string): string => e.replace(/^(.).*(@.*)$/, '$1***$2');

interface PlanRow {
  id: string;
  user_uuid: string;
  race_id: string | null;
  goal_iso: string | null;
  mode: string | null;
  email: string;
  /** `races.meta->>'distanceMi'`, the authoritative distance. */
  race_distance_mi: string | null;
}

interface WeekRow {
  wk: string;
  mi: string | number | null;
  longmi: string | number | null;
  q: string | number | null;
  mp: string | number | null;
  has_race: boolean;
  phase_label: string | null;
}

/**
 * The goal event, for the cold-start research allowance.
 *
 * `races.meta->>'distanceMi'` FIRST, because that is the authoritative figure
 * the app itself reads, and a slug is a name somebody typed. The slug is a
 * fallback only, for a race row whose distance was never filled in — which is
 * a real state here: `my-marathon-2026-10-02` carries a null `distanceMi`.
 *
 * Rule 11 · a plan with no race at all resolves to NULL, not to "marathon".
 * A null distance leaves a cold start with no research allowance, which makes
 * every week CONDITIONAL and gated rather than sized off a band nobody named.
 */
function distanceOf(
  raceDistanceMi: number | null,
  raceId: string | null,
): RaceDistanceKey | null {
  if (raceDistanceMi !== null && Number.isFinite(raceDistanceMi)) {
    const bands: ReadonlyArray<readonly [RaceDistanceKey, number]> = [
      ['5k', 3.11], ['10k', 6.21], ['half', 13.11], ['marathon', 26.22],
      ['50k', 31.07], ['100k', 62.14],
    ];
    let best: RaceDistanceKey | null = null;
    let bestGap = Infinity;
    for (const [key, mi] of bands) {
      const gap = Math.abs(raceDistanceMi - mi);
      if (gap < bestGap) { bestGap = gap; best = key; }
    }
    // Within 5% of a canonical distance, or it is something else and this
    // layer declines to name it.
    if (best !== null && bestGap <= raceDistanceMi * 0.05) return best;
  }
  const t = `${raceId ?? ''}`.toLowerCase();
  if (/100k|100-k/.test(t)) return '100k';
  if (/50k|50-k/.test(t)) return '50k';
  if (/marathon/.test(t) && !/half/.test(t)) return 'marathon';
  if (/half|13\.1|hm\b/.test(t)) return 'half';
  if (/10k|10-k/.test(t)) return '10k';
  if (/5k|5-k/.test(t)) return '5k';
  return null;
}

describe('checkPromotion · read-only replay against every active production plan', () => {
  it('reports how many active plans promote, under both policies', async () => {
    const client = new pg.Client({
      connectionString: envRO(),
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();

    try {
      const { rows: plans } = await client.query<PlanRow>(
        // Rule 14 · the population is named: the ACTIVE plan, joined to its user
        // by uuid. Never `user_id = 'me'`, never a plan version that was
        // archived.
        `SELECT tp.id::text AS id, tp.user_uuid::text AS user_uuid, tp.race_id,
                tp.goal_iso::text AS goal_iso, tp.mode, u.email,
                r.meta->>'distanceMi' AS race_distance_mi
           FROM training_plans tp
           JOIN users u ON u.id = tp.user_uuid
           LEFT JOIN races r ON r.slug = tp.race_id AND r.user_uuid = tp.user_uuid
          WHERE tp.archived_iso IS NULL
          ORDER BY tp.authored_iso DESC`,
      );

      console.log('\n# checkPromotion · read-only replay against every active production plan\n');
      console.log(`Active plans: **${plans.length}**. Nothing was written.\n`);

      const rows: string[] = [];
      let promotedNow = 0;
      let promotedLegacy = 0;
      let coldPlans = 0;
      const detail: string[] = [];

      for (const p of plans) {
        /* ── HISTORY · canonical rows only, whole year (Rule 14) ─────────── */
        const { rows: hw } = await client.query<{ mi: string | null }>(
          `SELECT round(sum(${runDistanceMiSql()})::numeric, 1) AS mi
             FROM runs
            WHERE user_uuid = $1::uuid AND ${CANONICAL_ROW_SQL}
              AND ${runDaySql()} >= '2026-01-01'
            GROUP BY date_trunc('week', ${runDaySql()}::timestamp)`,
          [p.user_uuid],
        );
        const weeklies = hw.map((r) => asMeasure(r.mi)).filter((v): v is number => v !== null);
        // Rule 11 · NO WEEKS is an absence, not a peak of zero. `Math.max()` of
        // an empty list is -Infinity and a `reduce(…, 0)` seed is a measured
        // zero this runner never produced.
        const peakWeeklyMi = weeklies.length === 0 ? null : Math.max(...weeklies);

        const { rows: lr } = await client.query<{ m: string | null }>(
          // A race is not a training long run, so the 26-mile ceiling stays.
          `SELECT max(${runDistanceMiSql()}) AS m FROM runs
            WHERE user_uuid = $1::uuid AND ${CANONICAL_ROW_SQL}
              AND ${runDaySql()} >= '2026-01-01'
              AND ${runDistanceMiSql()} < 26`,
          [p.user_uuid],
        );
        const longestRunMi = asMeasure(lr[0]?.m ?? null);

        /* ── THE BLOCK'S FUTURE WEEKS ────────────────────────────────────── */
        const { rows: wk } = await client.query<WeekRow>(
          `SELECT to_char(date_trunc('week', pw.date_iso::date), 'YYYY-MM-DD') AS wk,
                  round(sum(pw.distance_mi)::numeric, 1) AS mi,
                  round(max(pw.distance_mi) FILTER (WHERE pw.is_long)::numeric, 1) AS longmi,
                  count(*) FILTER (WHERE pw.is_quality) AS q,
                  count(*) FILTER (WHERE pw.sub_label ~ '@ (MP|M|HM)') AS mp,
                  bool_or(pw.type = 'race') AS has_race,
                  min(ph.label) AS phase_label
             FROM plan_workouts pw
             LEFT JOIN plan_weeks w ON w.id = pw.week_id AND w.plan_id = pw.plan_id
             LEFT JOIN plan_phases ph ON ph.id = w.phase_id AND ph.plan_id = pw.plan_id
            WHERE pw.plan_id = $1
            GROUP BY 1 ORDER BY 1`,
          [p.id],
        );
        const today = new Date().toISOString().slice(0, 10);
        const future = wk.filter((w) => w.wk >= today);

        const weeks: ComposedWeekLike[] = future.map((w) => {
          const mi = asMeasure(w.mi) ?? 0;
          const long = asMeasure(w.longmi);
          const q = asCount(w.q) ?? 0;
          const days: Array<{
            type: string; distanceMi: number; isQuality: boolean; isLong: boolean;
            subLabel?: string | null;
          }> = [];
          if (long !== null && long > 0) {
            days.push({
              type: w.has_race ? 'race' : 'long',
              distanceMi: long,
              isQuality: false,
              isLong: true,
            });
          }
          for (let i = 0; i < q; i += 1) {
            days.push({ type: 'quality', distanceMi: 1, isQuality: true, isLong: false, subLabel: 'threshold' });
          }
          const rest = Math.max(0, mi - (long ?? 0) - q);
          if (rest > 0) days.push({ type: 'easy', distanceMi: rest, isQuality: false, isLong: false });
          return {
            startISO: w.wk,
            phase: (w.phase_label ?? 'BASE').toUpperCase().replace(/[\s-]+/g, '-'),
            weeklyMi: mi,
            isRaceWeek: w.has_race,
            days,
          };
        });

        const distance = distanceOf(asMeasure(p.race_distance_mi), p.race_id);
        const isCold = peakWeeklyMi === null || longestRunMi === null;
        if (isCold) coldPlans += 1;

        const run = (reading: 'COLD_START' | 'LEGACY_NO_COLD_START'): CorpusAdjudication | null => {
          if (!isCold) {
            // A runner WITH history goes through the ordinary path, which the
            // cold-start policy does not touch — so both readings are the same
            // adjudication for him, and that is the correct answer rather than
            // a gap.
            const rendered = {
              shapeId: 'production',
              peakWeeklyMi,
              longestRunMi,
              maxStressorsInAWeek: 3,
              longRunComparables: [],
            } as unknown as RenderedHistory;
            return adjudicateComposedBlock({
              rendered,
              weeks,
              blockStartISO: weeks[0]?.startISO ?? today,
              windowDescribed: 'canonical runs, 2026 to date',
              raceDistance: distance,
            });
          }
          return adjudicateColdStartBlock({
            weeks,
            raceDistance: distance,
            why: 'no canonical runs are recorded for this account in 2026',
            reading,
          });
        };

        const now = weeks.length === 0 ? null : run('COLD_START');
        const before = weeks.length === 0 ? null : run('LEGACY_NO_COLD_START');

        if (now?.result.mayPromote) promotedNow += 1;
        if (before?.result.mayPromote) promotedLegacy += 1;

        rows.push(`| ${p.id.slice(0, 14)} | ${mask(p.email)} | ${distance ?? '-'} | `
          + `${future.length} | ${peakWeeklyMi ?? 'absent'} | ${longestRunMi ?? 'absent'} | `
          + `${isCold ? 'COLD' : 'has history'} | ${before === null ? 'n/a' : before.result.mayPromote ? 'YES' : '**BLOCKED**'} | `
          + `${now === null ? 'n/a' : now.result.mayPromote ? 'YES' : '**BLOCKED**'} |`);

        if (now !== null) {
          detail.push(`### ${p.id} (${distance ?? 'distance not known'})`);
          detail.push(`- cold-start decisions: ${now.result.coldStartDecisions} of ${now.result.traces.length} traces`);
          detail.push(`- BEFORE (${before?.result.mayPromote ? 'promoted' : 'blocked'}): `
            + `${before?.result.blockedBecause.join(' | ') || 'nothing'}`);
          detail.push(`- NOW (${now.result.mayPromote ? 'promoted' : 'blocked'}): `
            + `${now.result.blockedBecause.join(' | ') || 'nothing'}`);
          detail.push('');
        }
      }

      console.log('| plan | account | distance | future weeks | peak wk | longest | history | promotes BEFORE | promotes NOW |');
      console.log('|---|---|---|---:|---:|---:|---|---|---|');
      for (const r of rows) console.log(r);
      console.log(`\n**BEFORE (no cold-start policy): ${promotedLegacy} of ${plans.length} promote.**`);
      console.log(`**NOW: ${promotedNow} of ${plans.length} promote.**`);
      console.log(`**${coldPlans} of ${plans.length} plans belong to accounts with no canonical runs.**\n`);
      for (const d of detail) console.log(d);
    } finally {
      await client.end();
    }
  }, 120_000);
});
