/**
 * _backfill_sublabel_from_spec.mjs · one-off · sync plan_workouts.sub_label
 * to subLabelFromSpec(workout_spec) for active plans.
 *
 * iPhone agent Tier 2.d brief 2026-06-03 · sub_label should be a
 * read-side projection of workout_spec · this script normalizes
 * existing rows so the field is consistent with the spec it was
 * authored against.
 *
 * Default = DRY-RUN. Pass --commit to apply.
 * Scope = active plans only (archived stay as historical record).
 */
import { Pool } from 'pg';

const COMMIT = process.argv.includes('--commit');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set.'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

// Mirrors lib/training/expand-spec.subLabelFromSpec · keep in sync.
function subLabelFromSpec(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const kind = String(spec.kind ?? '');
  switch (kind) {
    case 'easy':     return 'EASY';
    case 'recovery': return 'RECOVERY';
    case 'long':     return 'LONG';
    case 'race':     return 'RACE';
    case 'tempo': {
      const wu = Number(spec.warmup_mi ?? 0);
      const tempo = Number(spec.tempo_distance_mi ?? 0);
      const cd = Number(spec.cooldown_mi ?? 0);
      if (!wu && !cd) return `${formatMi(tempo)} continuous tempo`;
      return `${formatMi(wu)} mi WU · ${formatMi(tempo)} mi @ T · ${formatMi(cd)} mi CD`;
    }
    case 'threshold':
    case 'intervals': {
      const reps = Number(spec.rep_count ?? 0);
      const repMi = Number(spec.rep_distance_mi ?? 0);
      const repM = Number(spec.rep_distance_m ?? 0);
      const effRepMi = repMi > 0 ? repMi : (repM / 1609.34);
      const restS = Number(spec.rep_rest_s ?? 0);
      const repLabel = formatRepLabel(effRepMi);
      const paceTag = kind === 'intervals' ? '@ I' : '@ T pace';
      return `${reps}×${repLabel} ${paceTag} · ${formatRestLabel(restS)}`;
    }
    default: return null;
  }
}
function formatMi(n) { const r = Math.round(n * 10) / 10; return r % 1 === 0 ? String(r) : r.toFixed(1); }
function formatRepLabel(repMi) {
  if (Math.abs(repMi - 1.0) < 0.05) return '1 mi';
  if (Math.abs(repMi - 0.621) < 0.02) return '1 km';
  if (Math.abs(repMi - 0.497) < 0.02) return '800 m';
  if (Math.abs(repMi - 0.249) < 0.02) return '400 m';
  if (Math.abs(repMi - 1.243) < 0.03) return '2 km';
  return `${repMi.toFixed(2)} mi`;
}
function formatRestLabel(s) {
  if (s <= 0) return 'jog rest';
  if (s >= 60 && s % 60 === 0) return `${s / 60} min jog`;
  if (s >= 60) {
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}:${String(r).padStart(2, '0')} jog`;
  }
  return `${s}s jog`;
}

async function main() {
  console.log(`[sub_label backfill] ${COMMIT ? 'LIVE' : 'DRY-RUN'}\n`);
  const rows = (await pool.query(
    `SELECT pw.id, pw.sub_label, pw.workout_spec, pw.type, pw.date_iso::text AS date
       FROM plan_workouts pw
       JOIN training_plans p ON p.id = pw.plan_id
      WHERE p.archived_iso IS NULL
        AND pw.workout_spec IS NOT NULL`,
  )).rows;
  console.log(`Found ${rows.length} active-plan rows with workout_spec\n`);

  const updates = [];
  for (const r of rows) {
    const want = subLabelFromSpec(r.workout_spec);
    if (want && want !== r.sub_label) {
      updates.push({ id: r.id, date: r.date, type: r.type, old: r.sub_label, new: want });
    }
  }
  console.log(`${updates.length} rows where stored sub_label != spec-derived:\n`);
  for (const u of updates.slice(0, 30)) {
    console.log(`  ${u.date} · ${u.type.padEnd(10)} · "${u.old}" → "${u.new}"`);
  }
  if (updates.length > 30) console.log(`  ... and ${updates.length - 30} more`);

  if (!COMMIT) { console.log('\nDry-run · pass --commit to apply.'); await pool.end(); return; }
  if (updates.length === 0) { console.log('Nothing to do.'); await pool.end(); return; }
  for (const u of updates) {
    await pool.query(`UPDATE plan_workouts SET sub_label = $1 WHERE id = $2`, [u.new, u.id]);
  }
  console.log(`\nUpdated ${updates.length} sub_labels.`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
