/**
 * PROGRESSION-1 · the authored plan carries a default overload trajectory.
 *
 * The defect these tests hold shut, in one sentence: a fourteen-week block
 * prescribed the same threshold session fourteen times, at the same pace.
 *
 * Two separate causes, both real. `resolvePrescriptions(cat, phase, level)`
 * resolved ONE string per (distance category, phase, level) and every week of
 * that phase rendered it verbatim — no week index reached rep count or rep
 * duration anywhere in the engine. And the one thing that did move week to
 * week, `blendedTPaceForWeek`'s pace ramp, moved on the calendar, which
 * `Design/adaptive-progression-engine.md` Rule 1 forbids; deleting it in
 * `fbc61eb9` was correct and left nothing in its place.
 *
 * What the trajectory has to prove, and what each block below checks:
 *
 *   · it reproduces the doctrine's canonical threshold progression;
 *   · the pace does NOT move, because pace is the ninth lever and an authored
 *     plan has no evidence behind it;
 *   · a deload week carries no progression step;
 *   · a capped lever moves to the next one, and an all-capped session HOLDS,
 *     which is a correct outcome rather than a failure;
 *   · the rendered label round-trips into the spec the watch executes.
 *
 * Run: ./node_modules/.bin/vitest run lib/prescription/_trajectory.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  OverloadTrajectory,
  authoringAdaptation,
  clampToWeek,
  renderRoundTrips,
  renderShapeLabel,
  seedShapeFrom,
  paceTagOf,
  SESSION_LADDER,
} from './trajectory';
import { totalWorkMinutes, type WorkShape } from './levers';
import { buildWorkoutSpec } from '@/lib/plan/spec-builder';
import { subLabelFromSpec } from '@/lib/training/expand-spec';
import { buildSimPlan } from '@/lib/plan/sim-inputs';

/** 6:52/mi — a VDOT-45 marathoner's threshold, near enough. */
const T = 412;

describe('the authored default · doctrine §3, the "calendar proposes" half', () => {
  it('authoring runs on the adaptation model\'s own no-evidence verdict, which is normal', () => {
    const v = authoringAdaptation();
    // §3's table: normal -> "progress as planned". Not marginal — silence
    // about a runner nobody has watched yet is not a finding about them.
    expect(v.band).toBe('normal');
    expect(v.decision).toBe('PROGRESS');
    expect(v.stepMultiplier).toBe(1);
    expect(v.confidence).toBe('low');
  });

  it('opens on the dose the catalog already prescribed, in the levers\' units', () => {
    // The seed is not invented. "4x1mi @ T pace · 90s jog" at 6:52/mi is four
    // reps of just under seven minutes, and that is what week one prescribes.
    const seed = seedShapeFrom('4×1mi @ T pace · 90s jog', T)!;
    expect(seed.reps).toBe(4);
    expect(seed.repMinutes).toBe(7);
    expect(seed.recoveryMinutes).toBe(1.5);
    expect(seed.paceSPerMi).toBe(T);
    expect(seed.zone).toBe('ESTABLISHED');
  });

  it('has nothing to say about a continuous tempo, and says so by returning null', () => {
    expect(seedShapeFrom('continuous tempo', T)).toBeNull();
    expect(seedShapeFrom('4mi continuous tempo', T)).toBeNull();
    expect(seedShapeFrom(null, T)).toBeNull();
  });
});

describe('the canonical progression, walked by the generator\'s own walker', () => {
  /** A 60 mi/wk block with a deload on the fourth week. */
  function walk(weeks: number, opts?: { deloadEvery?: number; weeklyMi?: number; dayBudgetMi?: number }) {
    const t = new OverloadTrajectory();
    const out: Array<{ label: string; shape: WorkShape; lever: string | null }> = [];
    for (let w = 0; w < weeks; w++) {
      const step = t.step({
        family: 'threshold',
        weekIdx: w,
        seedPrescription: '4×1mi @ T pace · 90s jog',
        paceSPerMi: T,
        weeklyMi: opts?.weeklyMi ?? 60,
        dayBudgetMi: opts?.dayBudgetMi ?? 9,
        isDeload: opts?.deloadEvery ? (w > 0 && (w + 1) % opts.deloadEvery === 0) : false,
      })!;
      out.push({ label: step.label, shape: step.shape, lever: step.lever });
    }
    return out;
  }

  it('duration first, then continuity at constant volume — §2\'s shape', () => {
    const w = walk(3);
    expect([w[0].shape.reps, w[0].shape.repMinutes]).toEqual([4, 7]);
    // Duration lever. Same reps, longer reps, more total work.
    expect([w[1].shape.reps, w[1].shape.repMinutes]).toEqual([4, 9]);
    expect(w[1].lever).toBe('quality_duration');
    // Density lever. Fewer, longer reps at the SAME total — the doctrine's
    // "3 x 10 becomes 2 x 15: same volume, higher continuity".
    expect(w[2].lever).toBe('work_density');
    expect(totalWorkMinutes(w[2].shape)).toBe(totalWorkMinutes(w[1].shape));
    expect(w[2].shape.reps).toBeLessThan(w[1].shape.reps);
  });

  it('the pace never moves — not once, in a whole block', () => {
    const paces = new Set(walk(14, { deloadEvery: 4 }).map((w) => w.shape.paceSPerMi));
    expect([...paces]).toEqual([T]);
  });

  it('the stimulus does move — that is the whole point', () => {
    const w = walk(14, { deloadEvery: 4 });
    expect(totalWorkMinutes(w[w.length - 1].shape)).toBeGreaterThan(totalWorkMinutes(w[0].shape));
    // And it is not the same session fourteen times.
    expect(new Set(w.map((x) => x.label)).size).toBeGreaterThan(3);
  });

  it('a deload week carries no progression step', () => {
    const w = walk(8, { deloadEvery: 4 });
    // Weeks 3 and 7 are the cutbacks (0-indexed, (i+1) % 4 === 0).
    expect(w[3].lever).toBeNull();
    expect(w[7].lever).toBeNull();
    // And the trajectory resumes from where it stood, not from the deload.
    expect(totalWorkMinutes(w[4].shape)).toBeGreaterThanOrEqual(totalWorkMinutes(w[2].shape));
  });

  it('holds when every lever is at its cap, and a held session is not a failure', () => {
    // 30 mi/wk at 6:52 buys 3 miles of threshold — about 21 minutes. The
    // duration lever caps against that almost immediately; density buys a few
    // more cycles by trading reps for continuity at constant volume, and then
    // there is genuinely nowhere left to go.
    const steps = walk(20, { weeklyMi: 30 });
    const holds = steps.filter((s, i) => i > 0 && s.lever === null);
    expect(holds.length, 'nothing ever held at 30 mi/wk').toBeGreaterThan(0);
    // A held session is a complete, coherent prescription, not an empty one.
    for (const h of holds) {
      expect(h.label).toBeTruthy();
      expect(h.shape.reps).toBeGreaterThan(0);
      expect(h.shape.repMinutes).toBeGreaterThan(0);
      expect(h.shape.paceSPerMi).toBe(T);
    }
  });

  it('never prescribes past Daniels\' at-pace share of the week', () => {
    for (const weeklyMi of [20, 30, 45, 60, 80]) {
      for (const step of walk(14, { deloadEvery: 4, weeklyMi })) {
        const capMi = weeklyMi * 0.10;
        const workMi = (totalWorkMinutes(step.shape) * 60) / step.shape.paceSPerMi;
        expect(workMi, `${weeklyMi} mi/wk prescribed ${workMi.toFixed(2)} mi of T`)
          .toBeLessThanOrEqual(capMi + 0.05);
      }
    }
  });

  it('the two quality tracks progress independently', () => {
    const t = new OverloadTrajectory();
    for (let w = 0; w < 4; w++) {
      t.step({ family: 'threshold', weekIdx: w, seedPrescription: '4×1mi @ T pace · 90s jog', paceSPerMi: T, weeklyMi: 60, dayBudgetMi: 9, isDeload: false });
    }
    const rep = t.step({ family: 'interval', weekIdx: 4, seedPrescription: '5×1mi @ I pace · 2:00 jog', paceSPerMi: T - 33, weeklyMi: 60, dayBudgetMi: 9, isDeload: false })!;
    // The rep track opens on its own seed rather than inheriting four weeks of
    // threshold progression.
    expect(rep.lever).toBeNull();
    expect(rep.label).toMatch(/@ I pace/);
  });

  it('a rep session grows by rep duration then rep count, never by threshold\'s ladder', () => {
    expect(SESSION_LADDER.interval).toContain('interval_duration');
    expect(SESSION_LADDER.interval).toContain('rep_count');
    expect(SESSION_LADDER.threshold).toContain('work_density');
  });
});

describe('the label and the numbers are one set of numbers', () => {
  it('every shape the trajectory can produce round-trips into its own spec', () => {
    // Every zone tag the inline catalog and the seeded workout_library use.
    const tags = [null, 'T pace', 'I pace', 'I-T transition', '5K race pace', '10K effort'];
    for (const reps of [1, 2, 3, 4, 5, 6, 8, 12]) {
      for (const repMinutes of [3, 5, 7, 9, 12, 15, 20, 30]) {
        for (const recoveryMinutes of [0.5, 1, 1.5, 2, 2.5, 3]) {
          for (const family of ['threshold', 'interval'] as const) {
            for (const tag of tags) {
              const shape: WorkShape = { reps, repMinutes, recoveryMinutes, paceSPerMi: T, zone: 'PROGRESSIVE' };
              expect(renderRoundTrips(shape, family, tag), `${renderShapeLabel(shape, family, tag)}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('keeps the zone the seed named, so a resized session is not a relabelled one', () => {
    // The marathon's rep session is authored "@ I-T transition" and its spec
    // paces at T−18, which is deliberately not Daniels' I.
    expect(paceTagOf('5×1mi @ I-T transition · 2:00 jog')).toBe('I-T transition');
    expect(paceTagOf('4×1mi @ T pace · 90s jog')).toBe('T pace');
    expect(paceTagOf('5×800m @ I pace · 90s jog')).toBe('I pace');
    expect(paceTagOf('continuous tempo')).toBeNull();

    const t = new OverloadTrajectory();
    const step = t.step({
      family: 'interval', weekIdx: 0, seedPrescription: '5×1mi @ I-T transition · 2:00 jog',
      paceSPerMi: T - 18, weeklyMi: 60, dayBudgetMi: 9, isDeload: false,
    })!;
    expect(step.label).toMatch(/@ I-T transition/);
  });

  it('the spec a watch runs carries the label\'s own reps, seconds and rest', () => {
    const shape: WorkShape = { reps: 3, repMinutes: 12, recoveryMinutes: 2, paceSPerMi: T, zone: 'PROGRESSIVE' };
    const label = renderShapeLabel(shape, 'threshold');
    expect(label).toBe('3×12 min @ T pace · 2 min jog');
    const { spec, paceTargetSPerMi } = buildWorkoutSpec('threshold', 9, T, 160, label);
    const s = spec as Record<string, unknown>;
    expect(s.kind).toBe('threshold');
    expect(s.rep_count).toBe(3);
    expect(s.rep_duration_s).toBe(720);
    expect(s.rep_rest_s).toBe(120);
    expect(s.rep_pace_s_per_mi).toBe(T);
    expect(paceTargetSPerMi).toBe(T);
    // And the label survives a spec rebuild, so a pace recompute cannot
    // relabel the session as something the runner was never asked to do.
    expect(subLabelFromSpec(spec as never)).toBe(label);
  });

  it('a rep session paces off I, not off T', () => {
    const label = renderShapeLabel(
      { reps: 4, repMinutes: 4, recoveryMinutes: 3, paceSPerMi: T - 33, zone: 'PROGRESSIVE' },
      'interval',
    );
    const { spec } = buildWorkoutSpec('intervals', 8, T, 160, label, null, null, T - 33);
    expect((spec as Record<string, unknown>).rep_pace_s_per_mi).toBe(T - 33);
  });

  it('the expanded session adds up to the day it is printed on', () => {
    // Before this, a time-based rep spec pinned warm-up and cool-down at their
    // 1.5/1.0 ceilings and left the remainder of a big day unallocated.
    const label = renderShapeLabel(
      { reps: 3, repMinutes: 12, recoveryMinutes: 2, paceSPerMi: T, zone: 'PROGRESSIVE' },
      'threshold',
    );
    const { spec } = buildWorkoutSpec('threshold', 9, T, 160, label);
    const s = spec as Record<string, unknown>;
    const workMi = (3 * 720) / T;
    const floatMi = 2 * (120 / 540);
    const total = Number(s.warmup_mi) + workMi + floatMi + Number(s.cooldown_mi);
    expect(total).toBeCloseTo(9, 1);
  });
});

describe('the week decides what it can afford, the trajectory decides what was earned', () => {
  it('cuts reps before it cuts the rep', () => {
    const shape: WorkShape = { reps: 5, repMinutes: 7, recoveryMinutes: 1, paceSPerMi: T, zone: 'ESTABLISHED' };
    // 30 mi/wk buys 3 mi ≈ 21 min of threshold; 5x7 = 35 is well over.
    const cut = clampToWeek(shape, 30, 'threshold');
    expect(cut.repMinutes).toBe(7);
    expect(cut.reps).toBeLessThan(5);
    expect(totalWorkMinutes(cut) * 60 / T).toBeLessThanOrEqual(3.05);
  });

  it('the label already fits the day, so the spec never has to cut it', () => {
    // Two implementations of one rule is how they drift: the trajectory clamps
    // to the day's budget when it renders, and `timeRepSpec` clamps again when
    // it builds. If they ever disagree the runner reads six reps over a spec
    // that runs four — the sub_label/spec drift this codebase has fixed twice.
    for (const dayBudgetMi of [3, 4, 5, 6, 8, 10, 12]) {
      for (const weeklyMi of [20, 30, 45, 60, 80]) {
        const t = new OverloadTrajectory();
        for (let w = 0; w < 14; w++) {
          const step = t.step({
            family: 'threshold', weekIdx: w, seedPrescription: '4×1mi @ T pace · 90s jog',
            paceSPerMi: T, weeklyMi, dayBudgetMi, isDeload: w > 0 && (w + 1) % 4 === 0,
          })!;
          const { spec } = buildWorkoutSpec('threshold', dayBudgetMi, T, 160, step.label);
          const s = spec as Record<string, unknown>;
          expect(
            s.rep_count,
            `${dayBudgetMi}mi day / ${weeklyMi}mi week · label "${step.label}" built ${s.rep_count} reps`,
          ).toBe(step.shape.reps);
          expect(s.rep_duration_s).toBe(step.shape.repMinutes * 60);
          // And the built session fits the day it is printed on.
          const total = Number(s.warmup_mi)
            + (Number(s.rep_count) * Number(s.rep_duration_s)) / T
            + Math.max(0, Number(s.rep_count) - 1) * (Number(s.rep_rest_s) / 540)
            + Number(s.cooldown_mi);
          expect(total).toBeLessThanOrEqual(dayBudgetMi + 0.15);
        }
      }
    }
  });

  it('leaves a week that can afford the session completely alone', () => {
    const shape: WorkShape = { reps: 4, repMinutes: 9, recoveryMinutes: 1, paceSPerMi: T, zone: 'ESTABLISHED' };
    expect(clampToWeek(shape, 70, 'threshold')).toBe(shape);
  });
});

/* ── the CIM block · the deliverable ─────────────────────────────────────── */

describe('David\'s CIM block', () => {
  const CIM = {
    goalMode: 'race', distance: 'marathon', experienceLevel: 'advanced',
    startDateISO: '2026-08-31', raceDateISO: '2026-12-06',
    lastRaceFinishedDaysAgo: 0, lastRaceDistance: null, raceHistory: [],
    longRunDay: 'sun', restDay: 'sat', availableDays: [],
    planWeeks: 14, goalTimeSec: 10800,
    weeklyMileageBucket: 45, weeklyFrequency: 6, longestRunBucket: '10+',
    bestRecentVdotOverride: 45.1,
  } as never;

  it('progresses instead of repeating one session for fourteen weeks', () => {
    const r = buildSimPlan(CIM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rows = r.composed.weeks.map((w, i) => {
      const q = w.days.filter((d) => d.isQuality && d.type !== 'race')
        .map((d) => `${d.type}: ${d.subLabel}`);
      return `wk${i + 1} ${String(w.phase).padEnd(14)} ${String(w.weeklyMi).padStart(5)}mi  ${q.join('  |  ') || '—'}`;
    });
    // eslint-disable-next-line no-console
    console.log(`\n[CIM BLOCK · quality sessions]\n${rows.join('\n')}`);
    // eslint-disable-next-line no-console
    console.log(`\n[CIM BLOCK · trajectory]\n${(r.composed.progression ?? []).map((s) =>
      `wk${s.weekIdx + 1} ${s.family.padEnd(9)} ${String(s.lever ?? '—').padEnd(17)} ` +
      `${s.shape.reps}×${s.shape.repMinutes}min @ ${s.shape.paceSPerMi}s/mi ${s.zone.padEnd(11)}` +
      `${s.clamped ? ' [clamped] ' : ' '}${s.change}`).join('\n')}`);

    const thresholdLabels = r.composed.weeks.flatMap((w) =>
      w.days.filter((d) => d.type === 'threshold' && d.workShape).map((d) => d.subLabel));
    expect(thresholdLabels.length).toBeGreaterThan(2);
    expect(new Set(thresholdLabels).size).toBeGreaterThan(1);
  });

  it('holds one pace for the whole block · no evidence, no fitness claim', () => {
    const r = buildSimPlan(CIM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tPaces = new Set(r.composed.weeks.map((w) => w.tPaceSec));
    expect(tPaces.size, `the block prescribed ${tPaces.size} different threshold paces`).toBe(1);
    const shapePaces = new Set((r.composed.progression ?? [])
      .filter((s) => s.family === 'threshold').map((s) => s.shape.paceSPerMi));
    expect(shapePaces.size).toBe(1);
  });

  it('never reaches the pace lever on a plan nobody has run yet', () => {
    const r = buildSimPlan(CIM);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const levers = (r.composed.progression ?? []).map((s) => s.lever);
    expect(levers).not.toContain('pace');
    // And no session is offered as a probe: a probe needs strong adaptation,
    // and strong needs evidence.
    expect((r.composed.progression ?? []).some((s) => s.zone === 'PROBE')).toBe(false);
  });
});
