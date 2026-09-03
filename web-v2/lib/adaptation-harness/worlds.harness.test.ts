/**
 * lib/adaptation-harness/worlds.harness.test.ts · THE PROOF THAT THE PLAN ADAPTS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * CLAUDE.md's hero statement is the specification:
 *
 *   "There's a world where I or other runners follow the plan, there's a world
 *    where we fall short, but ideally there's a world where we push forward and
 *    the plan has to push us more and more. That's what the app is for. To push."
 *
 * Rule 21 records what was measured against that on 2026-08-30: across 309
 * `coach_intents` rows, twenty distinct reasons, months of real training and
 * seven production accounts, the number of UPWARD adaptations is ZERO. Two
 * causes were found and fixed that night — a gate reading `data->>'type'`, a
 * field that has never held a session type, and a bump veto three domains
 * stricter than its own mirrored pull-back. Every one of them was found by
 * READING, and not one was caught by 7,294 passing tests.
 *
 * That is the gap this file closes. Not another audit — audits are read once and
 * decay. A harness: it drives the real adaptation loop through the three worlds,
 * against the owner's real history, and asserts what the RUNNER ends up seeing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES IT HONEST
 *
 * · IT DRIVES SHIPPED CODE. `runNightlyPass` invokes the `run-adaptations`
 *   route's own POST handler. `detect`/`apply`/`bump`/`repaceTo`/`loadProgression`
 *   are one-line wrappers around `detectAdaptations`, `applyAdaptations`,
 *   `tryAdaptiveBump`, `recomputePacesForPlan` and `loadProgressionWeek`.
 *   Nothing is reimplemented — Rule 13's fixture trap, one level up.
 *
 * · IT USES HIS REAL HISTORY. `substrate.ts` copies the owner's production rows
 *   and slides them forward by a whole number of weeks so a block he actually
 *   ran straddles today. Rule 15's complaint about the 11,598-archetype sweep is
 *   that `hist` is null for every case; here it is his. Each world then layers
 *   ONE named variation — a session not run, a session run faster, a week
 *   under-run against its prescription. Those are declared in the scenario, so a reader can always
 *   see the seam between what is real and what was synthesised.
 *
 * · IT ASSERTS THE OBSERVABLE. Every verdict reads through `observe.ts`, which
 *   goes through the app's own `loadAdaptationInfoByPlanIds`. "The prescription
 *   changed from X to Y and the app said why", never "the function returned a
 *   verdict object".
 *
 * · IT CANNOT REACH PRODUCTION. See `fence.ts`. Three independent fences, the
 *   outermost being a read-only Postgres role.
 *
 * · ITS CHECKS CAN FAIL. `falsify.harness.test.ts` breaks each mechanism on
 *   purpose and asserts the matching check goes red naming it (Rule 18).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BINDING vs OPEN — read `report.ts`. In short: a BINDING check must pass; an
 * OPEN check names behaviour the hero statement requires and the engine does not
 * have yet, is expected red, and FAILS THE RUN IF IT EVER PASSES, so that
 * landing the behaviour forces the marker to be promoted rather than forgotten.
 */

import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { assertHarnessDatabase, OWNER_UUID } from './fence';

assertHarnessDatabase();

import {
  resetToBase, shiftRealBlockOntoToday, plusDays,
  readPlanDays, missSessionOn, clearCompletionWindow, runFasterOn, underRunWeek,
  lastMutationRejection,
  clearProgressionMarker, intentsSince, type Substrate, type PlanDay,
} from './substrate';
import {
  runNightlyPass, detect, partition, rampDiagnosis, bump, repaceTo,
  detectMissed, loadProgression,
} from './drive';
import { seeWeek, fingerprint, totalMi, adaptationVerbTableMatchesComponent, type SeenDay } from './observe';
import { check, recordWorld, verdict, renderReport } from './report';

// `fileURLToPath`, not `URL.pathname` — this repository lives under a path with
// spaces in it, and `.pathname` hands back the percent-encoded form, which
// `fs.readFileSync` cannot open. The mirror check then reports "cannot read"
// and fails for a reason that has nothing to do with the mirror.
const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** Fresh substrate for one world. Isolation is not optional here: these
 *  scenarios WRITE, and a world inheriting another world's mutations would
 *  produce a verdict about neither. */
async function freshWorld(name: string): Promise<Substrate> {
  recordWorld(name);
  await resetToBase();
  return shiftRealBlockOntoToday();
}

/** The training week containing `dateISO`, resolved by the app's own rule
 *  (the week ENDS on `long_run_day`, locked 2026-06-16). */
async function weekOf(dateISO: string): Promise<{ start: string; end: string }> {
  const { trainingWeekWindow } = await import('@/lib/notifications/week-window');
  const { pool } = await import('@/lib/db/pool');
  const dow = (await pool.query<{ d: number | null }>(
    `SELECT long_run_dow AS d FROM user_prefs WHERE user_uuid = $1::uuid`, [OWNER_UUID],
  )).rows[0]?.d ?? 0;
  const w = trainingWeekWindow(dateISO, new Date(`${dateISO}T12:00:00Z`).getUTCDay(), Number(dow));
  return { start: w.week_start_iso, end: w.week_end_iso };
}

async function setLongRunDow(dow: number): Promise<void> {
  const { pool } = await import('@/lib/db/pool');
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  await pool.query(
    `UPDATE user_prefs SET long_run_dow = $2, long_run_day = $3 WHERE user_uuid = $1::uuid`,
    [OWNER_UUID, dow, names[dow]],
  );
}

/** Latest key (quality) session inside the freshness window the missed-session
 *  detector still treats as debt rather than data (`isStaleMissed` > 3 days). */
async function recentKeySession(sub: Substrate): Promise<PlanDay | null> {
  const days = await readPlanDays(sub.planId, plusDays(sub.todayISO, -3), plusDays(sub.todayISO, -1));
  const q = days.filter((d) => d.isQuality || ['threshold', 'tempo', 'intervals', 'vo2max'].includes(d.type));
  return q.length > 0 ? q[q.length - 1] : null;
}

let SUB0: Substrate | null = null;

beforeAll(async () => {
  SUB0 = await freshWorld('substrate');
  const s = SUB0;
  check({
    world: 'substrate',
    id: 'substrate.is-real-history',
    binding: 'binding',
    ok: s.runsKept > 50 && s.futureDays > 7,
    detail: `plan ${s.planId} slid ${s.offsetDays >= 0 ? '+' : ''}${s.offsetDays}d onto today (${s.todayISO}); `
      + `block ${s.blockStartISO}..${s.blockEndISO}; ${s.futureDays} prescribed days still ahead; `
      + `${s.runsKept} of the owner's real canonical runs kept.`,
  });
  check({
    world: 'substrate',
    id: 'substrate.plan-carries-the-tier-bands-the-ramp-reads',
    binding: 'binding',
    ok: s.hasTierBands,
    detail: s.hasTierBands
      ? 'the block carries tier_peak_weekly_band / tier_peak_long_band, so the volume ramp has a ceiling to '
        + 'measure headroom against.'
      : 'the block carries NO tier_peak_weekly_band. `readTierUpper` returns 0 for a missing band, '
        + '`peakHeadroomMi` goes negative, `belowTierUpper` is false, and the volume ramp is unreachable by '
        + 'construction — a missing band reads as "no headroom" rather than "unknown" (Rule 11).',
  });
  const mirror = adaptationVerbTableMatchesComponent(REPO);
  check({
    world: 'substrate',
    id: 'substrate.observable-mirror-matches-the-component',
    binding: 'binding',
    ok: mirror.ok,
    detail: `${mirror.detail} · component kinds: [${mirror.componentKinds.join(', ')}]`,
  });
});

afterAll(async () => {
  // `process.stdout.write`, not `console.log`: the ledger is the deliverable
  // and a reporter that swallows it leaves a green run with nothing to read.
  process.stdout.write(renderReport());
  const { pool } = await import('@/lib/db/pool');
  await pool.end().catch(() => {});
});

/* ═══════════════════════════════════════════════════════════════════════════
 * WORLD 0 · THE BLOCK HE IS ACTUALLY RUNNING, RIGHT NOW
 *
 * No shift, no variation, nothing synthesised. His production rows exactly as
 * they stand, with the plan that is live tonight.
 *
 * Rule 21's standard: "compute what the runner would have had to DO to trigger
 * it, then check whether any week they have actually run would have. If none
 * could, the bar is not a bar, it is a wall." Worlds 1-3 answer whether the
 * mechanisms work. This one answers whether they are reachable on the plan he
 * has, which is a different question and the one that produced the zero.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('WORLD 0 · the block he is actually running', () => {
  const W = 'WORLD 0 · the live block';

  it('reports whether the upward path is reachable at all on the live plan', async () => {
    recordWorld(W);
    await resetToBase();  // no shift · production as copied

    const { pool } = await import('@/lib/db/pool');
    const live = (await pool.query<{
      id: string; mode: string | null; bands: boolean; rows: string; future: string; prog: string; d1: string | null;
    }>(
      `SELECT tp.id, tp.mode,
              (tp.authored_state ? 'tier_peak_weekly_band') AS bands,
              COUNT(pw.id)::text AS rows,
              COUNT(pw.id) FILTER (WHERE pw.date_iso > to_char(NOW(), 'YYYY-MM-DD'))::text AS future,
              COUNT(pw.id) FILTER (WHERE pw.workout_spec ? 'progression')::text AS prog,
              MAX(pw.date_iso) AS d1
         FROM training_plans tp
         LEFT JOIN plan_workouts pw ON pw.plan_id = tp.id
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
        GROUP BY tp.id, tp.mode, tp.authored_state
        ORDER BY MAX(tp.authored_iso) DESC LIMIT 1`,
      [OWNER_UUID],
    )).rows[0];

    check({
      world: W, id: 'w0.he-has-an-active-plan', binding: 'binding',
      ok: live != null,
      detail: live
        ? `${live.id} · mode=${live.mode} · ${live.rows} prescribed days, last ${live.d1}, ${live.future} still ahead.`
        : 'no active plan on the production copy.',
    });
    if (!live) return;

    check({
      world: W, id: 'w0.the-live-plan-can-be-pushed-in-volume', binding: 'open',
      ok: live.bands && Number(live.future) > 0,
      detail: !live.bands
        ? `the live ${live.mode} block publishes NO tier_peak_weekly_band. `
          + '`readTierUpper` answers 0 for an absent band, so `peakHeadroomMi` is negative, `belowTierUpper` is '
          + 'false, and `tryAdaptiveBump` cannot fire on this plan whatever the runner does. The race-prep blocks '
          + 'in his history DO carry the bands, so this is an authoring gap on the recovery path, not a universal '
          + 'one — and a missing ceiling reading as "no headroom" instead of "unknown" is the Rule 11 collapse.'
        : `${live.future} unrun days ahead and the tier bands are published, so the ramp has something to raise.`,
      needs: 'the recovery/maintenance authoring paths to publish tier bands, and a block with unrun weeks in it.',
    });

    check({
      world: W, id: 'w0.the-live-plan-can-be-pushed-in-session-dose', binding: 'open',
      ok: Number(live.prog) > 0,
      detail: Number(live.prog) > 0
        ? `${live.prog} live rows carry workout_spec.progression.`
        : 'ZERO live rows carry `workout_spec.progression`, so the weekly progression cycle has no target and '
          + 'TAKE / ACCELERATE / HOLD / BACK_OFF cannot run for him tonight.',
      needs: 'w3.plan-rows-carry-a-progression-block',
    });

    const ever = (await pool.query<{ reason: string; n: string }>(
      `SELECT reason, COUNT(*)::text AS n FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1::uuid
          AND reason IN ('plan_adapt_upgrade','plan_adapt_bump','plan_adapt_progression')
        GROUP BY reason`,
      [OWNER_UUID],
    )).rows;
    check({
      world: W, id: 'w0.an-upward-adaptation-has-ever-been-recorded', binding: 'open',
      ok: ever.length > 0,
      detail: ever.length > 0
        ? `upward intents on record: ${ever.map((r) => `${r.reason}×${r.n}`).join(', ')}`
        : 'across his ENTIRE history there is no `plan_adapt_upgrade`, no `plan_adapt_bump` and no '
          + '`plan_adapt_progression` row. Rule 21\'s zero, re-measured by this harness against the same rows.',
      needs: 'the upward path to fire once, on his real plan, in production.',
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * WORLD 1 · HE FOLLOWS THE PLAN
 *
 * The easy case, and not the product — but it is the control. A loop that fires
 * on nothing is as broken as one that never fires, and a "quiet" night that
 * quietly rewrites four future days is the failure nobody would report because
 * nothing looks wrong.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('WORLD 1 · he follows the plan', () => {
  const W = 'WORLD 1 · he follows the plan';

  it('a quiet week is genuinely quiet, and sealed days stay sealed', async () => {
    const sub = await freshWorld(W);
    const past = plusDays(sub.todayISO, -21);
    const future = plusDays(sub.todayISO, 21);

    const beforeSealed = fingerprint(await seeWeek(sub.planId, past, plusDays(sub.todayISO, -1)));
    const beforeFuture = await seeWeek(sub.planId, sub.todayISO, future);

    const pass = await runNightlyPass();

    const afterSealed = fingerprint(await seeWeek(sub.planId, past, plusDays(sub.todayISO, -1)));
    const afterFuture = await seeWeek(sub.planId, sub.todayISO, future);

    check({
      world: W, id: 'w1.the-pass-ran', binding: 'binding',
      ok: pass.ok && pass.users >= 1 && !pass.results.some((r) => r.error),
      detail: `run-adaptations · users=${pass.users} applied=${pass.total_applied} proposed=${pass.total_proposed}`
        + `${pass.results.find((r) => r.error) ? ` ERROR ${pass.results.find((r) => r.error)!.error}` : ''}`,
    });

    check({
      world: W, id: 'w1.sealed-days-stay-sealed', binding: 'binding',
      ok: beforeSealed === afterSealed,
      detail: beforeSealed === afterSealed
        ? 'every prescription on a day already run is byte-identical after the pass.'
        : 'a day the runner has ALREADY RUN changed under him. The adapter must never rewrite history.',
    });

    // Nothing may go DOWN on a quiet night. Going up is a different question and
    // world 3 owns it; here the claim is only that a quiet night takes nothing away.
    const cut = beforeFuture.filter((b) => {
      const a = afterFuture.find((x) => x.workoutId === b.workoutId);
      return a != null && (b.distanceMi ?? 0) - (a.distanceMi ?? 0) > 0.05;
    });
    check({
      world: W, id: 'w1.nothing-spuriously-downgrades', binding: 'binding',
      ok: cut.length === 0,
      detail: cut.length === 0
        ? `${afterFuture.length} future days examined; no prescribed distance was reduced on a week with no signal.`
        : `${cut.length} future days were CUT with no adverse signal: `
          + cut.slice(0, 4).map((d) => `${d.dateISO} ${d.distanceMi}mi`).join(', '),
    });

    const told = afterFuture.filter((d) => d.told != null);
    check({
      world: W, id: 'w1.no-adaptation-banner-on-a-quiet-week', binding: 'binding',
      ok: told.length === 0 || told.every((d) => beforeFuture.find((b) => b.workoutId === d.workoutId)?.told === d.told),
      detail: told.length === 0
        ? 'the runner is told nothing, because nothing happened.'
        : `${told.length} days carry an adaptation banner; all were already carried before the pass.`,
    });
  });

  it('paces track fitness as VDOT moves, and only on the weeks not yet run', async () => {
    const sub = await freshWorld(W);
    const { pool } = await import('@/lib/db/pool');
    const anchor = Number((await pool.query<{ v: string | null }>(
      `SELECT vdot::text AS v FROM projection_snapshots
        WHERE user_uuid = $1::uuid AND vdot IS NOT NULL
        ORDER BY snapshot_date DESC LIMIT 1`, [OWNER_UUID],
    )).rows[0]?.v ?? 0);

    // Establish the plan at the anchor first, so the comparison is between two
    // runs of the SAME function one step apart. Comparing against the plan as
    // authored would be comparing against a different anchor entirely — his
    // block was written months ago at a VDOT the snapshot has since moved off,
    // and a "slower" verdict would say nothing about whether paces track
    // fitness.
    await repaceTo(sub.planId, anchor);
    const pastBefore = fingerprint(await seeWeek(sub.planId, plusDays(sub.todayISO, -21), plusDays(sub.todayISO, -1)));
    const futBefore = await seeWeek(sub.planId, sub.todayISO, plusDays(sub.todayISO, 21));

    // Same anchor again, nothing out. A pace pass that rewrites the plan when
    // the evidence has not moved is indistinguishable from one malfunctioning.
    await repaceTo(sub.planId, anchor);
    const futSame = await seeWeek(sub.planId, sub.todayISO, plusDays(sub.todayISO, 21));
    check({
      world: W, id: 'w1.repace-is-byte-stable-on-an-unmoved-anchor', binding: 'binding',
      ok: fingerprint(futBefore) === fingerprint(futSame),
      detail: fingerprint(futBefore) === fingerprint(futSame)
        ? `recomputePacesForPlan run twice at the same VDOT (${anchor}) changed nothing the second time.`
        : 'recomputePacesForPlan is not idempotent — it rewrote the plan on a second pass at an unchanged anchor.',
    });

    await repaceTo(sub.planId, anchor + 3);
    const futUp = await seeWeek(sub.planId, sub.todayISO, plusDays(sub.todayISO, 21));
    const pastAfter = fingerprint(await seeWeek(sub.planId, plusDays(sub.todayISO, -21), plusDays(sub.todayISO, -1)));

    const paced = futBefore.filter((b) => b.paceTargetSPerMi != null);
    const faster = paced.filter((b) => {
      const a = futUp.find((x) => x.workoutId === b.workoutId);
      return a?.paceTargetSPerMi != null && a.paceTargetSPerMi < b.paceTargetSPerMi! - 0.5;
    });
    check({
      world: W, id: 'w1.paces-follow-the-anchor-upward', binding: 'binding',
      ok: paced.length > 0 && faster.length > 0,
      detail: paced.length === 0
        ? 'no future prescription carries a pace target at all, so the pace axis cannot be observed.'
        : `VDOT ${anchor} → ${anchor + 3}: ${faster.length} of ${paced.length} future paced days got faster`
          + (faster[0]
            ? ` (e.g. ${faster[0].dateISO} ${faster[0].paceTargetSPerMi}s/mi → `
              + `${futUp.find((x) => x.workoutId === faster[0].workoutId)?.paceTargetSPerMi}s/mi).`
            : ' — not one moved.'),
    });
    check({
      world: W, id: 'w1.repace-does-not-touch-days-already-run', binding: 'binding',
      ok: pastBefore === pastAfter,
      detail: pastBefore === pastAfter
        ? 'the re-anchor left every already-run day alone.'
        : 'the re-anchor rewrote prescriptions on days the runner has already run.',
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * WORLD 2 · HE FALLS SHORT
 *
 * The owner's rule, from the hero statement: "The plan responds in GRADED
 * fashion — reshuffle early in the week when the stimulus still matters, absorb
 * it late. A missed run is stated, never judged."
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('WORLD 2 · he falls short', () => {
  const W = 'WORLD 2 · he falls short';

  /** Pose the miss with the week boundary moved so the SAME miss, the same
   *  number of days old, sits early or late in its own training week. Holding
   *  staleness fixed is what isolates week position as the variable. */
  async function poseMiss(position: 'early' | 'late') {
    const sub = await freshWorld(W);
    const key = await recentKeySession(sub);
    if (!key) {
      return {
        sub, key: null as PlanDay | null, removed: 0, cleared: 0,
        detectedOnRemovalAlone: false, trigger: null, actions: [] as any[],
      };
    }

    // Week ends on long_run_day. Put the missed session at day 0 of its week
    // ("early") or on the week's last day ("late"). Moving the BOUNDARY rather
    // than the miss is what isolates week position: the session is the same
    // session, the same number of days old, in both arms — so staleness, which
    // is the only positional rule the engine has, is held constant.
    const missDow = new Date(`${key.dateISO}T12:00:00Z`).getUTCDay();
    await setLongRunDow(position === 'early' ? (missDow + 6) % 7 : missDow);

    const removed = await missSessionOn(key.dateISO);
    const detectedOnRemovalAlone = (await detectMissed()) != null;
    // The engine's completion gate looks ±1 day and reads distance only, so an
    // ordinary easy run beside the session can stand in for it. See
    // `clearCompletionWindow`.
    const threshold = Math.min(key.distanceMi ?? 4, Math.max(1, (key.distanceMi ?? 4) * 0.6));
    const cleared = detectedOnRemovalAlone ? 0 : await clearCompletionWindow(key.dateISO, threshold);

    const { triggers, actions } = await detect();
    const trigger = triggers.find((t) => t.kind === 'missed_key_workout') ?? null;
    return {
      sub, key, removed, cleared, detectedOnRemovalAlone, trigger,
      actions: actions.filter((a) => a.sourceTrigger === 'missed_key_workout'),
    };
  }

  it('a missed key session is detected, stated, and never silently dropped', async () => {
    const { key, removed, cleared, detectedOnRemovalAlone, trigger, actions } = await poseMiss('early');
    check({
      world: W, id: 'w2.scenario-is-posable', binding: 'binding',
      ok: key != null && removed > 0,
      detail: key == null
        ? 'no key session inside the 3-day freshness window in the substrate, so the miss could not be posed. '
          + 'The harness will not assert against a session the runner never had.'
        : `key session ${key.dateISO} (${key.subLabel ?? key.type}, ${key.distanceMi}mi); ${removed} real run(s) removed to make it a miss.`,
    });
    if (!key) return;

    check({
      world: W, id: 'w2.miss-is-detected', binding: 'binding',
      ok: trigger != null,
      detail: trigger
        ? `missed_key_workout fired · ${trigger.reason}`
        : 'the engine did not notice a key session the runner did not run.',
    });

    // A finding the scenario turned up on its own: the completion gate reads
    // DISTANCE ONLY across a ±1 day window, so a neighbouring easy run longer
    // than 60% of the session marks the session done.
    check({
      world: W, id: 'w2.a-key-session-is-not-completed-by-the-easy-run-beside-it', binding: 'binding',
      ok: detectedOnRemovalAlone,
      detail: detectedOnRemovalAlone
        ? 'removing the session\'s own run was enough for the engine to see the miss.'
        : `removing the run on ${key.dateISO} was NOT enough — the miss only registered after ${cleared} `
          + `neighbouring run(s) were shrunk below the completion bar. `
          + '`detectMissedKeyWorkout`\'s `completedNear` accepts ANY canonical run within ±1 day that reaches '
          + '60% of the prescribed distance, with no regard for what the run was. His 7-mile easy day therefore '
          + `satisfies this ${key.distanceMi}mi threshold session. The comment above the gate says it exists so a `
          + '"4mi easy jog" cannot "satisfy an unrelated 8mi tempo" — the percentage makes that true for a long '
          + 'session and false for a short one.',
      needs: 'the completion gate to ask what the run WAS, not only how far it went — the execution reader '
        + '(`loadKeySessionExecutions`) already answers that question for the ramp.',
    });

    check({
      world: W, id: 'w2.the-runner-is-told', binding: 'binding',
      ok: actions.length > 0,
      detail: actions.length > 0
        ? `${actions.length} action(s): ${actions.map((a) => a.kind).join(', ')} — each writes a coach_intents row the runner-facing surface reads.`
        : 'the miss produced no action and no record, so nothing reaches the runner.',
    });

    // Never judged. The owner's standing rule.
    const scolding = actions.filter((a) => /should have|failed|missed out|behind|excuse/i.test(a.why));
    check({
      world: W, id: 'w2.stated-never-judged', binding: 'binding',
      ok: scolding.length === 0,
      detail: scolding.length === 0
        ? `copy is descriptive: "${actions[0]?.why?.slice(0, 90) ?? ''}…"`
        : `judgemental copy: "${scolding[0].why}"`,
    });
  });

  it('reshuffles EARLY in the week, absorbs LATE — the graded response', async () => {
    const early = await poseMiss('early');
    if (!early.key) return;
    const earlyKinds = early.actions.map((a) => a.kind).sort().join(',');
    const earlyDate = early.actions.find((a) => a.kind === 'reschedule')?.newDate ?? null;

    const late = await poseMiss('late');
    const lateKinds = late.actions.map((a) => a.kind).sort().join(',');

    check({
      world: W, id: 'w2.response-is-graded-by-week-position', binding: 'open',
      ok: earlyKinds !== lateKinds,
      detail: earlyKinds === lateKinds
        ? `the SAME response either way — early:[${earlyKinds}] late:[${lateKinds}]. Week position is not an input. `
          + 'The only positional rule in `adapt.ts` is `isStaleMissed` (> 3 days past its ORIGINAL date), which '
          + 'measures age, not position: it reschedules a session missed late in the week INTO the next one, and '
          + 'drops one missed early precisely because the week has moved on — the inverse of the hero statement.'
        : `graded · early:[${earlyKinds}] late:[${lateKinds}]`,
      needs: 'a week-position term in `partitionMissedCandidates` / `chooseRescheduleDate`: reshuffle while the '
        + "week can still carry the stimulus, absorb once it cannot.",
    });

    if (earlyDate && early.key) {
      const w = await weekOf(early.key.dateISO);
      const inSameWeek = earlyDate >= w.start && earlyDate <= w.end;
      check({
        world: W, id: 'w2.reshuffle-stays-inside-the-training-week', binding: 'open',
        ok: inSameWeek,
        detail: inSameWeek
          ? `moved ${early.key.dateISO} → ${earlyDate}, inside its own training week ${w.start}..${w.end}.`
          : `moved ${early.key.dateISO} → ${earlyDate}, OUTSIDE its training week ${w.start}..${w.end}. `
            + '`chooseRescheduleDate` walks today+1…today+4 with no week-position awareness and nothing confining '
            + "it to the same week, so a Saturday miss lands in next week's load.",
        needs: 'chooseRescheduleDate to take the training week as a bound, not just a 4-day walk.',
      });
    }
  });

  it('a week under-run by 30% is noticed, and the response is proposed rather than imposed', async () => {
    const sub = await freshWorld(W);
    const wk = await weekOf(plusDays(sub.todayISO, -1));
    const shaved = await underRunWeek(wk.start, wk.end, 0.30);

    const { triggers, actions } = await detect();
    const { applyNow, proposeFirst } = await partition(actions);

    check({
      world: W, id: 'w2.under-run-week-is-visible-to-the-engine', binding: 'binding',
      ok: shaved > 0,
      detail: `${shaved} runs in ${wk.start}..${wk.end} cut to 70% of what he actually ran.`,
    });

    const reducing = actions.filter((a) => a.kind === 'downgrade' || a.kind === 'shave');
    check({
      world: W, id: 'w2.load-never-falls-unattended', binding: 'binding',
      ok: reducing.every((a) => proposeFirst.includes(a)),
      detail: reducing.length === 0
        ? `no load-reducing action this pass (${triggers.length} triggers: ${triggers.map((t) => t.kind).join(', ') || 'none'}).`
        : `${reducing.length} load-reducing action(s), ${proposeFirst.filter((a) => a.kind === 'downgrade' || a.kind === 'shave').length} routed to PROPOSE. `
          + 'DIRECTION-1: load may rise unattended, it may never fall unattended.',
    });
    check({
      world: W, id: 'w2.record-only-notes-still-apply', binding: 'binding',
      ok: actions.filter((a) => a.kind === 'note').every((a) => applyNow.includes(a)),
      detail: 'a `note` writes a coach_intents row and no plan row; proposing one would delete the audit trail '
        + '`tryAdaptiveBump` reads before raising load.',
    });
  });

});

/* ═══════════════════════════════════════════════════════════════════════════
 * WORLD 3 · HE PUSHES FORWARD, AND THE PLAN PUSHES BACK HARDER
 *
 * "In PACE AND IN VOLUME. More and more." This is the one that matters most and
 * the one that has never once happened in production.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('WORLD 3 · he pushes', () => {
  const W = 'WORLD 3 · he pushes';

  /** Three consecutive strong weeks, expressed in his own data: every key
   *  session in the window run 6% quicker than he actually ran it, and no
   *  pull-back standing in the 48-hour guard window.
   *
   *  2026-09-02 · this used to pose readiness GREEN as well. Nothing in the
   *  adaptation path reads a readiness snapshot any more, so posing one here
   *  would be setup for a gate that no longer exists. */
  async function pushForward(sub: Substrate, days = 21): Promise<number> {
    const { pool } = await import('@/lib/db/pool');
    const window = await readPlanDays(sub.planId, plusDays(sub.todayISO, -days), plusDays(sub.todayISO, -1));
    let sped = 0;
    for (const d of window) {
      if (d.isQuality || ['threshold', 'tempo', 'intervals', 'vo2max'].includes(d.type)) {
        sped += await runFasterOn(d.dateISO, 0.06);
      }
    }
    // He was not pulled back. `PULLBACK_BUMP_LOOKBACK_HOURS` is 48h and reads
    // the adapter's own intents; a downgrade sitting in that window is a
    // different scenario from this one.
    await pool.query(
      `DELETE FROM coach_intents
        WHERE COALESCE(user_uuid, user_id) = $1::uuid
          AND ts >= NOW() - interval '7 days'
          AND reason IN ('plan_adapt_downgrade','plan_adapt_shave')`,
      [OWNER_UUID],
    );
    return sped;
  }

  it('THE VOLUME AXIS · a runner absorbing load gets a bigger week, and can see it', async () => {
    const sub = await freshWorld(W);
    const sped = await pushForward(sub);

    const startedAt = new Date().toISOString();
    const before = await seeWeek(sub.planId, sub.todayISO, plusDays(sub.todayISO, 6));
    const diag = await rampDiagnosis();
    const result = await bump(false);
    const after = await seeWeek(sub.planId, sub.todayISO, plusDays(sub.todayISO, 6));
    const rejection = await lastMutationRejection(startedAt);
    const upgradeIntents = (await intentsSince(startedAt)).filter((i) => i.reason === 'plan_adapt_upgrade');

    check({
      world: W, id: 'w3.push-is-expressible', binding: 'binding',
      ok: sped > 0,
      detail: `${sped} of the owner's real key sessions in the last 21 days re-scored 6% quicker.`,
    });

    check({
      world: W, id: 'w3.the-upward-volume-path-fires', binding: 'binding',
      ok: result != null,
      detail: result
        ? `the ramp DECIDED to push · +${result.longBumpMi}mi long, +${result.weeklyBumpMi}mi week, across `
          + `${result.bumps} days. why: ${result.why}`
        : `NO BUMP. Gates shut: [${diag.blockedBy.join(', ') || 'none — planUpgrade found no rows to bump'}]. `
          + `Signals: ${JSON.stringify(diag.signals)}; details ${JSON.stringify(diag.details)}.`,
    });

    // Deciding and landing are two facts, and `tryAdaptiveBump` reports only
    // the first. `applyAdaptations` runs inside `mutatePlan`, which rolls the
    // whole batch back when it introduces a doctrine violation — and the bump
    // never reads that return value, so its caller busts the briefing cache and
    // logs a push for a change that may not be in the database.
    const landed = totalMi(after) > totalMi(before) + 0.05;
    check({
      world: W, id: 'w3.the-decision-to-push-actually-reaches-the-plan', binding: 'binding',
      ok: result == null || landed,
      detail: result == null
        ? 'no bump was decided, so there was nothing to land (see the check above).'
        : landed
          ? `the week ahead moved ${totalMi(before)}mi → ${totalMi(after)}mi, and ${upgradeIntents.length} `
            + '`plan_adapt_upgrade` intent(s) were written.'
          : `THE BUMP WAS REPORTED AND DID NOT LAND. tryAdaptiveBump returned a summary `
            + `(+${result.longBumpMi}mi long, +${result.weeklyBumpMi}mi week) and the week ahead is unchanged at `
            + `${totalMi(after)}mi. ${upgradeIntents.length} upgrade intents written. Mutation boundary: `
            + `${rejection ? `${rejection.outcome} from ${rejection.source} · ${JSON.stringify(rejection.violations).slice(0, 220)}` : 'no rejection recorded'}. `
            + 'tryAdaptiveBump ignores applyAdaptations\'s return, so the cron logs a push, busts the briefing '
            + 'cache and reports `bump` for a write that was rolled back.',
      needs: 'tryAdaptiveBump to read the apply result and report what actually landed — and, where the boundary '
        + 'is right to refuse, a bump sized so it does not introduce the violation in the first place.',
    });

    const longBefore = before.find((d) => d.type === 'long');
    const longAfter = after.find((d) => d.type === 'long');
    check({
      world: W, id: 'w3.the-long-run-grows', binding: 'open',
      ok: longBefore != null && longAfter != null
        && (longAfter.distanceMi ?? 0) > (longBefore.distanceMi ?? 0) + 0.05,
      detail: longBefore && longAfter
        ? `long run ${longBefore.dateISO}: ${longBefore.distanceMi}mi → ${longAfter.distanceMi}mi`
        : 'no long run in the week ahead to grow.',
      needs: 'w3.the-decision-to-push-actually-reaches-the-plan',
    });

    check({
      world: W, id: 'w3.the-week-gets-bigger', binding: 'open',
      ok: landed,
      detail: `week ahead ${totalMi(before)}mi → ${totalMi(after)}mi`,
      needs: 'w3.the-decision-to-push-actually-reaches-the-plan',
    });

    const told = after.filter((d) => d.told != null);
    check({
      world: W, id: 'w3.the-runner-is-told-the-plan-got-harder', binding: 'open',
      ok: told.length > 0,
      detail: told.length > 0
        ? `${told.length} day(s) carry a banner, e.g. "${told[0].told}"`
        : 'no banner, because nothing landed. Note for when it does: `mark_upgrade` writes reason '
          + '`plan_adapt_upgrade`, which `adaptation-info.ts` maps to kind "other" because "upgrade" is not in '
          + 'its list, and `WorkoutDetail.tsx` then renders the word "Adjusted" — the one adaptation that ADDS '
          + 'work is the only one the surface has no verb for.',
      needs: 'w3.the-decision-to-push-actually-reaches-the-plan, plus an `upgrade` entry in the surface\'s verb table.',
    });
  });

  it('THE COOLDOWN · the plan does not push again before the last push is absorbed', async () => {
    const sub = await freshWorld(W);
    await pushForward(sub);

    const first = await bump(false);
    const second = await bump(false);

    check({
      world: W, id: 'w3.bump-cooldown-holds', binding: 'binding',
      ok: first == null || second == null,
      detail: first == null
        ? 'the first bump did not fire, so the cooldown could not be exercised (see w3.the-upward-volume-path-fires).'
        : 'TWO BUMPS IN ONE EVALUATION. `detectRampSignals` reads its 7-day cooldown from '
          + "`coach_intents.reason = 'plan_adapt_bump'`, and NOTHING IN THE CODEBASE EVER WRITES THAT REASON — "
          + "`applyAdaptations` writes `plan_adapt_upgrade` for a mark_upgrade (adapt.ts:1697). So "
          + '`daysSinceLastBump` is the 999 sentinel on every evaluation, `noBumpRecent` is permanently true, and '
          + 'the absorption window doctrine asks for does not exist. It also means the module header\'s evidence '
          + "that the ramp \"never fired\" — zero `plan_adapt_bump` rows — is confounded: that reason would read "
          + 'zero even if the ramp fired nightly.',
      needs: "adaptive-ramp.ts's cooldown query to read the reason the writer actually writes.",
    });
  });

  it('THE PACE AXIS · a re-anchor upward makes the unrun weeks faster', async () => {
    const sub = await freshWorld(W);
    await pushForward(sub);
    const { pool } = await import('@/lib/db/pool');
    const anchor = Number((await pool.query<{ v: string | null }>(
      `SELECT vdot::text AS v FROM projection_snapshots
        WHERE user_uuid = $1::uuid AND vdot IS NOT NULL ORDER BY snapshot_date DESC LIMIT 1`,
      [OWNER_UUID],
    )).rows[0]?.v ?? 0);

    // Baseline the plan at the current anchor first, for the reason world 1
    // gives: his block was priced months ago at an anchor the evidence has
    // since moved off, so comparing a re-anchor against the AUTHORED paces
    // measures the age of the plan, not the response to the push.
    await repaceTo(sub.planId, anchor);
    const before = await seeWeek(sub.planId, sub.todayISO, plusDays(sub.todayISO, 21));
    const res = await repaceTo(sub.planId, anchor + 3);
    const after = await seeWeek(sub.planId, sub.todayISO, plusDays(sub.todayISO, 21));

    const paced = before.filter((b) => b.paceTargetSPerMi != null);
    const faster = paced.filter((b) => {
      const a = after.find((x) => x.workoutId === b.workoutId);
      return a?.paceTargetSPerMi != null && a.paceTargetSPerMi < b.paceTargetSPerMi! - 0.5;
    });
    check({
      world: W, id: 'w3.prescribed-paces-get-harder', binding: 'binding',
      ok: faster.length > 0,
      detail: `VDOT ${anchor} → ${anchor + 3}: ${faster.length}/${paced.length} unrun paced days got faster`
        + `${res ? ` (recomputePacesForPlan touched ${JSON.stringify(res).slice(0, 120)})` : ' (recomputePacesForPlan returned null)'}`,
    });

    check({
      world: W, id: 'w3.both-axes-answer', binding: 'open',
      ok: false,
      detail: 'PACE moves on a re-anchor (above) and VOLUME moves only through `tryAdaptiveBump`, which does not '
        + 'fire on this substrate. Until both move in the same scenario, the engine has answered half the '
        + 'question — CLAUDE.md: "an engine that re-anchors paces while the volume curve stays frozen has '
        + 'answered only half."',
      needs: 'w3.the-upward-volume-path-fires and w3.prescribed-paces-get-harder green in the SAME run.',
    });
  });

  it('THE SESSION AXIS · the progression gate can reach a session and accelerate it', async () => {
    const sub = await freshWorld(W);
    await pushForward(sub);
    await clearProgressionMarker();

    const authored = (await readPlanDays(sub.planId, sub.blockStartISO, sub.blockEndISO))
      .filter((d) => d.hasProgressionBlock);
    check({
      world: W, id: 'w3.plan-rows-carry-a-progression-block', binding: 'open',
      ok: authored.length > 0,
      detail: authored.length > 0
        ? `${authored.length} rows carry workout_spec.progression, so the weekly cycle has targets.`
        : 'ZERO rows in the whole block carry `workout_spec.progression`. `loadProgressionWeek` requires that key '
          + '(`readProgressionSpec(r.workout_spec)` null → skip), so it returns null, `detectProgressionGate` '
          + 'returns null, and TAKE / ACCELERATE / HOLD / BACK_OFF has never had a session to decide about. '
          + 'The authoring side is `generate.ts`, whose `trackFor(slot)` returns null when the catalogue chose the '
          + 'session — which is nearly always.',
      needs: 'the authoring path to stamp a progression block on trajectory-owned quality rows.',
    });

    // The cycle only fires on the first three days of a training week
    // (PASS_CATCHUP_DAYS). Anchor the week to today so the harness can run on
    // any day — the boundary moves, no evidence does.
    const todayDow = new Date(`${sub.todayISO}T12:00:00Z`).getUTCDay();
    await setLongRunDow((todayDow + 6) % 7);

    const week = await loadProgression();
    check({
      world: W, id: 'w3.the-weekly-progression-cycle-runs', binding: 'open',
      ok: week != null && week.targets.length > 0,
      detail: week
        ? `cycle due for ${week.weekStartISO}..${week.weekEndISO} with ${week.targets.length} target(s), ${week.weeklyMi}mi`
        : 'the weekly cycle did not load. With the week anchored to today the dueness gate is open, so the '
          + 'remaining causes are: no active plan, a cutback/race/taper week, or no trajectory-owned quality '
          + 'session — the last of which is w3.plan-rows-carry-a-progression-block.',
      needs: 'w3.plan-rows-carry-a-progression-block',
    });

    // The mechanism itself, exercised on real geometry regardless of whether
    // authoring stamps the block. `resolveWeekProgression` is pure, so this is
    // the shipped decision function on a shipped shape — no reimplementation.
    const { resolveWeekProgression } = await import('@/lib/plan/progression-pass');
    const strong = {
      band: 'strong' as const, confidence: 'high' as const, decision: 'progress' as const,
      stepMultiplier: 1.5, dimensions: [], veto: null,
      summary: 'Absorbing the block well.',
    };
    // Sized so Daniels' at-pace weekly share is not the binding constraint —
    // a capped step returns TAKE by design, and this check is about whether
    // ACCELERATE can be reached at all, not about the cap.
    const shape = { reps: 4, repMinutes: 5, recoveryMinutes: 1, paceSPerMi: 372, zone: 'ESTABLISHED' as const };
    const resolved = resolveWeekProgression({
      targets: [{
        workoutId: 'harness-probe', dateISO: plusDays(sub.todayISO, 2), family: 'threshold',
        current: shape, authored: shape, authoredLever: 'quality_duration', dayBudgetMi: 12,
      }],
      prior: new Map([['threshold', {
        family: 'threshold' as const, dateISO: plusDays(sub.todayISO, -5),
        prescribed: shape, authored: shape,
      }]]),
      verdict: strong as never,
      weeklyMi: 60,
    });
    const acc = resolved[0];
    const grew = acc != null
      && (acc.shape.reps * acc.shape.repMinutes) > (shape.reps * shape.repMinutes) + 0.01;
    check({
      world: W, id: 'w3.ACCELERATE-is-decidable', binding: 'binding',
      ok: acc?.action === 'ACCELERATE' && grew,
      detail: acc
        ? `strong adaptation on a ${shape.reps}x${shape.repMinutes}min threshold → ${acc.action}, `
          + `${acc.shape.reps}x${acc.shape.repMinutes}min `
          + `(${(acc.shape.reps * acc.shape.repMinutes).toFixed(1)}min of work, was `
          + `${(shape.reps * shape.repMinutes).toFixed(1)}min). why: ${acc.why.slice(0, 90)}…`
        : 'resolveWeekProgression returned nothing.',
    });

    check({
      world: W, id: 'w3.ACCELERATE-has-ever-reached-a-runner', binding: 'open',
      ok: (week?.targets.length ?? 0) > 0 && authored.length > 0,
      detail: 'the decision function accelerates correctly and no plan row it can act on exists. '
        + "`adaptation-info.ts` recognises reason `plan_adapt_progression` and renders \"was CRUISE INTERVALS\" "
        + 'from it — a surface with zero rows in production, so it has never rendered.',
      needs: 'w3.plan-rows-carry-a-progression-block',
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE LEDGER · the harness's own verdict, and its liveness.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('the harness itself', () => {
  it('drove real scenarios, and reports honestly on what it found', () => {
    const v = verdict();

    // Rule 18 guard 2 · a harness that ran nothing and reported clean is the
    // worst outcome available, because it also reports confidence.
    expect(v.total, 'the harness recorded no checks at all').toBeGreaterThan(10);
    expect(v.worlds, 'the harness drove fewer than the three worlds').toBeGreaterThanOrEqual(4);

    // A stale OPEN marker means the behaviour landed and nobody promoted it.
    // Rule 18 guard 4: every allowlist is a ratchet.
    expect(
      v.stale.map((c) => c.id),
      'these checks are marked OPEN but now PASS — promote them to binding',
    ).toEqual([]);

    // Binding behaviour is behaviour the engine is supposed to have today.
    expect(
      v.broken.map((c) => `${c.id} · ${c.detail}`),
      'binding checks failed',
    ).toEqual([]);
  });
});
