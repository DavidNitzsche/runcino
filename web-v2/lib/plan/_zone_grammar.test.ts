/**
 * ZONE-R-1 + GRAMMAR-SEQ-1 · the zones the engine can price, and the shapes it
 * can say.
 *
 * Two walls stood between `lib/workout-catalogue/`'s fifty-nine cited workouts
 * and the five a fourteen-week marathon actually drew, and this file is the
 * gate on both of them.
 *
 *   1 · PACE ANCHORING. `buildWorkoutSpec` paced a `threshold` slot at T and a
 *       rep slot at I regardless of what the prescription declared, so the
 *       catalogue declined every session naming a third zone rather than
 *       mis-pace it. R did not exist anywhere in the engine at all.
 *   2 · STRUCTURAL GRAMMAR. `parsePrescription` reads N identical reps with one
 *       recovery, which is none of §13's ladders, §9.2's Mona fartlek, §10's
 *       combos and alternations or §12.4's progression.
 *
 * The claims below are ordered by what would break first, and the last group is
 * the one that matters most: the WATCH sees no new field, no new phase type and
 * no new anything. A stepped session reaches the wrist as the flat
 * work-and-recovery phase list it has always received.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_zone_grammar.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  dropLastSegment,
  parsePrescription,
  parseSegments,
  parseTimeReps,
  parseZones,
  primaryZone,
  segmentMi,
} from './prescription-parser';
import { resolveZoneAnchors, tightestDosePace, ST_OFFSET_S_PER_MI } from './zone-anchors';
import { buildWorkoutSpec, totalDistanceMiFromSpec, capSpecToDistance, marathonPaceSPerMi } from './spec-builder';
import { expandSpecToPhases, subLabelFromSpec } from '@/lib/training/expand-spec';
import { dayDoses, dosePaceOf, weekDose } from './dosing';
import { splitDay } from './intensity-distribution';
import { rPaceFromVdot, racePaceFromVdot, TABLE_RACE_DISTANCE_MI } from '@/lib/training/vdot';
import { renderPrescription } from './catalogue-rx';
import { WORKOUT_CATALOGUE } from '@/lib/workout-catalogue/catalogue';
import { AT_PACE_SESSION_MI, advanceShape } from '@/lib/prescription/levers';
import { SESSION_LADDER } from '@/lib/prescription/trajectory';

const T = 435;
const I = 400;

describe('ZONE-R-1 · the zones the engine can price', () => {
  it('R is the published mile column, not an offset off I', () => {
    // Research/01 §"Pace conversion": "R | ~mile race pace, or ~6 sec/400m
    // faster than I". The first reading, because the mile is a column.
    expect(rPaceFromVdot(50)).toBe(324);   // Research/01's Mile column, VDOT 50 → 5:24
    expect(rPaceFromVdot(40)).toBe(395);   // 6:35
    expect(rPaceFromVdot(70)).toBe(243);   // 4:03
    // Faster than I at every VDOT, which is what makes it a different zone.
    for (const v of [35, 45, 55, 65, 75]) {
      const r = rPaceFromVdot(v)!;
      const i = racePaceFromVdot(v, TABLE_RACE_DISTANCE_MI['5K'])!;
      expect(r, `R ${r} is not faster than I ${i} at VDOT ${v}`).toBeLessThan(i);
    }
    expect(rPaceFromVdot(null)).toBeNull();
  });

  it('3K comes off its own published column · the equation is 10-15 s/mi slow there', () => {
    // The divergence AUDIT #7 assumed had converged by 3K. It has not, and
    // §13.2's ladder paces its 800 at "3K/5K".
    expect(racePaceFromVdot(50, TABLE_RACE_DISTANCE_MI['3K'])).toBe(360); // 11:11 / 1.864
    expect(racePaceFromVdot(60, TABLE_RACE_DISTANCE_MI['3K'])).toBe(304); // 9:27 / 1.864
    // 10K reproduces from the equation, so it is left there.
    expect(racePaceFromVdot(50, TABLE_RACE_DISTANCE_MI['10K'])).toBe(399);
  });

  it('the zone order holds · R < 3K < I/5K < 10K < T/HM < ST < M', () => {
    const a = resolveZoneAnchors({ tPaceSec: T, iPaceSec: I, marathonPaceSec: 520 });
    expect(a.R!).toBeLessThan(a['3K']!);
    expect(a['3K']!).toBeLessThan(a.I!);
    expect(a.I!).toBe(a['5K']!);
    expect(a['5K']!).toBeLessThan(a['10K']!);
    expect(a['10K']!).toBeLessThan(a.T!);
    expect(a.T!).toBe(a.HM!);
    expect(a.T!).toBeLessThan(a.ST!);
    expect(a.ST!).toBeLessThan(a.M!);
    expect(a.M!).toBe(a.MP!);
    // E is never a work target · it is a band the day carries.
    expect(a.E).toBeUndefined();
  });

  it('sub-threshold is REFUSED rather than run at marathon pace', () => {
    // ST is read off the goal-blended threshold and MP off the current-fitness
    // anchor, so a runner whose goal is ahead of their fitness can land T+15
    // slower than MP. §5.4's session is "threshold volume without the systemic
    // cost of tempo"; at marathon pace it is not that session.
    const ok = resolveZoneAnchors({ tPaceSec: 435, iPaceSec: 400, marathonPaceSec: 470 });
    expect(ok.ST).toBe(435 + ST_OFFSET_S_PER_MI);
    const inverted = resolveZoneAnchors({ tPaceSec: 503, iPaceSec: 460, marathonPaceSec: 515 });
    expect(inverted.ST).toBeUndefined();
    expect(inverted.T).toBe(503); // and everything else still prices
  });

  it('a prescription is paced at the zone it DECLARES', () => {
    const pace = (type: string, rx: string) =>
      (buildWorkoutSpec(type, 9, T, 160, rx, null, null, I).spec as Record<string, unknown>).rep_pace_s_per_mi;
    const a = resolveZoneAnchors({ tPaceSec: T, iPaceSec: I, marathonPaceSec: marathonPaceSPerMi({ tPaceSec: T }) });
    expect(pace('threshold', '4×1mi @ R pace · 90s jog')).toBe(a.R);
    expect(pace('threshold', '4×1mi @ ST pace · 90s jog')).toBe(a.ST);
    expect(pace('threshold', '4×1mi @ 10K race pace · 90s jog')).toBe(a['10K']);
    expect(pace('intervals', '4×1mi @ 3K race pace · 90s jog')).toBe(a['3K']);
    expect(pace('intervals', '8×200m @ mile race pace')).toBe(a.mile);
    expect(pace('threshold', '3×1mi @ MP race pace · 90s jog')).toBe(a.MP);
  });

  it('EVERY prescription the engine wrote before this builds byte-identically', () => {
    // The zone resolver maps T/HM onto the threshold pace and I/5K onto the rep
    // pace, which are the two numbers these branches already used — so turning
    // it on may not have moved a single existing number.
    const same: Array<[string, string, number]> = [
      ['threshold', '4×1mi @ T pace · 60s jog', T],
      ['threshold', '3×1mi @ T pace · 2 min jog', T],
      ['threshold', '5×2km · MP → T · 2 min jog', T],       // an arrow is paced at its TARGET
      ['threshold', '8×1km @ HM-T pace · 60s jog', T],      // a band is entered at its slow edge
      ['intervals', '5×800m @ I pace · 90s jog', I],
      ['intervals', '5×1mi @ I-T transition · 2:00 jog', I],
      ['intervals', '6×3 min @ I pace · 90s jog', I],
      ['intervals', '4×1km @ 5K pace · 2min jog', I],
    ];
    for (const [type, rx, expected] of same) {
      const spec = buildWorkoutSpec(type, 9, T, 160, rx, null, null, I).spec as Record<string, unknown>;
      expect(spec.rep_pace_s_per_mi, `${rx} moved`).toBe(expected);
    }
    // A prescription declaring no zone at all keeps the branch default.
    const hills = buildWorkoutSpec('intervals', 9, T, 160, '10×30s hills', null, null, I).spec as Record<string, unknown>;
    expect(hills.rep_pace_s_per_mi).toBeNull();  // by effort
  });

  it('reads a zone only where a zone can be written', () => {
    expect(parseZones('4×1mi @ T pace · 60s jog')).toEqual(['T']);
    expect(parseZones('5×1mi @ I-T transition · 2:00 jog')).toEqual(['I', 'T']);
    expect(parseZones('6×90s hills @ 5K-10K effort · 2:30 jog down')).toEqual(['5K', '10K']);
    expect(parseZones('5×2km · MP → T · 2 min jog')).toEqual(['MP', 'T']);
    // Prose is prose. A wave tempo's shape row mentions T and declares nothing.
    expect(parseZones('5mi continuous wave tempo · ±10 s/mi around T')).toEqual([]);
    expect(primaryZone('5×2km · MP → T · 2 min jog')).toBe('T');       // progression → target
    expect(primaryZone('6×90s hills @ 5K-10K effort')).toBe('5K');      // band → slow edge
    expect(primaryZone('LONG')).toBeNull();
  });

  it('R is a cap family with a session band and a ladder that keeps the rest', () => {
    expect(AT_PACE_SESSION_MI.repetition.max).toBeCloseTo(8 / 1.609344, 2);   // Research/01 "max 8K"
    expect(SESSION_LADDER.repetition).not.toContain('recovery_duration');      // §7.4 "don't shorten the rest"
    const r = advanceShape({
      shape: { reps: 8, repMinutes: 0.75, recoveryMinutes: 3, paceSPerMi: 320, zone: 'ESTABLISHED' },
      lever: 'recovery_duration', stepMultiplier: 1, weeklyMi: 50, family: 'repetition',
    });
    expect(r.capped).toBe(true);
    expect(r.shape.recoveryMinutes).toBe(3);
    // And the rep may not grow past Research/01's two minutes.
    const grown = advanceShape({
      shape: { reps: 8, repMinutes: 2, recoveryMinutes: 3, paceSPerMi: 320, zone: 'ESTABLISHED' },
      lever: 'interval_duration', stepMultiplier: 1, weeklyMi: 90, family: 'repetition',
    });
    expect(grown.capped).toBe(true);
  });
});

describe('GRAMMAR-SEQ-1 · the shapes the engine can say', () => {
  const LADDER = '400m @ mile · 90s jog + 800m @ 3K · 3 min jog + 1200m @ 5K · 4 min jog + 1600m @ 10K';
  const MONA = '2×90s @ 5K · 90s jog + 4×60s @ 5K · 60s jog + 4×30s · 30s jog + 4×15s @ mile · 15s jog';
  const ALT = '6×(1mi @ MP + 1mi @ 10K)';
  const COMBO = '2mi @ T · 2:30 jog + 4×800m @ I · 90s jog';

  it('parses a ladder, a Mona, an alternation and a combo', () => {
    const ladder = parseSegments(LADDER)!;
    expect(ladder.map((s) => `${s.value}${s.unit}@${s.zone}`)).toEqual([
      '400m@mile', '800m@3K', '1200m@5K', '1600m@10K',
    ]);
    expect(ladder.map((s) => s.restS)).toEqual([90, 180, 240, 0]); // last has nothing to recover into

    const mona = parseSegments(MONA)!;
    expect(mona.length).toBe(14);                       // §9.2 "20 min continuous; 14 reps"
    expect(mona[0].value).toBe(90);
    expect(mona[13].zone).toBe('mile');

    const alt = parseSegments(ALT)!;
    expect(alt.length).toBe(12);
    expect(alt.map((s) => s.zone).slice(0, 4)).toEqual(['MP', '10K', 'MP', '10K']);
    expect(alt.every((s) => s.restS === 0)).toBe(true); // §10.1 "None — continuous"

    const combo = parseSegments(COMBO)!;
    expect(combo.length).toBe(5);
    expect(combo[0].zone).toBe('T');
    expect(combo[0].restS).toBe(150);
    expect(combo.slice(1).every((s) => s.zone === 'I')).toBe(true);
  });

  it('never fires on a prescription the engine already writes', () => {
    for (const s of [
      '4×1mi @ T pace · 60s jog',
      '6×90s hills @ 5K-10K effort · 2:30 jog down',
      '5×2km · MP → T · 2 min jog',
      '2 mi WU · 4 mi @ T · 2 mi CD',
      '5mi continuous tempo',
      '2 mi E + 6×80m strides',      // a top-level " + " that is NOT a sequence
      '45 min easy + 6×80m strides',
      'LONG · 8mi @ MP',
    ]) {
      expect(parseSegments(s), `${s} was read as a sequence`).toBeNull();
    }
  });

  it('the catalogue renders its unequal-step entries, and they read back', () => {
    const cases: Array<[string, RegExp]> = [
      ['ascending-ladder', /^400m @ mile · 90s jog \+ 800m @ 3K/],
      ['descending-ladder', /^1600m @ 10K/],
      ['up-and-down-pyramid', /^400m @ 5K \+ 800m @ 5K/],
      ['mona-fartlek', /^2×90s @ 5K · 90s jog \+ 4×60s @ 5K/],
      ['5k-progression', /^1mi @ HM \+ 1mi @ T \+ 1.1mi @ 5K$/],
      ['threshold-vo2-combo', /^2mi @ T · 2:30 jog \+ 4×800m @ I$/],
      ['mp-10k-alternations', /^\d+×\(1mi @ MP \+ 1mi @ 10K\)$/],
    ];
    for (const [slug, shape] of cases) {
      const entry = WORKOUT_CATALOGUE.find((e) => e.slug === slug)!;
      expect(entry, slug).toBeTruthy();
      const structure = entry.structures.find((s) => s.kind === 'sequence' || s.kind === 'alternation')!;
      const rendered = renderPrescription(entry, {
        structure, reps: structure.kind === 'alternation' ? structure.cycles.min : 1,
        atPaceMinutes: 0, atPaceMi: 0, recoverySec: 0,
      });
      expect(rendered, `${slug} did not render`).toBeTruthy();
      expect(rendered!, slug).toMatch(shape);
      const back = parseSegments(rendered!);
      expect(back, `${slug}: "${rendered}" does not read back`).toBeTruthy();
      // Every step keeps its own zone · that is the thing a rep set cannot say.
      if (structure.kind === 'sequence') {
        expect(back!.length).toBe(structure.steps.length);
      }
    }
  });

  it('declines what it cannot honestly say · effort circuits, easy legs, two-session days', () => {
    // §8.5's Lydiard hill circuit is a LAP — bounding uphill, flat jog, striding
    // downhill, wind sprints — with an easy leg in the middle and no pace on any
    // of it. §11.4's "8 mi easy + immediate 8 mi MP" is a long run with an MP
    // finish under another name. §11.1's Canova block is two sessions in a day.
    for (const slug of ['lydiard-hill-circuit', 'pre-fatigue-mp-work', 'canova-special-block']) {
      const entry = WORKOUT_CATALOGUE.find((e) => e.slug === slug)!;
      for (const structure of entry.structures) {
        const rendered = renderPrescription(entry, {
          structure, reps: 2, atPaceMinutes: 0, atPaceMi: 0, recoverySec: 0,
        });
        if (rendered != null) {
          // The only thing it may render is a genuinely uniform rep set.
          expect(structure.kind, `${slug} rendered "${rendered}"`).toBe('reps');
        }
      }
    }
  });

  it('sheds its last step, and stops before it stops being a sequence', () => {
    expect(dropLastSegment(LADDER)).toBe(
      '400m @ mile · 90s jog + 800m @ 3K · 3 min jog + 1200m @ 5K · 4 min jog');
    expect(dropLastSegment(ALT)).toBe('5×(1mi @ MP + 1mi @ 10K)');
    expect(dropLastSegment('2×(1mi @ MP + 1mi @ 10K)')).toBe('(1mi @ MP + 1mi @ 10K)');
    expect(dropLastSegment('400m @ mile · 90s jog + 800m @ 3K')).toBeNull();
    expect(dropLastSegment('4×1mi @ T pace · 60s jog')).toBeNull();
  });
});

describe('GRAMMAR-SEQ-1 · the spec, and what the watch receives', () => {
  const LADDER = '400m @ mile · 90s jog + 800m @ 3K · 3 min jog + 1200m @ 5K · 4 min jog + 1600m @ 10K';

  function ladderSpec(budgetMi = 9) {
    return buildWorkoutSpec('intervals', budgetMi, T, 160, LADDER, null, null, I).spec as Record<string, unknown>;
  }

  it('carries one step per rung, each at its own zone', () => {
    const spec = ladderSpec();
    const steps = spec.steps as Array<Record<string, unknown>>;
    expect(steps.length).toBe(4);
    const a = resolveZoneAnchors({ tPaceSec: T, iPaceSec: I, marathonPaceSec: marathonPaceSPerMi({ tPaceSec: T }) });
    expect(steps.map((s) => s.pace_s_per_mi)).toEqual([a.mile, a['3K'], a['5K'], a['10K']]);
    expect(steps.map((s) => s.rest_s)).toEqual([90, 180, 240, 0]);
    expect(steps.map((s) => Math.round((s.distance_mi as number) * 1609.344))).toEqual([400, 800, 1200, 1600]);
    // Each pace is strictly faster than the next rung's · the ladder walks zones.
    const paces = steps.map((s) => s.pace_s_per_mi as number);
    for (let i = 1; i < paces.length; i++) expect(paces[i]).toBeGreaterThan(paces[i - 1]);
  });

  it('keeps the uniform fields honest for a consumer that never heard of steps', () => {
    const spec = ladderSpec();
    const steps = spec.steps as Array<Record<string, unknown>>;
    const workMi = steps.reduce((a, s) => a + (s.distance_mi as number), 0);
    // rep_count × rep_distance_mi is the session's real total work.
    expect((spec.rep_count as number) * (spec.rep_distance_mi as number)).toBeCloseTo(workMi, 2);
    // and rep_rest_s spread over the gaps is its real total recovery.
    const restTotal = steps.reduce((a, s) => a + (s.rest_s as number), 0);
    expect((spec.rep_rest_s as number) * (steps.length - 1)).toBeCloseTo(restTotal, 0);
    // The label carries the workout's identity, and subLabelFromSpec keeps it
    // rather than re-deriving a generic rep string over it.
    expect(subLabelFromSpec(spec)).toBe(LADDER);
    // Totals: warm-up + work + jog floats + cool-down.
    expect(totalDistanceMiFromSpec(spec, 9)).toBeCloseTo(9, 1);
  });

  it('THE WATCH CONTRACT · a stepped session reaches the wrist as ordinary phases', () => {
    const phases = expandSpecToPhases({ spec: ladderSpec(), totalMi: 9, easyPaceSec: 540 })!;
    expect(phases).toBeTruthy();
    // Nothing but the four phase types the wire has always had.
    expect(new Set(phases.map((p) => p.type))).toEqual(new Set(['warmup', 'work', 'recovery', 'cooldown']));
    // Warm-up, four work phases with three jogs between them, cool-down.
    expect(phases.map((p) => p.type)).toEqual([
      'warmup', 'work', 'recovery', 'work', 'recovery', 'work', 'recovery', 'work', 'cooldown',
    ]);
    const work = phases.filter((p) => p.type === 'work');
    // Every work phase carries a distance and a pace, so `build-workout.ts`
    // marks it repUnit:'distance' — the same field it already sets for a rep.
    for (const p of work) {
      expect(p.distanceMi).toBeGreaterThan(0);
      expect(p.targetPaceSPerMi).toBeGreaterThan(0);
      expect(p.durationSec).toBeGreaterThan(0);
    }
    // No field on the phase that the Swift decoder has not seen: the phase
    // objects carry exactly the keys an ordinary rep session's phases carry.
    const repPhases = expandSpecToPhases({
      spec: buildWorkoutSpec('intervals', 9, T, 160, '4×1km @ I pace · 90s jog', null, null, I).spec,
      totalMi: 9, easyPaceSec: 540,
    })!;
    const keysOf = (ps: typeof phases) => [...new Set(ps.flatMap((p) => Object.keys(p)))].sort();
    expect(keysOf(phases)).toEqual(keysOf(repPhases));
  });

  it('a continuous alternation emits no recovery phase between its legs', () => {
    const spec = buildWorkoutSpec('threshold', 16, T, 160, '4×(1mi @ MP + 1mi @ 10K)', null, null, I).spec;
    const phases = expandSpecToPhases({ spec, totalMi: 16, easyPaceSec: 540 })!;
    expect(phases.filter((p) => p.type === 'recovery').length).toBe(0);
    expect(phases.filter((p) => p.type === 'work').length).toBe(8);
    // Alternating paces, never equal on adjacent legs · §10.1's whole point.
    const work = phases.filter((p) => p.type === 'work');
    for (let i = 1; i < work.length; i++) {
      expect(work[i].targetPaceSPerMi).not.toBe(work[i - 1].targetPaceSPerMi);
    }
  });

  it('a time-stated step stays time-stated · §9.2 sizes its reps in seconds', () => {
    const mona = '2×90s @ 5K · 90s jog + 4×60s @ 5K · 60s jog';
    const spec = buildWorkoutSpec('intervals', 8, T, 160, mona, null, null, I).spec;
    const phases = expandSpecToPhases({ spec, totalMi: 8, easyPaceSec: 540 })!;
    const work = phases.filter((p) => p.type === 'work');
    expect(work.length).toBe(6);
    // distanceMi null → build-workout marks it repUnit:'time', exactly as it
    // already does for a hill rep, and the watch counts it down by the clock.
    expect(work.every((p) => p.distanceMi === null)).toBe(true);
    expect(work.map((p) => p.durationSec)).toEqual([90, 90, 60, 60, 60, 60]);
  });

  it('a spec with no steps is byte-identical to before', () => {
    const before = buildWorkoutSpec('intervals', 9, T, 160, '5×800m @ I pace · 90s jog', null, null, I);
    expect((before.spec as Record<string, unknown>).steps).toBeUndefined();
    expect(parsePrescription('5×800m @ I pace · 90s jog')).toBeTruthy();
    expect(parseTimeReps('6×90s hills · 2:30 jog down')).toBeTruthy();
  });

  it('capSpecToDistance drops rungs from the END, never from the front', () => {
    const spec = ladderSpec(9);
    const capped = capSpecToDistance(spec, 3.5) as Record<string, unknown>;
    const steps = capped.steps as Array<Record<string, unknown>>;
    expect(steps.length).toBeLessThan(4);
    expect(Math.round((steps[0].distance_mi as number) * 1609.344)).toBe(400); // the opening rung survives
    expect(totalDistanceMiFromSpec(capped, 3.5)).toBeLessThanOrEqual(3.55);
  });
});

describe('DOCTRINE-DOSING · a multi-zone session is charged per segment', () => {
  const LADDER = '400m @ mile · 90s jog + 800m @ 3K · 3 min jog + 1200m @ 5K · 4 min jog + 1600m @ 10K';

  it('splits the ladder between R and I, and the parts sum to the hard miles', () => {
    const day = { type: 'intervals', distanceMi: 7, subLabel: LADDER } as never;
    const doses = dayDoses(day);
    expect(new Set(doses.map((d) => d.pace))).toEqual(new Set(['R', 'I']));
    const total = doses.reduce((a, d) => a + d.mi, 0);
    expect(total).toBeCloseTo(splitDay(day).qualityMi, 1);
    // Only the 400 is at mile pace, so only the 400 spends R budget.
    expect(doses.find((d) => d.pace === 'R')!.mi).toBeLessThan(0.4);
  });

  it('the R bucket fires from a generated prescription at all', () => {
    // Before ZONE-R-1 this bucket could only be reached by a standalone strides
    // day, which no composer authored.
    expect(dosePaceOf({ type: 'intervals', distanceMi: 6, subLabel: '8×200m @ R pace' } as never)).toBe('R');
    expect(dosePaceOf({ type: 'intervals', distanceMi: 6, subLabel: '10×100m @ mile race pace' } as never)).toBe('R');
    expect(tightestDosePace(['MP', '10K'])).toBe('I');
    expect(tightestDosePace(['T', 'I', 'R'])).toBe('R');
    expect(tightestDosePace(['MP'])).toBe('M');
    expect(tightestDosePace(['E'])).toBeNull();
  });

  it('leaves every single-zone session exactly where it was', () => {
    const week = {
      startISO: '2026-07-06', phase: 'QUALITY',
      days: [
        { type: 'easy', distanceMi: 6, subLabel: 'EASY' },
        { type: 'threshold', distanceMi: 9, subLabel: '4×1mi @ T pace · 60s jog' },
        { type: 'intervals', distanceMi: 8, subLabel: '5×1mi @ I pace · 90s jog' },
        { type: 'long', distanceMi: 16, subLabel: 'LONG · 4mi @ MP', isLong: true },
      ],
    };
    const d = weekDose(week as never);
    expect(d.byPace.T).toBeGreaterThan(0);
    expect(d.byPace.I).toBeGreaterThan(0);
    expect(d.byPace.M).toBeGreaterThan(0);
    expect(d.byPace.R).toBe(0);
    expect(d.sessions.length).toBe(3);
  });

  it('a segment step with no zone inherits the session it is part of', () => {
    // §9.2's 30 s reps carry no zone — the doc names only the ends of the ramp
    // — and they are still part of that session's dose.
    const day = {
      type: 'intervals', distanceMi: 8,
      subLabel: '2×90s @ 5K · 90s jog + 4×30s · 30s jog',
    } as never;
    const doses = dayDoses(day);
    expect(doses.length).toBeGreaterThan(0);
    expect(doses.reduce((a, d) => a + d.mi, 0)).toBeCloseTo(splitDay(day).qualityMi, 1);
  });
});

describe('GRAMMAR-SEQ-1 · segment arithmetic', () => {
  it('converts every unit the grammar admits', () => {
    expect(segmentMi({ value: 2, unit: 'mi', zone: null, restS: 0 }, 400)).toBe(2);
    expect(segmentMi({ value: 1, unit: 'km', zone: null, restS: 0 }, 400)).toBeCloseTo(0.6214, 3);
    expect(segmentMi({ value: 400, unit: 'm', zone: null, restS: 0 }, 400)).toBeCloseTo(0.2486, 3);
    expect(segmentMi({ value: 3, unit: 'min', zone: null, restS: 0 }, 400)).toBeCloseTo(0.45, 2);
    expect(segmentMi({ value: 90, unit: 's', zone: null, restS: 0 }, 400)).toBeCloseTo(0.225, 3);
    // A time-stated step is unconvertible without a pace, and says so.
    expect(segmentMi({ value: 90, unit: 's', zone: null, restS: 0 }, null)).toBeNull();
  });
});
