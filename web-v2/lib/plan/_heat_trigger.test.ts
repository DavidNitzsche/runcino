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
 * (a record-only 'note'). 2026-09-02 · that sentence used to cite "the same
 * pattern as the deprecated rhr_spike / sleep_crater cases" for company. Those
 * cases are gone — readiness, illness, injury and niggle no longer influence
 * training at all — so `heat_bail` is now the only deprecated limb left, and
 * the comparison is deleted rather than left pointing at nothing.
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

  it('DIRECTION-1 · which triggers must be proposed, and which may apply', () => {
    // Re-homed 2026-09-02 out of a test whose first half posed a readiness
    // amber/red pair. Readiness no longer produces a trigger of any kind, so
    // that half is deleted; these membership checks are about DIRECTION-1 and
    // survive it unchanged.
    //
    //   DIRECTION-1 (2026-08-29) · load may rise unattended, it may never
    //   fall unattended.
    //
    // Outside the gate, because none of these takes work away.
    const applyNowKinds: AdaptationTriggerKind[] = ['pr_bank', 'goal_changed'];
    for (const k of applyNowKinds) expect(PROPOSE_FIRST_TRIGGERS.has(k)).toBe(false);
    // Inside it, because each does. `niggle_reported` used to sit in this
    // list; it is not a trigger any more, so it is dropped rather than
    // asserted about.
    const nowGated: AdaptationTriggerKind[] = ['missed_key_workout', 'volume_overshoot'];
    for (const k of nowGated) expect(PROPOSE_FIRST_TRIGGERS.has(k)).toBe(true);
    // Rule 18 §2 · liveness. An empty set would satisfy every `false`
    // assertion above and report clean.
    expect(PROPOSE_FIRST_TRIGGERS.size).toBeGreaterThanOrEqual(nowGated.length);
  });

  it('DIRECTION-1 · a stale heat_bail downgrade proposes, because it is a downgrade', () => {
    // Was "still resolves as apply-now, not a live proposal". heat_bail is not
    // in PROPOSE_FIRST_TRIGGERS and never will be — the detector is retired —
    // so under the old trigger-keyed gate this fell through to apply.
    //
    // Under DIRECTION-1 the trigger is not what is asked. The action is a
    // `downgrade`, so it proposes, and a deprecated trigger nobody maintains
    // any more is exactly the case where reading direction off the action
    // rather than off a lookup table earns its keep: there is no list to
    // remember to add `heat_bail` to.
    //
    // `actionsForTrigger`'s 'heat_bail' case produces only record-only notes
    // now, so this fixture describes a stale row, not anything the engine
    // still emits.
    const heat: AdaptationAction = {
      kind: 'downgrade', workoutIds: ['w'], newType: 'easy',
      sourceTrigger: 'heat_bail', why: 'black flag',
    };
    const split = partitionActionsForCron([heat]);
    expect(split.proposeFirst).toEqual([heat]);
    expect(split.applyNow).toHaveLength(0);
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
