/**
 * mockup-health.mjs — coach output for HEALTH page.
 * Trends, insights, watch list. Coach informs, not prescribes.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
const env = Object.fromEntries(envText.split('\n').map((l) => l.match(/^([A-Z_]+)=(.+)$/)).filter(Boolean).map((m) => [m[1], m[2]]));

const USER_ID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const SYSTEM = `You are the coach on the HEALTH page. Trends + insights + watch list.

# Voice
2-4 short paragraphs. Inform, don't prescribe. Examples of tone:
- "Going to keep an eye on..."
- "Your sleep has been trending down 3 weeks running"
- "Weight's down a healthy 3lb / month"
- "HRV is holding steady, that's the signal we want during a build"

NOT: "You need to sleep 8 hours." NOT: "Drop 5 lbs."

It's a coach watching, noticing, surfacing patterns. The runner decides what to do with it.

# Output JSON
{ "voice": "<paragraphs>", "topics": [...] }

Topic kinds:
- sleep_trend: { kind, avg_h_last_7n, avg_h_last_30n, deficit_h_7n, direction: improving|stable|declining, coach_note }
- hrv_trend: { kind, current_ms, baseline_ms, direction, coach_note }
- rhr_trend: { kind, current_bpm, baseline_bpm, direction, coach_note }
- weight_trend: { kind, current_lb, delta_lb_30d, direction, coach_note }
- vo2_trend: { kind, current, source, coach_note }   // optional
- watch_list: { kind, items: [{label, status, coach_note_inline}], coach_note }   // things to monitor
- form_trends: { kind, metric, current, baseline, coach_note }   // e.g. cadence, stride

The HEALTH page is about LONG-TERM patterns. Don't surface today's run — that's TODAY's job.

NO markdown fences. JSON only.`;

async function loadState() {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // Sleep last 30
  const sleep30 = (await pool.query(`SELECT sample_date, value FROM health_samples WHERE user_id = $1 AND sample_type = 'sleep_hours' AND sample_date <= $2::date ORDER BY sample_date DESC LIMIT 30`, [USER_ID, today])).rows;
  const sleepVals = sleep30.map(r => Number(r.value)).filter(v => v > 0);
  const sleep7Avg = sleepVals.slice(0, 7).reduce((s, x) => s + x, 0) / Math.min(7, sleepVals.length);
  const sleep30Avg = sleepVals.reduce((s, x) => s + x, 0) / Math.max(1, sleepVals.length);
  const sleep7Deficit = sleepVals.slice(0, 7).reduce((s, x) => s + Math.max(0, 7.5 - x), 0);

  // HRV
  const hrv = (await pool.query(`SELECT value, recorded_at FROM health_samples WHERE user_id = $1 AND sample_type = 'hrv' ORDER BY recorded_at DESC LIMIT 30`, [USER_ID])).rows;
  const hrvVals = hrv.map(r => Number(r.value)).filter(v => v > 0);
  const hrvCurrent = hrvVals[0] ?? null;
  const hrvBaseline = hrvVals.length > 0 ? hrvVals.reduce((s, x) => s + x, 0) / hrvVals.length : null;

  // RHR
  const rhr = (await pool.query(`SELECT value, recorded_at FROM health_samples WHERE user_id = $1 AND sample_type = 'resting_hr' AND recorded_at >= NOW() - interval '60 days' ORDER BY recorded_at DESC`, [USER_ID])).rows;
  const rhrVals = rhr.map(r => Number(r.value)).filter(v => v > 0);
  const rhrCurrent = rhrVals[0] ?? null;
  const rhrBaseline = rhrVals.length > 0 ? Math.round(rhrVals.reduce((s, x) => s + x, 0) / rhrVals.length) : null;

  // Weight
  const weight = (await pool.query(`SELECT sample_date, value FROM health_samples WHERE user_id = $1 AND sample_type = 'body_mass' ORDER BY sample_date DESC LIMIT 8`, [USER_ID])).rows;
  const weightLb = weight.map(r => ({ date: r.sample_date.toISOString().slice(0, 10), lb: Number(r.value) * 2.20462 }));

  // VO2max
  const vo2 = (await pool.query(`SELECT value, recorded_at FROM health_samples WHERE user_id = $1 AND sample_type = 'vo2_max' ORDER BY recorded_at DESC LIMIT 5`, [USER_ID])).rows;
  const vo2Vals = vo2.map(r => Number(r.value)).filter(v => v > 0);

  // Form (cadence baseline + recent)
  const cad = (await pool.query(`
    SELECT sample_date, AVG(value)::numeric AS daily_avg FROM health_samples
    WHERE user_id=$1 AND sample_type='cadence' AND sample_date >= ($2::date - interval '60 days')
    GROUP BY sample_date ORDER BY sample_date DESC
  `, [USER_ID, today])).rows;
  const cadVals = cad.map(r => Number(r.daily_avg)).filter(v => v > 0);
  const cad7 = cadVals.slice(0, 7).reduce((s, x) => s + x, 0) / Math.max(1, Math.min(7, cadVals.length));
  const cad60 = cadVals.reduce((s, x) => s + x, 0) / Math.max(1, cadVals.length);

  return {
    today,
    sleep: { last7Avg: +sleep7Avg.toFixed(1), last30Avg: +sleep30Avg.toFixed(1), deficit7: +sleep7Deficit.toFixed(1), nights7: sleepVals.slice(0, 7) },
    hrv: { current: hrvCurrent, baseline: hrvBaseline ? +hrvBaseline.toFixed(0) : null, vals30: hrvVals.slice(0, 14) },
    rhr: { current: rhrCurrent, baseline: rhrBaseline, vals: rhrVals.slice(0, 14) },
    weight: { recent: weightLb.slice(0, 4).map(w => ({ date: w.date, lb: +w.lb.toFixed(1) })) },
    vo2: { vals: vo2Vals },
    form: { cadence7: +cad7.toFixed(0), cadence60: +cad60.toFixed(0), nDays: cadVals.length },
  };
}

function buildMessage(s) {
  const lines = [];
  lines.push(`RUNNER: David.`);
  lines.push(`TODAY: ${s.today}.`);
  lines.push('');
  lines.push(`SLEEP: 7-night avg ${s.sleep.last7Avg}h · 30-night avg ${s.sleep.last30Avg}h · 7-night cumulative deficit vs 7.5h target: ${s.sleep.deficit7}h`);
  lines.push(`HRV: current ${s.hrv.current}ms · 30-day baseline ${s.hrv.baseline}ms`);
  lines.push(`RESTING HR: current ${s.rhr.current}bpm · 60-day mean ${s.rhr.baseline}bpm`);
  lines.push(`WEIGHT: recent: ${s.weight.recent.map(w => `${w.date} ${w.lb}lb`).join(' · ')}`);
  if (s.vo2.vals.length > 0) lines.push(`VO2 max: ${s.vo2.vals[0]} (latest)`);
  lines.push(`CADENCE: 7-day mean ${s.form.cadence7} spm · 60-day mean ${s.form.cadence60} spm (${s.form.nDays} run days sampled)`);
  lines.push('');
  lines.push(`# YOUR JOB`);
  lines.push(`Coach voice on long-term health patterns. Inform, not prescribe. 2-4 paragraphs + topics. Surface a watch_list if there's something worth monitoring.`);
  return lines.join('\n');
}

async function main() {
  const state = await loadState();
  const a = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  const resp = await a.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildMessage(state) }],
  });
  const raw = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const parsed = JSON.parse(m ? m[1].trim() : raw);
  console.log('━━━ VOICE ━━━\n');
  console.log(parsed.voice);
  console.log('\n━━━ TOPICS ━━━\n');
  console.log(JSON.stringify(parsed.topics, null, 2));
  console.log(`\n  · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('\n━━━ STATE ━━━\n');
  console.log(JSON.stringify(state, null, 2));
  await pool.end();
}

main().catch((e) => { console.error('ERROR:', e); pool.end(); process.exit(1); });
