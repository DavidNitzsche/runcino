/**
 * CEIL-ZONE-1 · the plan's stimulus ceiling reads a session at its own zone.
 *
 * The doctrine gate (`PACE.zone-stimulus-inversion`) asserts the round trip and
 * the taper exclusion against the research passage. This file pins the WORKED
 * NUMBERS from the bug report, so the size of the defect stays legible in the
 * repo rather than only in a commit message.
 */
import { describe, it, expect } from 'vitest';
import {
  vdotFromZonePace,
  zonePaceAtVdot,
  stimulusVdotForRow,
} from './zone-stimulus';
import {
  iPaceFromVdot,
  tPaceFromVdot,
  racePaceFromVdot,
  vdotFromRace,
  TABLE_RACE_DISTANCE_MI,
} from './vdot';

const M = TABLE_RACE_DISTANCE_MI.marathon;

describe('CEIL-ZONE-1 · a rep set is not a race', () => {
  it('the marathon tune-up no longer re-scores I-pace reps as a marathon', () => {
    // A VDOT-48 marathon plan prescribes "5x400m @ 5K pace", which spec-builder
    // paces at I-pace. At VDOT 48 that is 398 s/mi.
    const iPace = iPaceFromVdot(48)!;
    expect(iPace).toBe(398);

    // BEFORE · vdotFromRace(pace x goalDistance, goalDistance) read those four
    // hundreds as a 2:53:55 marathon.
    const asMarathonRace = vdotFromRace(Math.round(iPace * M), M)!;
    expect(Math.round(iPace * M)).toBe(10435); // 2:53:55
    expect(asMarathonRace).toBeCloseTo(55.7, 1);
    expect(asMarathonRace - 48).toBeGreaterThan(7); // +7.7 VDOT, and it won the MAX

    // AFTER · the taper primer contributes nothing to the ceiling at all.
    expect(stimulusVdotForRow('race_week_tuneup', '5x400m @ 5K pace · 2min jog', iPace)).toBeNull();

    // And the same pace, read at its own zone on a BUILD session, lands on the
    // runner the plan was actually written for.
    expect(stimulusVdotForRow('intervals', '5x400m @ 5K pace · 2min jog', iPace)?.vdot).toBe(48);
  });

  it('every distance\'s tune-up is excluded, so the HM circularity is gone too', () => {
    const t = tPaceFromVdot(48)!;
    const i = iPaceFromVdot(48)!;
    // 5K / 10K / M all prescribe "@ 5K pace" (I-pace); HM prescribes "@ race
    // pace" (the goal itself); ultra prescribes "@ T pace".
    for (const [label, pace] of [
      ['5x200m @ 5K pace · 90s jog', i],
      ['4x400m @ 5K pace · 90s jog', i],
      ['4x1km @ race pace · 90s jog', 400],
      ['5x400m @ 5K pace · 2min jog', i],
      ['5x400m @ T pace · 90s jog', t],
    ] as Array<[string, number]>) {
      expect(stimulusVdotForRow('race_week_tuneup', label, pace)).toBeNull();
    }
  });

  it('a marathon-pace row is a goal echo, not a stimulus ceiling', () => {
    // marathonPaceSPerMi returns the runner's own GOAL marathon pace whenever
    // it sits in the marathon zone, so an @MP row proves the plan reaches the
    // goal by restating the goal.
    const mp = racePaceFromVdot(48, M)!;
    expect(stimulusVdotForRow('tempo', '8mi @ MP', mp)).toBeNull();
    // A plain tempo, with no declared zone, still reads at T.
    expect(stimulusVdotForRow('tempo', '4mi tempo', tPaceFromVdot(48)!)?.zone).toBe('T');
  });

  it('the T-zone read is the canonical inversion, to a tenth', () => {
    for (const v of [35, 42, 48, 55, 62, 70]) {
      const t = tPaceFromVdot(v)!;
      expect(Math.abs(vdotFromZonePace('T', t)! - v)).toBeLessThanOrEqual(0.5);
    }
  });

  it('a pace off either end of the table reads as unknown, not as the nearest edge', () => {
    const fastest = zonePaceAtVdot(85, 'T')!;
    const slowest = zonePaceAtVdot(30, 'T')!;
    expect(vdotFromZonePace('T', fastest - 60)).toBeNull();
    expect(vdotFromZonePace('T', slowest + 120)).toBeNull();
  });

  it('is deterministic — same input, same answer', () => {
    const p = tPaceFromVdot(48)!;
    const a = vdotFromZonePace('T', p);
    const b = vdotFromZonePace('T', p);
    expect(a).toBe(b);
  });
});
