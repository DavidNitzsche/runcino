/**
 * PROGRESSION-PERSIST-1 (2026-08-17) · the overload trajectory's shape must
 * survive the trip to `plan_workouts.workout_spec` and back.
 *
 * The shape was computed, attached to the composed day, and then dropped at the
 * persistence boundary — only the rendered prescription string reached the
 * database. That blocks the second half of
 * `Design/adaptive-progression-engine.md` §3: "hold the current stimulus" needs
 * to know what the current stimulus was, and re-deriving it by regexing
 * `"3×10 min @ T pace · 60s jog"` is exactly the drift the string was never
 * meant to carry.
 *
 * These tests assert IDENTITY after a round trip, not presence, and they hold
 * the Rule 6 discipline mechanically so a future writer of that multi-writer
 * jsonb column cannot quietly erase the block.
 */
import fs from 'node:fs';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  PROGRESSION_SPEC_KEY,
  preserveProgressionSql,
  progressionSpecFields,
  readProgressionSpec,
} from './progression-spec';
import {
  composePlan,
  finalizeComposedPlan,
  inlinePrescriptions,
  type ComposePlanInput,
  type DOW,
} from './generate';
import { buildWorkoutSpec, capSpecToDistance, tPaceFromGoal } from './spec-builder';
import { tPaceFromVdot } from '@/lib/training/vdot';
import type { WorkShape } from '@/lib/prescription/levers';
import { repoRoot } from '@/lib/doctrine/resolve';

/** The DB stores jsonb · anything that does not survive JSON is already lost. */
const throughJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function cimBlock(): ComposePlanInput {
  const distanceMi = 26.2;
  const goalSec = 10800;
  const currentT = tPaceFromVdot(44.1);
  const goalT = tPaceFromGoal(goalSec, distanceMi);
  return {
    raceDistanceMi: distanceMi, goalSec,
    goalPaceSec: Math.round(goalSec / distanceMi),
    raceDateISO: '2026-12-06', startMondayISO: '2026-08-31',
    level: 'advanced', recentWeeklyMi: 45, easyDayMedianMi: 6, recentLongMi: 14,
    bestRecentVdot: 44.1, isMidBlock: false,
    longRunDow: 0 as DOW, restDow: 5 as DOW, qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: null, crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOrThrow(distanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(distanceMi)),
    tPaceSec: (goalT != null && currentT != null ? Math.min(goalT, currentT) : goalT) ?? currentT ?? 480,
    lthr: null, maxHr: null,
  } as ComposePlanInput;
}

describe('PROGRESSION-PERSIST-1 · the work shape survives persistence', () => {
  it('round-trips every shape the trajectory can produce', () => {
    const shapes: WorkShape[] = [
      { reps: 4, repMinutes: 10, recoveryMinutes: 1, paceSPerMi: 462, zone: 'ESTABLISHED' },
      { reps: 1, repMinutes: 30, recoveryMinutes: 0, paceSPerMi: 394, zone: 'PROGRESSIVE' },
      { reps: 6, repMinutes: 3, recoveryMinutes: 2.5, paceSPerMi: 410, zone: 'PROBE' },
      { reps: 2, repMinutes: 20, recoveryMinutes: 1.5, paceSPerMi: 540, zone: 'ESTABLISHED' },
    ];
    for (const shape of shapes) {
      for (const lever of ['quality_duration', 'work_density', null] as const) {
        const spec = throughJson({
          kind: 'threshold',
          ...progressionSpecFields({ shape, lever, zone: shape.zone }),
        });
        const back = readProgressionSpec(spec);
        expect(back, `no block read back for ${shape.reps}x${shape.repMinutes}`).not.toBeNull();
        expect(back!.shape).toEqual(shape);
        expect(back!.lever).toBe(lever);
        expect(back!.zone).toBe(shape.zone);
      }
    }
  });

  it('reads null rather than a half-populated shape', () => {
    // A consumer deciding whether to hold a stimulus has to be able to tell
    // "nothing recorded" from "a shape with a zero in it".
    expect(readProgressionSpec(null)).toBeNull();
    expect(readProgressionSpec({ kind: 'threshold' })).toBeNull();
    expect(readProgressionSpec({ [PROGRESSION_SPEC_KEY]: {} })).toBeNull();
    expect(readProgressionSpec({
      [PROGRESSION_SPEC_KEY]: { reps: 4, rep_minutes: 10, recovery_minutes: 1, pace_s_per_mi: 0, zone: 'ESTABLISHED', lever: null },
    })).toBeNull();
    expect(readProgressionSpec({
      [PROGRESSION_SPEC_KEY]: { reps: 4, rep_minutes: 10, recovery_minutes: 1, pace_s_per_mi: 462, zone: 'NONSENSE', lever: null },
    })).toBeNull();
    // An unrecognised lever degrades to null without losing the shape — the
    // shape is what "hold the stimulus" needs; the lever is commentary.
    const odd = readProgressionSpec({
      [PROGRESSION_SPEC_KEY]: { reps: 4, rep_minutes: 10, recovery_minutes: 1, pace_s_per_mi: 462, zone: 'ESTABLISHED', lever: 'telepathy' },
    });
    expect(odd).not.toBeNull();
    expect(odd!.lever).toBeNull();
    expect(odd!.shape.reps).toBe(4);
  });

  it('survives the real author chain, identically, on a composed block', () => {
    // The exact chain `persistPlan` runs: buildWorkoutSpec → capSpecToDistance
    // → attach the block → JSON → (jsonb) → read back.
    const input = cimBlock();
    const res = composePlan(input);
    finalizeComposedPlan(res, 26.2, 'advanced');

    let carried = 0;
    for (const w of res.weeks) {
      const weekT = (w as { tPaceSec?: number | null }).tPaceSec ?? input.tPaceSec;
      if (weekT == null) continue;
      for (const d of w.days) {
        if (!d.isQuality || !d.workShape) continue;
        const built = buildWorkoutSpec(
          d.type, d.distanceMi, weekT, null, d.subLabel, null, input.goalPaceSec ?? null, null,
        );
        let spec = capSpecToDistance(built.spec, d.distanceMi);
        expect(spec, `${w.startISO} ${d.type} built no spec`).not.toBeNull();
        spec = {
          ...(spec as Record<string, unknown>),
          ...progressionSpecFields({
            shape: d.workShape,
            lever: d.progressionLever ?? null,
            zone: d.challengeZone ?? null,
            repsOverride: Number((spec as Record<string, unknown>).rep_count ?? 0) || null,
          }),
        };
        const back = readProgressionSpec(throughJson(spec));
        expect(back, `${w.startISO} ${d.type} lost its shape in persistence`).not.toBeNull();
        // Identity, field by field. `reps` is allowed to follow the spec when
        // `capSpecToDistance` trimmed one — that is the documented override —
        // so it is checked against the SPEC rather than against the intent.
        expect(back!.shape.repMinutes).toBe(Number(d.workShape.repMinutes.toFixed(2)));
        expect(back!.shape.recoveryMinutes).toBe(Number(Math.max(0, d.workShape.recoveryMinutes).toFixed(2)));
        expect(back!.shape.paceSPerMi).toBe(Math.round(d.workShape.paceSPerMi));
        expect(back!.zone).toBe(d.challengeZone ?? d.workShape.zone);
        expect(back!.lever).toBe(d.progressionLever ?? null);
        const specReps = Number((spec as Record<string, unknown>).rep_count ?? 0) || d.workShape.reps;
        expect(
          back!.shape.reps,
          `${w.startISO}: persisted block says ${back!.shape.reps} reps, the spec beside it says ${specReps}`,
        ).toBe(Math.round(specReps));
        carried++;
      }
    }
    // If the trajectory ever stops owning any session this test would pass
    // vacuously, which would be worse than failing.
    //
    // SLOT-ROTATE-2 (2026-08-19) · the count is 1, not 4, because §15's
    // specific-support vocabulary now fills most of a block's quality days and
    // a catalogue session carries no `workShape` — the trajectory's job on those
    // days is to supply the DOSE, not the words. The anti-vacuum guard is what
    // this line is for and it still does it; the assertion that the ladder
    // actually moves lives in `_trajectory.test.ts`, against the progression
    // log, which is where it can be made whoever renders the session.
    expect(carried, 'no quality day carried a work shape at all').toBeGreaterThan(0);
  });

  it('carries the calendar\'s own proposal beside the prescribed one', () => {
    // PROGRESSION-GATE-1 · once evidence declines a step the two part company,
    // and the next cycle needs BOTH: the prescribed shape to hold or step from,
    // and the authored shape to recognise that a divergence exists at all.
    // Keeping only one of them loses either the plan or the pause.
    const prescribed: WorkShape = { reps: 3, repMinutes: 11, recoveryMinutes: 1, paceSPerMi: 462, zone: 'ESTABLISHED' };
    const authored: WorkShape = { reps: 3, repMinutes: 13, recoveryMinutes: 1, paceSPerMi: 462, zone: 'PROGRESSIVE' };
    const spec = throughJson({
      kind: 'threshold',
      ...progressionSpecFields({
        shape: prescribed,
        lever: null,
        zone: prescribed.zone,
        authored: { shape: authored, lever: 'quality_duration' },
        gate: { action: 'HOLD', band: 'marginal', at: '2026-09-07T03:00:00.000Z' },
      }),
    });
    const back = readProgressionSpec(spec);
    expect(back).not.toBeNull();
    expect(back!.shape).toEqual(prescribed);
    expect(back!.authored!.shape).toEqual(authored);
    expect(back!.authored!.lever).toBe('quality_duration');
    expect(back!.gate).toEqual({ action: 'HOLD', band: 'marginal', at: '2026-09-07T03:00:00.000Z' });
  });

  it('reads an untouched row as having no divergence and no gate stamp', () => {
    // Authoring never writes either field, so a plan the gate has not seen is
    // byte-identical to what it has always been — and a consumer asking "what
    // did the plan ask for" reads `authored ?? shape` and gets the right answer.
    const shape: WorkShape = { reps: 4, repMinutes: 10, recoveryMinutes: 1, paceSPerMi: 462, zone: 'PROGRESSIVE' };
    const fields = progressionSpecFields({ shape, lever: 'quality_duration', zone: shape.zone });
    expect(Object.keys(fields[PROGRESSION_SPEC_KEY])).not.toContain('authored');
    expect(Object.keys(fields[PROGRESSION_SPEC_KEY])).not.toContain('gate');
    const back = readProgressionSpec(throughJson({ kind: 'threshold', ...fields }));
    expect(back!.authored).toBeNull();
    expect(back!.gate).toBeNull();
  });

  it('degrades a malformed divergence to null without losing the prescribed shape', () => {
    // The prescribed shape is what "hold the current stimulus" needs; the
    // calendar's copy and the stamp are commentary on top of it. Same posture
    // as an unrecognised lever.
    const back = readProgressionSpec({
      [PROGRESSION_SPEC_KEY]: {
        reps: 3, rep_minutes: 11, recovery_minutes: 1, pace_s_per_mi: 462, zone: 'ESTABLISHED',
        lever: null,
        authored: { reps: 0, rep_minutes: 13, pace_s_per_mi: 462, zone: 'PROGRESSIVE' },
        gate: { action: 'SHRUG', band: 'marginal', at: '' },
      },
    });
    expect(back).not.toBeNull();
    expect(back!.shape.repMinutes).toBe(11);
    expect(back!.authored).toBeNull();
    expect(back!.gate).toBeNull();
  });

  it('the preservation SQL carries an existing block forward and never invents one', () => {
    const sql = preserveProgressionSql('$2');
    // The old-row read, the guard, and the merge all have to be there. The
    // behaviour itself is exercised against a real database by the writers'
    // own integration paths; this holds the statement's shape.
    expect(sql).toContain('plan_workouts.workout_spec');
    expect(sql).toContain(`? '${PROGRESSION_SPEC_KEY}'`);
    expect(sql).toContain(`jsonb_set($2::jsonb, '{${PROGRESSION_SPEC_KEY}}'`);
    // A new spec that DOES carry a block must win, and a NULL spec must stay
    // NULL — both are branches, not accidents.
    expect(sql).toContain('IS NOT NULL');
    expect(sql).toContain('ELSE $2::jsonb');
    expect(preserveProgressionSql('$1', 'pw')).toContain('pw.workout_spec');
  });

  it('every writer of workout_spec either preserves the block or says why not', () => {
    // CLAUDE.md Rule 6, made mechanical. `plan_workouts.workout_spec` has
    // several writers with different field coverage, which is precisely the
    // shape that erased `strava_activities.data.splits` and
    // `races.actual_result`. A new writer added later must land in one of these
    // two lists on purpose.
    const NOT_PRESERVED: Record<string, string> = {
      'web-v2/lib/plan/adapt.ts':
        'Two writers, both deliberate: the adapter downgrading a quality day to easy/rest, and the ' +
        'field-test replacement. Both make the row a DIFFERENT session, so a block describing the ' +
        'old one would be a false record of what the runner was asked to do. The third writer in ' +
        'this file (rebuildWorkoutDerivations, same session) DOES preserve.',
      'web-v2/app/api/plan/restore/route.ts':
        'Restores a captured snapshot verbatim. The snapshot carries whatever the row had, block ' +
        'included, so a full replace is the correct semantics for a point-in-time restore.',
      'web-v2/app/api/plan/replan/route.ts':
        'Clears the spec to NULL on a replan — there is no session left to describe.',
      'web-v2/app/api/plan/workout/[id]/accept-standing/route.ts':
        'Clears the spec to NULL when a standing change replaces the workout.',
      'web-v2/lib/race/race-row-refresh.ts':
        '2026-09-01 · P0 race-pace brain. Writes RACE rows only, and PRESERVES: the statement is a ' +
        'field-level jsonb merge — `(workout_spec - hr_cap_bpm) || $n` — so every key the row already ' +
        'carries (rules, fuel_mi, strides, an overload block if one ever lands on a race row) survives, ' +
        'and only the keys this path owns (pace band, race_execution, race_hr) are replaced. It does not ' +
        'use preserveProgressionSql because a race row has no progression block to carry and the merge ' +
        'shape is the same guard stated directly.',
      'web-v2/lib/plan/replan-scenarios.ts':
        'The "Change the plan" sheet writes a spec on exactly two shapes, and neither is the same ' +
        'session it replaced. A quality day demoted by a cutback or a re-entry ramp becomes an easy ' +
        'run and takes the week template\'s easy spec, and a rest day turned into a running day is a ' +
        'session that did not exist a moment ago — carrying an overload block onto either would be a ' +
        'false record of what the runner was asked to do, the same reasoning adapt.ts is listed for. ' +
        'The one row that stays the SAME session, a long run whose distance the ramp cut, is edited ' +
        'by copying its own spec and removing the at-pace finish, so anything else it carried — a ' +
        'block included — survives without needing the guard.',
    };

    const root = repoRoot();
    const roots = [path.join(root, 'web-v2', 'lib'), path.join(root, 'web-v2', 'app')];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && !/\.test\.ts$/.test(e.name)) files.push(p);
      }
    };
    for (const r of roots) if (fs.existsSync(r)) walk(r);

    const unguarded: string[] = [];
    for (const file of files) {
      const rel = path.relative(root, file);
      if (rel.endsWith('progression-spec.ts')) continue; // it IS the guard
      for (const [i, line] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;      // comments describe
        if (!/workout_spec\s*=/.test(line)) continue;
        if (/preserveProgressionSql/.test(line)) continue;   // guarded
        if (/workout_spec\s*=\s*(NULL|null)/i.test(line) && rel in NOT_PRESERVED) continue;
        if (rel in NOT_PRESERVED) continue;
        unguarded.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    }
    expect(
      unguarded,
      'These write plan_workouts.workout_spec without the Rule 6 guard. Either wrap the parameter\n' +
        'in preserveProgressionSql, or record in NOT_PRESERVED why this writer is entitled to\n' +
        'discard the overload trajectory\'s shape.\n  ' + unguarded.join('\n  '),
    ).toEqual([]);

    // And the allowlist may not rot: every entry must still be a real writer.
    const stale = Object.keys(NOT_PRESERVED).filter((rel) => {
      const abs = path.join(root, rel);
      return !fs.existsSync(abs) || !/workout_spec\s*=/.test(fs.readFileSync(abs, 'utf8'));
    });
    expect(stale, `these allowlist entries no longer write workout_spec · delete them:\n  ${stale.join('\n  ')}`)
      .toEqual([]);
  });
});
