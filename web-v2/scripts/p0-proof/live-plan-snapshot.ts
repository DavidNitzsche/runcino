/**
 * LIVE PLAN SNAPSHOT · the BEFORE side of the rebuild diff.
 *
 * Read-only, and deliberately independent of the composer. It reads the stored
 * plan rows and renders every category the runner asked the diff to cover:
 * weekly mileage, long-run distance AND purpose, quality sessions and their
 * targets, warm-up and cool-down structure, race and tune-up events, recovery
 * placement, and pace and HR prescriptions.
 *
 * Two rules it exists to keep honest:
 *
 *  - It groups by the plan's OWN `week_id`, never by a re-derived Monday. The
 *    whole point of the rebuild question is whether week boundaries move, and a
 *    reader that recomputes them cannot see that they did (Rule 14 — a query
 *    names the population it reads).
 *  - It prints "—" for absent and says so, rather than printing 0. A missing
 *    pace and a pace of zero are different facts (Rule 11).
 *
 * It writes nothing, and it touches no endpoint that could.
 */
import { pool } from '@/lib/db/pool';

const U = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = process.env.PROBE_TODAY || new Date().toISOString().slice(0, 10);

const pace = (s: number | null | undefined) =>
  s == null || !(s > 0) ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const mi = (v: unknown) => (v == null ? '—' : Number(v).toFixed(1));

type Row = {
  date_iso: string; dow: number; type: string; sub_label: string | null;
  distance_mi: string | null; pace_target_s_per_mi: number | null;
  duration_min: number | null; is_quality: boolean; is_long: boolean;
  week_id: string; notes: string | null; spec: Record<string, unknown>;
};

async function main() {
  const plan = (await pool.query<{ id: string; race_id: string | null; goal_iso: string | null; authored_iso: string }>(
    `SELECT id, race_id, goal_iso, authored_iso FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [U])).rows[0];
  if (!plan) { console.log('REFUSAL · no active plan for this runner'); return; }

  const weeks = (await pool.query<{
    id: string; week_idx: number; week_start_iso: string; phase_id: string | null;
    is_cutback: boolean; is_peak: boolean; is_race_week: boolean; rationale: string | null;
  }>(`SELECT id, week_idx, week_start_iso, phase_id, is_cutback, is_peak, is_race_week, rationale
        FROM plan_weeks WHERE plan_id = $1 ORDER BY week_start_iso`, [plan.id])).rows;

  const rows = (await pool.query<Row>(
    `SELECT date_iso, dow, type, sub_label, distance_mi, pace_target_s_per_mi, duration_min,
            is_quality, is_long, week_id, notes, workout_spec AS spec
       FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`, [plan.id])).rows;

  // Completed history: what a rebuild must not touch. Sourced from the runs the
  // runner actually did, not from a status flag on the plan row, because the
  // question is what he RAN, not what the plan believes about it.
  const done = (await pool.query<{ n: string; mi: string }>(
    `SELECT COUNT(*) n, COALESCE(SUM((data->>'distanceMi')::numeric), 0) mi
       FROM runs WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
        AND (data->>'startLocal') >= $2 AND (data->>'startLocal') < $3`,
    [U, '2026-08-24', TODAY])).rows[0];

  const L: string[] = [];
  L.push(`# Live plan snapshot · BEFORE`);
  L.push('');
  L.push(`plan \`${plan.id}\` · race \`${plan.race_id}\` · goal date ${plan.goal_iso} · authored ${plan.authored_iso}`);
  L.push(`${rows.length} rows across ${weeks.length} weeks · ${rows[0]?.date_iso} → ${rows[rows.length - 1]?.date_iso}`);
  L.push(`completed history in this block, to today: ${done.n} runs, ${Number(done.mi).toFixed(1)} mi`);
  L.push('');
  L.push(`## Week summary`);
  L.push('');
  L.push('| # | Start | Phase | Mi | Long | Long purpose | Quality | Rest | Flags |');
  L.push('|---|---|---|---|---|---|---|---|---|');

  const byWeek = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.week_id;
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k)!.push(r);
  }

  const detail: string[] = [];
  for (const w of weeks) {
    const ws = byWeek.get(w.id) ?? [];
    const vol = ws.reduce((a, r) => a + Number(r.distance_mi ?? 0), 0);
    const long = ws.find((r) => r.is_long);
    const quality = ws.filter((r) => r.is_quality);
    const rest = ws.filter((r) => r.type === 'rest').length;
    const flags = [w.is_peak && 'PEAK', w.is_cutback && 'cutback', w.is_race_week && 'RACE WEEK']
      .filter(Boolean).join(' ') || '—';
    L.push(`| ${w.week_idx} | ${w.week_start_iso} | ${w.phase_id ?? '—'} | ${vol.toFixed(1)} | `
      + `${mi(long?.distance_mi)} | ${long?.sub_label ?? '—'} | ${quality.length} | ${rest} | ${flags} |`);

    detail.push(`### Week ${w.week_idx} · ${w.week_start_iso} · ${w.phase_id ?? 'no phase'} · ${vol.toFixed(1)} mi ${flags === '—' ? '' : `· ${flags}`}`);
    if (w.rationale) detail.push(`> ${w.rationale}`);
    detail.push('');
    detail.push('| Date | Type | Session | Mi | Pace | WU | CD | HR cap | HR target | Abort rules |');
    detail.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const r of ws) {
      const s = (r.spec ?? {}) as Record<string, any>;
      const rules = Array.isArray(s.rules) ? s.rules : [];
      const bail = rules.filter((x: any) => x?.kind === 'bail').map((x: any) => x.label).join(' · ') || '—';
      const past = r.date_iso < TODAY ? ' ✓past' : '';
      detail.push(`| ${r.date_iso}${past} | ${r.type} | ${r.sub_label ?? '—'} | ${mi(r.distance_mi)} | `
        + `${pace(r.pace_target_s_per_mi)} | ${s.warmup_mi ?? '—'} | ${s.cooldown_mi ?? '—'} | `
        + `${s.hr_cap_bpm ?? '—'} | ${s.hr_target_bpm ?? '—'} | ${bail} |`);
    }
    detail.push('');
  }

  L.push('');
  L.push(`## Races and tune-ups`);
  L.push('');
  const races = rows.filter((r) => r.type === 'race' || String(r.sub_label ?? '').toLowerCase().includes('race'));
  if (!races.length) L.push('_none in this block_');
  for (const r of races) {
    const s = (r.spec ?? {}) as Record<string, any>;
    L.push(`- **${r.date_iso}** · ${r.sub_label ?? r.type} · ${mi(r.distance_mi)} mi · `
      + `execution ${s.race_execution ? JSON.stringify(s.race_execution) : '—'} · HR ${s.race_hr ? JSON.stringify(s.race_hr) : '—'}`);
  }

  L.push('');
  L.push(`## Every week in full`);
  L.push('');
  L.push(...detail);

  console.log(L.join('\n'));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
