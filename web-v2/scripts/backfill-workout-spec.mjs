/**
 * backfill-workout-spec.mjs
 *
 * Migration 120 added a `workout_spec` JSONB column on `plan_workouts`.
 * Plans authored AFTER the migration land with the column populated by
 * the plan-builder. Plans authored BEFORE — every existing row — have
 * a NULL spec, which makes the WorkoutBreakdown component (on
 * /runs/[id]) and the Poster A3 breakdown rows (on /today) fall back to
 * the placeholder pace bands instead of real Daniels-VDOT numbers.
 *
 * This script re-computes the spec for each existing plan_workouts row
 * against the runner's CURRENT VDOT and writes it back. It is safe to
 * re-run — workouts that already have a spec are skipped.
 *
 * USAGE (user invokes manually after deploy):
 *   cd web-v2
 *   node scripts/backfill-workout-spec.mjs
 *
 * The script is NOT run automatically. Per the migration 120 task spec,
 * the column ships in NULL state and runners get real numbers either
 * (a) on their next plan re-authoring, or (b) via this backfill.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '');
  return a;
}, {});

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Mirror the plan-builder's buildWorkoutSpec logic ─────────────────
// The full implementation lives in legacy/web/coach/plan-builder.ts. To
// keep this script standalone (no TS compile, no web-v2 → legacy import
// surface), we mirror the relevant slice here. If the plan-builder
// evolves, this mirror MUST be updated in lock-step — otherwise the
// backfill diverges from what fresh authoring produces.
//
// NOTE: this is a v1 backfill. Once the plan-builder + LTHR threading
// move into web-v2 we can `import { buildWorkoutSpec } from ...` and
// delete this mirror.

function paceCenter(band) {
  if (!band) return null;
  return Math.round((band.lowS + band.highS) / 2);
}

// Phase 31 (2026-05-28 · LTHR wire) · the plan-builder now threads
// profile.lthr through buildWorkoutSpec and emits LTHR-anchored HR
// fields (easy → ~88% LTHR, long → 85%, recovery → 75%, threshold =
// LTHR direct, tempo/mp → 92%). This backfill mirrors the same math so
// re-runs converge with fresh-authored plans. When `lthr` is null
// (runner has no manual LTHR set), HR fields stay null and renderers
// fall back to placeholders. Cite: Friel · Research/03 §6 (LTHR zones).
function buildWorkoutSpec(type, subLabel, distanceMi, paceSet, lthr) {
  if (!paceSet) return null;
  const easyHrCap     = lthr != null ? Math.round(lthr * 0.88) : null;
  const longHrCap     = lthr != null ? Math.round(lthr * 0.85) : null;
  const recoveryHrCap = lthr != null ? Math.round(lthr * 0.75) : null;
  const tempoHrTarget = lthr != null ? Math.round(lthr * 0.92) : null;

  switch (type) {
    case 'easy': {
      const fuelMi = distanceMi >= 8 ? [Math.round(distanceMi / 2)] : undefined;
      return {
        kind: 'easy',
        pace_target_s_per_mi_lo: paceSet.E.lowS,
        pace_target_s_per_mi_hi: paceSet.E.highS,
        hr_cap_bpm: easyHrCap,
        ...(fuelMi ? { fuel_mi: fuelMi } : {}),
      };
    }
    case 'long': {
      const checkpoints = [];
      if (distanceMi >= 4) {
        for (let mi = 4; mi <= Math.floor(distanceMi); mi += 4) checkpoints.push(mi);
      }
      if (subLabel === 'Long Run · Progression' || subLabel === 'Long Run · HM Finish') {
        const progDist = Math.max(2, Math.round(distanceMi / 3));
        const wm = Math.max(1, Math.round((distanceMi - progDist) * 0.5));
        const cd = Math.max(0, +(distanceMi - wm - progDist).toFixed(1));
        return {
          kind: 'progression',
          warmup_mi: wm,
          prog_distance_mi: progDist,
          prog_start_s_per_mi: paceSet.E.lowS,
          prog_end_s_per_mi: paceSet.T.lowS,
          cooldown_mi: cd,
          hr_cap_bpm: longHrCap,
        };
      }
      return {
        kind: 'long',
        pace_target_s_per_mi_lo: paceSet.E.lowS,
        pace_target_s_per_mi_hi: paceSet.E.highS,
        hr_cap_bpm: longHrCap,
        fuel_mi: checkpoints,
      };
    }
    case 'threshold': {
      const warmupMi = 1.5;
      const cooldownMi = 1;
      const repPaceS = paceCenter(paceSet.T) ?? paceSet.T.lowS;
      if (subLabel === 'HM Continuous Tempo') {
        const tempoMi = Math.max(2, distanceMi - warmupMi - cooldownMi);
        return {
          kind: 'tempo',
          warmup_mi: warmupMi,
          tempo_distance_mi: +tempoMi.toFixed(1),
          tempo_pace_s_per_mi: repPaceS,
          cooldown_mi: cooldownMi,
          hr_target_bpm: tempoHrTarget,
        };
      }
      if (subLabel === 'HM Cruise Intervals') {
        return { kind: 'threshold', warmup_mi: warmupMi, rep_count: 3, rep_distance_mi: 2,
          rep_pace_s_per_mi: repPaceS, rep_rest_s: 90, cooldown_mi: cooldownMi, lthr_bpm: lthr };
      }
      if (subLabel === 'HM Threshold Blocks') {
        return { kind: 'threshold', warmup_mi: warmupMi, rep_count: 2, rep_distance_mi: 3,
          rep_pace_s_per_mi: repPaceS, rep_rest_s: 120, cooldown_mi: cooldownMi, lthr_bpm: lthr };
      }
      if (subLabel === 'Threshold Touch') {
        return { kind: 'threshold', warmup_mi: warmupMi, rep_count: 2, rep_distance_mi: 1.5,
          rep_pace_s_per_mi: repPaceS, rep_rest_s: 90, cooldown_mi: cooldownMi, lthr_bpm: lthr };
      }
      return { kind: 'threshold', warmup_mi: warmupMi, rep_count: 5, rep_distance_m: 1000,
        rep_pace_s_per_mi: repPaceS, rep_rest_s: 60, cooldown_mi: cooldownMi, lthr_bpm: lthr };
    }
    case 'interval':
      return {
        kind: 'intervals',
        warmup_mi: 1.5,
        rep_count: 5,
        rep_distance_m: 1000,
        rep_pace_s_per_mi: paceCenter(paceSet.I) ?? paceSet.I.lowS,
        rep_rest_s: 90,
        cooldown_mi: 1,
        lthr_bpm: lthr,
      };
    case 'mp': {
      const warmupMi = 1;
      const cooldownMi = 1;
      const mpDist = Math.max(2, +(distanceMi - warmupMi - cooldownMi).toFixed(1));
      return {
        kind: 'mp',
        warmup_mi: warmupMi,
        mp_distance_mi: mpDist,
        mp_pace_s_per_mi: paceCenter(paceSet.M) ?? paceSet.M.lowS,
        cooldown_mi: cooldownMi,
        hr_target_bpm: tempoHrTarget,
      };
    }
    case 'recovery': {
      return {
        kind: 'recovery',
        pace_target_s_per_mi_lo: paceSet.E.lowS + 30,
        pace_target_s_per_mi_hi: paceSet.E.highS + 30,
        hr_cap_bpm: recoveryHrCap,
      };
    }
    case 'race_week_tuneup':
      return {
        kind: 'threshold',
        warmup_mi: 1.5,
        rep_count: 4,
        rep_distance_m: 1000,
        rep_pace_s_per_mi: paceCenter(paceSet.T) ?? paceSet.T.lowS,
        rep_rest_s: 90,
        cooldown_mi: 1,
        lthr_bpm: lthr,
      };
    case 'shakeout':
    case 'rest':
    case 'race':
    default:
      return null;
  }
}

// ── Resolve a runner's current VDOT and Daniels paces ────────────────
// We can't import the TS pacesFromVdot from legacy/, but we CAN read
// the cached pace set straight from the user's profile if it's stored.
// For v1 the simplest approach: skip plans where the runner has no
// authored_state.vdotSnapshot. If you need a more aggressive backfill,
// add a per-user VDOT resolver here.

async function loadPaceSetForPlan(client, planId) {
  // The training_plans row's authored_state JSONB carries the snapshot
  // used at authoring time. The plan-builder stored a vdotSnapshot when
  // a race result existed; if absent, we can't backfill (return null).
  // The DanielsPaceSet shape mirrors lib/vdot.ts.
  const r = await client.query(
    `SELECT authored_state FROM training_plans WHERE id = $1`,
    [planId],
  );
  const state = r.rows[0]?.authored_state;
  if (!state || typeof state !== 'object') return null;
  // The authored_state.vdotSnapshot subtree (if present) is what we
  // emit at authoring. Mirror plan-builder.ts § paces line: paces is
  // null when vdotSnap is null. Pass through; if you have a smarter
  // VDOT resolver, plug it in here.
  const paces = state.danielsPaces ?? null;
  return paces;
}

// Phase 31 · LTHR-per-runner lookup. Mirrors state-loader.ts's profile
// query — the user_id on training_plans maps to profile rows by
// user_uuid (or by legacy user_id='me' for anon-bound data). Returns
// null when no LTHR is set so the spec emits null HR fields and the
// renderer falls back to placeholders. Cite: Friel · Research/03 §6.
async function loadLthrForUser(client, userId) {
  // user_id on training_plans is a uuid (when authenticated) or 'me' for
  // legacy single-tenant rows. Try the uuid path first; if it's not a
  // valid uuid format, fall back to the 'me'-anchored row.
  const isUuid = typeof userId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
  if (isUuid) {
    const r = await client.query(
      `SELECT lthr FROM profile
        WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
        ORDER BY (user_uuid = $1) DESC LIMIT 1`,
      [userId],
    );
    return r.rows[0]?.lthr ?? null;
  }
  // Legacy 'me' fallback.
  const r = await client.query(
    `SELECT lthr FROM profile WHERE user_id = 'me' AND user_uuid IS NULL LIMIT 1`,
  );
  return r.rows[0]?.lthr ?? null;
}

// ── Main backfill loop ───────────────────────────────────────────────

async function main() {
  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  const client = await pool.connect();
  try {
    const { rows: plans } = await client.query(
      `SELECT id, user_id FROM training_plans WHERE archived_iso IS NULL`,
    );
    console.log(`Found ${plans.length} active plans.`);

    for (const plan of plans) {
      const paceSet = await loadPaceSetForPlan(client, plan.id);
      if (!paceSet) {
        console.log(`  · plan ${plan.id} — no VDOT/paceSet in authored_state; skipping.`);
        continue;
      }

      // Phase 31 · resolve the runner's LTHR so HR caps/targets are
      // emitted alongside pace targets. Null when the runner hasn't set
      // a manual LTHR — HR fields ship null and the renderer falls back
      // to placeholders (no fabrication).
      const lthr = await loadLthrForUser(client, plan.user_id);
      const lthrTag = lthr != null ? `LTHR=${lthr}` : 'LTHR=null (no profile.lthr)';

      const { rows: workouts } = await client.query(
        `SELECT id, type, sub_label, distance_mi, workout_spec
           FROM plan_workouts
          WHERE plan_id = $1 AND workout_spec IS NULL`,
        [plan.id],
      );

      for (const w of workouts) {
        scanned++;
        const spec = buildWorkoutSpec(w.type, w.sub_label, Number(w.distance_mi), paceSet, lthr);
        if (!spec) {
          skipped++;
          continue;
        }
        await client.query(
          `UPDATE plan_workouts SET workout_spec = $2 WHERE id = $1`,
          [w.id, JSON.stringify(spec)],
        );
        updated++;
      }
      console.log(`  · plan ${plan.id} (${lthrTag}) — scanned ${workouts.length} null-spec rows.`);
    }
  } finally {
    client.release();
  }

  console.log(`\nBACKFILL COMPLETE.`);
  console.log(`  scanned: ${scanned}`);
  console.log(`  updated: ${updated}`);
  console.log(`  skipped (no spec for type): ${skipped}`);
  await pool.end();
}

main().catch((e) => {
  console.error('backfill failed:', e);
  process.exit(1);
});
