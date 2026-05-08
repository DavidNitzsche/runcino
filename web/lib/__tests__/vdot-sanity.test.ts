/**
 * Sanity check: VDOT-derived paces for the runner's actual recent
 * race (AFC half marathon 2025: 13.26 mi in 1:36:31 / 7:17 pace).
 *
 * Goal of this test: print the resulting Daniels bands so we can
 * eyeball them against expectations BEFORE shipping. If any of the
 * assertions feel wrong on a re-read, the inputs/wiring need a
 * second look.
 */
import { describe, it, expect } from 'vitest';
import { vdotFromRace, pacesFromVdot, paceTargetFromVdot, vdotSnapshot } from '../vdot';
import type { CoachState } from '../coach-state';

const HM_DISTANCE_MI = 13.26;       // Strava-reported, slightly long course
const HM_TIME_S = (1 * 3600) + (36 * 60) + 31;  // 1:36:31

function paceStr(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

describe('VDOT sanity — AFC half marathon 2025 actual', () => {
  it('infers a believable VDOT', () => {
    const vdot = vdotFromRace(HM_DISTANCE_MI, HM_TIME_S);
    expect(vdot).not.toBeNull();
    // 1:36:31 HM: between VDOT 46 (HM 1:38:27) and VDOT 48 (1:35:01).
    // Linear interp lands ~47.1.
    expect(vdot!).toBeGreaterThan(46);
    expect(vdot!).toBeLessThan(48);
    // eslint-disable-next-line no-console
    console.log(`\n  AFC 2025: ${HM_DISTANCE_MI}mi @ ${paceStr(HM_TIME_S / HM_DISTANCE_MI)}/mi → VDOT ${vdot}`);
  });

  it('produces all 5 Daniels bands', () => {
    const vdot = vdotFromRace(HM_DISTANCE_MI, HM_TIME_S)!;
    const set = pacesFromVdot(vdot)!;
    expect(set).not.toBeNull();
    // eslint-disable-next-line no-console
    console.log(
      `\n  Daniels bands at VDOT ${vdot}:\n` +
      `    E: ${paceStr(set.E.lowS)}–${paceStr(set.E.highS)}/mi\n` +
      `    M: ${paceStr(set.M.lowS)}–${paceStr(set.M.highS)}/mi\n` +
      `    T: ${paceStr(set.T.lowS)}–${paceStr(set.T.highS)}/mi\n` +
      `    I: ${paceStr(set.I.lowS)}–${paceStr(set.I.highS)}/mi\n` +
      `    R: ${paceStr(set.R.lowS)}–${paceStr(set.R.highS)}/mi`
    );
    // Sanity guards:
    // E pace should be in 8:00–9:30/mi territory for VDOT ~47.
    expect((set.E.lowS + set.E.highS) / 2).toBeGreaterThan(450);
    expect((set.E.lowS + set.E.highS) / 2).toBeLessThan(580);
    // T pace should be tighter than E and faster.
    expect(set.T.highS - set.T.lowS).toBeLessThan(set.E.highS - set.E.lowS);
  });

  it('paceTargetFromVdot picks correct band per workout type', () => {
    // Build a minimal CoachState stub that has just enough for the
    // pipeline to find the AFC race and route to vdot.
    const state = {
      races: {
        recent: [
          {
            slug: 'afc-2025',
            activityId: null,
            name: 'America\'s Finest City Half',
            date: '2025-08-31',
            distanceMi: HM_DISTANCE_MI,
            finishS: HM_TIME_S,
            daysAgo: 14,
          },
        ],
        nextA: null, nextAny: null, inWindow: [], raceCount30d: 0,
      },
    } as unknown as CoachState;

    const easy = paceTargetFromVdot(state, 'general_aerobic');
    const threshold = paceTargetFromVdot(state, 'threshold');
    const vo2 = paceTargetFromVdot(state, 'vo2');
    const marathon = paceTargetFromVdot(state, 'marathon_specific');

    expect(easy).not.toBeNull();
    expect(threshold).not.toBeNull();
    expect(vo2).not.toBeNull();
    expect(marathon).not.toBeNull();

    expect(easy!.zone).toBe('E');
    expect(threshold!.zone).toBe('T');
    expect(vo2!.zone).toBe('I');
    expect(marathon!.zone).toBe('M');

    // E should be the slowest (highest s/mi).
    expect(easy!.lowS).toBeGreaterThan(marathon!.lowS);
    expect(marathon!.lowS).toBeGreaterThan(threshold!.lowS);
    expect(threshold!.lowS).toBeGreaterThan(vo2!.lowS);
  });

  it('falls back to null when no recent race', () => {
    const state = {
      races: { recent: [], nextA: null, nextAny: null, inWindow: [], raceCount30d: 0 },
    } as unknown as CoachState;
    expect(paceTargetFromVdot(state, 'general_aerobic')).toBeNull();
  });

  it('vdotSnapshot bundles the dashboard payload', () => {
    const state = {
      races: {
        recent: [
          {
            slug: 'afc-2025',
            activityId: null,
            name: 'America\'s Finest City Half',
            date: '2025-08-31',
            distanceMi: HM_DISTANCE_MI,
            finishS: HM_TIME_S,
            daysAgo: 14,
          },
        ],
        nextA: null, nextAny: null, inWindow: [], raceCount30d: 0,
      },
    } as unknown as CoachState;

    const snap = vdotSnapshot(state);
    expect(snap).not.toBeNull();
    expect(snap!.vdot).toBeGreaterThan(46);
    expect(snap!.vdot).toBeLessThan(48);
    expect(snap!.source.name).toBe('America\'s Finest City Half');
    expect(snap!.source.daysAgo).toBe(14);
    expect(snap!.source.paceSPerMi).toBeGreaterThan(430);
    expect(snap!.source.paceSPerMi).toBeLessThan(442);
    // All 5 bands populated.
    expect(snap!.paces.E.lowS).toBeGreaterThan(0);
    expect(snap!.paces.M.lowS).toBeGreaterThan(0);
    expect(snap!.paces.T.lowS).toBeGreaterThan(0);
    expect(snap!.paces.I.lowS).toBeGreaterThan(0);
    expect(snap!.paces.R.lowS).toBeGreaterThan(0);
  });

  it('vdotSnapshot returns null without race data', () => {
    const state = {
      races: { recent: [], nextA: null, nextAny: null, inWindow: [], raceCount30d: 0 },
    } as unknown as CoachState;
    expect(vdotSnapshot(state)).toBeNull();
  });
});
