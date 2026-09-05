/**
 * lib/brain/_threshold_round_trip.db.test.ts · THE WHOLE LOOP, END TO END,
 * AGAINST A REAL DATABASE.
 *
 * Every stage of this loop already had a suite. None of them ran the loop:
 *
 *   training evidence → canonical threshold belief → PUSH/HOLD/PULL_BACK →
 *   phase-aware arbitration → PACE_CHANGE proposal → V5 card →
 *   runner acceptance → plan mutation → ledger → phone/Watch explanation →
 *   undo
 *
 * That gap is this codebase's named failure mode. Rule 21 measured it: the
 * upward adaptation path was "doctrine-bound, unit-tested, cron-mounted — and
 * it has never once fired for the only real runner this app has." Wired,
 * tested and inert. A per-stage test cannot see it, because every stage is
 * individually correct; only running the stages in sequence can.
 *
 * So this file does not mock a stage. Each one calls the real owner named in
 * `lib/brain/orchestration/steps.ts`, and the plan mutation is a real
 * transaction against real `plan_workouts` rows that are read back afterwards.
 *
 * ── IT NEVER TOUCHES PRODUCTION, AND IT SAYS SO WHEN IT SKIPS ──────────────
 *
 * `DATABASE_URL` must parse, name a LOOPBACK host, and name the database
 * `faff_roundtrip_scratch`. The predicate is the one
 * `_decision_ledger.db.test.ts` and `lib/adaptation-harness/fence.ts` already
 * apply, for the same reason: a URL that merely "looks local" is not enough.
 * The production write barrier from `vitest.setup.ts` is NOT disabled here; it
 * is the backstop, not the gate. When the check fails the suite SKIPS AND
 * PRINTS WHY, because reporting clean after looking at nothing is the worst
 * outcome available (Rule 18 point 2).
 *
 *     bash web-v2/scripts/_build_roundtrip_scratch.sh
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/brain/_threshold_round_trip.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · IT CANNOT PROVE THE LOOP RUNS IN PRODUCTION. It assembles the stages by
 *   hand in the order `steps.ts` declares. Three of those steps are UNWIRED
 *   and four are SHADOW, and this file does not change that — it proves the
 *   pieces COMPOSE, not that anything composes them today. `steps.ts` and its
 *   `WIRED_STEP_PIN` remain the only honest statement of reachability, and
 *   this file deliberately does not raise the pin.
 * · IT CANNOT PROVE THE COACHING IS RIGHT. A threshold that moved the wrong
 *   way would travel this loop exactly as cleanly.
 * · IT USES ONE SYNTHETIC RUNNER on a schema copied from production. A defect
 *   that needs real history — the shape Rule 15 is about — is out of reach.
 * · IT CANNOT SEE THE PHONE OR THE WATCH. Stage 9 asserts the STRINGS and the
 *   watch EFFECT the API would emit; `native-v2` is Swift and Rule 13's render
 *   requirement is answered there, not here.
 * · THE CENSUS IT OPENS WITH IS ONE ACCOUNT'S. See
 *   `_threshold_owner_census.audit.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const SCRATCH_DB = 'faff_roundtrip_scratch';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function scratchVerdict(url: string | undefined, label: string): string | null {
  if (!url) return `${label} is not set`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return `${label} is not a parseable URL`; }
  if (!LOOPBACK.has(parsed.hostname)) {
    return `${label} points at host '${parsed.hostname}', which is not loopback`;
  }
  const db = parsed.pathname.replace(/^\//, '');
  if (db !== SCRATCH_DB) return `${label} names database '${db}', not '${SCRATCH_DB}'`;
  return null;
}

const refusal = scratchVerdict(process.env.DATABASE_URL, 'DATABASE_URL');
const REACHABLE = refusal === null;
if (!REACHABLE) {
  // eslint-disable-next-line no-console
  console.log(`\n[threshold-round-trip] SKIPPED · ${refusal}\n`);
}

const RUNNER = randomUUID();
const PLAN_ID = `pln_rt_${randomUUID().slice(0, 8)}`;
const WEEK_ID = `wk_rt_${randomUUID().slice(0, 8)}`;
const PHASE_ID = `ph_rt_${randomUUID().slice(0, 8)}`;
const TODAY = '2026-09-05';

/** The three future threshold rows the loop reprices. */
const ROWS = [
  { id: `w_rt_${randomUUID().slice(0, 8)}`, date: '2026-09-09' },
  { id: `w_rt_${randomUUID().slice(0, 8)}`, date: '2026-09-16' },
  { id: `w_rt_${randomUUID().slice(0, 8)}`, date: '2026-09-23' },
];

/** What the plan was priced at before the loop runs. The stale belief. */
const PACE_BEFORE = 440;

const log: string[] = [];
const say = (s = '') => { log.push(s); };
const stage = (n: number, name: string) => {
  say('');
  say(`── ${n} · ${name} ${'─'.repeat(Math.max(0, 62 - name.length))}`);
};

describe.skipIf(!REACHABLE)('THRESHOLD ROUND TRIP · evidence to undo, against a real database', () => {
  beforeAll(async () => {
    const { pool } = await import('@/lib/db/pool');
    // NOT `.catch(() => undefined)`. The first draft of this fixture swallowed
    // this insert, the FK failure surfaced three statements later as a
    // confusing violation on `training_plans`, and the cause was invisible —
    // which is Rule 11's defect committed inside the test that exists to prove
    // Rule 11 is honoured. A setup failure is a failure.
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1::uuid, $2, $3)`,
      [RUNNER, `roundtrip-${RUNNER.slice(0, 8)}@scratch.invalid`, 'not-a-real-hash'],
    );
    await pool.query(
      `INSERT INTO training_plans
         (id, user_id, user_uuid, mode, goal_iso, authored_iso, authored_state)
       VALUES ($1, $2, $3::uuid, 'race-prep', '2026-12-06', now(), $4::jsonb)`,
      [PLAN_ID, RUNNER, RUNNER, JSON.stringify({ t_pace_s_per_mi: PACE_BEFORE })],
    );
    await pool.query(
      `INSERT INTO plan_phases
         (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
       VALUES ($1, $2, 'QUALITY', 0, 0, 'round-trip fixture', 'Research/22')`,
      [PHASE_ID, PLAN_ID],
    );
    await pool.query(
      `INSERT INTO plan_weeks
         (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
       VALUES ($1, $2, 0, '2026-09-07', $3, 'round-trip fixture')`,
      [WEEK_ID, PLAN_ID, PHASE_ID],
    );
    for (const [i, r] of ROWS.entries()) {
      await pool.query(
        `INSERT INTO plan_workouts
           (id, plan_id, week_id, date_iso, dow, type, distance_mi,
            is_quality, is_long, pace_target_s_per_mi, workout_spec)
         VALUES ($1, $2, $3, $4, $5, 'threshold', 8, true, false, $6, $7::jsonb)`,
        [r.id, PLAN_ID, WEEK_ID, r.date, 2 + i, PACE_BEFORE, JSON.stringify({
          kind: 'threshold', warmup_mi: 2, tempo_distance_mi: 4,
          tempo_pace_s_per_mi: PACE_BEFORE, cooldown_mi: 2, hr_target_bpm: null,
        })],
      );
    }
  }, 60_000);

  afterAll(async () => {
    const { pool } = await import('@/lib/db/pool');
    // Scratch hygiene only. This database is rebuilt from scratch by
    // `_build_roundtrip_scratch.sh`, so cleanup is courtesy, not correctness.
    await pool.query('DELETE FROM plan_workouts WHERE plan_id = $1', [PLAN_ID]).catch(() => undefined);
    await pool.query('DELETE FROM plan_weeks WHERE plan_id = $1', [PLAN_ID]).catch(() => undefined);
    await pool.query('DELETE FROM plan_phases WHERE plan_id = $1', [PLAN_ID]).catch(() => undefined);
    await pool.query('DELETE FROM training_plans WHERE id = $1', [PLAN_ID]).catch(() => undefined);
    await pool.query('DELETE FROM users WHERE id = $1::uuid', [RUNNER]).catch(() => undefined);
    const dest = process.env.ROUNDTRIP_OUT ?? '/tmp/threshold-round-trip.txt';
    fs.writeFileSync(dest, log.join('\n'));
    // eslint-disable-next-line no-console
    console.log(log.join('\n'));
  }, 60_000);

  it('runs the whole loop and lands back where it started', async () => {
    say('');
    say('╔════════════════════════════════════════════════════════════════════╗');
    say('║ THRESHOLD ROUND TRIP · faff_roundtrip_scratch (loopback)           ║');
    say('╚════════════════════════════════════════════════════════════════════╝');
    say(`  runner ${RUNNER}`);
    say(`  plan   ${PLAN_ID} · 3 threshold rows priced at ${PACE_BEFORE} s/mi`);

    /* ══════════════════════════════════════════════════════════════════════
     * 1 · TRAINING EVIDENCE → THE CANONICAL THRESHOLD BELIEF
     *
     * The ONE owner. `composeThresholdCapacity` is the pure core of
     * `resolveThresholdCapacity`; feeding it a direct corpus read is exactly
     * what the DB path does after `loadThresholdCorpusInputs` returns.
     * ═══════════════════════════════════════════════════════════════════ */
    stage(1, 'TRAINING EVIDENCE → CANONICAL THRESHOLD BELIEF');
    const { composeThresholdCapacity } = await import('@/lib/training/capacity-resolver');

    const observation = (id: string, dateISO: string, paceSecPerMi: number) => ({
      id,
      dateISO,
      paceSecPerMi,
      weight: 1,
      representative: true,
      authority: { evidenceKind: 'threshold_session' as const },
    });
    const supporting = [
      observation('run_a', '2026-08-22', 431),
      observation('run_b', '2026-08-29', 429),
      observation('run_c', '2026-09-02', 430),
    ];

    const belief = composeThresholdCapacity({
      direct: {
        ok: true,
        tPaceSecPerMi: 430,
        vdot: 47.8,
        observations: supporting.length,
        supporting: supporting as never,
        moveCap: { applied: false } as never,
        windowDays: 60,
      } as never,
      fallback: {
        measuredVdot: 47.8,
        measuredVdotEvidenceId: 'run_c',
        measuredVdotDate: '2026-09-02',
        measuredVdotSource: 'run',
        belowTableAnchor: null,
        normalWeeklyMi: { ok: true, value: 36.1, representativeDays: 28, excludedDays: 0 },
        normalRunDays: 16,
        selfReportedWeeklyMi: null,
        selfReportedPr: { ok: false, reason: 'NO_PR_ON_FILE', considered: 0, rejected: [] },
      },
      todayISO: TODAY,
    });

    say(`  evidence          ${supporting.length} threshold sessions · 431, 429, 430 s/mi`);
    say(`  BELIEF            ${belief.paceSecPerMi} s/mi`);
    say(`  sourceMode        ${belief.sourceMode}`);
    say(`  confidence        ${belief.confidence.toFixed(2)}`);
    say(`  evidenceIds       ${belief.evidenceIds.join(', ')}`);
    say(`  plan is priced at ${PACE_BEFORE} s/mi · the belief moved ${PACE_BEFORE - belief.paceSecPerMi} s/mi faster`);

    // The belief is DIRECT, from the runner's own sessions, and it is the
    // number every later stage carries. Not a re-derivation of it.
    expect(belief.sourceMode).toBe('direct');
    expect(belief.paceSecPerMi).toBe(430);
    expect(belief.evidenceIds).toEqual(['run_a', 'run_b', 'run_c']);

    /* ══════════════════════════════════════════════════════════════════════
     * 2 · THE BELIEF, ASSEMBLED · `lib/runner-state` (step 1's owner)
     *
     * The belief becomes ONE key in the runner model, with its Rule 8 side,
     * its levers and its immovables WELDED ON from the registry rather than
     * supplied by the loader. Notice what this stage proves: a loader cannot
     * declare that a goal may move this belief, because `neverMovesOn` does
     * not come from the submission.
     * ═══════════════════════════════════════════════════════════════════ */
    stage(2, 'BELIEF ASSEMBLED INTO THE RUNNER MODEL');
    const { assembleRunnerBeliefs, submitted, notLookedFor } =
      await import('@/lib/runner-state/assemble');
    const { BELIEF_KEYS, point } = await import('@/lib/runner-state/belief');

    const input = Object.fromEntries(
      BELIEF_KEYS.map((k) => [k, notLookedFor(k, `${TODAY}T00:00:00Z`)]),
    ) as never;
    (input as Record<string, unknown>).THRESHOLD_PACE = submitted({
      estimate: point(belief.paceSecPerMi),
      confidence: belief.confidence,
      sourceMode: belief.sourceMode,
      supporting: supporting.map((o) => ({
        id: o.id, kind: 'QUALITY_SESSION' as const, dateISO: o.dateISO,
        what: `threshold session at ${o.paceSecPerMi} s/mi`,
      })),
      lastUpdatedISO: `${TODAY}T00:00:00Z`,
    });

    const beliefs = assembleRunnerBeliefs(input);
    const tp = beliefs.THRESHOLD_PACE;
    if (!tp.reading.ok) throw new Error('the assembled threshold belief refused');

    say(`  THRESHOLD_PACE    ${tp.reading.value.best} s/mi`);
    say(`  owner             ${tp.owner.module}#${tp.owner.symbol}`);
    say(`  rule8Side         ${tp.rule8Side}`);
    say(`  neverMovesOn      ${tp.neverMovesOn.map((n) => n.what).join(', ')}`);
    say(`  19 other beliefs  notLookedFor (honest: this loop asked for one)`);

    expect(tp.reading.value.best).toBe(430);
    expect(tp.owner.symbol).toBe('resolveThresholdCapacity');
    // THE GOAL CAN NEVER MOVE IT, and that fact is structural — the loader
    // above never supplied it and could not have.
    expect(tp.neverMovesOn.map((n) => n.what)).toContain('GOAL_STATED');

    /* ══════════════════════════════════════════════════════════════════════
     * 3 · PUSH / HOLD / PULL_BACK  ·  `adjudicate.ts#rankOptions`
     * ═══════════════════════════════════════════════════════════════════ */
    stage(3, 'PUSH / HOLD / PULL_BACK');
    const { rankOptions } = await import('@/lib/plan/adjudication/adjudicate');
    // `SUPPORTED` — "he has completed something comparable and it went well" —
    // is the honest class for the three sessions stage 1 read. The vocabulary
    // is the contract's own; an earlier draft invented `ATHLETE_SPECIFIC` and
    // `tsc` refused it, which is the type doing the job a cast would have
    // taken away.
    const appraisal = (option: 'PUSH' | 'HOLD' | 'PULL_BACK', score: number, describe: string) => ({
      option, describe, evidenceClass: 'SUPPORTED' as const,
      heuristicRankScore: {
        value: score,
        provenance: 'POLICY_ASSUMPTION' as const,
        because: 'ranking only, never a forecast',
      } as never,
      risk: 'none stated',
    });
    const ranked = rankOptions([
      appraisal('HOLD', 0.9, `keep the plan at ${PACE_BEFORE}`),
      appraisal('PUSH', 0.9, `reprice to the belief, ${belief.paceSecPerMi}`),
      appraisal('PULL_BACK', 0.9, 'ease the block'),
    ]);
    for (const o of ranked) say(`  ${o.option.padEnd(10)} ${o.describe}`);
    const chosen = ranked[0].option;
    say(`  CHOSEN            ${chosen}`);

    // Rule 21/22: three equally-scored options must not tie into a HOLD. The
    // stimulus weighting is what lets an engine with the headroom actually
    // spend it, and this asserts the UP arm wins on equal evidence rather
    // than only asserting that a refusal is possible.
    expect(chosen).toBe('PUSH');

    /* ══════════════════════════════════════════════════════════════════════
     * 4 · PHASE-AWARE ARBITRATION  ·  `phase-priority.ts`
     *
     * The one stage that can VETO a push without any safety event: a TAPER
     * freezes the threshold anchor, symmetrically.
     * ═══════════════════════════════════════════════════════════════════ */
    stage(4, 'PHASE-AWARE ARBITRATION');
    const { resolveArbitrationPriority } = await import('@/lib/adaptation/canonical/phase-priority');
    type TrainingPhase = Parameters<typeof resolveArbitrationPriority>[0]['phase'];
    // The values are the owners' own, not casts of my invention. An earlier
    // draft passed `safety: 'CLEAR'`, which is not a member of
    // `TrainingSafetyPosture` — the resolver treated the unknown value as a
    // hard stop and BOTH phases came back STOP/frozen. The test failed, which
    // is the gate working; but a cast that invents a vocabulary is how a
    // fixture stops describing the system (Rule 15).
    const ctxFor = (phase: TrainingPhase) => ({
      phase,
      raceDistance: 'MARATHON' as const,
      limiter: 'THRESHOLD' as const,
      safety: 'NORMAL' as const,
      stepsTakenThisCycle: { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 } as const,
    });
    const quality = resolveArbitrationPriority(ctxFor('QUALITY'));
    const taper = resolveArbitrationPriority(ctxFor('TAPER'));
    say(`  QUALITY  posture ${quality.posture} · order ${quality.order.join(' > ')}`);
    say(`           freezesThresholdAnchor ${quality.freezesThresholdAnchor}`);
    say(`  TAPER    posture ${taper.posture} · freezesThresholdAnchor ${taper.freezesThresholdAnchor}`);

    // The push may proceed in QUALITY and is frozen in TAPER. Both directions
    // asserted, because a gate that only checks the permissive side passes an
    // engine that never refuses, and one that only checks the refusal passes
    // an engine that never pushes (Rule 22).
    expect(quality.freezesThresholdAnchor).toBe(false);
    expect(taper.freezesThresholdAnchor).toBe(true);

    /* ══════════════════════════════════════════════════════════════════════
     * 5 · THE PACE_CHANGE PROPOSAL  ·  the 21-kind action schema
     * ═══════════════════════════════════════════════════════════════════ */
    stage(5, 'PACE_CHANGE PROPOSAL');
    const { ACTION_SCHEMA_VERSION } = await import('@/lib/brain/proposal/action');
    const { validateAction } = await import('@/lib/brain/proposal/validate');
    const { serializeAction, deserializeAction } = await import('@/lib/brain/proposal/serialize');

    // THE `before` IS READ FROM THE LIVE ROWS, not hand-built. That is how a
    // real proposal is raised, and it is the only way the `planVersion` it
    // records can match the one staleness will compare against in stage 7 —
    // an earlier draft wrote `planVersion: null` by hand and the staleness
    // guard correctly refused it as stale against `…:none`. The guard was
    // right and the fixture was lying.
    const { readLiveRows, beforeFromLive } = await import('@/lib/brain/proposal/staleness');
    const liveAtRaise = await readLiveRows(RUNNER, ROWS.map((r) => r.id));
    const before = beforeFromLive(liveAtRaise);
    expect(before.length).toBe(ROWS.length);
    // The pace it changed FROM must be on the record, or stage 10 cannot run.
    for (const b of before) expect(b.paceTargetSecPerMi).toBe(PACE_BEFORE);

    const action = {
      schemaVersion: ACTION_SCHEMA_VERSION,
      kind: 'PACE_CHANGE' as const,
      direction: 'MORE' as const,
      lever: 'THRESHOLD' as const,
      to: { unit: 'sec_per_mi' as const, value: belief.paceSecPerMi },
      before,
    };

    const valid = validateAction(action as never);
    say(`  kind              PACE_CHANGE · lever THRESHOLD · direction MORE`);
    say(`  to                ${belief.paceSecPerMi} s/mi (from ${PACE_BEFORE})`);
    say(`  rows              ${action.before.length}`);
    say(`  validateAction    ${valid.ok ? 'ok' : valid.refusals.join('; ')}`);
    expect(valid.ok).toBe(true);

    // It survives the jsonb round trip it will take through the proposal row.
    const revived = deserializeAction(serializeAction(action as never));
    expect(revived).not.toBeNull();
    expect(revived).toEqual(action);
    say('  jsonb round trip  identical after serialize → deserialize');

    /* ══════════════════════════════════════════════════════════════════════
     * 6 · THE V5 CARD  ·  what the runner actually reads
     * ═══════════════════════════════════════════════════════════════════ */
    stage(6, 'V5 CARD');
    const { actionHeadline, phoneDirectionOf, dayNameOf } =
      await import('@/lib/faff/v5-action-render');
    const headline = actionHeadline(action as never, dayNameOf(ROWS[0].date));
    const direction = phoneDirectionOf({ kind: action.kind, direction: action.direction } as never);
    say(`  headline          "${headline}"`);
    say(`  direction         ${direction}`);

    expect(headline.length).toBeGreaterThan(0);
    // Coach voice, locked: no em dashes, no exclamation marks, no emoji.
    expect(headline).not.toMatch(/[—!]/);

    /* ══════════════════════════════════════════════════════════════════════
     * 7 · STALENESS  ·  a proposal raised against rows that have since moved
     *     may NOT apply. Asserted BEFORE the accept, so the accept below is
     *     known to be operating on rows it actually described.
     * ═══════════════════════════════════════════════════════════════════ */
    stage(7, 'STALENESS GUARD');
    const { staleAgainst } = await import('@/lib/brain/proposal/action');
    const live = await readLiveRows(RUNNER, ROWS.map((r) => r.id));
    const fresh = staleAgainst(action as never, live);
    say(`  live rows read    ${live.size}`);
    say(`  this proposal     ${fresh.stale ? `STALE · ${fresh.why}` : 'fresh'}`);
    expect(live.size).toBe(ROWS.length);
    expect(fresh.stale).toBe(false);

    // AND THE OTHER DIRECTION, which is the one that matters (Rule 18 point 1
    // and Rule 22: a guard only ever tested on the permissive side passes a
    // guard that never refuses). A proposal raised against an OLDER plan
    // version must not be allowed to mutate the newer one.
    const stalePlanVersion = staleAgainst(
      { ...action, before: action.before.map((b) => ({ ...b, planVersion: 'pln_rt:OLD' })) } as never,
      live,
    );
    say(`  older planVersion ${stalePlanVersion.stale ? `STALE · ${stalePlanVersion.why}` : 'FRESH (DEFECT)'}`);
    expect(stalePlanVersion.stale).toBe(true);

    // A row whose PACE has moved under the proposal since it was raised.
    const stalePace = staleAgainst(
      { ...action, before: action.before.map((b) => ({ ...b, paceTargetSecPerMi: 999 })) } as never,
      live,
    );
    say(`  moved pace        ${stalePace.stale ? `STALE · ${stalePace.why}` : 'FRESH (DEFECT)'}`);
    expect(stalePace.stale).toBe(true);

    // A row that has since been DELETED from the plan.
    const staleMissing = staleAgainst(
      { ...action, before: [...action.before, { planWorkoutId: 'w_gone', paceTargetSecPerMi: 440 }] } as never,
      live,
    );
    say(`  vanished row      ${staleMissing.stale ? `STALE · ${staleMissing.why}` : 'FRESH (DEFECT)'}`);
    expect(staleMissing.stale).toBe(true);

    /* ══════════════════════════════════════════════════════════════════════
     * 8 · RUNNER ACCEPTANCE → PLAN MUTATION → LEDGER
     *
     * ONE call. `applyBrainAction` validates, routes, mutates through
     * `mutatePlan` under RUNNER_ACCEPTED, and the boundary writes the ledger
     * row on its way out.
     * ═══════════════════════════════════════════════════════════════════ */
    stage(8, 'RUNNER ACCEPTANCE → MUTATION → LEDGER');
    const { applyBrainAction } = await import('@/lib/brain/proposal/accept');
    const { prepareAction } = await import('@/lib/brain/proposal/execute');
    const { pool } = await import('@/lib/db/pool');

    /* THE ORDER PRODUCTION USES, not a shortcut past it.
     *
     * `accept.ts`'s own header says staleness is not its job — "prepareAction
     * owns that and the caller runs it first ... a second staleness check on a
     * second snapshot would be a second answer to one question" — and
     * `app/api/plan/workout-proposals/[id]/accept/route.ts:83` is the caller
     * that runs it. An earlier draft of this file called `applyBrainAction`
     * directly and therefore proved a loop the runner never travels. */
    const prepared = prepareAction(action as never, live);
    say(`  prepareAction     ${prepared.ok ? 'ok' : `REFUSED · ${prepared.refusedBecause}`}`);
    expect(prepared.ok).toBe(true);

    // AND THE REFUSAL, at the same seam (Rule 18 point 1 · falsification (b)).
    // A proposal reasoned about an older plan must not reach the mutation.
    const staleAttempt = prepareAction(
      { ...action, before: action.before.map((b) => ({ ...b, planVersion: 'pln_rt:OLD' })) } as never,
      live,
    );
    say(`  stale attempt     ${staleAttempt.ok ? 'ADMITTED (DEFECT)' : `REFUSED · ${staleAttempt.refusedBecause}`}`);
    expect(staleAttempt.ok).toBe(false);

    const outcome = await applyBrainAction(action as never, {
      userUuid: RUNNER,
      todayISO: TODAY,
      why: `Your threshold sessions are landing at ${belief.paceSecPerMi}. Repricing the block to match.`,
    });
    say(`  outcome.ok        ${outcome.ok}`);
    if (!outcome.ok) say(`  error             ${outcome.error} · ${outcome.detail}`);
    expect(outcome.ok, outcome.ok ? '' : `${outcome.error}: ${outcome.detail}`).toBe(true);
    if (!outcome.ok) return;
    say(`  rows applied      ${outcome.applied}`);
    say(`  watch effect      ${outcome.watch.kind}`);
    say(`  undo offered      ${outcome.undo.can}`);
    expect(outcome.applied).toBe(ROWS.length);

    const after = await pool.query<{ id: string; p: string | null }>(
      `SELECT id, pace_target_s_per_mi::text AS p FROM plan_workouts
        WHERE plan_id = $1 ORDER BY date_iso`, [PLAN_ID]);
    say(`  plan_workouts     ${after.rows.map((r) => r.p).join(', ')} s/mi`);
    // THE ROWS ACTUALLY MOVED. Read back from the table, not inferred from
    // the return value (Rule 13 point 3: assert the shape of the result).
    for (const r of after.rows) expect(Number(r.p)).toBe(belief.paceSecPerMi);

    const { loadRecentDecisions, directionCensus } =
      await import('@/lib/brain/ledger/decision-ledger');
    const history = await loadRecentDecisions(RUNNER, 10);
    say(`  ledger state      ${history.state}`);
    expect(history.state).toBe('read');
    if (history.state !== 'read') return;
    say(`  ledger rows       ${history.rows.length}`);
    /* NAMED, NOT A TypeError. This assertion sits BEFORE the row is indexed
     * because reverting LEDGERRESPONDED-1 made the loop fail with "Cannot read
     * properties of undefined (reading 'decision')" — a gate that fires on the
     * right defect and describes the wrong one. The whole value of this check
     * is that it says WHICH half broke: the plan moved, and nothing recorded
     * that it had. */
    expect(
      history.rows.length,
      'THE MUTATION APPLIED AND THE LEDGER RECORDED NOTHING. `mutatePlan` logs '
      + '"DECISION NOT RECORDED" to console.error and returns normally, so the '
      + 'plan moves and the decision vanishes. Check the console output above '
      + 'for the reason the write was rejected. This is the exact blindness '
      + 'Rule 21 describes: a census of upward adaptations that reads zero '
      + 'because the rows were never written, not because nothing happened.',
    ).toBeGreaterThan(0);
    const row = history.rows[0];
    say(`  decision          ${row.decision} · direction ${row.direction} · lever ${row.lever}`);
    say(`  authority         ${row.authority} · ${row.authorityVerdict}`);
    say(`  outcome           ${row.mutationOutcome}`);
    say(`  explanation       "${row.explanation}"`);

    expect(row.authority).toBe('RUNNER_ACCEPTED');
    expect(row.authorityVerdict).toBe('PERMITTED');
    expect(row.mutationOutcome).toBe('applied');
    // Rule 21's census, answerable in ONE query now. The direction is MEASURED
    // from the before/after rows by the boundary, never taken from the caller
    // — so a downgrade cannot be labelled an adjustment.
    const census = await directionCensus(RUNNER);
    say(`  Rule 21 census    ${census.state === 'measured' ? JSON.stringify(census.counts) : census.state}`);
    expect(census.state).toBe('measured');
    if (census.state === 'measured') {
      // A FASTER prescribed pace is more demand, and the ledger must say UP.
      // This is the assertion Rule 21 could not make in production: the
      // census of upward adaptations was ZERO and could only be reconstructed
      // sideways out of `coach_intents`.
      expect(census.counts.UP).toBeGreaterThan(0);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * 9 · PHONE AND WATCH EXPLANATIONS
     * ═══════════════════════════════════════════════════════════════════ */
    stage(9, 'PHONE AND WATCH EXPLANATION');
    const { watchBehaviorOf, watchIsApplicable } =
      await import('@/lib/brain/proposal/watch-facet');
    const watch = watchBehaviorOf(action as never);
    say(`  phone headline    "${headline}"`);
    say(`  phone reason      "${row.explanation}"`);
    say(`  watch effect      ${watch.kind}`);
    say(`  watch because     ${watch.because}`);
    expect(watchIsApplicable('PACE_CHANGE')).toBe(true);
    // A repriced session the runner may be about to start must not be carried
    // to the wrist at the old pace.
    expect(watch.kind).toBe('RELOAD_IF_TODAY');

    /* ══════════════════════════════════════════════════════════════════════
     * 10 · UNDO  ·  restores the prior state EXACTLY
     * ═══════════════════════════════════════════════════════════════════ */
    stage(10, 'UNDO');
    const { undoWritesFor } = await import('@/lib/brain/proposal/undo');
    const plan = undoWritesFor(action as never);
    say(`  undo plan         ${plan.kind}`);
    expect(plan.kind).toBe('reverse');
    if (plan.kind !== 'reverse') return;
    say(`  writes            ${plan.writes.length}`);

    // AND THE REFUSAL (Rule 18 point 1). An action that did not record the
    // pace it changed FROM cannot be reversed, and must say so rather than
    // guessing. This is the reason stage 5 reads `before` off the live rows.
    const noRecord = undoWritesFor(
      { ...action, before: action.before.map(({ paceTargetSecPerMi: _drop, ...b }) => b) } as never,
    );
    say(`  unrecorded before ${noRecord.kind}${'because' in noRecord ? ` · ${noRecord.because}` : ''}`);
    expect(noRecord.kind).toBe('not_undoable');

    for (const w of plan.writes) {
      if (w.op !== 'update') continue;
      await pool.query(
        `UPDATE plan_workouts SET pace_target_s_per_mi = $1 WHERE id = $2 AND plan_id = $3`,
        [w.set.pace_target_s_per_mi, w.planWorkoutId, PLAN_ID],
      );
    }
    const restored = await pool.query<{ id: string; p: string | null }>(
      `SELECT id, pace_target_s_per_mi::text AS p FROM plan_workouts
        WHERE plan_id = $1 ORDER BY date_iso`, [PLAN_ID]);
    say(`  plan_workouts     ${restored.rows.map((r) => r.p).join(', ')} s/mi`);

    // EXACTLY, not approximately. Every row is back at the value it held
    // before stage 8, and the undo derived that value from the action's own
    // `before` record rather than from a snapshot it might not have.
    for (const r of restored.rows) expect(Number(r.p)).toBe(PACE_BEFORE);
    say('');
    say(`  ROUND TRIP CLOSED · ${PACE_BEFORE} → ${belief.paceSecPerMi} → ${PACE_BEFORE}`);

    /* ══════════════════════════════════════════════════════════════════════
     * 11 · THE AUTHORITY BOUNDARY, FROM THE OTHER SIDE
     *
     * Everything above travelled under RUNNER_ACCEPTED. The whole point of
     * the seam is that the SAME write, attempted unattended, is refused. A
     * loop proven only on the permitted side proves a door, not a lock
     * (Rule 22).
     * ═══════════════════════════════════════════════════════════════════ */
    stage(11, 'AUTHORITY BOUNDARY · the same write, unattended');
    const { mutationIsPermitted } = await import('@/lib/brain/mutation/authority');
    const { AUTOMATIC_ADAPTATION_AUTHORITY } = await import('@/lib/plan/adaptation-authority');
    const { mutatePlan } = await import('@/lib/plan/mutate');

    say(`  AUTOMATIC_ADAPTATION_AUTHORITY  ${AUTOMATIC_ADAPTATION_AUTHORITY}`);
    expect(AUTOMATIC_ADAPTATION_AUTHORITY).toBe(false);

    const accepted = mutationIsPermitted('RUNNER_ACCEPTED');
    const automatic = mutationIsPermitted('COACHING_ADAPTATION');
    say(`  RUNNER_ACCEPTED     permitted=${accepted.permitted}`);
    say(`  COACHING_ADAPTATION permitted=${automatic.permitted}`);
    say(`    because           ${automatic.because}`);
    say(`    insteadDo         ${automatic.insteadDo}`);
    expect(accepted.permitted).toBe(true);
    expect(automatic.permitted).toBe(false);
    // A refusal that does not say what to do instead is a dead end.
    expect(automatic.insteadDo).toBeTruthy();

    // And the boundary REALLY refuses the write, not just the question. It
    // THROWS rather than returning a rejection — stronger than the returned
    // verdict, because a caller cannot ignore the result by not reading it.
    let refusal: string | null = null;
    try {
      await mutatePlan<number>({
        authority: 'COACHING_ADAPTATION',
        userUuid: RUNNER,
        source: 'round-trip/unattended-probe',
        todayISO: TODAY,
        planId: PLAN_ID,
        touches: 'structural',
        apply: async (tx, planId) => {
          const r = await tx.query(
            `UPDATE plan_workouts SET pace_target_s_per_mi = 400 WHERE plan_id = $1`, [planId]);
          return r.rowCount ?? 0;
        },
      });
    } catch (e) {
      refusal = e instanceof Error ? e.message : String(e);
    }
    say(`  unattended write  ${refusal == null ? 'ADMITTED (DEFECT)' : 'THREW'}`);
    if (refusal != null) say(`    ${refusal}`);
    expect(refusal, 'an unattended COACHING_ADAPTATION write was admitted').not.toBeNull();
    expect(refusal).toContain('sealed');
    expect(refusal).toContain('RUNNER_ACCEPTED');

    const untouched = await pool.query<{ p: string | null }>(
      `SELECT pace_target_s_per_mi::text AS p FROM plan_workouts WHERE plan_id = $1`, [PLAN_ID]);
    say(`  plan_workouts     ${untouched.rows.map((r) => r.p).join(', ')} s/mi (unchanged)`);
    // THE ROWS DID NOT MOVE. Read back, not inferred from the return value.
    for (const r of untouched.rows) expect(Number(r.p)).toBe(PACE_BEFORE);
    say('');
  }, 180_000);
});
