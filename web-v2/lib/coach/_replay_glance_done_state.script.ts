/**
 * lib/coach/_replay_glance_done_state.script.ts · the real-history replay behind
 * GLANCE-FALLBACK-1.
 *
 * NOT A TEST. It reads a database and cannot pass on a clean checkout, which is
 * why it carries `.script.ts` and its own config rather than joining
 * `lib/**\/*.test.ts`. Same shape and same argument as
 * `lib/adaptation/volume-evidence/_replay_real_history.script.ts`.
 *
 *     FAFF_REPLAY_DB=faff_fix_glance_flattering \
 *       npx vitest run --config vitest.glance-replay.config.ts
 *
 * ── WHAT IT MEASURES ────────────────────────────────────────────────────────
 *
 * Three implementations of "what word does Today print about the session the
 * runner just finished", graded over EVERY day in this account's history that
 * carries both a prescription and a real run:
 *
 *   OLD      the pre-SIMROW-1 selection — its own `coach_intents` query, this
 *            runner, reason `watch_completion`, THIS DATE, `ORDER BY ts DESC
 *            LIMIT 1`, over a swallowing catch. Reimplemented here verbatim
 *            from `8bbe7029b^`, because it is deleted from the tree.
 *   HEAD     the SIMROW-1 selection as committed in `8bbe7029b`: grade only
 *            when `primaryPrescription(...)?.matchedRun` is non-null, and
 *            otherwise fall through to `overreach ? 'over' : 'nailed'`.
 *            Reimplemented here so all three can be compared in ONE run.
 *   LIVE     whatever `computeTodayExecution` actually is in the working tree.
 *
 * LIVE is the control. Run this BEFORE the fix and `LIVE === HEAD` on every
 * day — which is what makes the HEAD reimplementation above trustworthy
 * (Rule 18: a comparator nothing has falsified is a hypothesis). Run it AFTER
 * and every day where LIVE moves is a day the fix changed, named.
 *
 * ── WHAT IT CANNOT CATCH (Rule 22) ──────────────────────────────────────────
 *
 * It cannot catch `resolveWorkoutVerdict` grading a session wrongly — all three
 * columns call the same grader, so a wrong grade is wrong in all three and
 * cancels out of the comparison. It cannot catch `ownedDaysSql` naming the
 * wrong prescription for a historical date, and it cannot see any day on which
 * the runner has no prescription at all. It measures SELECTION, not judgement.
 */
import { describe, it } from 'vitest';
import fs from 'node:fs';
import { pool } from '@/lib/db/pool';
import { ownedDaysSql } from '@/lib/plan/owned-days';
import { canonicalMileageByDay } from '@/lib/runs/merge';
import { runDaySql, runDistanceMiSql } from '@/lib/runs/run-shape';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';
import { runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { fellShortShare, resolveWorkoutVerdict, phasesFromCompletion } from '@/lib/execution/verdict';
import { resolveDayExecutions, primaryPrescription } from '@/lib/execution/day-resolver';
import { resolveStoredPhases } from '@/lib/postrun/load';
import { computeTodayExecution, type GlanceWeekDay } from '@/lib/coach/glance-state';
import type { WorkoutSpec } from '@/lib/faff/types';

const OWNER = process.env.FAFF_REPLAY_OWNER ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

type Grade = 'nailed' | 'short' | 'over' | null;

/**
 * The removed selection, reimplemented from `8bbe7029b^`.
 *
 * ONE DELIBERATE DIFFERENCE from the original, and it cannot move a grade:
 * the two swallowing catches it carried — `.catch(() => 'America/Los_Angeles')`
 * on the timezone read and `.catch(() => ({ rows: [] }))` on the query — are
 * NOT reproduced. On a database that answers they are unreachable, so every
 * number this comparator reports is the original's. On one that does not, the
 * original graded a failed read as a confident "nailed" (that is the swallow
 * SIMROW-1 removed, and test D's subject); a measurement tool must show the
 * failure instead of averaging it into the result. Keeping them would also
 * add two live sites to the coercion and swallowed-failure ratchets, which
 * are ratchets precisely so this shape cannot re-enter through a side door.
 */
async function oldGrade(userId: string, today: string, row: GlanceWeekDay): Promise<Grade> {
  if (row.doneMi < 0.5) return null;
  const tz = await runnerTimezoneOrPacific(userId);
  const intent = (await pool.query(
    `SELECT value FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1
        AND reason = 'watch_completion'
        AND (CASE WHEN field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
                  THEN field ~ ('-' || $2::text || '(#[0-9]+)?$')
                  ELSE (ts AT TIME ZONE $3::text)::date = $2::date END)
      ORDER BY ts DESC LIMIT 1`,
    [userId, today, tz],
  )).rows[0];

  const overreach = row.plannedMi > 0 && row.doneMi >= row.plannedMi * 1.25;
  if (intent?.value) {
    const grade = resolveWorkoutVerdict({
      type: row.plannedType,
      spec: (row.plannedSpec ?? null) as Record<string, unknown> | null,
      phases: intent.value,
    });
    const shortShare = fellShortShare(grade);
    if (grade.work.incomplete || (shortShare != null && shortShare >= 0.34)) return 'short';
  }
  return overreach ? 'over' : 'nailed';
}

/** The SIMROW-1 selection exactly as `8bbe7029b` committed it. */
async function headGrade(userId: string, today: string, row: GlanceWeekDay): Promise<Grade> {
  if (row.doneMi < 0.5) return null;
  const resolved = await resolveDayExecutions(userId, today);
  const matchedRun = primaryPrescription(resolved)?.matchedRun ?? null;
  const phases = matchedRun
    ? await resolveStoredPhases(userId, today, matchedRun.data as Record<string, unknown>)
    : [];
  const overreach = row.plannedMi > 0 && row.doneMi >= row.plannedMi * 1.25;
  if (phases.length > 0) {
    const grade = resolveWorkoutVerdict({
      type: row.plannedType,
      spec: (row.plannedSpec ?? null) as Record<string, unknown> | null,
      phases,
    });
    const shortShare = fellShortShare(grade);
    if (grade.work.incomplete || (shortShare != null && shortShare >= 0.34)) return 'short';
  }
  return overreach ? 'over' : 'nailed';
}

interface Day {
  date: string;
  row: GlanceWeekDay;
  matched: boolean;
  /** The day's biggest canonical run, when one exists — the `loadRun` fallback. */
  biggestRunId: string | null;
  /** Does the OLD lookup's payload belong to a run of the runner's own that day? */
  oldPayloadField: string | null;
}

async function loadDays(): Promise<Day[]> {
  // Every date the runner has an owned prescription for. `ownedDaysSql` is the
  // reign-aware reader — the ACTIVE plan alone covers only 2026-08-24 onward,
  // and the days this replay is about are months older than that.
  const owned = await pool.query<{
    date_iso: string; type: string | null; distance_mi: string | null;
    sub_label: string | null; workout_spec: unknown; id: string;
  }>(
    ownedDaysSql({ columns: 'pw.date_iso, pw.type, pw.distance_mi, pw.sub_label, pw.workout_spec, pw.id::text AS id' }),
    [OWNER, '2000-01-01', '2100-01-01'],
  );
  if (owned.rows.length === 0) return [];
  const from = owned.rows[0].date_iso;
  const to = owned.rows[owned.rows.length - 1].date_iso;

  const mileage = await canonicalMileageByDay(OWNER, from, to);

  const biggest = await pool.query<{ day: string; id: string }>(
    `SELECT DISTINCT ON (${runDaySql()}) ${runDaySql()} AS day, id::text AS id
       FROM runs
      WHERE user_uuid = $1 AND ${CANONICAL_ROW_SQL}
      ORDER BY ${runDaySql()}, ${runDistanceMiSql()} DESC NULLS LAST`,
    [OWNER],
  );
  const biggestByDay = new Map(biggest.rows.map((r) => [r.day, r.id]));

  const tz = await runnerTimezoneOrPacific(OWNER);
  const out: Day[] = [];
  for (const p of owned.rows) {
    const done = mileage.get(p.date_iso)?.mi ?? 0;
    if (done < 0.5) continue; // no run that day — the done-state is not active
    const row: GlanceWeekDay = {
      date: p.date_iso,
      dow: new Date(`${p.date_iso}T12:00:00Z`).getUTCDay(),
      plannedId: p.id,
      plannedMi: Number(p.distance_mi) || 0,
      plannedType: p.type ?? 'rest',
      plannedLabel: p.sub_label,
      plannedSpec: (p.workout_spec ?? null) as WorkoutSpec | null,
      doneMi: Math.round(done * 10) / 10,
      activityId: null,
      isToday: false,
      isPast: true,
      adaptation: null,
    };
    const resolved = await resolveDayExecutions(OWNER, p.date_iso);
    const matched = primaryPrescription(resolved)?.matchedRun != null;
    const oldField = (await pool.query<{ field: string }>(
      `SELECT field FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1 AND reason = 'watch_completion'
          AND (CASE WHEN field ~ '-[0-9]{4}-[0-9]{2}-[0-9]{2}(#[0-9]+)?$'
                    THEN field ~ ('-' || $2::text || '(#[0-9]+)?$')
                    ELSE (ts AT TIME ZONE $3::text)::date = $2::date END)
        ORDER BY ts DESC LIMIT 1`,
      [OWNER, p.date_iso, tz],
    )).rows[0]?.field ?? null;
    out.push({
      date: p.date_iso, row, matched,
      biggestRunId: biggestByDay.get(p.date_iso) ?? null,
      oldPayloadField: oldField,
    });
  }
  return out;
}

describe('GLANCE-FALLBACK-1 · real-history replay of the Today done-state', () => {
  it('grades every real run-day three ways and prints the disagreements', async () => {
    const days = await loadDays();
    const lines: string[] = [];
    lines.push(`days with a prescription AND a run ≥ 0.5 mi: ${days.length}`);
    lines.push(`  of those, matchedRun === null:            ${days.filter((d) => !d.matched).length}`);
    lines.push(`  …and a canonical run exists that day:      ${days.filter((d) => !d.matched && d.biggestRunId).length}`);
    lines.push(`  …and the OLD lookup found a payload:       ${days.filter((d) => !d.matched && d.oldPayloadField).length}`);

    let oldVsHead = 0, oldVsLive = 0, headVsLive = 0;
    const rows: string[] = [];
    for (const d of days) {
      const [o, h, l] = [
        await oldGrade(OWNER, d.date, d.row),
        await headGrade(OWNER, d.date, d.row),
        await computeTodayExecution(OWNER, d.date, d.row),
      ];
      if (o !== h) oldVsHead++;
      if (o !== l) oldVsLive++;
      if (h !== l) headVsLive++;
      if (o !== h || h !== l) {
        rows.push(
          `  ${d.date}  OLD=${String(o).padEnd(6)} HEAD=${String(h).padEnd(6)} LIVE=${String(l).padEnd(6)}` +
          ` matched=${d.matched ? 'yes' : 'NO '} run=${d.biggestRunId ? 'yes' : 'no '}` +
          ` oldField=${d.oldPayloadField ?? 'none'}`,
        );
      }
    }
    lines.push('');
    lines.push(`OLD  vs HEAD disagreements: ${oldVsHead}`);
    lines.push(`OLD  vs LIVE disagreements: ${oldVsLive}`);
    lines.push(`HEAD vs LIVE disagreements: ${headVsLive}`);
    if (rows.length > 0) {
      lines.push('');
      lines.push('DAYS WHERE THE THREE DISAGREE:');
      lines.push(...rows);
    }

    // SPOTLIGHT · the days named in `glance-state.ts`'s header comment, so a
    // sentence about a specific date is checked against the data rather than
    // remembered (Rule 13).
    const SPOTLIGHT = ['2026-05-31', '2026-06-02', '2026-06-04', '2026-07-14', '2026-09-01', '2026-09-02', '2026-09-03'];
    lines.push('');
    lines.push('SPOTLIGHT (dates named in comments):');
    for (const date of SPOTLIGHT) {
      const d = days.find((x) => x.date === date);
      if (!d) { lines.push(`  ${date}  not in the replay set`); continue; }
      lines.push(
        `  ${date}  OLD=${String(await oldGrade(OWNER, d.date, d.row)).padEnd(6)}` +
        ` HEAD=${String(await headGrade(OWNER, d.date, d.row)).padEnd(6)}` +
        ` LIVE=${String(await computeTodayExecution(OWNER, d.date, d.row)).padEnd(6)}` +
        ` matched=${d.matched ? 'yes' : 'NO '} type=${d.row.plannedType} planned=${d.row.plannedMi} done=${d.row.doneMi}` +
        ` oldField=${d.oldPayloadField ?? 'none'}`,
      );
    }

    const out = lines.join('\n');
    // eslint-disable-next-line no-console
    console.log(`\n${out}\n`);
    fs.writeFileSync(process.env.FAFF_REPLAY_OUT ?? '/tmp/glance-replay.txt', `${out}\n`);
  }, 600_000);
});
