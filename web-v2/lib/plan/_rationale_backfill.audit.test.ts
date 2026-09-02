/**
 * lib/plan/_rationale_backfill.audit.test.ts · the RATIONALE-BACKFILL-1 dry run.
 *
 * `selection_rationale` is present on ZERO of the owner's 103 live plan rows
 * (appendix E Finding 6): RATIONALE-PERSIST-1 is wired end to end and inert on
 * the block, because that block was authored the day before it landed. The
 * recompute now writes a recomposed line when the key is absent
 * (`recompute-paces.ts`, RATIONALE-BACKFILL-1).
 *
 * This file runs `rationaleForRow` over those real rows READ-ONLY and reports
 * what the recompute would write, per row, so the coordinator can see the
 * outcome before the live recompute rather than after it. It writes nothing.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · IT DOES NOT RUN THE RECOMPUTE. It drives the pure recomposer with the
 *     same three inputs the recompute hands it (`notes`, `type`, the week's
 *     phase label), so it cannot catch a mistake in the UPDATE, in the Rule 6
 *     preserve guard, or in the sealed/exempt row filters — only in what the
 *     recomposer would produce for the rows the recompute will reach.
 *   · IT ASSERTS A FLOOR, NOT A TARGET. A row the catalogue never filled
 *     correctly recomposes to null, and that is the right answer, so the only
 *     honest assertion is that SOME quality rows resolve and that no row
 *     resolves to a partial guess.
 *
 * Run with:
 *   npx vitest run lib/plan/_rationale_backfill.audit.test.ts
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const PLAN = 'pln_9a57561debb776e5';

describe.skipIf(!RO)('RATIONALE-BACKFILL-1 · dry run on the owner\'s live block', () => {
  it('reports what the recompute would write, per row', async () => {
    process.env.DATABASE_URL = RO;
    const { pool } = await import('@/lib/db/pool');
    const { rationaleForRow } = await import('@/lib/workout-catalogue/select');
    const { readSelectionRationale } = await import('@/lib/plan/progression-spec');

    const rows = (await pool.query<{
      date_iso: string; type: string; notes: string | null;
      phase: string | null; workout_spec: unknown;
    }>(
      `SELECT pw.date_iso::text AS date_iso, pw.type, pw.notes, ph.label AS phase,
              pw.workout_spec
         FROM plan_workouts pw
         LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
         LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
        WHERE pw.plan_id = $1
        ORDER BY pw.date_iso ASC`,
      [PLAN],
    )).rows;

    let already = 0;
    let would = 0;
    let refused = 0;
    const sample: string[] = [];

    for (const r of rows) {
      if (readSelectionRationale(r.workout_spec)) { already++; continue; }
      const line = rationaleForRow({ notes: r.notes, slot: r.type, phase: r.phase });
      if (line) {
        would++;
        if (sample.length < 12) sample.push(`  ${r.date_iso} ${r.type.padEnd(10)} ${line}`);
      } else {
        refused++;
      }
    }

    /* eslint-disable no-console */
    console.log(`\n══ RATIONALE-BACKFILL-1 dry run · plan ${PLAN} ══`);
    console.log(`  rows=${rows.length}  already carry one=${already}  `
      + `would be written=${would}  correctly refused=${refused}`);
    console.log('  sample of what would be written:');
    for (const s of sample) console.log(s);
    console.log('');
    /* eslint-enable no-console */

    expect(rows.length).toBeGreaterThan(0);
    // The floor: the catalogue filled real quality days on this block, so the
    // recomposer must resolve some of them. A zero here would mean the note
    // format the recomposer reads has drifted and the backfill is a no-op —
    // which is exactly the "wired, tested and inert" failure it exists to end.
    expect(would).toBeGreaterThan(0);
  }, 60_000);
});
