/**
 * scripts/v5-roundtrip-seed.ts · SIX DIRECTIONS OF PROPOSAL, ON A SCRATCH PLAN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The owner's finding, verbatim: "The card is rendered, but acceptance has never
 * been proven." Rule 13 answers that by RENDERING with real data — and the
 * proposal surface has the problem `ProposalHarnessV5.swift` already names:
 * there is almost nothing to render. Production has written a handful of
 * `plan_workout_proposals` rows in the life of the product and every one of them
 * is a `field_test`, so opening Today against the real account exercises ONE of
 * six directions and proves nothing about the other five.
 *
 * `ProposalHarnessV5` solved that with a JSON fixture on the phone. That is
 * honest about what it proves and it is explicitly NOT what Rule 13 asks for:
 * it skips the network hop, the auth layer, `toWire`'s mapping off a real
 * database row, and the accept and dismiss writes — which is to say, it skips
 * exactly the half the owner says was never proven.
 *
 * So this file moves the seam all the way back to the database. It writes real
 * rows, against the runner's real (copied) plan, and everything downstream of
 * the row is the shipping code path: `loadPendingProposals` → `toWire` →
 * `/api/v5/today` → the phone's own decoder → `ProposalCardV5`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL HERE AND WHAT IS NOT · say it before anyone has to ask
 *
 * REAL. The plan rows (copied from production, read-only, by
 * `scripts/walk-substrate.ts`). The action union, built by the SHIPPING
 * generators — `actionFromAdaptation` and `holdFor`. The
 * serializer. The writer: four of the six go through `writeWorkoutProposals`,
 * the same function the evening cron calls, including its dedup, its
 * sealed-day check, its citation scrub and its `describesEvidence` gate.
 *
 * NOT REAL. The DETECTION. No trigger fired; this file hands the writer the
 * actions a trigger would have handed it. That is the deliberate boundary: this
 * proves the lane from the decision onward, and says nothing about whether the
 * engine would have made these decisions on this data.
 *
 * NOT REAL, AND A FINDING RATHER THAN A SHORTCUT. `hold` and `stop` do NOT go
 * through `writeWorkoutProposals`, because they CANNOT: `PROPOSABLE_KINDS` is a
 * set of `AdaptationAction['kind']`, and HOLD, REFUSAL and SAFETY_STOP are not
 * members of that type at all. The repo says so itself —
 * `lib/audit/generated-content-registry.ts` records the SAFETY_STOP generator as
 * "COMPLETE AND DELIBERATELY UNWIRED", waiting on the canonical safety slice. So
 * for those two this file writes the row the way a writer would once one exists,
 * in the real serializer's envelope. The HOLD comes from its real generator; the
 * SAFETY_STOP is written out as a fixture rather than generated, and the reason
 * is at that call site — importing the generator from a script would make the
 * repo's own orphan gate believe a deliberately-unwired module had been wired.
 * Every reader downstream is untouched. The report says which two those are.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT FAIL ON (Rule 22)
 *
 * · WHETHER THE ENGINE WOULD RAISE THESE PROPOSALS. It is handed them. A green
 *   run says the lane carries a decision; it says nothing about detection.
 * · WHETHER THE COACHING IS RIGHT. Sizing is the adjudicator's.
 * · ANYTHING ABOUT PRODUCTION. It refuses to run against anything that is not
 *   the loopback scratch database it owns, and the refusal is fence 1 below.
 * · THE PHONE. It stands up rows. Which build of the app reads them, and what it
 *   draws, is the screenshot's job and not this file's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 *
 *   bash scripts/walk-substrate.sh          # FAFF_WALK_DB=faff_v5_roundtrip
 *   bash scripts/v5-roundtrip-seed.sh       # this
 *   bash scripts/walk-server.sh             # serve it on :3111
 */

import '@/lib/verify/install-barrier';
import { inspectConnectionString } from '@/lib/adaptation-harness/fence';
import { pool } from '@/lib/db/pool';
import { writeWorkoutProposals } from '@/lib/plan/workout-proposals';
import { holdFor } from '@/lib/brain/proposal/generate/from-seal';
import { serializeAction } from '@/lib/brain/proposal/serialize';
import type { AdaptationAction, AdaptationTrigger } from '@/lib/plan/adapt';
import type { BrainAction } from '@/lib/brain/proposal/action';
import { ACTION_SCHEMA_VERSION } from '@/lib/brain/proposal/action';

const SEED_DB = process.env.FAFF_WALK_DB || 'faff_v5_roundtrip';
const OWNER_UUID =
  process.env.FAFF_WALK_OWNER_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** This file's own source tag, so a teardown can find exactly what it wrote. */
const SEED_SOURCE = 'v5_roundtrip_seed';

function say(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s);
}

function refuse(why: string): never {
  // eslint-disable-next-line no-console
  console.error(`\n[seed] REFUSING TO RUN\n  ${why}\n`);
  process.exit(2);
}

/* ── fence 1 · the target ────────────────────────────────────────────────────
 *
 * The same predicate `walk-substrate.ts` and the adaptation harness use, asked
 * about this database's name. There is one owner of "may I write to the
 * database this string names" and this is not a second one (Rule 16).
 *
 * Falsify it with:
 *   DATABASE_URL=postgresql://u:p@crossover.proxy.rlwy.net:20769/railway \
 *     bash scripts/v5-roundtrip-seed.sh
 */
function assertTarget(): void {
  const v = inspectConnectionString(process.env.DATABASE_URL, SEED_DB);
  if (!v.ok) refuse(v.refusal ?? 'the target connection string could not be proven local');
  say(`fence · target ${v.host}/${v.database} is loopback and is this seed's own database`);
}

interface Row {
  id: string;
  date_iso: string;
  type: string;
  distance_mi: number | null;
}

async function upcoming(): Promise<Row[]> {
  // Rule 14 · the population is named: this runner, by uuid, on the ACTIVE
  // plan only. A join on user_uuid alone reads all 49 plan versions in this
  // scratch copy.
  const { rows } = await pool.query<{
    id: string; date_iso: string; type: string; distance_mi: string | number | null;
  }>(
    `SELECT pw.id, pw.date_iso::text AS date_iso, pw.type, pw.distance_mi
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid
        AND tp.archived_iso IS NULL
        AND pw.date_iso > $2
      ORDER BY pw.date_iso
      LIMIT 40`,
    [OWNER_UUID, todayISO()],
  );
  return rows.map((r) => ({
    id: r.id,
    date_iso: r.date_iso,
    type: r.type,
    distance_mi: r.distance_mi === null ? null : Number(r.distance_mi),
  }));
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A trigger, in the shape `writeWorkoutProposals` reads it. */
function trigger(kind: string, reason: string, evidence: Record<string, unknown>): AdaptationTrigger {
  return { kind, severity: 'info', reason, evidence } as unknown as AdaptationTrigger;
}

/**
 * The two kinds no writer can produce, written the way a writer would.
 *
 * `action_kind` carries the engine word the reader falls back on, and the
 * `action` payload carries the decision itself — which is what
 * `actionFromPending` prefers, and therefore what decides the card. Nothing
 * downstream of this INSERT is special-cased for the seed.
 */
async function insertUnwritable(
  action: BrainAction,
  row: Row,
  actionKind: string,
  reason: string,
  evidence: Record<string, unknown>,
): Promise<number> {
  const payload = {
    newType: null, newDate: null, shaveFraction: null, newDistanceMi: null,
    why: reason,
    action: serializeAction(action),
  };
  const r = await pool.query<{ id: number }>(
    `INSERT INTO plan_workout_proposals
       (user_uuid, plan_workout_id, workout_date_iso, action_kind,
        action_payload, reason, evidence, source)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8)
     RETURNING id`,
    [OWNER_UUID, row.id, row.date_iso, actionKind,
      JSON.stringify(payload), reason,
      JSON.stringify({ ...evidence, planned_type: row.type, planned_distance_mi: row.distance_mi }),
      SEED_SOURCE],
  );
  return r.rows[0].id;
}

async function main(): Promise<void> {
  assertTarget();

  // Clear anything this seed wrote before, so a re-run is idempotent and does
  // not stack six more cards on the runner's Today.
  const cleared = await pool.query(
    `DELETE FROM plan_workout_proposals WHERE user_uuid = $1::uuid AND source = $2`,
    [OWNER_UUID, SEED_SOURCE],
  );
  const clearedCron = await pool.query(
    `DELETE FROM plan_workout_proposals
      WHERE user_uuid = $1::uuid AND status = 'pending' AND source <> $2`,
    [OWNER_UUID, SEED_SOURCE],
  );
  say(`cleared · ${cleared.rowCount ?? 0} seeded, ${clearedCron.rowCount ?? 0} other pending`);

  const rows = await upcoming();
  if (rows.length < 8) refuse(`only ${rows.length} upcoming sessions on the active plan; need at least 8`);

  const pick = (pred: (r: Row) => boolean, used: Set<string>): Row => {
    const r = rows.find((x) => pred(x) && !used.has(x.id));
    if (!r) refuse('no upcoming session matches one of the six directions');
    used.add(r.id);
    return r;
  };
  const used = new Set<string>();

  const easyForPush = pick((r) => r.type === 'easy' && (r.distance_mi ?? 0) >= 5, used);
  const qualityForCut = pick(isQualityish, used);
  const easyForMove = pick((r) => r.type === 'easy', used);
  const qualityForRecovery = pick(isQualityish, used);
  const anyForHold = pick((r) => r.type !== 'rest', used);
  const anyForStop = pick((r) => r.type !== 'rest', used);

  say('');
  say('sessions chosen from the ACTIVE plan');
  for (const [label, r] of [
    ['push', easyForPush], ['pull_back', qualityForCut], ['move', easyForMove],
    ['recovery', qualityForRecovery], ['hold', anyForHold], ['stop', anyForStop],
  ] as [string, Row][]) {
    say(`  ${label.padEnd(10)} ${r.date_iso}  ${r.type.padEnd(10)} ${r.distance_mi ?? '-'} mi  ${r.id}`);
  }

  /* ── the four the shipping writer can carry ─────────────────────────────── */

  const actions: AdaptationAction[] = [
    {
      kind: 'mark_upgrade',
      workoutIds: [easyForPush.id],
      why: 'You absorbed 47.3 miles against 45.5 prescribed across the last three weeks, '
        + 'with no late-session fade on either long run.',
      bumps: [{ workoutId: easyForPush.id, newDistanceMi: Math.round(((easyForPush.distance_mi ?? 6) + 1.5) * 10) / 10 }],
      sourceTrigger: 'volume_headroom',
    } as unknown as AdaptationAction,
    {
      kind: 'shave',
      workoutIds: [qualityForCut.id],
      shaveFraction: 0.17,
      why: 'Your last two threshold sessions each lost 14 seconds a mile over the final rep, '
        + 'and average heart rate on both sat 6 bpm above the prescribed ceiling.',
      sourceTrigger: 'quality_fade',
    } as unknown as AdaptationAction,
    {
      kind: 'reschedule',
      workoutIds: [easyForMove.id],
      newDate: addDays(easyForMove.date_iso, 1),
      why: 'The long run and this session land back to back this week.',
      sourceTrigger: 'spacing',
    } as unknown as AdaptationAction,
    {
      kind: 'downgrade',
      workoutIds: [qualityForRecovery.id],
      newType: 'recovery',
      why: 'Resting heart rate has run 7 bpm above your own baseline for four consecutive '
        + 'mornings and HRV is 22 percent below your 60-day mean.',
      sourceTrigger: 'readiness_pullback',
    } as unknown as AdaptationAction,
  ];

  const triggers: AdaptationTrigger[] = [
    trigger('volume_headroom',
      'You absorbed 47.3 miles against 45.5 prescribed across the last three weeks, '
      + 'with no late-session fade on either long run.',
      { weekly_mi: 47.3, long_mi: 16.0, days_since_test: 41 }),
    trigger('quality_fade',
      'Your last two threshold sessions each lost 14 seconds a mile over the final rep, '
      + 'and average heart rate on both sat 6 bpm above the prescribed ceiling.',
      { weekly_mi: 47.3 }),
    trigger('spacing',
      'The long run and this session land back to back this week.',
      {}),
    trigger('readiness_pullback',
      'Resting heart rate has run 7 bpm above your own baseline for four consecutive '
      + 'mornings and HRV is 22 percent below your 60-day mean.',
      { weekly_mi: 47.3 }),
  ];

  const written = await writeWorkoutProposals(OWNER_UUID, actions, triggers);
  say('');
  say(`writeWorkoutProposals · ${written} row(s) written through the shipping writer`);

  /* ── the two no writer can carry ────────────────────────────────────────── */

  const hold = holdFor(
    'One hard week is not evidence. Two more sessions at this control and the '
    + 'threshold dose moves.',
    [anyForHold.id],
  );
  const holdId = await insertUnwritable(hold, anyForHold, 'hold',
    'One hard week is not evidence. Two more sessions at this control and the threshold dose moves.',
    { weekly_mi: 47.3, days_since_test: 41 });

  /* ── WHY THIS ONE DOES NOT CALL ITS GENERATOR ──────────────────────────────
   *
   * `lib/brain/proposal/generate/from-safety.ts::safetyStopFrom` would build
   * exactly this, and calling it would be the tidier code. It is deliberately
   * not called, and the reason is the repo's own gate.
   *
   * `lib/audit/module-graph.ts::isEntryPoint` counts `web-v2/scripts/**` as a
   * LIVE ROOT, so a seed importing that module would make it reachable — and
   * `_generated_content_gate.test.ts` GUARD 5 would then fail its staleness
   * check and demand the `MODULE_ORPHANS` entry be deleted. That entry is not
   * bookkeeping: it records that the SAFETY_STOP generator is complete and
   * DELIBERATELY UNWIRED while the canonical safety slice is in flight, and it
   * expires "the moment a LIVE path calls it". A verification seed is not a
   * live path, and letting a scratch-database tool retire that entry would
   * make the gate report a wiring that does not exist.
   *
   * So the action is written out here as a fixture. It is not a second
   * implementation: `_action_completeness.test.ts` asserts the generator
   * produces this exact shape from a STOP verdict — kind, direction, and a
   * `because` that comes from the safety owner's own renderer ("Rest, not
   * run") — so if the generator ever changes, that test moves and this fixture
   * is what has to follow it.
   */
  const stop: BrainAction = {
    schemaVersion: ACTION_SCHEMA_VERSION,
    kind: 'SAFETY_STOP',
    direction: 'STOP',
    before: [{ planWorkoutId: anyForStop.id, dateISO: anyForStop.date_iso }],
    because: 'Rest, not run, until this is looked at.',
    until: null,
  };
  const stopId = await insertUnwritable(stop, anyForStop, 'safety_stop',
    'Localised shin pain that has not settled with two easy days. Rest, not run, until this is looked at.',
    {});

  say(`unwritable-by-production · hold #${holdId}, safety stop #${stopId}`);

  /* ── what the reader now sees ───────────────────────────────────────────── */

  const { rows: out } = await pool.query<{ id: number; action_kind: string; workout_date_iso: string }>(
    `SELECT id, action_kind, workout_date_iso FROM plan_workout_proposals
      WHERE user_uuid = $1::uuid AND status = 'pending' ORDER BY id`,
    [OWNER_UUID],
  );
  say('');
  say(`pending rows now: ${out.length}`);
  for (const r of out) say(`  #${r.id}  ${r.action_kind.padEnd(14)} ${r.workout_date_iso}`);
  say('');
  say('serve it:  bash scripts/walk-server.sh');
  await pool.end();
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A session with a shape worth cutting or easing. Deliberately excludes
 *  `race`: proposing to shave a race is not a coaching decision this seed
 *  should be putting in front of anyone. */
function isQualityish(r: Row): boolean {
  return ['tempo', 'threshold', 'interval', 'intervals', 'long', 'marathon_pace', 'steady']
    .includes(r.type);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed:', e);
  process.exit(1);
});
