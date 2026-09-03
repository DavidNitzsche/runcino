// Standalone week table, isolated from rebuild-preview.ts's unconditional main().
import { pool } from '@/lib/db/pool';
import { composeForUser } from '@/lib/plan/generate';

const U = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';

async function main() {
  const plan = (await pool.query<{ id: string; race_id: string | null }>(
    `SELECT id, race_id FROM training_plans WHERE user_uuid=$1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`, [U])).rows[0];
  const live = (await pool.query<{ date_iso: string; type: string; distance_mi: string | null }>(
    `SELECT date_iso, type, distance_mi FROM plan_workouts WHERE plan_id=$1 ORDER BY date_iso`, [plan.id])).rows;
  const c = await composeForUser({ userId: U, raceSlug: plan.race_id ?? undefined });
  if (!c.ok) { console.log('refused'); return; }
  const cr = c.result.composed as unknown as { weeks: Array<{ startISO: string; days: Array<Record<string, unknown>> }> };

  const wk = (iso: string) => {
    const d = new Date(Date.parse(iso + 'T12:00:00Z'));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
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
  console.log('week        live mi  new mi   Δ      Δ%     live long  new long');
  for (const k of keys) {
    const l = liveW.get(k) ?? { mi: 0, long: 0 };
    const n = newW.get(k) ?? { mi: 0, long: 0 };
    const d = n.mi - l.mi;
    const pct = l.mi > 0 ? (d / l.mi) * 100 : (n.mi > 0 ? 100 : 0);
    console.log(`${k}  ${l.mi.toFixed(1).padStart(7)}  ${n.mi.toFixed(1).padStart(6)}  ${(d>=0?'+':'')+d.toFixed(1).padStart(5)}  ${(pct>=0?'+':'')+pct.toFixed(0).padStart(4)}%   ${l.long.toFixed(1).padStart(8)}  ${n.long.toFixed(1).padStart(8)}`);
  }
  const lPeak = Math.max(...[...liveW.values()].map(v=>v.mi));
  const nPeak = Math.max(...[...newW.values()].map(v=>v.mi));
  const lLong = Math.max(...[...liveW.values()].map(v=>v.long));
  const nLong = Math.max(...[...newW.values()].map(v=>v.long));
  console.log(`\npeak week   live ${lPeak.toFixed(1)}  ->  new ${nPeak.toFixed(1)}`);
  console.log(`peak long   live ${lLong.toFixed(1)}  ->  new ${nLong.toFixed(1)}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
