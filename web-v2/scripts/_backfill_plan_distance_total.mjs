/**
 * _backfill_plan_distance_total.mjs · one-time backfill of
 * plan_workouts.distance_mi to TOTAL miles (WU + core + floats + CD)
 * for rows with a workout_spec.
 *
 * Was: distance_mi stored just the core (e.g. "4×1 mi @ T" → 4.0)
 * while sub_label and workout_spec described the full WU + core + CD
 * = ~7 mi. Runner saw "4.0 mi" on the card but the breakdown summed
 * to ~7. Fixed at the generator 2026-06-02 · this catches existing
 * rows.
 *
 * Mirrors lib/plan/spec-builder.totalDistanceMiFromSpec (one source
 * of truth · this script re-implements the math inline to stay a
 * single-file hand-runnable).
 *
 * Default = DRY-RUN: prints what would change. Pass --commit to apply.
 *
 *   node web-v2/scripts/_backfill_plan_distance_total.mjs
 *   node web-v2/scripts/_backfill_plan_distance_total.mjs --commit
 *
 * Idempotent · re-running on already-correct rows is a no-op.
 */
import { Pool } from 'pg';

const COMMIT = process.argv.includes('--commit');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set.');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

/** Mirrors spec-builder.totalDistanceMiFromSpec · keep in sync. */
function totalDistanceMiFromSpec(spec, fallback) {
  if (!spec || typeof spec !== 'object') return fallback;
  const kind = String(spec.kind ?? '');
  const wu = Number(spec.warmup_mi ?? 0) || 0;
  const cd = Number(spec.cooldown_mi ?? 0) || 0;
  switch (kind) {
    case 'tempo': {
      const core = Number(spec.tempo_distance_mi ?? 0) || 0;
      return Number((wu + core + cd).toFixed(1));
    }
    case 'threshold':
    case 'intervals': {
      const reps = Number(spec.rep_count ?? 0) || 0;
      // Two schema variants: rep_distance_mi (newer) and rep_distance_m
      // (older legacy rows in metres). Prefer miles.
      const repMi = Number(spec.rep_distance_mi ?? 0) || 0;
      const repM = Number(spec.rep_distance_m ?? 0) || 0;
      const effRepMi = repMi > 0 ? repMi : repM / 1609.34;
      const restS = Number(spec.rep_rest_s ?? 0) || 0;
      const repTotal = reps * effRepMi;
      const floatTotal = Math.max(0, reps - 1) * (restS / 540);
      return Number((wu + repTotal + floatTotal + cd).toFixed(1));
    }
    default:
      return fallback;
  }
}

async function main() {
  console.log(`[backfill] ${COMMIT ? 'LIVE' : 'DRY-RUN'} · plan_workouts.distance_mi from workout_spec\n`);

  const rows = (await pool.query(
    `SELECT pw.id, pw.type, pw.distance_mi::numeric AS distance_mi, pw.workout_spec,
            pw.date_iso, pw.sub_label, p.user_uuid::text AS user_uuid
       FROM plan_workouts pw
       JOIN training_plans p ON p.id = pw.plan_id
      WHERE pw.workout_spec IS NOT NULL
        AND pw.type IN ('tempo', 'threshold', 'intervals')
      ORDER BY pw.date_iso ASC`,
  )).rows;
  console.log(`Found ${rows.length} candidate rows (tempo / threshold / intervals with workout_spec)\n`);

  // 2026-06-02 · only apply INCREASES. A decrease could be undoing an
  // adapter shave (shave reduces distance_mi without touching spec) ·
  // safer to leave those alone. The flagged-but-skipped list goes in
  // the open-questions report so we can revisit after the spec/sub_label
  // mismatch is resolved separately.
  const increases = [];
  const skippedDecreases = [];
  for (const r of rows) {
    const current = Number(r.distance_mi);
    const newTotal = totalDistanceMiFromSpec(r.workout_spec, current);
    const delta = newTotal - current;
    if (delta >= 0.05) {
      increases.push({ id: r.id, date: r.date_iso, type: r.type, sub: r.sub_label, current, newTotal });
    } else if (delta <= -0.05) {
      skippedDecreases.push({ id: r.id, date: r.date_iso, type: r.type, sub: r.sub_label, current, newTotal });
    }
  }

  console.log(`${increases.length} rows would INCREASE (the original David-flagged bug · 4mi → 7mi shape):\n`);
  for (const u of increases.slice(0, 50)) {
    console.log(`  ${u.date} · ${u.type.padEnd(10)} · ${String(u.current).padEnd(6)} → ${u.newTotal} mi · ${u.sub ?? ''} (id=${u.id})`);
  }
  if (increases.length > 50) console.log(`  ... and ${increases.length - 50} more`);
  console.log();

  if (skippedDecreases.length > 0) {
    console.log(`${skippedDecreases.length} rows would DECREASE (skipped · could be adapter-shaved · review separately):\n`);
    for (const u of skippedDecreases.slice(0, 30)) {
      console.log(`  ${u.date} · ${u.type.padEnd(10)} · ${String(u.current).padEnd(6)} → ${u.newTotal} mi (NOT applied) · ${u.sub ?? ''} (id=${u.id})`);
    }
    if (skippedDecreases.length > 30) console.log(`  ... and ${skippedDecreases.length - 30} more`);
    console.log();
  }

  const updates = increases;

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
      `UPDATE plan_workouts SET distance_mi = $1 WHERE id = $2`,
      [u.newTotal, u.id],
    );
    applied++;
  }
  console.log(`Updated ${applied} plan_workouts rows.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
