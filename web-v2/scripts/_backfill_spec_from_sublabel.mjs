/**
 * _backfill_spec_from_sublabel.mjs · one-time backfill of
 * plan_workouts.workout_spec to match the sub_label prescription.
 *
 * Was (David's flag 2026-06-02): some rows have
 *   sub_label  = "4×1 mi @ I · 3 min jog"
 *   workout_spec = { rep_count: 5, rep_distance_mi: 0.62, rep_rest_s: 90 }
 * Two different workouts. Fixed at generate.ts going forward · this
 * catches existing rows.
 *
 * For each row where:
 *   · type IN ('threshold','intervals')
 *   · sub_label parses to a rep prescription
 *   · existing spec disagrees with the parsed values
 * → recompute spec.rep_count / rep_distance_mi / rep_rest_s + WU + CD
 * → recompute distance_mi from the new spec (so total still matches)
 *
 * Mirrors lib/plan/prescription-parser.ts inline so the script stays
 * a single-file hand-runnable. Doctrine: keep the regex set in sync
 * with the parser source.
 *
 *   node web-v2/scripts/_backfill_spec_from_sublabel.mjs
 *   node web-v2/scripts/_backfill_spec_from_sublabel.mjs --commit
 */
import { Pool } from 'pg';

const COMMIT = process.argv.includes('--commit');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set.'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

/** Mirrors lib/plan/prescription-parser.ts · parsePrescription. */
function parsePrescription(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/(\d+)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*(mi|km|k|m)\b/);
  if (!m) return null;
  const reps = parseInt(m[1], 10);
  const value = parseFloat(m[2]);
  const unit = m[3].toLowerCase();
  let repMi;
  switch (unit) {
    case 'mi': repMi = value; break;
    case 'km': case 'k': repMi = value * 0.621371; break;
    case 'm': repMi = (value / 1000) * 0.621371; break;
    default: return null;
  }
  repMi = Number(repMi.toFixed(3));
  // Rest
  let restS = null;
  const sM = s.match(/(\d+)\s*s(?:ec)?\b/i);
  const mmss = s.match(/(\d+):(\d{2})\s*jog/i);
  const minM = s.match(/(\d+)\s*[-\s]?\s*min\s*jog/i);
  if (sM) restS = parseInt(sM[1], 10);
  else if (mmss) restS = parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  else if (minM) restS = parseInt(minM[1], 10) * 60;
  return { reps, repMi, restS };
}

/** Mirrors spec-builder.totalDistanceMiFromSpec for threshold/intervals. */
function totalDistanceMi(spec) {
  const wu = Number(spec.warmup_mi ?? 0) || 0;
  const cd = Number(spec.cooldown_mi ?? 0) || 0;
  const reps = Number(spec.rep_count ?? 0) || 0;
  const repMi = Number(spec.rep_distance_mi ?? 0) || 0;
  const restS = Number(spec.rep_rest_s ?? 0) || 0;
  const repTotal = reps * repMi;
  const floatTotal = Math.max(0, reps - 1) * (restS / 540);
  return Number((wu + repTotal + floatTotal + cd).toFixed(1));
}

async function main() {
  console.log(`[backfill spec] ${COMMIT ? 'LIVE' : 'DRY-RUN'}\n`);
  const rows = (await pool.query(
    `SELECT id, type, distance_mi::numeric AS distance_mi, sub_label, workout_spec, date_iso::text AS date
       FROM plan_workouts
      WHERE type IN ('threshold', 'intervals')
        AND sub_label IS NOT NULL
        AND workout_spec IS NOT NULL
      ORDER BY date_iso ASC`,
  )).rows;
  console.log(`Found ${rows.length} candidate rows`);

  const updates = [];
  for (const r of rows) {
    const parsed = parsePrescription(r.sub_label);
    if (!parsed) continue;  // can't speak about this row · skip
    const cur = r.workout_spec;
    const curReps = Number(cur.rep_count ?? 0);
    const curMi = Number(cur.rep_distance_mi ?? 0) ||
                  (Number(cur.rep_distance_m ?? 0) / 1609.34);
    const curRest = Number(cur.rep_rest_s ?? 0);
    const agrees =
      curReps === parsed.reps
      && Math.abs(curMi - parsed.repMi) < 0.02
      && (parsed.restS == null || Math.abs(curRest - parsed.restS) < 2);
    if (agrees) continue;

    // Recompute · drop rep_distance_m if present (use _mi only going forward).
    const newCore = parsed.reps * parsed.repMi;
    const restS = parsed.restS ?? curRest ?? (r.type === 'intervals' ? 90 : 60);
    const targetTotal = Number(r.distance_mi);
    const wuRaw = (targetTotal - newCore - 1) / 2;
    const wu = Number(Math.max(1.5, wuRaw).toFixed(1));
    const cd = Number(Math.max(1.0, wuRaw).toFixed(1));
    const newSpec = {
      ...cur,
      rep_count: parsed.reps,
      rep_distance_mi: parsed.repMi,
      rep_rest_s: restS,
      warmup_mi: wu,
      cooldown_mi: cd,
    };
    delete newSpec.rep_distance_m;  // remove legacy key
    const newDistance = totalDistanceMi(newSpec);
    updates.push({
      id: r.id, date: r.date, type: r.type, sub: r.sub_label,
      old: { reps: curReps, repMi: curMi.toFixed(2), restS: curRest, distance: Number(r.distance_mi) },
      new: { reps: parsed.reps, repMi: parsed.repMi, restS, distance: newDistance },
      newSpec,
    });
  }

  console.log(`\n${updates.length} rows would change:\n`);
  for (const u of updates.slice(0, 50)) {
    const o = u.old, n = u.new;
    console.log(`  ${u.date} · ${u.type.padEnd(10)} · ${u.sub}`);
    console.log(`      OLD: ${o.reps}×${o.repMi}mi · ${o.restS}s rest · total ${o.distance}mi`);
    console.log(`      NEW: ${n.reps}×${n.repMi}mi · ${n.restS}s rest · total ${n.distance}mi`);
  }
  if (updates.length > 50) console.log(`  ... and ${updates.length - 50} more`);
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
          SET workout_spec = $1::jsonb,
              distance_mi  = $2
        WHERE id = $3`,
      [JSON.stringify(u.newSpec), u.new.distance, u.id],
    );
    applied++;
  }
  console.log(`Updated ${applied} plan_workouts rows (spec + distance_mi).`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
