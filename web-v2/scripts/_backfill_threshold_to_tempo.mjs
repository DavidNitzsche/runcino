/**
 * _backfill_threshold_to_tempo.mjs · one-time retype + respec of
 * plan_workouts rows that are mistyped 'threshold' but describe a
 * continuous tempo ("N mi WU · M mi @ T · N mi CD").
 *
 * Root cause (workout_library): some library rows have family='threshold'
 * with prescription_text describing a continuous tempo. The generator
 * picked those for threshold-quality slots, so the plan_workouts row
 * landed with type='threshold' under a tempo label. spec-builder's
 * threshold branch produced a rep spec (4×1mi · 60s rest) under a
 * label promising "4 mi @ T continuous". Three-way disagreement.
 *
 * Going forward: lib/plan/generate.ts now detects the tempo shape and
 * sets type='tempo' when the picked threshold-library row is actually
 * a continuous tempo (2026-06-02 commit). This script fixes existing
 * rows on the active plan.
 *
 *   node web-v2/scripts/_backfill_threshold_to_tempo.mjs
 *   node web-v2/scripts/_backfill_threshold_to_tempo.mjs --commit
 *
 * Active plan only · archived plans stay as-is (historical record,
 * referenced by bench tests + audit tools).
 */
import { Pool } from 'pg';

const COMMIT = process.argv.includes('--commit');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set.'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

/** Mirrors lib/plan/prescription-parser.ts § parseTempoShape. */
function parseTempoShape(s) {
  if (!s) return null;
  const m = String(s).match(
    /(\d+(?:\.\d+)?)\s*(?:mi)?\s*WU\s*[·•]\s*(\d+(?:\.\d+)?)\s*mi\s*@[^·•]+[·•]\s*(\d+(?:\.\d+)?)\s*(?:mi)?\s*CD/i,
  );
  if (!m) return null;
  return {
    warmupMi: parseFloat(m[1]),
    tempoMi: parseFloat(m[2]),
    cooldownMi: parseFloat(m[3]),
  };
}

async function main() {
  console.log(`[backfill threshold→tempo] ${COMMIT ? 'LIVE' : 'DRY-RUN'}\n`);
  // Active-plan-only · use COALESCE on user identifier to match the
  // training_plans.archived_iso convention.
  const rows = (await pool.query(`
    SELECT pw.id, pw.type, pw.distance_mi::numeric AS distance_mi,
           pw.sub_label, pw.workout_spec, pw.date_iso::text AS date,
           pw.plan_id
      FROM plan_workouts pw
      JOIN training_plans p ON p.id = pw.plan_id
     WHERE p.archived_iso IS NULL
       AND pw.type = 'threshold'
       AND pw.sub_label LIKE '% mi WU%'
     ORDER BY pw.date_iso ASC
  `)).rows;

  console.log(`Found ${rows.length} candidate rows on the active plan\n`);

  const updates = [];
  for (const r of rows) {
    const parsed = parseTempoShape(r.sub_label);
    if (!parsed) continue;
    const newDistance = Number(
      (parsed.warmupMi + parsed.tempoMi + parsed.cooldownMi).toFixed(1),
    );
    // Build the tempo spec · take rep_pace_s_per_mi from the existing
    // threshold spec as the tempo_pace (T-pace is the same number).
    const existingSpec = r.workout_spec ?? {};
    const tPace = Number(existingSpec.rep_pace_s_per_mi)
      || Number(existingSpec.tempo_pace_s_per_mi)
      || null;
    const lthr = existingSpec.lthr_bpm ?? null;
    const hrTarget = lthr ? Math.round(Number(lthr) * 0.92) : null;
    const newSpec = {
      kind: 'tempo',
      warmup_mi: Number(parsed.warmupMi.toFixed(1)),
      tempo_distance_mi: Number(parsed.tempoMi.toFixed(1)),
      tempo_pace_s_per_mi: tPace,
      cooldown_mi: Number(parsed.cooldownMi.toFixed(1)),
      hr_target_bpm: hrTarget,
    };
    updates.push({
      id: r.id, date: r.date, sub: r.sub_label,
      oldType: r.type, oldDistance: Number(r.distance_mi),
      newSpec, newDistance,
    });
  }

  console.log(`${updates.length} rows would change:\n`);
  for (const u of updates) {
    console.log(`  ${u.date} · ${u.sub}`);
    console.log(`      OLD: type=${u.oldType} · distance=${u.oldDistance}mi · rep-shaped spec`);
    console.log(`      NEW: type=tempo · distance=${u.newDistance}mi · tempo spec ${u.newSpec.warmup_mi}+${u.newSpec.tempo_distance_mi}+${u.newSpec.cooldown_mi}`);
  }
  console.log();

  if (!COMMIT) {
    console.log('Dry-run complete. Re-run with --commit to apply.');
    await pool.end();
    return;
  }
  if (updates.length === 0) {
    console.log('Nothing to apply.');
    await pool.end();
    return;
  }

  let applied = 0;
  for (const u of updates) {
    await pool.query(
      `UPDATE plan_workouts
          SET type         = 'tempo',
              workout_spec = $1::jsonb,
              distance_mi  = $2
        WHERE id = $3`,
      [JSON.stringify(u.newSpec), u.newDistance, u.id],
    );
    applied++;
  }
  console.log(`Updated ${applied} plan_workouts rows (type + spec + distance_mi).`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
