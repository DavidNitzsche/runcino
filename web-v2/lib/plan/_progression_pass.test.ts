/**
 * PROGRESSION-GATE-1 (2026-08-17) · the weekly cycle that connects doctrine
 * §3's two halves.
 *
 * `resolveProgressionStep` was pure, correct and never called. These tests hold
 * the cycle that calls it: when it runs, what it resolves, and — the part worth
 * the most scrutiny — that a ladder which pauses resumes from where it paused
 * rather than from where the calendar had got to in the meantime.
 *
 * The block simulation at the bottom drives the REAL `OverloadTrajectory` and
 * the REAL `classifyAdaptation`, not hand-written shapes and bands. A test that
 * asserts against its own fixtures would only prove it agrees with itself.
 */
import { describe, it, expect } from 'vitest';
import {
  PASS_CATCHUP_DAYS,
  applyProgressionReshape,
  progressionPassDue,
  resolveWeekProgression,
  sameShape,
  type PriorPrescription,
  type ProgressionResolution,
  type ProgressionTarget,
} from './progression-pass';
import { OverloadTrajectory, renderShapeLabel } from '@/lib/prescription/trajectory';
import {
  classifyAdaptation,
  type AdaptationInput,
  type AdaptationVerdict,
} from '@/lib/adaptation/adaptation-model';
import type { ProgressionLever, WorkShape } from '@/lib/prescription/levers';

const T = 462; // 7:42/mi
const WEEKLY_MI = 55;
const SEED = '4×1mi @ T pace · 90s jog';

/** The simulated block at the bottom runs a bigger runner, for the reason
 *  documented where it authors the trajectory. */
const BLOCK_WEEKLY_MI = 70;
const BLOCK_SEED = '4×6 min @ T pace · 90s jog';

const BLANK: AdaptationInput = {
  keySessionsPlanned: null, keySessionsCompleted: null, targetVerdicts: null,
  repConsistency: null, rpeReported: null, rpeHarderThanExpected: null,
  decouplingVerdicts: null, lateDriftBpm: null, easyDiscipline: null,
  recoveryPctOfExpected: null, readinessBelowNormalDays: null, readinessWindowDays: null,
  weeklyPlannedMi: null, weeklyActualMi: null, trainingForm: null,
  distinctEvidenceWeeks: null, adapterDowngrades: null,
  niggleSeverity: null, illnessActive: null, injuryActive: null,
};

/** Verdicts built from real signals through the real classifier. */
function verdictFrom(over: Partial<AdaptationInput>): AdaptationVerdict {
  return classifyAdaptation({ ...BLANK, ...over });
}

/** Absorbing the work well, with the weeks behind it to call it a trend. */
const ABSORBING = verdictFrom({
  keySessionsPlanned: 8, keySessionsCompleted: 8,
  targetVerdicts: ['on', 'on', 'on', 'on', 'on', 'on'],
  weeklyPlannedMi: [50, 52, 55, 55], weeklyActualMi: [50, 52, 55, 55],
  trainingForm: 'PRODUCTIVE', distinctEvidenceWeeks: 4, adapterDowngrades: 0,
  rpeReported: 6, rpeHarderThanExpected: 0,
  decouplingVerdicts: ['race-ready', 'building', 'race-ready'],
});

/**
 * Training landing about as expected — doctrine's "progress as planned".
 *
 * Identical signals to ABSORBING but only two weeks of them, so the trend gate
 * on `strong` withholds acceleration. The classifier says so itself: "recent
 * sessions look good, but it is not yet enough weeks to call it a trend."
 */
const STEADY = verdictFrom({
  keySessionsPlanned: 6, keySessionsCompleted: 6,
  targetVerdicts: ['on', 'on', 'on', 'on'],
  weeklyPlannedMi: [55, 55], weeklyActualMi: [55, 54],
  trainingForm: 'PRODUCTIVE', distinctEvidenceWeeks: 2, adapterDowngrades: 0,
  rpeReported: 4, rpeHarderThanExpected: 0,
});

/**
 * Not absorbing it: half the key sessions missed, targets slipping, RPE above
 * what was prescribed, decoupling gone poor, weekly volume falling off plan.
 *
 * The execution gate is what pins this to `marginal` rather than letting the
 * healthy consistency numbers average it back up — "you cannot earn more
 * training by not doing the training".
 */
const STRUGGLING = verdictFrom({
  keySessionsPlanned: 8, keySessionsCompleted: 4,
  targetVerdicts: ['on', 'slow', 'slow', 'on', 'slow', 'slow'],
  weeklyPlannedMi: [55, 55, 55, 55], weeklyActualMi: [48, 44, 41, 43],
  trainingForm: 'LOADED', distinctEvidenceWeeks: 4, adapterDowngrades: 1,
  rpeReported: 6, rpeHarderThanExpected: 4,
  decouplingVerdicts: ['building', 'poor', 'poor'],
});

// The fixtures are only useful if they land where the narrative needs them, and
// they are built from signals rather than declared, so this is a real check.
describe('fixtures land on the bands the scenarios describe', () => {
  it('classifies as strong / normal / marginal', () => {
    expect(ABSORBING.band).toBe('strong');
    expect(STEADY.band).toBe('normal');
    expect(STRUGGLING.band).toBe('marginal');
    expect(STRUGGLING.veto).toBeNull();   // a hold, not a protect
  });
});

function shape(reps: number, repMinutes: number, recoveryMinutes = 1): WorkShape {
  return { reps, repMinutes, recoveryMinutes, paceSPerMi: T, zone: 'PROGRESSIVE' };
}

// Shapes are kept inside what a 55 mi/wk week can carry at 7:42 — Daniels' 10%
// share is 5.5 miles, about 42 minutes at pace. A fixture over that line gets
// trimmed by `clampToWeek` and every assertion downstream is then measuring the
// clamp instead of the gate.
function target(over: Partial<ProgressionTarget> = {}): ProgressionTarget {
  const authored = over.authored ?? shape(3, 10);
  return {
    workoutId: 'w1', dateISO: '2026-09-08', family: 'threshold',
    current: authored, authored, authoredLever: 'quality_duration', dayBudgetMi: 9,
    ...over,
  };
}

function priorOf(prescribed: WorkShape, authored = prescribed): Map<'threshold' | 'interval', PriorPrescription> {
  return new Map([['threshold', { family: 'threshold', dateISO: '2026-09-01', prescribed, authored }]]);
}

/* --------------------------------------------------------------- 1 · when */

describe('progressionPassDue · once per training week, on the runner\'s boundary', () => {
  // David runs long on Sunday (dow 0) → his training week is Mon-Sun, so it
  // STARTS on Monday. A Saturday-long runner's starts on Sunday.
  it('fires on the first day of the training week and not before', () => {
    const mon = progressionPassDue({
      todayISO: '2026-09-07', todayDow: 1, longRunDow: 0, lastPassWeekStartISO: null,
    });
    expect(mon.due).toBe(true);
    expect(mon.weekStartISO).toBe('2026-09-07');
    expect(mon.weekEndISO).toBe('2026-09-13');

    // The Sunday before is the END of the previous week, not the start of this
    // one — its own week began six days earlier and has long since fired.
    const sun = progressionPassDue({
      todayISO: '2026-09-06', todayDow: 0, longRunDow: 0, lastPassWeekStartISO: '2026-08-31',
    });
    expect(sun.due).toBe(false);
    expect(sun.weekStartISO).toBe('2026-08-31');
  });

  it('anchors on the runner\'s long-run day, not on Monday', () => {
    // A Saturday-long runner (dow 6): the week runs Sun-Sat, so Sunday is day
    // one. Anchoring on ISO Monday would read one week's evidence against
    // another week's plan — the same defect the weekly check-in cron had.
    const satRunner = progressionPassDue({
      todayISO: '2026-09-06', todayDow: 0, longRunDow: 6, lastPassWeekStartISO: null,
    });
    expect(satRunner.due).toBe(true);
    expect(satRunner.weekStartISO).toBe('2026-09-06');
    expect(satRunner.weekEndISO).toBe('2026-09-12');
    // And Monday is mid-week for them.
    expect(progressionPassDue({
      todayISO: '2026-09-07', todayDow: 1, longRunDow: 6, lastPassWeekStartISO: null,
    }).dayIndex).toBe(1);
  });

  it('never fires twice for the same week', () => {
    for (const [iso, dow] of [['2026-09-07', 1], ['2026-09-08', 2], ['2026-09-09', 3]] as const) {
      expect(progressionPassDue({
        todayISO: iso, todayDow: dow, longRunDow: 0, lastPassWeekStartISO: '2026-09-07',
      }).due, `${iso} re-fired`).toBe(false);
    }
  });

  it('catches up on a missed cron tick, but does not resolve a week half-run', () => {
    // A lost cron tick must not cost the runner a whole cycle...
    for (let d = 0; d <= PASS_CATCHUP_DAYS; d++) {
      const iso = ['2026-09-07', '2026-09-08', '2026-09-09'][d];
      expect(progressionPassDue({
        todayISO: iso, todayDow: 1 + d, longRunDow: 0, lastPassWeekStartISO: null,
      }).due, `day ${d} should still catch up`).toBe(true);
    }
    // ...but by midweek the quality days have started landing. Next week's
    // pass reads the same evidence plus this week's, which is strictly better
    // than rewriting a week the runner is already inside.
    expect(progressionPassDue({
      todayISO: '2026-09-10', todayDow: 4, longRunDow: 0, lastPassWeekStartISO: null,
    }).due).toBe(false);
  });
});

/* ------------------------------------------------------- 2 · what it does */

describe('resolveWeekProgression · evidence permits or modifies', () => {
  it('writes nothing at all while the plan is going fine', () => {
    // The property that keeps a healthy plan byte-stable: the authored shape is
    // used verbatim, so `changed` is false and the caller emits no action.
    const authored = shape(3, 10);
    const [res] = resolveWeekProgression({
      targets: [target({ authored, current: authored })],
      prior: priorOf(shape(3, 8)),
      verdict: STEADY,
      weeklyMi: WEEKLY_MI,
    });
    expect(res.action).toBe('TAKE');
    expect(res.changed).toBe(false);
    expect(sameShape(res.shape, authored)).toBe(true);
  });

  it('asks for a little more when the runner is absorbing the block', () => {
    const [res] = resolveWeekProgression({
      targets: [target({ authored: shape(3, 10), current: shape(3, 10) })],
      prior: priorOf(shape(3, 8)),
      verdict: ABSORBING,
      weeklyMi: WEEKLY_MI,
    });
    expect(res.action).toBe('ACCELERATE');
    expect(res.shape.repMinutes).toBeGreaterThan(10);
    // Bigger step, never an unbounded one — Daniels' share of the week still
    // binds. 5.5 mi at 7:42 is a little over 42 minutes.
    expect(res.shape.reps * res.shape.repMinutes).toBeLessThanOrEqual(43);
  });

  it('holds the previous session rather than adding to it', () => {
    const [res] = resolveWeekProgression({
      targets: [target({ authored: shape(3, 10) })],
      prior: priorOf(shape(3, 8)),
      verdict: STRUGGLING,
      weeklyMi: WEEKLY_MI,
    });
    expect(res.action).toBe('HOLD');
    expect(res.changed).toBe(true);
    // Repeats what was PRESCRIBED, not what the calendar wanted.
    expect(res.shape.reps).toBe(3);
    expect(res.shape.repMinutes).toBe(8);
    // A held week accumulates; it does not overload. Doctrine §4.
    expect(res.shape.zone).toBe('ESTABLISHED');
    // No lever was pulled, and the calendar's proposal is carried so the next
    // cycle can see the divergence.
    expect(res.lever).toBeNull();
    expect(res.authored.repMinutes).toBe(10);
  });

  it('never moves pace, in any band', () => {
    for (const verdict of [ABSORBING, STEADY, STRUGGLING]) {
      const [res] = resolveWeekProgression({
        targets: [target()],
        prior: priorOf(shape(3, 8)),
        verdict,
        weeklyMi: WEEKLY_MI,
      });
      expect(res.shape.paceSPerMi, `${verdict.band} moved pace`).toBe(T);
    }
  });

  it('takes the first session of a block as authored · nothing to hold yet', () => {
    const [res] = resolveWeekProgression({
      targets: [target()],
      prior: new Map(),
      verdict: STRUGGLING,
      weeklyMi: WEEKLY_MI,
    });
    expect(res.action).toBe('TAKE');
    expect(res.changed).toBe(false);
  });

  it('re-anchors a held shape on the row\'s own pace', () => {
    // Evidence moved the anchor between the two weeks (`recomputePacesForPlan`).
    // Holding last week's DOSE must not drag last week's PACE along with it.
    const [res] = resolveWeekProgression({
      targets: [target({
        authored: { ...shape(3, 10), paceSPerMi: 450 },
        current: { ...shape(3, 10), paceSPerMi: 450 },
      })],
      prior: priorOf({ ...shape(3, 8), paceSPerMi: T }),
      verdict: STRUGGLING,
      weeklyMi: WEEKLY_MI,
    });
    expect(res.action).toBe('HOLD');
    expect(res.shape.repMinutes).toBe(8);
    expect(res.shape.paceSPerMi).toBe(450);
  });

  it('resumes the ladder from the pause, not from where the calendar reached', () => {
    // THE mechanism. The runner has been held at 3x8 while the calendar climbed
    // to 3x14. On recovery the honest next step is one rung above the pause.
    const [res] = resolveWeekProgression({
      targets: [target({
        authored: shape(3, 14),
        current: shape(3, 14),
        authoredLever: 'quality_duration',
      })],
      // Diverged: prescribed 3x8 against an authored 3x12 last week.
      prior: priorOf(shape(3, 8), shape(3, 12)),
      verdict: STEADY,
      weeklyMi: WEEKLY_MI,
    });
    expect(res.action).toBe('TAKE');
    expect(res.changed).toBe(true);
    // 3x8 plus one duration step — NOT the calendar's 3x14.
    expect(res.shape.reps).toBe(3);
    expect(res.shape.repMinutes).toBe(10);
  });

  it('holds rather than inventing a step when the calendar authored none', () => {
    // A capped or seed week carries no lever, so there is nothing to add to the
    // held shape.
    const [res] = resolveWeekProgression({
      targets: [target({ authored: shape(3, 14), current: shape(3, 14), authoredLever: null })],
      prior: priorOf(shape(3, 8), shape(3, 12)),
      verdict: STEADY,
      weeklyMi: WEEKLY_MI,
    });
    expect(res.shape.repMinutes).toBe(8);
  });

  it('keeps each quality track on its own ladder', () => {
    // A threshold session and a rep session progress independently — the
    // trajectory authors them as separate tracks and the gate must not merge
    // them.
    const res = resolveWeekProgression({
      targets: [
        target({ workoutId: 't', family: 'threshold', authored: shape(3, 10), current: shape(3, 10) }),
        target({ workoutId: 'i', family: 'interval', authored: shape(5, 4), current: shape(5, 4), authoredLever: 'interval_duration' }),
      ],
      prior: new Map([
        ['threshold', { family: 'threshold', dateISO: 'x', prescribed: shape(3, 8), authored: shape(3, 8) }],
        ['interval', { family: 'interval', dateISO: 'x', prescribed: shape(4, 4), authored: shape(4, 4) }],
      ]),
      verdict: STRUGGLING,
      weeklyMi: WEEKLY_MI,
    });
    expect(res.map((r) => `${r.shape.reps}x${r.shape.repMinutes}`)).toEqual(['3x8', '4x4']);
  });
});

/* ------------------------------------------------------- 3 · what it writes */

describe('applyProgressionReshape · spec, label and pace cannot disagree', () => {
  type Captured = { sql: string; params: unknown[] };

  /** A client that answers the live-row read and records every write. */
  function fakeClient(live: Record<string, unknown> | null, captured: Captured[]) {
    return {
      query: async (sql: string, params: unknown[]) => {
        if (/^\s*SELECT type, distance_mi/.test(sql)) {
          return { rows: live ? [live] : [] };
        }
        captured.push({ sql, params });
        return { rows: [] };
      },
    } as unknown as Parameters<typeof applyProgressionReshape>[0];
  }

  const held: ProgressionResolution = {
    workoutId: 'w9', dateISO: '2026-09-08', family: 'threshold',
    action: 'HOLD',
    shape: { reps: 3, repMinutes: 11, recoveryMinutes: 1, paceSPerMi: T, zone: 'ESTABLISHED' },
    authored: { reps: 3, repMinutes: 13, recoveryMinutes: 1, paceSPerMi: T, zone: 'PROGRESSIVE' },
    authoredLever: 'quality_duration',
    lever: null,
    why: 'Holding this week where it was rather than adding to it.',
    changed: true,
  };

  it('writes one session · the spec, the label and the pace all come from one render', async () => {
    const captured: Captured[] = [];
    const wrote = await applyProgressionReshape(
      fakeClient({ type: 'threshold', distance_mi: '11', sub_label: '3×13 min @ T pace · 60s jog' }, captured),
      { workoutId: 'w9', row: { type: 'threshold', distanceMi: 11, subLabel: '3×13 min @ T pace · 60s jog' }, resolution: held, band: 'marginal', lthr: 168 },
    );
    expect(wrote).toBe(true);
    expect(captured).toHaveLength(1);

    const [{ sql, params }] = captured;
    // Rule 6 · the multi-writer guard is on the statement.
    expect(sql).toContain('workout_spec');
    expect(sql).toMatch(/jsonb_set/);
    // The runner can SEE it: the pre-change label is captured for
    // `adaptation-info` to render "was ...".
    expect(sql).toContain('original_sub_label = COALESCE(original_sub_label, sub_label)');

    const spec = JSON.parse(params[0] as string);
    const subLabel = params[1] as string;
    const paceTarget = params[2] as number;

    // The spec is the HELD session, parsed back out of the label the shape was
    // rendered to — three elevens, not the calendar's three thirteens.
    expect(spec.kind).toBe('threshold');
    expect(spec.rep_count).toBe(3);
    expect(spec.rep_duration_s).toBe(11 * 60);
    // Pace is untouched, in the spec and on the column.
    expect(spec.rep_pace_s_per_mi).toBe(T);
    expect(paceTarget).toBe(T);
    // The label the runner reads agrees with the spec beside it.
    expect(subLabel).toBe('3×11 min @ T pace · 60s jog');
    // And the block records both numbers, so next week can see the divergence.
    expect(spec.progression.reps).toBe(3);
    expect(spec.progression.rep_minutes).toBe(11);
    expect(spec.progression.authored.rep_minutes).toBe(13);
    expect(spec.progression.authored.lever).toBe('quality_duration');
    expect(spec.progression.gate).toMatchObject({ action: 'HOLD', band: 'marginal' });
  });

  it('refuses to write when the row is no longer the session it resolved', async () => {
    // A niggle downgrade applying earlier in the same transaction turns the row
    // into an easy run. Writing a threshold spec over it would produce exactly
    // the contradictory state the downgrade path exists to avoid.
    const captured: Captured[] = [];
    const wrote = await applyProgressionReshape(
      fakeClient({ type: 'easy', distance_mi: '11', sub_label: 'EASY' }, captured),
      { workoutId: 'w9', row: { type: 'threshold', distanceMi: 11, subLabel: '3×13 min @ T pace · 60s jog' }, resolution: held, band: 'marginal', lthr: 168 },
    );
    expect(wrote).toBe(false);
    expect(captured).toHaveLength(0);
  });

  it('sizes the session against the row\'s live mileage, not the detect-time snapshot', async () => {
    // A volume shave landed first. The day is smaller now, and the label has to
    // be true of the day it is printed on.
    const captured: Captured[] = [];
    await applyProgressionReshape(
      fakeClient({ type: 'threshold', distance_mi: '6', sub_label: '3×13 min @ T pace · 60s jog' }, captured),
      { workoutId: 'w9', row: { type: 'threshold', distanceMi: 11, subLabel: '3×13 min @ T pace · 60s jog' }, resolution: held, band: 'marginal', lthr: 168 },
    );
    const spec = JSON.parse(captured[0].params[0] as string);
    const dayMi = spec.warmup_mi + (spec.rep_count * spec.rep_duration_s) / T
      + Math.max(0, spec.rep_count - 1) * (spec.rep_rest_s / 540) + spec.cooldown_mi;
    expect(dayMi).toBeLessThanOrEqual(6.05);
    // And the label follows the count the spec actually built.
    expect(captured[0].params[1]).toBe(`${spec.rep_count}×11 min @ T pace · 60s jog`);
  });
});

/* ------------------------------------------------- 4 · the block, simulated */

describe('a block where adaptation degrades and then recovers', () => {
  it('holds through the bad weeks and resumes the ladder from the pause', () => {
    const WEEKS = 9;
    // Weeks 1-4 landing as expected, 5-7 the runner stops absorbing it, 8-9
    // recovered. `normal` on the recovery weeks rather than `strong` keeps the
    // question narrow: does the ladder RESUME correctly, without an
    // acceleration muddying where it resumed from.
    const script: AdaptationVerdict[] = [
      STEADY, STEADY, STEADY, STEADY,
      STRUGGLING, STRUGGLING, STRUGGLING,
      STEADY, STEADY,
    ];
    expect(script.map((v) => v.band)).toEqual([
      'normal', 'normal', 'normal', 'normal',
      'marginal', 'marginal', 'marginal',
      'normal', 'normal',
    ]);

    // ── the calendar authors the block ──────────────────────────────────
    // A 70 mi/wk block opening on 4x6. Daniels' 10% share is seven miles, about
    // 54 minutes at pace, so the calendar has real runway left when the runner
    // recovers — otherwise the ladder saturates against the cap during the hold
    // and "resumed from the pause" and "resumed from the calendar" become the
    // same number, which would make the test unable to fail.
    const traj = new OverloadTrajectory();
    const authored: Array<{
      shape: WorkShape; lever: ProgressionLever | null; dayMi: number; isDeload: boolean;
    }> = [];
    for (let w = 0; w < WEEKS; w++) {
      const isDeload = w > 0 && (w + 1) % 4 === 0;
      const weeklyMi = isDeload ? Math.round(BLOCK_WEEKLY_MI * 0.8) : BLOCK_WEEKLY_MI;
      const step = traj.step({
        family: 'threshold', weekIdx: w, seedPrescription: BLOCK_SEED, paceSPerMi: T,
        weeklyMi, dayBudgetMi: 11,
        sizeDay: { ceilingMi: 16, atPaceCapMi: null },
        isDeload,
      });
      expect(step, `no authored step for week ${w + 1}`).not.toBeNull();
      authored.push({ shape: step!.shape, lever: step!.lever, dayMi: step!.dayMi ?? 9, isDeload });
    }

    // ── the gate runs once per training week ────────────────────────────
    const table: Array<{
      wk: number; band: string; proposed: string; action: string; prescribed: string; note: string;
    }> = [];
    let prior: PriorPrescription | null = null;

    for (let w = 0; w < WEEKS; w++) {
      const a = authored[w];
      const proposed = renderShapeLabel(a.shape, 'threshold', 'T pace');

      // The gate does not run on a deload week — the trajectory does not step
      // on one, so there is no proposed step to permit. Verified rather than
      // assumed: doctrine §2's W4 means NO LEVER is pulled. (The prescription
      // itself is still smaller, because Daniels' share is a share of the
      // cutback week's reduced mileage — the dose comes down without the ladder
      // moving, which is what a recovery week is.)
      //
      // And the deload does NOT become the prior. Its clamped shape is not a
      // stimulus the runner earned their way down to, and it carries no record
      // of a pause — using it would jump a held ladder back to the calendar the
      // week after every cutback. `loadProgressionWeek` skips these rows for
      // the same reason.
      if (a.isDeload) {
        expect(a.lever, `week ${w + 1} pulled a lever on a deload`).toBeNull();
        table.push({ wk: w + 1, band: '—', proposed, action: 'SKIPPED', prescribed: proposed, note: 'deload' });
        continue;
      }

      if (w === 0) {
        table.push({ wk: 1, band: '—', proposed, action: 'SEED', prescribed: proposed, note: 'block opens' });
        prior = { family: 'threshold', dateISO: 'w0', prescribed: a.shape, authored: a.shape };
        continue;
      }

      const [res] = resolveWeekProgression({
        targets: [{
          workoutId: `w${w}`, dateISO: `w${w}`, family: 'threshold',
          current: a.shape, authored: a.shape, authoredLever: a.lever, dayBudgetMi: a.dayMi,
        }],
        prior: new Map([['threshold', prior!]]),
        verdict: script[w],
        weeklyMi: BLOCK_WEEKLY_MI,
      });

      table.push({
        wk: w + 1, band: script[w].band, proposed,
        action: res.action,
        prescribed: renderShapeLabel(res.shape, 'threshold', 'T pace'),
        note: res.changed ? 'rewritten' : 'as authored',
      });
      prior = { family: 'threshold', dateISO: `w${w}`, prescribed: res.shape, authored: a.shape };
    }

    // Printed so the behaviour can be read, not only asserted.
    const head = ['wk', 'adaptation', 'calendar proposed', 'gate', 'prescribed', ''];
    const rows = table.map((r) => [
      String(r.wk), r.band, r.proposed, r.action, r.prescribed, r.note,
    ]);
    const widths = head.map((h, i) => Math.max(h.length, ...rows.map((x) => x[i].length)));
    const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join('  ');
    // eslint-disable-next-line no-console
    console.log(['', line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n'));

    /* --- the assertions the table has to satisfy ----------------------- */

    const struggling = table.filter((r) => r.band === 'marginal');
    expect(struggling.length, 'the degraded stretch never reached the gate').toBeGreaterThanOrEqual(2);

    // 1 · every struggling week HOLDS, and holds at the SAME session.
    for (const r of struggling) {
      expect(r.action, `week ${r.wk} did not hold`).toBe('HOLD');
    }
    const heldPrescriptions = new Set(struggling.map((r) => r.prescribed));
    expect(heldPrescriptions.size, 'a hold escalated between held weeks').toBe(1);

    // 2 · the hold repeated the last session the runner actually trained on,
    //     not the calendar's proposal for the held week — and it reached PAST a
    //     deload to find it, because a cutback week's clamped dose is not a
    //     stimulus anyone earned their way down to.
    const firstHeld = struggling[0];
    const beforeHold = [...table]
      .filter((r) => r.wk < firstHeld.wk && r.action !== 'SKIPPED')
      .pop()!;
    expect(firstHeld.prescribed).toBe(beforeHold.prescribed);
    expect(firstHeld.prescribed).not.toBe(firstHeld.proposed);

    // 3 · the calendar kept climbing underneath the hold — otherwise there is
    //     no divergence and the test proves nothing.
    const lastHeld = struggling[struggling.length - 1];
    expect(lastHeld.proposed).not.toBe(firstHeld.proposed);

    // 4 · THE POINT · recovery resumes ONE step above the pause, not at the
    //     calendar's accumulated position.
    const resumed = table.find((r) => r.wk > lastHeld.wk && r.action !== 'SKIPPED')!;
    expect(resumed, 'the block never recovered').toBeTruthy();
    const heldMinutes = minutesOf(firstHeld.prescribed);
    const resumedMinutes = minutesOf(resumed.prescribed);
    const calendarMinutes = minutesOf(resumed.proposed);
    expect(resumedMinutes, 'recovery did not step up from the hold').toBeGreaterThan(heldMinutes);
    expect(
      resumedMinutes,
      `recovery jumped to the calendar's position (${resumed.proposed}) instead of resuming from the pause`,
    ).toBeLessThan(calendarMinutes);
  });
});

/** Total at-pace minutes in a rendered label ("4×9 min @ T pace · 60s jog"). */
function minutesOf(label: string): number {
  const m = label.match(/^(\d+)×(\d+)\s*min/);
  if (!m) throw new Error(`unreadable label: ${label}`);
  return Number(m[1]) * Number(m[2]);
}
