/**
 * mockup-profile.mjs — coach output for PROFILE page.
 * Per David: minimal coach, EXCEPT for shoes (rotation, retirement, race-fit).
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

const SYSTEM = `You are the coach on the PROFILE page. Per the runner's brief: minimal coach voice here — this surface is mostly "the guts" the user fills in. The ONE thing the coach speaks to is SHOES.

# Voice (shoes-focused)
1-2 short paragraphs. Talk about:
- Shoe rotation (which shoe for which day)
- Approaching retirement (~300-500 mi for trainers, ~150-250 for racing flats)
- Will the current racing shoe survive the upcoming A-race
- Should we look at a different pair for race day
- How mileage is tracking across the rotation

If no shoes need flagging, voice is brief / positive.

# Output JSON
{ "voice": "<short>", "topics": [...] }

Topic kinds:
- shoe_status: { kind, shoe_name, brand_model, current_mi, retirement_mi, status: fresh|seasoned|approaching_retirement|retire_soon, coach_note }
- shoe_race_fit: { kind, race_name, shoe_name, mi_at_race, status: fits|risky|wont_make_it, coach_note }
- shoe_rotation: { kind, rotation: [{shoe_name, role: easy|long|quality|race}], coach_note }
- profile_gap: { kind, field, why }   // for genuinely missing entries (height, etc)

Don't pad. If shoes are all fresh, one card + one short voice paragraph is enough.

NO markdown fences. JSON only.`;

async function loadState() {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const prof = (await pool.query(`SELECT full_name, sex, age, city, hrmax, rhr, height_cm, vo2max_apple FROM profile WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me') ORDER BY (user_uuid = $1) DESC LIMIT 1`, [USER_ID])).rows[0];

  // Shoes
  const shoes = (await pool.query(`SELECT id, brand, model, color, run_types, mileage, mileage_cap, retired, preferred FROM shoes WHERE user_uuid = $1 OR user_uuid IS NULL ORDER BY id`, [USER_ID])).rows;

  // Count strava runs per shoe for context
  const runsPerShoe = (await pool.query(`
    SELECT shoe_id, COUNT(*) AS n_runs
    FROM strava_activities
    WHERE (user_uuid = $1 OR user_uuid IS NULL) AND NOT (data ? 'mergedIntoId') AND shoe_id IS NOT NULL
    GROUP BY shoe_id
  `, [USER_ID])).rows;
  const nRunsByShoe = Object.fromEntries(runsPerShoe.map(r => [r.shoe_id, Number(r.n_runs)]));

  const shoesEnriched = shoes.filter(s => !s.retired).map(s => {
    const current = Number(s.mileage) || 0;
    const cap = Number(s.mileage_cap) || 400;
    return {
      id: s.id,
      name: `${s.brand} ${s.model}`,
      brand: s.brand,
      model: s.model,
      color: s.color,
      runTypes: s.run_types ?? [],
      preferred: s.preferred,
      currentMi: Math.round(current),
      capMi: cap,
      pctUsed: Math.round((current / cap) * 100),
      nRuns: nRunsByShoe[s.id] ?? 0,
    };
  });

  // Next A-race for race-fit context
  const races = (await pool.query(`SELECT slug, meta FROM races WHERE user_uuid = $1 OR user_uuid IS NULL`, [USER_ID])).rows;
  const nextA = races
    .map(r => ({ slug: r.slug, name: r.meta?.name, date: r.meta?.date, priority: r.meta?.priority }))
    .filter(r => r.date && r.date >= today && r.priority === 'A')
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const daysToA = nextA ? Math.round((Date.parse(nextA.date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000) : null;

  return { today, profile: prof, shoes: shoesEnriched, nextA, daysToA };
}

function buildMessage(s) {
  const lines = [];
  lines.push(`RUNNER: ${s.profile?.full_name ?? 'David'}.`);
  lines.push(`TODAY: ${s.today}.`);
  lines.push('');
  lines.push(`SHOES IN ROTATION:`);
  for (const sh of s.shoes) {
    lines.push(`  · ${sh.name} (${sh.brand} ${sh.model}) · ${sh.currentMi} / ${sh.targetMi} mi · ${sh.pctUsed}% used · ${sh.nRuns} runs`);
  }
  lines.push('');
  if (s.nextA) lines.push(`NEXT A-RACE: ${s.nextA.name} in ${s.daysToA} days.`);
  lines.push('');
  lines.push(`PROFILE DATA STATUS:`);
  lines.push(`  · height_cm: ${s.profile?.height_cm ?? 'NOT SET'}`);
  lines.push(`  · hrmax: ${s.profile?.hrmax ?? 'NOT SET (derivable)'}`);
  lines.push(`  · rhr: ${s.profile?.rhr ?? 'NOT SET (derivable)'}`);
  lines.push('');
  lines.push(`# YOUR JOB`);
  lines.push(`Brief coach voice ONLY about shoes. Surface shoe_status cards per shoe. shoe_race_fit if next A-race is far enough out that mileage projections matter. Maybe shoe_rotation card if there's an interesting rotation pattern. Don't pad if there's nothing to say.`);
  return lines.join('\n');
}

async function main() {
  const state = await loadState();
  const a = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  const resp = await a.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1200,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildMessage(state) }],
  });
  const raw = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  console.log('━━━ RAW LLM OUTPUT ━━━\n');
  console.log(raw.slice(0, 800));
  console.log('\n...');
  // Try to extract JSON object by braces
  let jsonText = raw;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();
  else {
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) jsonText = raw.slice(first, last + 1);
  }
  const parsed = JSON.parse(jsonText);
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
