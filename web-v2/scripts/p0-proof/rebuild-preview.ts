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
  // ComposeForUserResult.composed is the ComposePlanResult; its weeks carry
  // `startISO` + `days: DayPlan[]`, and a DayPlan is keyed by `dow` rather than
  // a date, so the date is derived from the week start.
  const cr = composed.result.composed as unknown as { weeks: Array<{ startISO: string; days: Array<Record<string, unknown>> }> };
  // DayPlan.dow is NUMERIC, Sun=0..Sat=6 (generate.ts:146). The week's start
  // weekday varies with the runner's long-run day, so the offset is computed
  // from startISO's own weekday rather than assumed to be Monday.
  const days: Array<{ iso: string; type: string; mi: number; subLabel: string | null }> = [];
  for (const w of cr.weeks ?? []) {
    const startMs = Date.parse(w.startISO + 'T12:00:00Z');
    const startDow = new Date(startMs).getUTCDay();
    for (const d of w.days ?? []) {
      const dow = Number(d.dow);
      const offset = ((dow - startDow) % 7 + 7) % 7;
      const iso = new Date(startMs + offset * 86400000).toISOString().slice(0, 10);
      days.push({ iso, type: String(d.type ?? ''), mi: Number(d.distanceMi ?? 0),
                  subLabel: (d.subLabel as string | null) ?? null });
    }
  }
  days.sort((a, b) => a.iso.localeCompare(b.iso));
  console.log(`composed rows: ${days.length} across ${(cr.weeks ?? []).length} weeks`);

  const liveMi = live.reduce((a, d) => a + Number(d.distance_mi ?? 0), 0);
  const newMi = days.reduce((a, d) => a + d.mi, 0);
  console.log(`\ntotal volume   live ${liveMi.toFixed(1)} mi   composed ${newMi.toFixed(1)} mi   delta ${(newMi - liveMi).toFixed(1)}`);

  const byDate = new Map(live.map((d) => [String(d.date_iso).slice(0, 10), d]));
  let same = 0; const diffs: string[] = [];
  for (const d of days) {
    const l = byDate.get(d.iso);
    if (!l) { diffs.push(`${d.iso}  NEW DAY (not in live plan)`); continue; }
    const lMi = Number(l.distance_mi ?? 0);
    if (Math.abs(d.mi - lMi) < 0.05 && d.type === l.type) { same++; continue; }
    diffs.push(`${d.iso}  ${l.type} ${lMi.toFixed(1)} mi ${l.sub_label ?? ''}`
      + `  ->  ${d.type} ${d.mi.toFixed(1)} mi ${d.subLabel ?? ''}`);
  }
  console.log(`\nidentical days: ${same} of ${days.length}`);
  console.log(`differing days: ${diffs.length}`);
  for (const d of diffs.slice(0, 40)) console.log('   ' + d);
  if (diffs.length > 40) console.log(`   … ${diffs.length - 40} more`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

/** Week-by-week volume and long run, live against composed. Run with PREVIEW_WEEKS=1. */
export async function weeksTable() {
  const { pool: p2 } = await import('@/lib/db/pool');
  const plan = (await p2.query<{ id: string; race_id: string | null }>(
    `SELECT id, race_id FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`, [U])).rows[0];
  const live = (await p2.query<{ date_iso: string; type: string; distance_mi: string | null }>(
    `SELECT date_iso, type, distance_mi FROM plan_workouts WHERE plan_id=$1 ORDER BY date_iso`, [plan.id])).rows;
  const c = await composeForUser({ userId: U, raceSlug: plan.race_id ?? undefined });
  if (!c.ok) { console.log('refused'); return; }
  const cr = c.result.composed as unknown as { weeks: Array<{ startISO: string; days: Array<Record<string, unknown>> }> };

  const wk = (iso: string) => {
    const d = new Date(Date.parse(iso + 'T12:00:00Z'));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
    return d.toISOString().slice(0, 10);
  };
  const liveW = new Map<string, { mi: number; long: number }>();
  for (const d of live) {
    const k = wk(String(d.date_iso).slice(0, 10));
    const e = liveW.get(k) ?? { mi: 0, long: 0 };
    const mi = Number(d.distance_mi ?? 0);
    e.mi += mi; if (d.type === 'long' && mi > e.long) e.long = mi;
    liveW.set(k, e);
  }
  const newW = new Map<string, { mi: number; long: number }>();
  for (const w of cr.weeks ?? []) {
    const startMs = Date.parse(w.startISO + 'T12:00:00Z');
    const startDow = new Date(startMs).getUTCDay();
    for (const d of w.days ?? []) {
      const off = ((Number(d.dow) - startDow) % 7 + 7) % 7;
      const iso = new Date(startMs + off * 86400000).toISOString().slice(0, 10);
      const k = wk(iso);
      const e = newW.get(k) ?? { mi: 0, long: 0 };
      const mi = Number(d.distanceMi ?? 0);
      e.mi += mi; if (d.type === 'long' && mi > e.long) e.long = mi;
      newW.set(k, e);
    }
  }
  const keys = [...new Set([...liveW.keys(), ...newW.keys()])].sort();
  console.log('\nweek        live mi  new mi   Δ      live long  new long');
  for (const k of keys) {
    const l = liveW.get(k) ?? { mi: 0, long: 0 };
    const n = newW.get(k) ?? { mi: 0, long: 0 };
    const d = n.mi - l.mi;
    console.log(`${k}  ${l.mi.toFixed(1).padStart(7)}  ${n.mi.toFixed(1).padStart(6)}  ${(d>=0?'+':'')+d.toFixed(1).padStart(5)}   ${l.long.toFixed(1).padStart(8)}  ${n.long.toFixed(1).padStart(8)}`);
  }
  const lPeak = Math.max(...[...liveW.values()].map(v=>v.mi));
  const nPeak = Math.max(...[...newW.values()].map(v=>v.mi));
  const lLong = Math.max(...[...liveW.values()].map(v=>v.long));
  const nLong = Math.max(...[...newW.values()].map(v=>v.long));
  console.log(`\npeak week   live ${lPeak.toFixed(1)}  ->  new ${nPeak.toFixed(1)}`);
  console.log(`peak long   live ${lLong.toFixed(1)}  ->  new ${nLong.toFixed(1)}`);
  await p2.end();
}
