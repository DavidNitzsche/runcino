/**
 * lib/plan/_progression_dose_persisted.test.ts · PROGRESSION-DOSE-1
 *
 * The overload ladder climbs. Its position has to be WRITTEN DOWN, or the
 * adaptation gate that reads it has nothing to read.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * MEASURED ON THE OWNER'S CIM BLOCK, at the instant the cron authors it
 *
 *   24 quality slots · 21 with `vocabRx` SET (the §15 catalogue chose them)
 *   `trackOfType` non-null on 13 of those 21 · so the dose stepped for 13
 *   `workShape` persisted for 1
 *
 * `workShape` is set only where `trackFor` is non-null, and `trackFor` returns
 * null whenever the catalogue filled the slot — deliberately, because a
 * catalogue session carries the name doctrine gives it and the ladder must not
 * overwrite those words. That split is right. The bug was that `workShape` was
 * ALSO the only thing reaching storage, so `loadProgressionWeek` built zero
 * targets, `detectProgressionGate` returned null every week, and
 * `plan_adapt_progression` has ZERO rows in the entire production database.
 *
 * The ladder was never dark. Only its position was unrecorded.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS STILL OPEN, stated here so this file is not read as a full fix
 *
 * The THRESHOLD ladder does not open for this runner at all, for a different
 * reason that this change does not touch: his `rx.threshold` is
 * `"2 mi WU · 4 mi @ T · 2 mi CD"`, and `seedShapeFrom` returns null for a
 * continuous tempo — `parsePrescription` wants `N x D mi` and `parseTimeReps`
 * wants `N x M min`. So `stepByTrack` holds a `threshold` KEY with a NULL
 * value, and every threshold and tempo slot still records no dose. The
 * assertions below pin what this change fixed (the interval track, and the
 * tempo/threshold family mapping on the reader side); the seed-parse gap is
 * reported, not silently absorbed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { familyOfType } from './progression-pass';
import { seedShapeFrom } from '@/lib/prescription/trajectory';

const GENERATE = path.join(process.cwd(), 'lib/plan/generate.ts');

function generateSrc(): string {
  const s = fs.readFileSync(GENERATE, 'utf8');
  expect(s.length, 'generate.ts read as empty · the scan would pass on nothing')
    .toBeGreaterThan(100_000);
  return s;
}

describe('PROGRESSION-DOSE-1 · the ladder position reaches storage', () => {
  it('the persist path falls back to the dose when the label half is absent', () => {
    const src = generateSrc().replace(/\s+/g, ' ');
    // The fallback itself. Without it a catalogue-filled slot persists nothing,
    // which is the whole defect.
    expect(src).toContain('const persistedDose = d.workShape ? { shape: d.workShape, lever: d.progressionLever ?? null, zone: d.challengeZone ?? null } : d.progressionDose ?? null;');
    expect(src).toContain('if (workoutSpec && persistedDose) {');
    // And `workShape` still WINS when both exist, so a generic slot's output is
    // byte-identical to what it was before this change.
    expect(src.indexOf('d.workShape ? { shape: d.workShape'))
      .toBeLessThan(src.indexOf(': d.progressionDose ?? null;'));
  });

  it('the dose is read off the DOSE track, never off the label track', () => {
    const src = generateSrc().replace(/\s+/g, ' ');
    // `trackFor` is the label question and returns null on a catalogue slot.
    // Reading the dose through it would reproduce the bug exactly.
    expect(src).toContain('const doseTrack = doseTrackOfType(qt);');
    expect(src).toContain('const doseStep = doseTrack != null ? (stepByTrack.get(doseTrack) ?? null) : null;');
    expect(src).not.toContain('const doseTrack = trackFor(');
  });

  it('a day demoted out of quality drops its ladder position too', () => {
    // Otherwise the row reads "Easy · no quality this close" over a spec still
    // claiming a rung on the threshold ladder — MIDRACE-SHAPE-1's defect, in a
    // new field.
    const src = generateSrc();
    expect(src).toMatch(/function clearWorkShape\(d: DayPlan\): void \{[\s\S]{0,600}delete d\.progressionDose;/);
    const travel = fs.readFileSync(path.join(process.cwd(), 'lib/plan/travel-windows.ts'), 'utf8');
    expect(travel).toContain('delete d.progressionDose;');
  });

  it('the label path is untouched · the trajectory still supplies no words it did not before', () => {
    const src = generateSrc().replace(/\s+/g, ' ');
    // `trackFor` must keep returning null on a catalogue slot. If this ever
    // stops being true, variety has been traded for progression — the opposite
    // of the intended trade, and a change no assertion here would otherwise see.
    expect(src).toContain('const trackFor = (s: { qt: ComposerQualityType; vocabRx: string | undefined }): SessionFamily | null => { if (s.vocabRx) return null; return trackOfType(s.qt); };');
  });
});

describe('PROGRESSION-DOSE-1 · a tempo is the threshold ladder, on doctrine', () => {
  /*
   * `Research/01` § "Pace prescription by workout type" gives both rows the SAME
   * Daniels zone, pace anchor, RPE and %HRmax:
   *
   *   | Tempo (continuous) | T | T pace | 7-8 | 88-92% | 20-40 min |
   *   | Cruise intervals   | T | T pace | 7-8 | 88-92% | 4-6 x 1mi @ T, 1 min jog |
   *
   * and the concept map above it lists them as "T" and "T (broken)". A tempo is
   * the threshold ladder run continuously rather than chopped up.
   *
   * The engine already agreed on the SIZING path (`targetMinutesFor` mapped
   * tempo -> threshold) and disagreed on the ladder and reader paths. One
   * quantity, three answers — Rule 16.
   */
  it('familyOfType puts tempo on the threshold ladder', () => {
    expect(familyOfType('tempo')).toBe('threshold');
    expect(familyOfType('threshold')).toBe('threshold');
  });

  it('the interval families are unchanged', () => {
    expect(familyOfType('intervals')).toBe('interval');
    expect(familyOfType('vo2max')).toBe('interval');
  });

  it('a declared zone still wins over the type · ZONE-R-1 is not weakened', () => {
    // A `tempo` row prescribing R-pace repeats is repetition work, and the
    // prescription says so. Type only decides when the prescription declares
    // nothing.
    expect(familyOfType('tempo', '8 x 200m @ R pace')).toBe('repetition');
    expect(familyOfType('threshold', '5 x 3 min @ I pace')).toBe('interval');
  });

  it('a non-quality type is still on no ladder', () => {
    expect(familyOfType('easy')).toBeNull();
    expect(familyOfType('long')).toBeNull();
    expect(familyOfType('race')).toBeNull();
  });

  it('the composer and the reader agree, through ONE mapping each', () => {
    const src = generateSrc().replace(/\s+/g, ' ');
    // The composer's dose track is defined once and both call sites use it,
    // rather than the tempo->threshold mapping being restated per site.
    expect(src).toContain("const doseTrackOfType = (qt: ComposerQualityType): SessionFamily | null => trackOfType(qt === 'tempo' ? 'threshold' : qt);");
    expect((src.match(/doseTrackOfType\(qt\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The step MAP stays keyed by `trackOfType`. Keying it by the dose track
    // adds a `threshold` entry on a tempo-only week, and `targetMinutesFor`
    // reads the same map — the at-pace ceiling would start binding where it
    // never has, which moved the owner-class plan and was caught by
    // `_audit_periodization.test.ts`'s frozen fingerprint. Recording the dose
    // is additive; changing what the map holds is a separate decision.
    expect(src).toContain('const track = trackOfType(s.qt); if (track == null || stepByTrack.has(track)) continue;');
  });
});

describe('PROGRESSION-DOSE-1 · the seed-parse gap, held as a known open finding', () => {
  /*
   * NOT a fix, an ASSERTION OF THE CURRENT TRUTH, so the next person reads the
   * limit rather than assuming the ladder is whole. When the seed parser learns
   * continuous tempos, these two flip and this block is the thing that makes
   * someone come back and say so.
   */
  it('a rep-shaped threshold seed opens the ladder', () => {
    expect(seedShapeFrom('4 x 1 mi @ T, 1 min jog', 458)).not.toBeNull();
    expect(seedShapeFrom('3 x 10 min @ T pace · 60s jog', 458)).not.toBeNull();
  });

  it('OPEN: a continuous tempo seed does not, so the threshold ladder never opens for this runner', () => {
    // His live `rx.threshold`. Every parser returns null, so `trajectory.step`
    // returns null, so `stepByTrack` holds a threshold key with a null value.
    expect(seedShapeFrom('2 mi WU · 4 mi @ T · 2 mi CD', 458)).toBeNull();
    expect(seedShapeFrom('20 min @ T', 458)).toBeNull();
  });
});
