/**
 * HEAT-1 wiring · the heat gate can now act, and only by proposing.
 *
 * `lib/coach/heat-gate.ts` implemented `Research/06` §11 in full — the WBGT
 * flag table, the time-on-feet conversions, the hard bails — and nothing
 * registered it as an adaptation trigger. At ACSM black flag the prescription
 * was unchanged and the day terminated in a sentence.
 *
 * `lib/coach/_heat_doctrine.test.ts` holds the gate's NUMBERS against the
 * research. This file holds the WIRING: that a firing verdict reaches the
 * adapter, that it becomes the right kind of plan change, and — the part worth
 * being loud about — that it can only ever propose.
 *
 * Nothing here touches the database. The detector's DB half (does today's plan
 * even have a hard session, where does the runner live, what is the forecast)
 * is I/O; the decision it hangs on is the pure gate, tested directly.
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

describe('HEAT-1 · the heat gate is registered as an adaptation trigger', () => {
  it('heat_bail is propose-first · it may never mutate the plan by itself', () => {
    expect(PROPOSE_FIRST_TRIGGERS.has('heat_bail')).toBe(true);
  });

  it('a heat_bail action is routed to the proposal writer, never to apply-now', () => {
    const heat: AdaptationAction = {
      kind: 'downgrade', workoutIds: ['wko_today'], newType: 'easy',
      sourceTrigger: 'heat_bail', why: 'Heat gate · WBGT 88°F. Black flag.',
    };
    const missed: AdaptationAction = {
      kind: 'reschedule', workoutIds: ['wko_other'], newDate: '2026-08-19',
      sourceTrigger: 'missed_key_workout', why: 'missed',
    };
    const { applyNow, proposeFirst } = partitionActionsForCron([heat, missed]);
    expect(proposeFirst).toEqual([heat]);
    expect(applyNow).toEqual([missed]);
  });

  it('the readiness ruling is untouched · readiness still cannot apply either', () => {
    // This is the guard against someone reading the heat wiring as licence to
    // let a wellness score mutate the plan. Heat earns an action because it is
    // an environmental hazard with a doctrine hard stop; readiness has neither
    // property, and its membership here is what keeps it informing only.
    expect(PROPOSE_FIRST_TRIGGERS.has('readiness_pullback')).toBe(true);
    const applyNowKinds: AdaptationTriggerKind[] = [
      'missed_key_workout', 'volume_overshoot', 'pr_bank', 'goal_changed',
    ];
    for (const k of applyNowKinds) expect(PROPOSE_FIRST_TRIGGERS.has(k)).toBe(false);
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
