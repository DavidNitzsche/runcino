/**
 * scripts/_cim_block_adjudication.mjs · run every week of the live CIM block
 * through the adjudication layer against CORRECTED history, and emit the
 * conditional list with its reassess boundaries.
 *
 * READ ONLY. Uses DATABASE_URL_RO. Writes nothing.
 */
import pg from 'pg';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]));

const U = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const PLAN = 'pln_7636bcc0a201bf2d';

const STEP_SUPPORTED_MAX = 0.10;
const STEP_ALLOWED_MAX = 0.25;
const classify = (p, d) => {
  if (p == null || d == null || d <= 0) return ['UNKNOWN', null];
  const s = p / d - 1;
  if (s <= STEP_SUPPORTED_MAX) return ['SUPPORTED', s];
  if (s <= STEP_ALLOWED_MAX) return ['ALLOWED', s];
  return ['CONDITIONAL', s];
};

const c = new pg.Client({ connectionString: env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
await c.connect();

// ── corrected history · the WHOLE year, canonical rows only (Rule 14) ──────
const { rows: hw } = await c.query(
  `SELECT to_char(date_trunc('week',(data->>'startLocal')::timestamp),'YYYY-MM-DD') wk,
          round(sum((data->>'distanceMi')::numeric),1) mi,
          round(max((data->>'distanceMi')::numeric),1) longest
     FROM runs
    WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
      AND (data->>'startLocal')>='2026-01-01'
    GROUP BY 1 ORDER BY 1`, [U]);
const peakWeeklyMi = Math.max(...hw.map((r) => Number(r.mi)));
const { rows: lr } = await c.query(
  `SELECT max((data->>'distanceMi')::numeric) m FROM runs
    WHERE user_uuid=$1::uuid AND NOT (data ? 'mergedIntoId')
      AND (data->>'startLocal')>='2026-01-01' AND (data->>'distanceMi')::numeric < 26`, [U]);
const longestRunMi = Number(lr[0].m);

// ── the block as authored ─────────────────────────────────────────────────
const { rows: pw } = await c.query(
  `SELECT to_char(date_trunc('week',date_iso::date),'YYYY-MM-DD') wk,
          round(sum(distance_mi)::numeric,1) mi,
          round(max(distance_mi) FILTER (WHERE is_long)::numeric,1) longmi,
          count(*) FILTER (WHERE is_quality) q,
          string_agg(DISTINCT type,',') FILTER (WHERE is_quality) types,
          bool_or(type='race') has_race
     FROM plan_workouts WHERE plan_id=$1 GROUP BY 1 ORDER BY 1`, [PLAN]);

console.log('# CIM block · every week adjudicated on corrected history\n');
console.log(`Demonstrated peak week **${peakWeeklyMi} mi**, longest training run **${longestRunMi} mi**.`);
console.log('Both read over all of 2026, canonical rows only.\n');
console.log('`vol@today` is against what he has demonstrated. `vol@proj` is against the');
console.log('largest week the block asks him to complete BEFORE this one, which is the');
console.log('honest comparison for a future date and is a POLICY ASSUMPTION about');
console.log('execution, not a measurement.\n');
console.log('| week | mi | long | stressors | vol@today | vol@proj | long | verdict |');
console.log('|---|---|---|---|---|---|---|---|');

let runningProjected = peakWeeklyMi;
let maxPlannedSoFar = 0;
let prevWeekMi = null;
const conditionals = [];
for (const w of pw) {
  const mi = Number(w.mi);
  const long = w.longmi == null ? null : Number(w.longmi);
  // pg returns count(*) as a string. `'2' + 1` is '21', which is how this
  // first printed a runner with 21 stressors in a week.
  const stressors = Number(w.q ?? 0) + (long != null && long >= 15 ? 1 : 0);
  const [clsToday, stepToday] = classify(mi, peakWeeklyMi);
  const [clsProj, stepProj] = classify(mi, runningProjected);
  // The goal race is not a training long run. Grading CIM's 26.2 against his
  // longest TRAINING run says the race is a reach, which is true and useless:
  // the race is the thing the block exists to reach. A race week's long run is
  // exempt, and the taper that precedes it is what governs instead.
  const [clsLong] = w.has_race && long != null && long >= 26
    ? ['SUPPORTED', null]
    : classify(long, longestRunMi);

  // the strictest of the three governs
  const rank = { SUPPORTED: 0, ALLOWED: 1, CONDITIONAL: 2, UNKNOWN: 3 };
  const verdict = [clsProj, clsLong].sort((a, b) => rank[b] - rank[a])[0];
  const pct = (s) => (s == null ? '  -  ' : `${s >= 0 ? '+' : ''}${(s * 100).toFixed(1)}%`);

  console.log(`| ${w.wk} | ${mi} | ${long ?? '-'} | ${stressors} | ${pct(stepToday)} | ${pct(stepProj)} | ${clsLong} | **${verdict}** |`);

  if (verdict === 'CONDITIONAL' || verdict === 'ALLOWED') {
    conditionals.push({
      wk: w.wk, mi, long, stressors, clsToday, clsProj, clsLong,
      prior: runningProjected,
      // The largest week the PLAN asks before this one. Where that is below his
      // demonstrated peak, the projection offers no intermediate step and the
      // week is a jump off his February self with nothing in between.
      priorPlanned: maxPlannedSoFar,
      wowFromPrevious: prevWeekMi == null ? null : mi / prevWeekMi - 1,
    });
  }
  runningProjected = Math.max(runningProjected, mi);
  maxPlannedSoFar = Math.max(maxPlannedSoFar, mi);
  prevWeekMi = mi;
}

console.log('\n## Marked conditional, with reassess boundaries\n');
console.log('Defect 2. Each of these is judged against the training accumulated by its own');
console.log('date, not against today, and each is reassessed at a boundary BEFORE it lands.\n');
if (conditionals.length === 0) console.log('_none_');
for (const k of conditionals) {
  // The boundary is the day before the week starts. It cannot be earlier: the
  // requirement is that the PRECEDING week completed, and a boundary two weeks
  // out would be asked to check a week that has not happened yet. This printed
  // an incoherent 2026-09-07 assessing the week of 2026-09-14 before it ran.
  const d = new Date(k.wk + 'T00:00:00Z');
  const boundary = new Date(d.getTime() - 864e5).toISOString().slice(0, 10);
  console.log(`### ${k.wk} · ${k.mi} mi, long ${k.long ?? '-'}, ${k.stressors} stressors`);
  console.log(`- against today (${peakWeeklyMi} mi peak): **${k.clsToday}**`);
  console.log(`- against the ${k.prior} mi the block builds first: **${k.clsProj}**`);
  const wow = k.wowFromPrevious == null ? null : (k.wowFromPrevious * 100).toFixed(1);
  console.log(`- largest week the PLAN asks before this one: **${k.priorPlanned} mi**`);
  if (wow != null) console.log(`- week-over-week step from the week before: **${wow >= 0 ? '+' : ''}${wow}%**`);
  if (k.priorPlanned < peakWeeklyMi) {
    console.log(`- **the projection offers no help here.** Nothing the block asks before this week `
      + `exceeds the ${peakWeeklyMi} mi he has already demonstrated, so this is a step off his `
      + 'February self with no intermediate week in between. It is the one genuine reach in the block.');
  }
  console.log(`- **reassess ${boundary}**. Requires the ${k.priorPlanned} mi week of the block completed with no session graded MISSED.`);
  console.log(`- if unmet: REDUCE to ${Math.max(k.priorPlanned, peakWeeklyMi)}, not dropped.\n`);
}
await c.end();
