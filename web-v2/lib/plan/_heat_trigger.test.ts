/**
 * HEAT-1 wiring, then its 2026-08-27 reversal.
 *
 * `lib/coach/heat-gate.ts` implements `Research/06` §11 in full — the WBGT
 * flag table, the time-on-feet conversions, the hard bails. It was briefly
 * wired as an adaptation trigger (`detectHeatBail`, propose-only) so a black
 * flag day could ask to convert or cancel a hard session.
 *
 * Removed entirely 2026-08-27: the runner paces off feel and conditions on
 * the day, and nothing in this app proposes a pace or session change because
 * of heat any more. `detectHeatBail` is deleted; `heat_bail` is dropped from
 * `PROPOSE_FIRST_TRIGGERS`; the `'heat_bail'` case in `actionsForTrigger`
 * stays only to resolve any in-flight `coach_intents` rows from the old path
 * (a record-only 'note', the same pattern as the deprecated rhr_spike /
 * sleep_crater cases).
 *
 * `lib/coach/_heat_doctrine.test.ts` holds the gate's NUMBERS against the
 * research — those stay correct, since `heatBandForConditions` still backs
 * the informational heat-band read used elsewhere (race-morning forecast,
 * HR-drift relabeling). This file now documents that the gate no longer
 * reaches the plan.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_heat_trigger.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  PROPOSE_FIRST_TRIGGERS,
  partitionActionsForCron,
  type AdaptationAction,
  type AdaptationTriggerKind,
} from './adapt';
import { evaluateHeatGate } from '@/lib/coach/heat-gate';

describe('HEAT-1 REVERSED · the heat gate no longer changes a session', () => {
  it('heat_bail is no longer propose-first · it is not a live trigger at all any more', () => {
    expect(PROPOSE_FIRST_TRIGGERS.has('heat_bail')).toBe(false);
  });

  it('readiness still defaults to propose-first · only convergent red opts out', () => {
    // 2026-08-19 · this test used to read "readiness still cannot apply
    // either". That was true under the 2026-06-03 ruling and is no longer the
    // whole picture: the owner has since ruled that readiness MAY change a
    // session, on a convergence of independent signals, settled overnight.
    //
    // What survives unchanged is the guard this test was really written for —
    // nobody may read the heat wiring as licence to let a wellness score
    // mutate the plan. Readiness's KIND is still propose-first, so an amber
    // convergence (two domains) reaches the runner as a banner and touches
    // nothing. Only an action explicitly carrying `forceApplyNow` — which
    // `actionsForTrigger` sets on a convergent-RED downgrade and nowhere else
    // — skips it. See lib/coach/convergence.ts for what red costs to reach.
    expect(PROPOSE_FIRST_TRIGGERS.has('readiness_pullback')).toBe(true);

    const amber: AdaptationAction = {
      kind: 'note', noteReason: 'readiness_convergence_amber',
      sourceTrigger: 'readiness_pullback', why: 'two domains',
    };
    const red: AdaptationAction = {
      kind: 'downgrade', workoutIds: ['wko_today'], newType: 'easy',
      sourceTrigger: 'readiness_pullback', forceApplyNow: true, why: 'three domains',
    };
    const split = partitionActionsForCron([amber, red]);
    expect(split.proposeFirst).toEqual([amber]);
    expect(split.applyNow).toEqual([red]);

    const applyNowKinds: AdaptationTriggerKind[] = [
      'missed_key_workout', 'volume_overshoot', 'pr_bank', 'goal_changed',
    ];
    for (const k of applyNowKinds) expect(PROPOSE_FIRST_TRIGGERS.has(k)).toBe(false);
  });

  it('a stale heat_bail action (from before the removal) still resolves as apply-now, not a live proposal', () => {
    // heat_bail is no longer in PROPOSE_FIRST_TRIGGERS, so partitionActionsForCron
    // has nothing to route it to specially any more — it falls through like any
    // other untagged/deprecated kind. The actual handler (`actionsForTrigger`'s
    // 'heat_bail' case) never produces a 'downgrade' shape any more; this only
    // documents the partition behavior for whatever a stale row might carry.
    const heat: AdaptationAction = {
      kind: 'downgrade', workoutIds: ['w'], newType: 'easy',
      sourceTrigger: 'heat_bail', why: 'black flag',
    };
    expect(partitionActionsForCron([heat]).applyNow).toEqual([heat]);
  });
});

describe('HEAT-1 · which verdicts become plan changes, and into what', () => {
  // The detector fires on exactly two of the gate's five actions. These
  // fixtures pin the mapping the switch in `actionsForTrigger` implements.
  const firingActions = new Set(['easy_time_on_feet', 'cancel']);

  it('black-flag WBGT converts the session to easy time on feet', () => {
    // Research/06:484 · WBGT >=80°F · all hard sessions convert.
    const v = evaluateHeatGate({ tairF: 88, humidityPct: 75, cloudCoverPct: 0 });
    expect(firingActions.has(v.action)).toBe(true);
    expect(v.proposeFirst).toBe(true);
  });

  it('a hard bail asks for the day to move indoors or postpone', () => {
    // Research/06:494 · Td >=80°F · evaporative cooling fails.
    const v = evaluateHeatGate({ tairF: 95, humidityPct: 60, cloudCoverPct: 0, dewpointF: 82 });
    expect(v.action).toBe('cancel');
    expect(v.proposeFirst).toBe(true);
  });

  it('yellow and red flags do NOT become plan proposals', () => {
    // "Reduce hard-session volume 5-10%" is guidance on how to run the session
    // as written, and it is already surfaced as prose. Turning every warm
    // afternoon into a plan proposal is precisely the reactive noise the
    // no-reactive-coach ruling forbids, so the detector ignores these rows.
    const yellow = evaluateHeatGate({ tairF: 74, humidityPct: 60, cloudCoverPct: 100 });
    expect(yellow.action).toBe('reduce_hard_volume');
    expect(firingActions.has(yellow.action)).toBe(false);

    const red = evaluateHeatGate({ tairF: 84, humidityPct: 60, cloudCoverPct: 100 });
    expect(red.action).toBe('reduce_intensity');
    expect(firingActions.has(red.action)).toBe(false);
  });

  it('an ordinary day produces no trigger at all', () => {
    const v = evaluateHeatGate({ tairF: 58, humidityPct: 55, cloudCoverPct: 40 });
    expect(v.fires).toBe(false);
    expect(firingActions.has(v.action)).toBe(false);
  });

  it('no forecast produces no trigger · a missing input reads as missing', () => {
    const v = evaluateHeatGate({ tairF: null });
    expect(v.fires).toBe(false);
    expect(firingActions.has(v.action)).toBe(false);
  });
});
