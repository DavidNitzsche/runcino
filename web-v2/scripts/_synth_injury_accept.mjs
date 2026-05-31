/**
 * Synthetic injury-proposal-accept end-to-end test.
 *
 * Exercises the full Q-08 path:
 *   1. Note David's current active plan
 *   2. Insert a synthetic runner_injuries row (resolved_date NULL, severity='moderate')
 *   3. Drive the adaptation cycle by directly inserting the coach_proposals row
 *      that detectInjuryActive + actionsForTrigger would produce (we can't import
 *      ESM .ts from a .mjs script, but the proposal-write path is just a single
 *      INSERT — reproduce it faithfully here so the shape matches what the
 *      production engine writes)
 *   4. Replay what the accept route does: archive prior plan, call buildInjuryPlan
 *      (also reproduced inline since it's the dead code we just rescued)
 *   5. Assert: new training_plans row with mode_label='injury-return',
 *      total_weeks=3 (moderate), 3 plan_weeks rows, plan_workouts populated,
 *      mode='maintenance' (per buildInjuryPlan)
 *   6. Cleanup: delete every synthetic row + restore David's race-prep plan
 *
 * Run with:
 *   cd web-v2 && DATABASE_URL=... node scripts/_synth_injury_accept.mjs
 *
 * For accuracy we shell out to a tiny tsx-style inline runner that imports
 * the real buildInjuryPlan from lib/plan/injury-builder. If tsx isn't
 * available, we fall through to a parity-check SQL replay (less strict but
 * still confirms the shape).
 */
import pg from 'pg';
import fs from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '');
  return a;
}, {});

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const log = (...a) => console.log(...a);

// Ledger of every row we create so cleanup is exhaustive even on partial-failure.
const ledger = {
  injuryId: null,
  proposalId: null,
  newPlanId: null,
  archivedPlanIds: [],   // training_plans rows we set archived_iso on (NULL → NOW())
};

async function q(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function snapshotActivePlans() {
  return q(
    `SELECT id, mode, race_id, goal_iso, archived_iso, authored_iso
       FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC`,
    [DAVID],
  );
}

async function cleanup() {
  log('\n— cleanup —');
  try {
    if (ledger.newPlanId) {
      const w = await q(`DELETE FROM plan_workouts WHERE plan_id = $1 RETURNING id`, [ledger.newPlanId]);
      log(`  deleted ${w.length} plan_workouts`);
      const wk = await q(`DELETE FROM plan_weeks WHERE plan_id = $1 RETURNING id`, [ledger.newPlanId]);
      log(`  deleted ${wk.length} plan_weeks`);
      const ph = await q(`DELETE FROM plan_phases WHERE plan_id = $1 RETURNING id`, [ledger.newPlanId]);
      log(`  deleted ${ph.length} plan_phases`);
      const p = await q(`DELETE FROM training_plans WHERE id = $1 RETURNING id`, [ledger.newPlanId]);
      log(`  deleted ${p.length} training_plans (injury-return)`);
    }
    if (ledger.archivedPlanIds.length) {
      const r = await q(
        `UPDATE training_plans SET archived_iso = NULL
          WHERE id = ANY($1::text[])
          RETURNING id`,
        [ledger.archivedPlanIds],
      );
      log(`  restored ${r.length} training_plans (race-prep un-archived)`);
    }
    if (ledger.proposalId) {
      const r = await q(`DELETE FROM coach_proposals WHERE id = $1 RETURNING id`, [ledger.proposalId]);
      log(`  deleted ${r.length} coach_proposals`);
    }
    // Also clean any coach_intents the accept route wrote for this proposal.
    if (ledger.proposalId) {
      const r = await q(
        `DELETE FROM coach_intents
          WHERE user_uuid = $1::uuid
            AND reason IN ('injury_plan_built', 'illness_acknowledged')
            AND field = $2
          RETURNING id`,
        [DAVID, String(ledger.proposalId)],
      );
      log(`  deleted ${r.length} coach_intents (accept artifacts)`);
    }
    if (ledger.injuryId) {
      const r = await q(`DELETE FROM runner_injuries WHERE id = $1 RETURNING id`, [ledger.injuryId]);
      log(`  deleted ${r.length} runner_injuries`);
    }
    log('  cleanup done.');
  } catch (e) {
    log('  ⚠️ CLEANUP FAILED:', e.message);
    log('  ledger:', JSON.stringify(ledger));
  }
}

async function main() {
  log('— Synthetic injury-accept E2E test —');
  log('DB:', (env.DATABASE_URL ?? '').slice(0, 50) + '…');

  // 1. Snapshot the active plans.
  const before = await snapshotActivePlans();
  log(`\n[1] David active plans before: ${before.length}`);
  before.forEach(p => log(`    ${p.id} mode=${p.mode} race=${p.race_id} goal=${p.goal_iso}`));

  // 2. Insert synthetic injury.
  const injuryRow = (await q(
    `INSERT INTO runner_injuries (user_id, user_uuid, site, severity, return_protocol, notes, start_date, resolved_date, created_at)
     VALUES ($1::text, $1::uuid, 'left calf', 'moderate', '4-week walk-run', 'synthetic test row — DELETE ME', CURRENT_DATE - 2, NULL, NOW())
     RETURNING id, site, severity, start_date`,
    [DAVID],
  ))[0];
  ledger.injuryId = injuryRow.id;
  log(`\n[2] Inserted synthetic injury id=${injuryRow.id} site=${injuryRow.site} severity=${injuryRow.severity}`);

  // 3. Write the coach_proposals row that the engine would write. Match the
  //    payload shape from lib/plan/adapt.ts (case 'injury_active') + the
  //    evidence the detector produces. The accept route reads evidence.injury_id.
  const proposalRow = (await q(
    `INSERT INTO coach_proposals (user_uuid, user_id, proposal_type, payload, status, created_at)
     VALUES ($1::uuid, $1::text, 'injury_adjust', $2::jsonb, 'pending', NOW())
     RETURNING id, proposal_type, status`,
    [DAVID, JSON.stringify({
      reason: `Active ${injuryRow.site} injury (${injuryRow.severity}). Switch to INJURY-mode walk-run + cross-train.`,
      evidence: {
        injury_id: injuryRow.id,
        site: injuryRow.site,
        severity: injuryRow.severity,
        return_protocol: '4-week walk-run',
        start_date: String(injuryRow.start_date).slice(0, 10),
      },
      suggested: 'Walk-run scaffold + cross-train. Pain-monitor in-session, 24h, location (per Research/05). Suspend running ≥ 5/10 pain.',
    })],
  ))[0];
  ledger.proposalId = proposalRow.id;
  log(`\n[3] Inserted coach_proposals id=${proposalRow.id} type=${proposalRow.proposal_type} status=${proposalRow.status}`);

  // 4. Drive the accept path using a tsx process that imports the real
  //    buildInjuryPlan. Falls back to an SQL-only replay if tsx is unavailable.
  log(`\n[4] Invoking buildInjuryPlan via tsx subprocess...`);
  const tsxScript = `
    import { buildInjuryPlan } from './lib/plan/injury-builder';
    const r = await buildInjuryPlan({ userId: '${DAVID}', injuryId: ${injuryRow.id} });
    console.log(JSON.stringify(r));
    process.exit(0);
  `;
  const tsxPath = path.join(process.cwd(), '_synth_invoke.mts');
  fs.writeFileSync(tsxPath, tsxScript);
  let buildResult = null;
  try {
    const child = spawnSync('npx', ['--yes', 'tsx', tsxPath], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
      encoding: 'utf8',
      timeout: 90_000,
    });
    log('  tsx stdout:', (child.stdout ?? '').trim());
    if (child.stderr) log('  tsx stderr:', child.stderr.trim().slice(0, 800));
    const lastLine = (child.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '{}';
    try {
      buildResult = JSON.parse(lastLine);
    } catch {
      log('  tsx output not JSON; falling through to SQL-only check');
    }
  } catch (e) {
    log('  tsx invocation errored:', e.message);
  } finally {
    try { fs.unlinkSync(tsxPath); } catch {}
  }

  if (!buildResult?.ok || !buildResult.plan_id) {
    throw new Error('buildInjuryPlan did not return an ok+plan_id payload — abort. ' + JSON.stringify(buildResult));
  }
  ledger.newPlanId = buildResult.plan_id;
  log(`  buildInjuryPlan ok plan_id=${buildResult.plan_id} weeks_generated=${buildResult.weeks_generated}`);

  // Record any plans that just got archived as a side-effect so cleanup
  // un-archives them (David's race-prep plan).
  const justArchived = await q(
    `SELECT id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NOT NULL
        AND archived_iso > NOW() - INTERVAL '2 minutes'
        AND id <> $2`,
    [DAVID, ledger.newPlanId],
  );
  ledger.archivedPlanIds = justArchived.map(r => r.id);
  log(`  side-effect-archived ${ledger.archivedPlanIds.length} prior plans (will restore in cleanup)`);

  // 5. Assertions.
  log(`\n[5] Asserting shape of new plan...`);
  const plan = (await q(
    `SELECT id, mode, race_id, goal_iso, archived_iso,
            authored_state->>'mode_label' AS mode_label,
            (authored_state->>'total_weeks')::int AS total_weeks,
            authored_state->>'severity' AS severity,
            authored_state->>'injury_site' AS injury_site,
            (authored_state->>'injury_id')::int AS injury_id_in_state
       FROM training_plans WHERE id = $1`,
    [ledger.newPlanId],
  ))[0];
  const phases = await q(`SELECT id, label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1`, [ledger.newPlanId]);
  const weeks = await q(`SELECT id, week_idx, week_start_iso, is_race_week FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`, [ledger.newPlanId]);
  const workouts = await q(`SELECT id, date_iso, dow, type, distance_mi, sub_label FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso, dow`, [ledger.newPlanId]);

  const assertions = [
    ['training_plans row exists',                  plan != null,                                       true],
    ['mode_label = "injury-return"',               plan?.mode_label === 'injury-return',               true],
    ['total_weeks = 3 (moderate severity)',        plan?.total_weeks === 3,                            true],
    ['severity = "moderate"',                      plan?.severity === 'moderate',                      true],
    ['injury_site = "left calf"',                  plan?.injury_site === 'left calf',                  true],
    ['injury_id_in_state matches synthetic',       plan?.injury_id_in_state === injuryRow.id,          true],
    ['plan archived_iso is NULL (active)',         plan?.archived_iso == null,                         true],
    ['plan mode = "maintenance"',                  plan?.mode === 'maintenance',                       true],
    ['plan_phases: 1 row labelled INJURY-RETURN',  phases.length === 1 && phases[0].label === 'INJURY-RETURN', true],
    ['plan_weeks: 3 rows',                         weeks.length === 3,                                 true],
    ['plan_weeks idx 0,1,2',                       weeks.map(w => w.week_idx).join(',') === '0,1,2',   true],
    ['plan_workouts: >0 rows',                     workouts.length > 0,                                true],
    ['plan_workouts has REST + WALK + WALK-RUN',
      workouts.some(w => w.sub_label === 'REST')
      && workouts.some(w => w.sub_label?.startsWith('WALK 25'))
      && workouts.some(w => w.sub_label?.startsWith('WALK-RUN')),                                      true],
  ];
  let pass = 0;
  for (const [label, got, want] of assertions) {
    const ok = got === want;
    log(`  ${ok ? '✓' : '⚠️'} ${label.padEnd(48)} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
    if (ok) pass++;
  }
  log(`\n  ${pass}/${assertions.length} assertions pass`);

  log(`\n  plan summary:`);
  log(`    plan_id           = ${ledger.newPlanId}`);
  log(`    weeks_generated   = ${weeks.length}`);
  log(`    workouts_written  = ${workouts.length}`);
  log(`    mode_label        = ${plan.mode_label}`);
  log(`    severity          = ${plan.severity}`);
  log(`    mode (DB col)     = ${plan.mode}`);
  log(`    goal_iso          = ${plan.goal_iso}`);

  if (pass !== assertions.length) {
    throw new Error(`Only ${pass}/${assertions.length} assertions pass — see above`);
  }
  log('\n✓ Synthetic injury-accept test PASSED');
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  console.error('\n⚠️ TEST FAILED:', e.message);
  if (e.stack) console.error(e.stack);
  exitCode = 1;
} finally {
  await cleanup();
  await pool.end();
}
process.exit(exitCode);
