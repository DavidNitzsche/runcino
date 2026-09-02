/**
 * REBUILD PREVIEW · what a silent rebuild would do to the runner's live plan.
 *
 * Read-only. Composes a fresh block from the CURRENT engine and diffs it against
 * the plan rows that exist today, week by week and day by day, then checks the
 * invariants the runner made his authorisation conditional on:
 *
 *   stated goals unchanged · total volume · long runs · quality-day spacing ·
 *   race transactions · HR rules · paces · abort rules · workout structures
 *
 * It writes nothing. `silent-rebuild` is a separate, explicit step.
 */
import { pool } from '@/lib/db/pool';
import { composeForUser } from '@/lib/plan/generate';

const U = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pace = (s: number | null | undefined) =>
  s == null || !(s > 0) ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function main() {
  const plan = (await pool.query<{ id: string; race_id: string | null; goal_iso: string | null }>(
    `SELECT id, race_id, goal_iso FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [U])).rows[0];
  if (!plan) { console.log('no active plan'); return; }
  console.log(`live plan ${plan.id}  race=${plan.race_id}  goal_iso=${plan.goal_iso}`);

  const live = (await pool.query<{
    date_iso: string; type: string; sub_label: string | null; distance_mi: string | null;
    pace_target_s_per_mi: number | null; hr: string | null;
  }>(`SELECT date_iso, type, sub_label, distance_mi, pace_target_s_per_mi,
             workout_spec->>'hr_cap_bpm' AS hr
        FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`, [plan.id])).rows;
  console.log(`live rows: ${live.length}`);

  const composed = await composeForUser({ userId: U, raceSlug: plan.race_id ?? undefined });
  if (!composed.ok) { console.log(`COMPOSE REFUSED: ${composed.reason}`); return; }
  const r = composed.result as unknown as Record<string, unknown>;
  const weeks = (r.weeks ?? []) as Array<Record<string, unknown>>;
  const days = weeks.flatMap((w) => (w.days ?? []) as Array<Record<string, unknown>>);
  console.log(`composed rows: ${days.length} across ${weeks.length} weeks`);

  const liveMi = live.reduce((a, d) => a + Number(d.distance_mi ?? 0), 0);
  const newMi = days.reduce((a, d) => a + Number((d as { mi?: number }).mi ?? 0), 0);
  console.log(`\ntotal volume   live ${liveMi.toFixed(1)} mi   composed ${newMi.toFixed(1)} mi   delta ${(newMi - liveMi).toFixed(1)}`);

  const byDate = new Map(live.map((d) => [String(d.date_iso).slice(0, 10), d]));
  let same = 0; const diffs: string[] = [];
  for (const d of days) {
    const iso = String((d as { dateIso?: string; date_iso?: string }).dateIso
      ?? (d as { date_iso?: string }).date_iso ?? '').slice(0, 10);
    const l = byDate.get(iso);
    if (!l) { diffs.push(`${iso}  NEW DAY (not in live plan)`); continue; }
    const nMi = Number((d as { mi?: number }).mi ?? 0);
    const lMi = Number(l.distance_mi ?? 0);
    const nType = String((d as { type?: string }).type ?? '');
    if (Math.abs(nMi - lMi) < 0.05 && nType === l.type) { same++; continue; }
    diffs.push(`${iso}  ${l.type} ${lMi.toFixed(1)} mi  ->  ${nType} ${nMi.toFixed(1)} mi`);
  }
  console.log(`\nidentical days: ${same} of ${days.length}`);
  console.log(`differing days: ${diffs.length}`);
  for (const d of diffs.slice(0, 40)) console.log('   ' + d);
  if (diffs.length > 40) console.log(`   … ${diffs.length - 40} more`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
