/**
 * _spec_card.test.ts · SPECFIRST-1 (2026-08-24)
 *
 * THE GATE THAT WAS MISSING. `lib/training/expand-spec.ts` has said since
 * 2026-06-02 that `workout_spec` is the single source of truth, and the watch
 * was migrated to it. `/api/v5/today` was not, and nothing anywhere asserted
 * that the two surfaces describe the same workout — so for two and a half
 * months they did not, on every quality day, and no test went red.
 *
 * Measured against production 2026-08-24 over `faff_readonly`, all
 * non-archived plans: 41 quality days, 40 of them showing the runner a session
 * the watch would not run; 34 of the 35 future-dated. The one that matched did
 * so by coincidence.
 *
 * These are the invariants that make that state fail loudly next time:
 *
 *   1. The card's rep count IS the spec's rep count.
 *   2. The card's rep distance IS the spec's rep distance.
 *   3. Every pace the card states is a pace some phase states.
 *   4. A spec that carries no pace produces a card with no pace.
 *   5. A row with no spec produces a card that shows no rep set at all.
 *
 * Test 3 is the general form: it walks the same phase list the watch consumes
 * and refuses any number the card invented on top of it.
 */
import { describe, it, expect } from 'vitest';
import { cardFromSpec, cardWithoutSpec, fmtPace, fmtPaceCeiling, fmtPaceBand } from './spec-card';
import { expandSpecToPhases } from './expand-spec';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';

const HR = { z1: '<128 bpm (Z1)', z2: '128-140 bpm (Z2)', z3: '141-152 bpm (Z3)', z4: '153-162 bpm (Z4)', z5: '>162 bpm (Z5)' };

/** The five paces on a card, in the "M:SS /mi" shape the client renders. */
function cardPaces(steps: ReturnType<typeof cardFromSpec>extends null ? never : NonNullable<ReturnType<typeof cardFromSpec>>['steps']): string[] {
  const out: string[] = [];
  for (const s of steps) {
    if (s.pace_target) out.push(s.pace_target);
    if (s.recovery?.pace_target) out.push(s.recovery.pace_target);
  }
  return out;
}
/**
 * WU/CD-CEIL-1 / QUALITY-BAND-1 (2026-09-01) · the allowed set now has to be
 * built with the SAME formatting rule the card applies, not a bare point for
 * every phase — a warm-up/cool-down prints as a ceiling ("≤ 9:00 /mi") and a
 * quality work phase (threshold/intervals/tempo) prints as a tolerance band
 * ("7:02-7:18 /mi"), reusing `spec-card.ts`'s own formatters rather than a
 * second copy of that arithmetic, so this stays a real anti-fabrication check
 * instead of a rubber stamp that happens to agree with itself.
 */
function phasePaces(spec: WorkoutSpec, totalMi: number, easy: number | null, type: string): string[] {
  const ph = expandSpecToPhases({ spec, totalMi, easyPaceSec: easy, easyCeilingSec: easy, recoveryPaceSec: easy, toleranceSec: 8 })!;
  const isQualityWork = type === 'threshold' || type === 'intervals' || type === 'tempo';
  const out: string[] = [];
  for (const p of ph) {
    if (p.targetPaceSPerMi == null) continue;
    const s =
      (p.type === 'warmup' || p.type === 'cooldown') ? fmtPaceCeiling(p.targetPaceSPerMi)
      : (p.type === 'work' && isQualityWork) ? fmtPaceBand(p.targetPaceSPerMi, p.tolerancePaceSPerMi)
      : fmtPace(p.targetPaceSPerMi);
    if (s) out.push(s);
  }
  return out;
}

describe('SPECFIRST-1 · the card is composed from the spec the watch runs', () => {
  it('a 5×400 m threshold set is five 400 m reps, not "2 × 1 mile"', () => {
    // The exact shape on two live plan rows (apple-review, 2026-09-15 and
    // 2026-09-22). `prescriptionFor` rendered both as "Threshold · 2 × 1 mile
    // reps" — wrong count, wrong distance, and 33 s/mi off the target.
    const spec = {
      kind: 'threshold', lthr_bpm: null, rep_count: 5, warmup_mi: 1.2,
      rep_rest_s: 120, cooldown_mi: 1, rep_distance_mi: 0.249, rep_pace_s_per_mi: 430,
    } as unknown as WorkoutSpec;
    const card = cardFromSpec({
      spec, type: 'threshold', subLabel: '5×400 m @ T pace · 2 min jog',
      distanceMi: 4.3, easyPaceSec: 540, hr: HR,
    })!;
    const rep = card.steps.find((s) => s.reps != null)!;
    expect(rep.reps).toBe(5);
    // 0.25, not the spec's 0.249: `expandReps` rounds a rep to two decimals
    // and the card passes the PHASE's number through untouched. The watch is
    // handed the same 0.25, which is the whole point — the card agrees with
    // what will actually be run, not with a number it re-derived.
    expect(rep.rep_distance_mi).toBeCloseTo(0.25, 3);
    // QUALITY-BAND-1 (2026-09-01) · a rounded band, not a bare point — this
    // used to assert '7:10 /mi'. `cardFromSpec`'s own default tolerance (8
    // s/mi, the same width the watch grades threshold execution against) now
    // shows on the card too, closing the Rule 16 gap the provenance trace
    // found ("the runner is graded on a band he is never shown").
    expect(rep.pace_target).toBe('7:02-7:18 /mi');
    expect(rep.recovery?.duration).toBe('2:00');
    // RECOVERY-BYFEEL-1 · the jog between reps carries no exact pace anymore.
    expect(rep.recovery?.pace_target).toBeUndefined();
    // The last rep has no recovery. It is still a rep of the set — the earlier
    // grouping split it off and showed "4 × 400 m" beside a headline saying 5.
    expect(card.steps.filter((s) => s.reps != null)).toHaveLength(1);
    expect(card.total_mi).toBe(4.3);
    expect(card.basis).toBe('spec');
  });

  it('a time-based set keeps its seconds · "3 × 7:00", never a rep distance', () => {
    const spec = {
      kind: 'intervals', label: '3×7 min @ I · 60s jog', rep_count: 3,
      warmup_mi: 1.5, cooldown_mi: 1, rep_rest_s: 60, rep_duration_s: 420,
      rep_pace_s_per_mi: 466,
    } as unknown as WorkoutSpec;
    const card = cardFromSpec({ spec, type: 'intervals', distanceMi: 5.5, easyPaceSec: 540, hr: HR })!;
    const rep = card.steps.find((s) => s.reps != null)!;
    expect(rep.reps).toBe(3);
    expect(rep.duration).toBe('7:00');
    // RULE ONE, in its structural form: a session written in seconds must not
    // acquire a distance on the way to the screen.
    expect(rep.rep_distance_mi).toBeUndefined();
  });

  it('an unequal ladder comes out as its real steps, not one averaged block', () => {
    // Live row, qa-goal 2026-08-26: "2×90s + 4×60s + 4×30s + 4×15s".
    const spec = {
      kind: 'intervals', label: 'ladder', warmup_mi: 1, cooldown_mi: 1,
      steps: [
        ...Array(2).fill({ duration_s: 90, rest_s: 90, pace_s_per_mi: 466 }),
        ...Array(4).fill({ duration_s: 60, rest_s: 60, pace_s_per_mi: 466 }),
        ...Array(4).fill({ duration_s: 30, rest_s: 30, pace_s_per_mi: 466 }),
        ...Array(4).fill({ duration_s: 15, rest_s: 15, pace_s_per_mi: 466 }),
      ],
    } as unknown as WorkoutSpec;
    const card = cardFromSpec({ spec, type: 'intervals', distanceMi: 5, easyPaceSec: 540, hr: HR })!;
    const blocks = card.steps.filter((s) => s.reps != null).map((s) => `${s.reps}×${s.duration}`);
    expect(blocks).toEqual(['2×1:30', '4×1:00', '4×30s', '4×15s']);
  });

  it('states no pace the spec does not state', () => {
    const specs: Array<[WorkoutSpec, number]> = [
      [{ kind: 'threshold', rep_count: 5, rep_distance_mi: 0.249, rep_pace_s_per_mi: 430, rep_rest_s: 120, warmup_mi: 1.2, cooldown_mi: 1 } as unknown as WorkoutSpec, 4.3],
      [{ kind: 'tempo', warmup_mi: 1.5, cooldown_mi: 1.5, tempo_distance_mi: 3, tempo_pace_s_per_mi: 473 } as unknown as WorkoutSpec, 6],
      [{ kind: 'intervals', label: '6×3 min hills', by_effort: true, rep_count: 6, rep_duration_s: 180, rep_rest_s: 120, warmup_mi: 1.5, cooldown_mi: 1 } as unknown as WorkoutSpec, 5.5],
    ];
    for (const [spec, mi] of specs) {
      const card = cardFromSpec({ spec, type: 'threshold', distanceMi: mi, easyPaceSec: 540, hr: HR })!;
      const allowed = new Set(phasePaces(spec, mi, 540, 'threshold'));
      for (const p of cardPaces(card.steps)) expect(allowed.has(p), `card invented pace ${p}`).toBe(true);
    }
  });

  it('a by-effort set goes out by feel · no number is substituted', () => {
    // `by_effort` is DELIBERATE absence (Research/04 §8.1 — a flat-ground pace
    // is unreachable uphill), and the card must not fill the gap.
    const spec = {
      kind: 'intervals', label: '11×10s hills · by effort', by_effort: true,
      rep_count: 11, rep_duration_s: 10, rep_rest_s: 120, warmup_mi: 1.5, cooldown_mi: 1,
    } as unknown as WorkoutSpec;
    const card = cardFromSpec({ spec, type: 'intervals', distanceMi: 4, easyPaceSec: 540, hr: HR })!;
    const rep = card.steps.find((s) => s.reps === 11)!;
    expect(rep.pace_target).toBeUndefined();
    // …and the note must not name a distance either. "Each mile at the same
    // pace" was the old note, on a ten-second rep.
    expect(rep.note).not.toMatch(/mile|mi\b/);
  });

  it('no easy anchor means by-feel edges, not a fabricated warm-up pace', () => {
    const spec = { kind: 'threshold', rep_count: 3, rep_distance_mi: 1, rep_pace_s_per_mi: 503, rep_rest_s: 60, warmup_mi: 1.5, cooldown_mi: 1 } as unknown as WorkoutSpec;
    const card = cardFromSpec({ spec, type: 'threshold', distanceMi: 6, easyPaceSec: null, hr: HR })!;
    expect(card.steps.find((s) => s.label === 'Warmup')!.pace_target).toBeUndefined();
    expect(card.steps.find((s) => s.label === 'Cooldown')!.pace_target).toBeUndefined();
    // QUALITY-BAND-1 (2026-09-01) · the rep still carries its own authored
    // pace — only the edges go by feel — but now as a band (target ± the
    // default 8 s/mi tolerance), not the bare '8:23 /mi' this used to assert.
    expect(card.steps.find((s) => s.reps === 3)!.pace_target).toBe('8:15-8:31 /mi');
  });

  it('a set of one is still a set · "1 × 1 km", matching the plan label', () => {
    const spec = { kind: 'threshold', rep_count: 1, rep_distance_mi: 0.62, rep_pace_s_per_mi: 449, rep_rest_s: 90, warmup_mi: 0.7, cooldown_mi: 0.7 } as unknown as WorkoutSpec;
    const card = cardFromSpec({ spec, type: 'threshold', subLabel: '1×1 km @ T pace · 1:30 jog', distanceMi: 2, easyPaceSec: 540, hr: HR })!;
    const rep = card.steps.find((s) => s.reps != null)!;
    expect(rep.reps).toBe(1);
    expect(rep.rep_distance_mi).toBeCloseTo(0.62, 2);
  });

  it('a continuous tempo block is NOT dressed up as a set of one', () => {
    const spec = { kind: 'tempo', warmup_mi: 1.5, cooldown_mi: 1.5, tempo_distance_mi: 2.5, tempo_pace_s_per_mi: 503 } as unknown as WorkoutSpec;
    const card = cardFromSpec({ spec, type: 'tempo', distanceMi: 5.5, easyPaceSec: 540, hr: HR })!;
    const work = card.steps.find((s) => s.label !== 'Warmup' && s.label !== 'Cooldown')!;
    expect(work.reps).toBeUndefined();
    expect(work.distance_mi).toBeCloseTo(2.5, 2);
  });

  it('the day total is the PLAN row total, not a re-summed one', () => {
    const spec = { kind: 'threshold', rep_count: 5, rep_distance_mi: 0.249, rep_pace_s_per_mi: 430, rep_rest_s: 120, warmup_mi: 0.9, cooldown_mi: 1 } as unknown as WorkoutSpec;
    const card = cardFromSpec({ spec, type: 'threshold', distanceMi: 4, easyPaceSec: 540, hr: HR })!;
    expect(card.total_mi).toBe(4);
  });

  it('RULE THREE · a row with no spec refuses a rep set rather than inventing one', () => {
    const card = cardWithoutSpec({
      type: 'threshold', subLabel: null, distanceMi: 6, paceTargetSPerMi: 503, hr: HR,
    });
    expect(card.basis).toBe('row');
    // The bug this replaces: "Threshold · 3 × 1 mile reps" on a row storing no
    // rep count, no rep distance and no rest interval.
    expect(card.steps.some((s) => s.reps != null)).toBe(false);
    expect(card.steps.some((s) => s.rep_distance_mi != null)).toBe(false);
    // It still says what it DOES have, and says plainly what it does not.
    expect(card.steps[0].distance_mi).toBe(6);
    expect(card.steps[0].pace_target).toBe('8:23 /mi');
    expect(card.steps[0].note).toMatch(/no stored breakdown/i);
    expect(card.total_mi).toBe(6);
  });

  it('a spec-less row with no stored pace says by feel, not a derived number', () => {
    const card = cardWithoutSpec({ type: 'easy', distanceMi: 5, paceTargetSPerMi: null, hr: HR });
    expect(card.steps[0].pace_target).toBeUndefined();
    expect(card.steps[0].note).toMatch(/by feel/i);
  });

  it('an unrecognised spec kind returns null so the caller refuses, not guesses', () => {
    const card = cardFromSpec({
      spec: { kind: 'something-new' } as unknown as WorkoutSpec,
      type: 'threshold', distanceMi: 6, easyPaceSec: 540, hr: HR,
    });
    expect(card).toBeNull();
  });

  it('RULE FOUR · no note shouts, hypes, or scolds', () => {
    const spec = { kind: 'threshold', rep_count: 3, rep_distance_mi: 1, rep_pace_s_per_mi: 503, rep_rest_s: 60, warmup_mi: 1.5, cooldown_mi: 1 } as unknown as WorkoutSpec;
    const card = cardFromSpec({ spec, type: 'threshold', distanceMi: 6, easyPaceSec: 540, hr: HR })!;
    const prose = [card.why, ...card.steps.map((s) => s.note), ...card.steps.map((s) => s.recovery?.note ?? '')];
    for (const line of prose) {
      expect(line, line).not.toMatch(/[!—]/);
      // Emoji / pictographs.
      expect(line, line).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});

describe('SPECFIRST-1 · the phone and the watch read the same phases', () => {
  // The general invariant, stated once. Any spec the expander can expand must
  // produce a card whose rep count and at-pace mileage equal the phase list's.
  const cases: Array<{ name: string; spec: WorkoutSpec; mi: number; type: 'threshold' | 'intervals' | 'tempo' | 'easy' | 'long' }> = [
    { name: '5×400 m', type: 'threshold', mi: 4.3, spec: { kind: 'threshold', rep_count: 5, rep_distance_mi: 0.249, rep_pace_s_per_mi: 430, rep_rest_s: 120, warmup_mi: 1.2, cooldown_mi: 1 } as unknown as WorkoutSpec },
    { name: '3×1 mi', type: 'threshold', mi: 6, spec: { kind: 'threshold', rep_count: 3, rep_distance_mi: 1, rep_pace_s_per_mi: 503, rep_rest_s: 60, warmup_mi: 1.5, cooldown_mi: 1 } as unknown as WorkoutSpec },
    { name: '5×1 km', type: 'threshold', mi: 6.5, spec: { kind: 'threshold', rep_count: 5, rep_distance_mi: 0.62, rep_pace_s_per_mi: 518, rep_rest_s: 60, warmup_mi: 1.5, cooldown_mi: 1 } as unknown as WorkoutSpec },
    { name: '13×10s hills', type: 'intervals', mi: 4.5, spec: { kind: 'intervals', label: '13×10s hills · by effort', by_effort: true, rep_count: 13, rep_duration_s: 10, rep_rest_s: 120, warmup_mi: 1.5, cooldown_mi: 1 } as unknown as WorkoutSpec },
    { name: '3×7 min @ I', type: 'intervals', mi: 5.5, spec: { kind: 'intervals', label: '3×7 min @ I · 60s jog', rep_count: 3, rep_duration_s: 420, rep_rest_s: 60, rep_pace_s_per_mi: 466, warmup_mi: 1.5, cooldown_mi: 1 } as unknown as WorkoutSpec },
    { name: 'tempo 6 mi', type: 'tempo', mi: 9, spec: { kind: 'tempo', warmup_mi: 1.5, cooldown_mi: 1.5, tempo_distance_mi: 6, tempo_pace_s_per_mi: 463 } as unknown as WorkoutSpec },
    { name: 'easy + strides', type: 'easy', mi: 3, spec: { kind: 'easy', pace_target_s_per_mi_lo: 643, pace_target_s_per_mi_hi: 683, strides_reps: 6, strides_duration_s: 20 } as unknown as WorkoutSpec },
    { name: 'long w/ finish', type: 'long', mi: 14, spec: { kind: 'long', pace_target_s_per_mi_lo: 560, pace_target_s_per_mi_hi: 600, finish_mi: 3, finish_pace_s_per_mi: 486, finish_label: 'M' } as unknown as WorkoutSpec },
  ];

  for (const c of cases) {
    it(`${c.name} · card reps and at-pace miles equal the watch's phases`, () => {
      const easy = 600;
      const card = cardFromSpec({ spec: c.spec, type: c.type, distanceMi: c.mi, easyPaceSec: easy, hr: HR })!;
      const phases = expandSpecToPhases({ spec: c.spec, totalMi: c.mi, easyPaceSec: easy, recoveryPaceSec: easy, toleranceSec: 8 })!;
      const work = phases.filter((p) => p.type === 'work');

      const body = card.steps.filter((s) => s.label !== 'Warmup' && s.label !== 'Cooldown');
      const cardReps = body.reduce((a, s) => a + (s.reps ?? 1), 0);
      expect(cardReps, 'rep count').toBe(work.length);

      const cardMi = body.reduce((a, s) =>
        a + (s.rep_distance_mi != null ? (s.reps ?? 1) * s.rep_distance_mi : (s.distance_mi ?? 0)), 0);
      const specMi = work.reduce((a, p) => a + (p.distanceMi ?? 0), 0);
      expect(cardMi, 'at-pace miles').toBeCloseTo(specMi, 2);

      const allowed = new Set(phasePaces(c.spec, c.mi, easy, c.type));
      for (const p of cardPaces(card.steps)) expect(allowed.has(p), `invented pace ${p}`).toBe(true);

      expect(card.total_mi).toBe(Math.round(c.mi * 10) / 10);
    });
  }
});
