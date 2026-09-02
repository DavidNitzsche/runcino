/**
 * SPECSUMMARY-1 · the session's family is READ off the spec, never templated.
 *
 * THE DEFECT. `lib/watch/build-workout.ts` built the wire's `summary` from
 * `prescriptionFor(...)` — the generic template whose rep distance is a
 * literal (`const repMi = 1` for threshold, `0.5` for intervals) and whose
 * rep count is dosed off WEEKLY MILEAGE rather than read off the day. Composed
 * against production read-only on 2026-09-01, every quality row of the owner's
 * live block was described as a session it is not, and four plain long runs
 * were described as carrying a marathon-pace finish their specs do not have.
 *
 * This is the same generic-versus-authored split `_spec_card.test.ts` closed
 * for the phone on 2026-08-24. That gate asserts the card's STRUCTURE comes
 * from the spec; this one asserts the summary states no structure at all.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · Whether any surface DRAWS the summary. No watch face does today; this
 *     checks the wire's honesty, not a pixel.
 *   · A family phrase that is the wrong family. It checks that no COUNT or
 *     DISTANCE is stated and that the long-run finish claim matches the spec;
 *     `sessionRationale`'s family words are taken as given.
 *   · The no-spec fallback. A row with no `workout_spec` still gets the
 *     template, which is its stated job — so a regression that deletes specs
 *     rather than mis-describing them reads clean here.
 */
import { describe, it, expect } from 'vitest';
import { specFamilyPhrase } from './spec-card';
import { prescriptionFor } from './prescriptions';
import type { WorkoutSpec } from '@/lib/plan/spec-builder';

/** The real shapes off the owner's live block, 2026-09-01. */
const HILLS = { kind: 'intervals', label: '10×60s hills @ 5K-10K effort · 2 min jog down', by_effort: true,
  rep_count: 10, rep_duration_s: 60, rep_rest_s: 120, warmup_mi: 1.5, cooldown_mi: 1 } as unknown as WorkoutSpec;
const NORWEGIAN = { kind: 'threshold', label: '9×1km @ ST pace · 60s jog', rep_count: 9,
  rep_distance_mi: 0.621, rep_pace_s_per_mi: 445, rep_rest_s: 60, warmup_mi: 2, cooldown_mi: 2 } as unknown as WorkoutSpec;
const PLAIN_LONG = { kind: 'long', pace_target_s_per_mi_lo: 502, pace_target_s_per_mi_hi: 537,
  hr_cap_bpm: 151, fuel_mi: [5, 9, 13] } as unknown as WorkoutSpec;
const FINISH_LONG = { ...(PLAIN_LONG as object), finish_mi: 4, finish_pace_s_per_mi: 475,
  finish_label: 'M' } as unknown as WorkoutSpec;
const SEGMENTED_LONG = { ...(PLAIN_LONG as object), finish_segments: [
  { mi: 3.5, pace_s_per_mi: 475, label: 'M' }, { mi: 2, pace_s_per_mi: 475, label: 'M' },
] } as unknown as WorkoutSpec;

/** A count or a size — the two things the template stated and got wrong. */
const STATES_A_STRUCTURE = /\d/;

describe('SPECSUMMARY-1 · the summary states a family, never a structure', () => {
  it('names no rep count, rep distance or block length on any quality shape', () => {
    const cases: Array<[string, WorkoutSpec, 'threshold' | 'intervals' | 'tempo']> = [
      ['hills', HILLS, 'intervals'],
      ['norwegian', NORWEGIAN, 'threshold'],
      ['tempo', { kind: 'tempo', warmup_mi: 2, tempo_distance_mi: 5, tempo_pace_s_per_mi: 430, cooldown_mi: 2 } as unknown as WorkoutSpec, 'tempo'],
    ];
    for (const [name, spec, type] of cases) {
      const phrase = specFamilyPhrase(spec, type);
      expect(phrase, `${name} · "${phrase}" states a number`).not.toMatch(STATES_A_STRUCTURE);
      expect(phrase.length, name).toBeGreaterThan(0);
    }
  });

  it('the template it replaces DID state one · the defect, pinned', () => {
    // Falsification in the suite rather than only in a log: this is the exact
    // call the summary used to make, and it invents a structure for a session
    // it has never seen. If this ever stops being true the fix is moot and the
    // gate above is measuring nothing.
    const generic = prescriptionFor('intervals', 45, { lthr: null, anchors: null, raceDistanceMi: 26.2 }, 6.5).headline;
    expect(generic).toMatch(STATES_A_STRUCTURE);
    // …and it does not agree with the ten 60-second hills it was describing.
    expect(generic).not.toContain('60s');
  });

  it('a long run claims a marathon-pace finish only when its spec carries one', () => {
    // The live defect: four of the owner's plain long runs were described as
    // "Long run · marathon-pace finish" with no finish segment in the spec.
    expect(specFamilyPhrase(PLAIN_LONG, 'long')).toBe('Long run · aerobic');
    expect(specFamilyPhrase(FINISH_LONG, 'long')).toBe('Long run · marathon-pace finish');
    expect(specFamilyPhrase(SEGMENTED_LONG, 'long')).toBe('Long run · marathon-pace finish');
  });

  it('the watch builder routes the summary through this owner, not the template', () => {
    // A source scan, for the same reason EXECSEM-1 is one: a consumer that
    // stops calling the owner silently goes back to its own answer, and a
    // behavioural test cannot see which function produced a legal-looking
    // string. Comments are stripped so the docblock quoting the old line
    // does not satisfy the check (Rule 18 — an absence-only assertion that
    // passes on wreckage is the failure this repo has already shipped).
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'watch', 'build-workout.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(src.length, 'liveness · the scanner read a real file').toBeGreaterThan(500);
    expect(src).toMatch(/specFamilyPhrase\(wo\.workout_spec, prescriptionType\)/);
    // The template may still be the NO-SPEC fallback, and only that.
    const summaryLines = src.split('\n').filter((l) => /const summary =|prescription\.headline/.test(l));
    expect(summaryLines.join('\n')).toMatch(/expanded && expanded\.length > 0/);
  });
});
