/**
 * REBUILD ANCHOR ACCEPTANCE · does a rebuild keep the active block's calendar?
 *
 * Read-only. Composes a fresh block through the SAME entry the rebuild paths
 * use (`composeForUser` with only a userId and the plan's own race slug — no
 * startAnchor, no startDateISO, exactly what `fireAutoRebuild` passes) and puts
 * it beside the plan rows that exist today:
 *
 *   · the block span and week count, composed against live
 *   · week start dates, composed against live, week by week
 *   · weekly volume and long run, composed against live, with the peaks named
 *   · the stated goal, the race transaction, and every past-dated row
 *
 * The composed side is walked through `persistsComposedDay` — the same
 * predicate `persistPlan` calls — so what this prints is what would actually be
 * WRITTEN, not what the composer emitted before the writer dropped rows.
 *
 * It writes NOTHING. The rebuild itself is a separate, explicit step the runner
 * authorises. Run it as:
 *
 *   DATABASE_URL=$DATABASE_URL_RO npx tsx --tsconfig tsconfig.json \
 *     scripts/p0-proof/rebuild-anchor-acceptance.ts
 */
import { pool } from '@/lib/db/pool';
import { composeForUser, persistsComposedDay, requestedBlockStartISO } from '@/lib/plan/generate';
import { isDaySealed } from '@/lib/plan/seal';

const U = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** `persistPlan`'s own date derivation, so this is not a paraphrase. */
function dateForDow(weekStartISO: string, dow: number): string {
  const wsDow = new Date(weekStartISO + 'T12:00:00Z').getUTCDay();
  return addDays(weekStartISO, (dow - wsDow + 7) % 7);
}
function weekStartOf(iso: string, weekStartDow: number): string {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay();
  return addDays(iso, -(((dow - weekStartDow) % 7 + 7) % 7));
}

async function main() {
  const plan = (await pool.query<{ id: string; race_id: string | null; goal_iso: string | null }>(
    `SELECT id, race_id, goal_iso FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL ORDER BY authored_iso DESC LIMIT 1`, [U])).rows[0];
  if (!plan) { console.log('no active plan'); await pool.end(); return; }

  const liveRows = (await pool.query<{ d: string; type: string; mi: string | null; is_long: boolean }>(
    `SELECT date_iso AS d, type, distance_mi AS mi, is_long
       FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`, [plan.id])).rows
    .map((r) => ({ d: String(r.d).slice(0, 10), type: r.type, mi: Number(r.mi ?? 0), long: r.is_long }));
  const liveWeeks = (await pool.query<{ ws: string }>(
    `SELECT week_start_iso AS ws FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`, [plan.id]))
    .rows.map((r) => String(r.ws).slice(0, 10));

  const composed = await composeForUser({ userId: U, raceSlug: plan.race_id ?? undefined });
  if (!composed.ok) { console.log(`COMPOSE REFUSED: ${composed.reason}`); await pool.end(); return; }
  const { composed: cr, todayISO } = composed.result;
  const clipBeforeISO = requestedBlockStartISO(todayISO, 'monday', undefined);

  console.log(`today ${todayISO}`);
  console.log(`live plan ${plan.id}  race=${plan.race_id}  goal_iso=${plan.goal_iso}`);

  // Composed days, dated, then walked through the writer's own predicate.
  const compAll: Array<{ d: string; type: string; mi: number; long: boolean; wk: number }> = [];
  cr.weeks.forEach((w, wi) => {
    for (const day of w.days) {
      if (day.distanceMi === 0 && day.type !== 'rest' && day.type !== 'race') continue;
      compAll.push({
        d: dateForDow(w.startISO, day.dow as number), type: day.type,
        mi: day.distanceMi, long: day.isLong, wk: wi,
      });
    }
  });
  const sealedCache = new Map<string, boolean>();
  const sealed = async (iso: string) => {
    if (!sealedCache.has(iso)) sealedCache.set(iso, await isDaySealed(U, iso));
    return sealedCache.get(iso)!;
  };
  const compWritten: typeof compAll = [];
  for (const c of compAll) {
    const keep = persistsComposedDay({
      dateISO: c.d, todayISO, clipBeforeISO,
      sealed: c.d < todayISO ? await sealed(c.d) : false,
    });
    if (keep) compWritten.push(c);
  }

  const compWeekStarts = cr.weeks.map((w) => w.startISO);

  // ── 1 · span ──────────────────────────────────────────────────────────────
  console.log(`\n── SPAN ──`);
  console.log(`live      ${liveRows[0]?.d} → ${liveRows[liveRows.length - 1]?.d}   ${liveWeeks.length} weeks   ${liveRows.length} rows`);
  console.log(`composed  ${compWeekStarts[0]} → ${compAll[compAll.length - 1]?.d}   ${cr.weeks.length} weeks   ${compAll.length} composed rows, ${compWritten.length} would be written`);

  // ── 2 · week starts ───────────────────────────────────────────────────────
  console.log(`\n── WEEK STARTS ──`);
  const n = Math.max(liveWeeks.length, compWeekStarts.length);
  let alignedCount = 0;
  for (let i = 0; i < n; i++) {
    const l = liveWeeks[i] ?? '—'; const c = compWeekStarts[i] ?? '—';
    if (l === c) alignedCount++;
    console.log(` w${String(i).padStart(2)}  live ${l}   composed ${c}${l === c ? '' : '   <-- DIFFERS'}`);
  }
  console.log(`aligned week starts: ${alignedCount} of ${n}`);

  // ── 3 · weekly volume + long run ──────────────────────────────────────────
  const weekStartDow = new Date((liveWeeks[0] ?? todayISO) + 'T12:00:00Z').getUTCDay();
  type Agg = { mi: number; long: number };
  // The long-run column is the TRAINING long. Race day is `is_long` on both
  // sides and is 26.2 on both sides; folding it in would report a peak long the
  // block never prescribed as a run.
  const roll = (rows: Array<{ d: string; type: string; mi: number; long: boolean }>) => {
    const m = new Map<string, Agg>();
    for (const r of rows) {
      const k = weekStartOf(r.d, weekStartDow);
      const a = m.get(k) ?? { mi: 0, long: 0 };
      a.mi += r.mi;
      if (r.long && r.type !== 'race') a.long = Math.max(a.long, r.mi);
      m.set(k, a);
    }
    return m;
  };
  const liveAgg = roll(liveRows);
  const compAgg = roll(compAll);        // the composed CURVE, past weeks included
  const writtenAgg = roll(compWritten); // what would land on the calendar

  console.log(`\n── WEEKLY VOLUME / LONG RUN ──`);
  console.log(`week start     live mi   comp mi   writ mi     live long   comp long`);
  for (const k of [...new Set([...liveAgg.keys(), ...compAgg.keys()])].sort()) {
    const l = liveAgg.get(k); const c = compAgg.get(k); const w = writtenAgg.get(k);
    const f = (x: number | undefined) => (x == null ? '—' : x.toFixed(1));
    console.log(`${k}    ${f(l?.mi).padStart(7)}   ${f(c?.mi).padStart(7)}   ${f(w?.mi).padStart(7)}`
      + `     ${f(l?.long).padStart(9)}   ${f(c?.long).padStart(9)}`);
  }
  const peak = (m: Map<string, Agg>) => {
    let pv = 0, pvk = '', pl = 0, plk = '';
    for (const [k, a] of m) { if (a.mi > pv) { pv = a.mi; pvk = k; } if (a.long > pl) { pl = a.long; plk = k; } }
    return { pv, pvk, pl, plk };
  };
  const lp = peak(liveAgg); const cp = peak(compAgg);
  console.log(`\npeak week   live ${lp.pv.toFixed(1)} (${lp.pvk})   composed ${cp.pv.toFixed(1)} (${cp.pvk})`);
  console.log(`peak long   live ${lp.pl.toFixed(1)} (${lp.plk})   composed ${cp.pl.toFixed(1)} (${cp.plk})`);
  console.log(`vols: ${JSON.stringify(cr.vols)}`);

  // ── 4 · past-dated rows ───────────────────────────────────────────────────
  console.log(`\n── PAST-DATED LIVE ROWS (< ${todayISO}) ──`);
  const past = liveRows.filter((r) => r.d < todayISO);
  const writtenByDate = new Map(compWritten.map((c) => [c.d, c]));
  for (const r of past) {
    const c = writtenByDate.get(r.d);
    const s = await sealed(r.d);
    // Rule 15: on a SEALED day `persistPlan` overlays the prior plan's own
    // prescription, so the composer's value for that date is discarded and the
    // row the runner reads back is the live one. On an UNSEALED past day
    // `persistsComposedDay` drops the row outright (BACKDATE-1).
    const lands = s ? `CARRIED (Rule 15 · ${r.type} ${r.mi.toFixed(1)})`
      : c ? `${c.type} ${c.mi.toFixed(1)}` : 'NOT WRITTEN (BACKDATE-1 drops it)';
    console.log(` ${r.d}  sealed=${String(s).padEnd(5)} live ${r.type} ${r.mi.toFixed(1)}   → ${lands}`);
  }
  console.log(`past-dated live rows: ${past.length}`);

  // ── 5 · goal + race transaction ───────────────────────────────────────────
  const race = (await pool.query(
    `SELECT slug,
            plan->>'date' AS date_iso, plan->>'distance' AS distance,
            plan->>'priority' AS priority, plan->>'goalTime' AS goal_time,
            (actual_result IS NOT NULL) AS has_result
       FROM races WHERE user_uuid = $1 AND slug = $2`, [U, plan.race_id])).rows[0];
  console.log(`\n── GOAL / RACE TRANSACTION (read-only) ──`);
  console.log(` race row: ${JSON.stringify(race ?? null)}`);
  const allRaces = (await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM races WHERE user_uuid = $1`, [U])).rows[0];
  console.log(` race rows for this runner: ${allRaces?.n}`);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
