/**
 * scripts/_promotion_replay.mjs · run the adjudication layer's promotion gate
 * READ-ONLY against every active production plan.
 *
 * Answers items 2.2 and 2.3: would the held `wire-adjudication` branch refuse
 * to author these plans? Writes nothing. DATABASE_URL_RO only.
 */
import pg from 'pg';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]));

const SUPPORTED_MAX = 0.10;
const ALLOWED_MAX = 0.25;
const classify = (p, d) => {
  if (p == null || d == null || d <= 0) return ['UNKNOWN', null];
  const s = p / d - 1;
  if (s <= SUPPORTED_MAX) return ['SUPPORTED', s];
  if (s <= ALLOWED_MAX) return ['ALLOWED', s];
  return ['CONDITIONAL', s];
};

const c = new pg.Client({ connectionString: env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows: plans } = await c.query(
  `SELECT tp.id, tp.user_uuid, tp.race_id, tp.goal_iso, u.email
     FROM training_plans tp JOIN users u ON u.id = tp.user_uuid
    WHERE tp.archived_iso IS NULL
    ORDER BY tp.authored_iso DESC`);

console.log('# checkPromotion · read-only replay against every active production plan\n');
console.log(`Active plans: **${plans.length}**. Nothing was written.\n`);

let blockedCount = 0;
const summary = [];

for (const p of plans) {
  // CORRECTED history · whole year, canonical rows only (Rule 14).
  const { rows: hw } = await c.query(
    `SELECT round(sum((data->>'distanceMi')::numeric),1) mi
       FROM runs
      WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
        AND (data->>'startLocal')>='2026-01-01'
      GROUP BY date_trunc('week',(data->>'startLocal')::timestamp)`, [p.user_uuid]);
  const peakWeeklyMi = hw.length ? Math.max(...hw.map((r) => Number(r.mi))) : null;

  const { rows: lr } = await c.query(
    `SELECT max((data->>'distanceMi')::numeric) m FROM runs
      WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
        AND (data->>'startLocal')>='2026-01-01' AND (data->>'distanceMi')::numeric < 26`,
    [p.user_uuid]);
  const longestRunMi = lr[0].m == null ? null : Number(lr[0].m);

  const { rows: wk } = await c.query(
    `SELECT to_char(date_trunc('week',date_iso::date),'YYYY-MM-DD') wk,
            round(sum(distance_mi)::numeric,1) mi,
            round(max(distance_mi) FILTER (WHERE is_long)::numeric,1) longmi,
            count(*) FILTER (WHERE is_quality) q,
            bool_or(type='race') has_race
       FROM plan_workouts WHERE plan_id=$1
      GROUP BY 1 ORDER BY 1`, [p.id]);

  const today = new Date().toISOString().slice(0, 10);
  const future = wk.filter((w) => w.wk >= today);

  const blocked = [];
  // Rule 11 · absent history is a RECORDED refusal, never a pass.
  if (peakWeeklyMi == null || longestRunMi == null) {
    blocked.push('athleteSpecificSupport · no demonstrated history to adjudicate against');
  } else {
    let projected = peakWeeklyMi;
    const seen = [];
    for (const w of future) {
      const mi = Number(w.mi);
      const long = w.longmi == null ? null : Number(w.longmi);
      // count(*) is a STRING from pg. Numeric before arithmetic.
      const stressors = Number(w.q ?? 0) + (long != null && long >= 15 ? 1 : 0);
      const [volCls] = classify(mi, projected);
      // The goal race is not a training long run.
      const [longCls] = w.has_race && long != null && long >= 26
        ? ['SUPPORTED'] : classify(long, longestRunMi);

      if (volCls === 'CONDITIONAL') blocked.push(`${w.wk} volume ${mi} is CONDITIONAL and ungated`);
      if (longCls === 'CONDITIONAL') blocked.push(`${w.wk} long ${long} is CONDITIONAL and ungated`);

      // one-stressor-at-a-time, Research/00a. Baseline is the trailing MAX of
      // up to 3 non-race weeks, never the single previous week: a planned
      // cutback poisons that comparison and misreported 4 of 13 weeks here.
      const win = seen.slice(-3).filter((x) => x.mi > 0);
      if (win.length > 0 && !win.every((x) => x.isDip)) {
        const baseMi = Math.max(...win.map((x) => x.mi));
        const baseStr = Math.max(...win.map((x) => x.stressors));
        const step = mi / baseMi - 1;
        if (step > 0.05 && stressors > baseStr) {
          blocked.push(`${w.wk} adds mileage (+${(step * 100).toFixed(1)}%) AND intensity (${baseStr} to ${stressors})`);
        }
      }
      projected = Math.max(projected, mi);
      // a race week that does NOT dip is normal training, not a prescribed dip
      seen.push({ mi, stressors, isDip: w.has_race && mi < (projected * 0.7) });
    }
  }

  const mayPromote = blocked.length === 0;
  if (!mayPromote) blockedCount += 1;
  summary.push({ id: p.id, email: p.email, race: p.race_id, weeks: future.length, peakWeeklyMi, longestRunMi, mayPromote, blocked });
}

console.log('| plan | race | future weeks | peak wk | longest | promote |');
console.log('|---|---|---:|---:|---:|---|');
for (const s of summary) {
  console.log(`| ${s.id.slice(0, 14)} | ${s.race ?? '-'} | ${s.weeks} | ${s.peakWeeklyMi ?? 'null'} | ${s.longestRunMi ?? 'null'} | ${s.mayPromote ? 'YES' : '**BLOCKED**'} |`);
}
console.log(`\n**${plans.length - blockedCount} of ${plans.length} would promote. ${blockedCount} blocked.**\n`);
for (const s of summary.filter((x) => !x.mayPromote)) {
  console.log(`### ${s.id} (${s.race ?? 'no race'})`);
  for (const b of s.blocked) console.log(`- ${b}`);
  console.log('');
}
await c.end();
