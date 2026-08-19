/**
 * lib/workout-catalogue/_select.test.ts · the selector, across the full matrix.
 *
 * Three properties this file exists to hold:
 *
 *   1 · IT NEVER PRODUCES A DEGENERATE SESSION. Every (distance × tier × phase ×
 *       slot × weekly volume) either yields a session whose dose is inside
 *       doctrine's own bounds, or a refusal. There is no third outcome, and in
 *       particular there is no one-mile "tempo".
 *
 *   2 · IT REFUSES WHERE IT SHOULD. At 10, 15 and 20 mi/wk the threshold and
 *       rep slots have nothing doctrine will fit, and the selector says so.
 *
 *   3 · IT IS DETERMINISTIC. Same training state, same session, every time.
 *       This runs in the runner-facing plan path; a plan that regenerates
 *       differently is a plan the runner cannot trust.
 *
 * Run: ./node_modules/.bin/vitest run lib/workout-catalogue/_select.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { repoRoot } from '@/lib/doctrine/resolve';
import { AT_PACE_WEEKLY_SHARE_CAP, CONTINUOUS_TEMPO_MINUTES } from '@/lib/prescription/levers';
import { WORKOUT_CATALOGUE } from './catalogue';
import {
  selectWorkout,
  capFamilyOf,
  chooseIndex,
  sessionAllowanceMi,
  combinationViolation,
  PHASE_FROM_ENGINE,
  type Slot,
  type SelectorInput,
} from './select';
import { ALL_DISTANCES, DOCTRINE_PHASES, TIERS, type PaceZone } from './types';

/** A VDOT-48-ish runner, seconds per mile. */
const ANCHORS: Partial<Record<PaceZone, number>> = {
  E: 540, M: 460, MP: 460, T: 435, ST: 448, HM: 445,
  I: 400, R: 370, '10K': 415, '5K': 400, '3K': 385, mile: 370,
};

const SLOTS: Slot[] = ['threshold', 'intervals', 'tempo', 'long', 'medium_long', 'speed'];

const base = (over: Partial<SelectorInput> = {}): SelectorInput => ({
  phase: 'race_specific',
  distance: 'm',
  tier: 'intermediate',
  weekIndex: 0,
  weeklyMi: 50,
  slot: 'threshold',
  anchors: ANCHORS,
  ...over,
});

/* ───────────────────────────────────────────────────────── the full matrix ── */

describe('SELECTOR · the full matrix never yields a degenerate session', () => {
  it('every distance × tier × phase × slot × volume is a session or a refusal', () => {
    const problems: string[] = [];
    let ok = 0;
    let refused = 0;

    for (const distance of ALL_DISTANCES) {
      for (const tier of TIERS) {
        for (const phase of DOCTRINE_PHASES) {
          for (const slot of SLOTS) {
            for (const weeklyMi of [10, 15, 20, 30, 40, 55, 70, 95]) {
              const res = selectWorkout(base({ distance, tier, phase, slot, weeklyMi }));
              const at = `${distance}/${tier}/${phase}/${slot}@${weeklyMi}`;
              if (!res.ok) {
                refused++;
                if (!res.detail) problems.push(`${at}: refusal with no explanation`);
                continue;
              }
              ok++;
              const e = res.entry;
              if (!e.distances.includes(distance)) problems.push(`${at}: ${e.slug} is not for ${distance}`);
              if (!e.tiers.includes(tier)) problems.push(`${at}: ${e.slug} is not for ${tier}`);
              if (!e.phases.includes(phase)) problems.push(`${at}: ${e.slug} is not placed in ${phase}`);
              if (!(res.dose.reps >= 1)) problems.push(`${at}: ${e.slug} has ${res.dose.reps} reps`);
              // An effort-cued session (§8's hills, §7.3's sprints) spends no
              // at-pace MILES by construction — it has no pace. Its work is
              // minutes. Either currency must be non-zero; neither being so
              // would mean an empty session.
              if (!(res.dose.atPaceMi > 0) && !(res.dose.atPaceMinutes > 0)) {
                problems.push(`${at}: ${e.slug} carries no work at all`);
              }
              if (e.effortOnly && res.dose.atPaceMi !== 0) {
                problems.push(`${at}: ${e.slug} is effort-cued but claims ${res.dose.atPaceMi} at-pace mi`);
              }

              // The dose respects Daniels' share cap for its own zone.
              const cap = capFamilyOf(e);
              if (cap) {
                const allowance = weeklyMi * AT_PACE_WEEKLY_SHARE_CAP[cap];
                if (res.dose.atPaceMi > allowance + 1e-6) {
                  problems.push(`${at}: ${e.slug} spends ${res.dose.atPaceMi.toFixed(2)} mi against a ${allowance.toFixed(2)} mi ${cap} allowance`);
                }
              }
            }
          }
        }
      }
    }
    expect(problems.slice(0, 20), problems.slice(0, 20).join('\n')).toEqual([]);
    // Both outcomes must actually occur, or the matrix is proving nothing.
    expect(ok).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  it('a continuous tempo is never shorter than doctrine\'s minimum stimulus', () => {
    // §5.2 "20 min minimum for stimulus". This is the defect the refusal path
    // exists to prevent: the share cap and the tempo floor used to collide and
    // the runner got a nine-minute block.
    for (const weeklyMi of [10, 15, 20, 25, 30, 40, 55, 70, 95]) {
      for (const phase of DOCTRINE_PHASES) {
        const res = selectWorkout(base({ slot: 'tempo', phase, weeklyMi, distance: 'm' }));
        if (!res.ok) continue;
        if (res.entry.slug !== 'continuous-tempo') continue;
        expect(
          res.dose.atPaceMinutes,
          `${weeklyMi} mi/wk produced a ${res.dose.atPaceMinutes.toFixed(1)} min tempo`,
        ).toBeGreaterThanOrEqual(CONTINUOUS_TEMPO_MINUTES.min - 1e-9);
        expect(res.dose.atPaceMinutes).toBeLessThanOrEqual(CONTINUOUS_TEMPO_MINUTES.max + 1e-9);
      }
    }
  });
});

/* ────────────────────────────────────────────────────────────── refusal ── */

describe('SELECTOR · refusal at low volume', () => {
  for (const weeklyMi of [10, 15, 20]) {
    it(`offers no PACED quality session at ${weeklyMi} mi/wk`, () => {
      // The claim being pinned, stated precisely: at these volumes Daniels'
      // share caps leave too little at-pace volume for the shortest form of
      // anything doctrine paces. A session prescribed by EFFORT is a different
      // matter and is asserted below — §8.4's long hill repeats carry no share
      // against the week because they carry no pace, and doctrine offers them
      // as the substitute "for flat intervals when injury-prone". Refusing
      // those too would be this module overreaching, not doctrine speaking.
      for (const phase of DOCTRINE_PHASES) {
        for (const slot of ['threshold', 'intervals', 'tempo'] as Slot[]) {
          for (const distance of ALL_DISTANCES) {
            const res = selectWorkout(base({ slot, weeklyMi, phase, distance }));
            if (!res.ok) {
              expect(['no-quality-fits', 'nothing-placed-here', 'no-anchor']).toContain(res.reason);
              continue;
            }
            expect(
              res.entry.effortOnly,
              `${distance}/${phase}/${slot}@${weeklyMi} offered the paced session ${res.entry.slug}`,
            ).toBe(true);
          }
        }
      }
    });
  }

  it('refuses the paced threshold session outright at 10-20 mi/wk', () => {
    // The brief's own case: a week this small cannot carry a threshold
    // session, and the engine used to answer with a one-mile "tempo".
    for (const weeklyMi of [10, 15, 20]) {
      const res = selectWorkout(base({ slot: 'tempo', weeklyMi, phase: 'specific_support', distance: 'hm' }));
      expect(res.ok, `${weeklyMi} mi/wk was offered a tempo`).toBe(false);
      if (!res.ok) expect(res.reason).toBe('no-quality-fits');
    }
  });

  it('never hands a low-volume runner a session bigger than doctrine\'s share of the week', () => {
    // §11.4's pre-fatigue MP work is "8 mi easy + immediate 8 mi MP". Bounded
    // only by "shorter than the week", a 20 mi/wk runner was offered all
    // sixteen miles of it. Every session must sit inside its own share.
    for (const weeklyMi of [10, 15, 20, 30]) {
      for (const slot of SLOTS) {
        for (const phase of DOCTRINE_PHASES) {
          const res = selectWorkout(base({ slot, weeklyMi, phase, distance: 'm' }));
          if (!res.ok) continue;
          const allowance = sessionAllowanceMi(res.entry, weeklyMi);
          expect(
            res.dose.atPaceMi,
            `${res.entry.slug}@${weeklyMi} spends ${res.dose.atPaceMi.toFixed(2)} mi of a ${allowance.toFixed(2)} mi allowance`,
          ).toBeLessThanOrEqual(allowance + 1e-6);
        }
      }
    }
  });

  it('names the week, the cap and the minimum in the refusal', () => {
    const res = selectWorkout(base({ slot: 'tempo', weeklyMi: 15, phase: 'specific_support', distance: 'hm' }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('no-quality-fits');
    expect(res.detail).toContain('15 mi/wk');
    expect(res.detail).toContain(String(CONTINUOUS_TEMPO_MINUTES.min));
    // Every candidate it turned down is on the record with a reason.
    expect(res.rejected.length).toBeGreaterThan(0);
    expect(res.rejected.some((r) => r.reason === 'does-not-fit-the-week')).toBe(true);
  });

  it('still offers the low-volume runner what §15\'s base row does carry', () => {
    // Strides and hill sprints have no at-pace share against them, so a 15
    // mi/wk week is not empty — it is a base week, which is the honest answer.
    const speed = selectWorkout(base({ slot: 'speed', weeklyMi: 15, phase: 'base', distance: 'm' }));
    expect(speed.ok).toBe(true);
    const reps = selectWorkout(base({ slot: 'intervals', weeklyMi: 15, phase: 'base', distance: 'm' }));
    expect(reps.ok).toBe(true);
    if (reps.ok) expect(reps.entry.effortOnly).toBe(true);
  });

  it('threshold work opens up as the week grows, and not before', () => {
    const opensAt: number[] = [];
    for (let mi = 10; mi <= 60; mi++) {
      const res = selectWorkout(base({ slot: 'tempo', weeklyMi: mi, phase: 'specific_support', distance: 'hm' }));
      if (res.ok) opensAt.push(mi);
    }
    expect(opensAt.length).toBeGreaterThan(0);
    const first = opensAt[0];
    // Monotone: once it fits, it keeps fitting.
    expect(opensAt).toEqual(Array.from({ length: 61 - first }, (_, i) => first + i));
    // And it opens where the arithmetic says: 20 min at T pace, inside a 10%
    // share. 435 s/mi × 20 min → 2.76 mi → 27.6 mi/wk.
    const need = (CONTINUOUS_TEMPO_MINUTES.min * 60) / ANCHORS.T! / AT_PACE_WEEKLY_SHARE_CAP.threshold;
    expect(first).toBe(Math.ceil(need));
  });

  it('declines rather than guesses when a pace anchor is missing', () => {
    const res = selectWorkout(base({ slot: 'tempo', weeklyMi: 55, phase: 'specific_support', distance: 'hm', anchors: {} }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no-anchor');
  });

  it('says so plainly when doctrine places nothing here at all', () => {
    // §15's taper row is "Reduced-volume versions of recent workouts; strides;
    // short race-pace work" — no hill block, no fartlek, no VO2 set.
    //
    // ZONE-R-1 (2026-08-19) · this used to assert the cell was EMPTY, and the
    // cell was never empty: the row names strides and short race-pace work in
    // as many words, and §7's speed family is exactly that. What was empty was
    // the engine's admission table, which offered no §7 entry to any slot in
    // any phase — the other half of why the R bucket in `dosing.ts` could never
    // fire from a generated plan.
    //
    // So the claim flips to what the row actually says: the taper rep slot
    // offers §7 work and nothing else. A hill block, a fartlek or a VO2 set
    // reaching here would still be the defect this test was written for.
    for (const distance of ALL_DISTANCES) {
      const res = selectWorkout(base({ slot: 'intervals', phase: 'taper', distance, weeklyMi: 55 }));
      expect(res.ok, `${distance} taper offered nothing at all`).toBe(true);
      if (res.ok) {
        expect(res.entry.family, `${distance} taper offered a ${res.entry.family} session`).toBe('speed');
        expect(res.entry.section.startsWith('§7')).toBe(true);
      }
    }
    // And the phases where §15 genuinely places nothing on this slot still say
    // so, with the phase named.
    const none = selectWorkout(base({ slot: 'medium_long', phase: 'taper', distance: 'm', weeklyMi: 55 }));
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.reason).toBe('nothing-placed-here');
      expect(none.detail).toContain('taper');
    }
  });

  it('does NOT refuse a base-phase tempo · §5.2 places one there', () => {
    // Worth pinning because §15's base row and §5.2's own "When in cycle" row
    // disagree, and this module follows the more specific one. §15 summarises
    // the base block as easy running plus strides and hill sprints; §5.2 says
    // "Base into specific phase; backbone of HM and marathon training". The
    // per-workout row wins, and a reader who expects otherwise should see why.
    const res = selectWorkout(base({ slot: 'tempo', phase: 'base', distance: 'hm', weeklyMi: 55 }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entry.phases).toContain('base');
  });
});

/* ────────────────────────────────────────────────────────── determinism ── */

describe('SELECTOR · variety without randomness', () => {
  it('has no randomness in the source at all', () => {
    for (const f of ['select.ts', 'catalogue.ts', 'types.ts']) {
      const src = fs.readFileSync(path.join(repoRoot(), 'web-v2', 'lib', 'workout-catalogue', f), 'utf8');
      // Comments may DISCUSS randomness — this module's docstring explains why
      // it has none. Strip them and scan what actually executes.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n');
      expect(/Math\s*\.\s*random/.test(code), `${f} reaches for randomness`).toBe(false);
      expect(/Date\s*\.\s*now/.test(code), `${f} reads the clock`).toBe(false);
      expect(/new\s+Date\s*\(/.test(code), `${f} reads the clock`).toBe(false);
    }
  });

  it('returns the same session for the same training state, every time', () => {
    for (const weekIndex of [0, 1, 5, 11]) {
      const a = selectWorkout(base({ weekIndex, weeklyMi: 55, distance: 'm', phase: 'race_specific' }));
      const b = selectWorkout(base({ weekIndex, weeklyMi: 55, distance: 'm', phase: 'race_specific' }));
      expect(a.ok && b.ok && a.entry.slug === b.entry.slug).toBe(true);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('does not prescribe the same session twelve weeks running', () => {
    // The defect: an eighteen-week build whose threshold slot said the same
    // thing every week. Walk twelve weeks the way a composer would, carrying
    // what was already run so the cadence rows apply.
    const seen: string[] = [];
    for (let week = 0; week < 12; week++) {
      const recent = seen.map((slug, i) => ({ slug, weeksAgo: week - i })).filter((s) => s.weeksAgo > 0);
      const res = selectWorkout(base({
        weekIndex: week, weeklyMi: 55, distance: 'hm', phase: 'race_specific', slot: 'threshold', recent,
      }));
      expect(res.ok, `week ${week} refused a 55 mi/wk half runner`).toBe(true);
      if (res.ok) seen.push(res.entry.slug);
    }
    expect(new Set(seen).size, `twelve weeks produced ${new Set(seen).size} distinct sessions: ${seen.join(', ')}`).toBeGreaterThanOrEqual(3);
    // And no session repeats on consecutive weeks.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `week ${i} repeats week ${i - 1}`).not.toBe(seen[i - 1]);
    }
  });

  it('rotates within the candidate set and stays in range', () => {
    for (const count of [1, 2, 3, 7]) {
      for (let w = 0; w < 20; w++) {
        for (const slot of SLOTS) {
          const i = chooseIndex(w, slot, count);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(count);
        }
      }
    }
    expect(chooseIndex(0, 'threshold', 0)).toBe(-1);
  });

  it('honours a workout\'s own frequency row', () => {
    // §4.4 "Every 2–3 weeks during marathon specific phase" — asked again the
    // very next week, the selector will not hand back the MP long run.
    const res = selectWorkout(base({
      slot: 'long', distance: 'm', phase: 'race_specific', weeklyMi: 55, weekIndex: 3,
      recent: [{ slug: 'marathon-pace-long-run', weeksAgo: 1 }],
    }));
    if (res.ok) expect(res.entry.slug).not.toBe('marathon-pace-long-run');
    const trail = res.ok ? res.rejected : res.rejected;
    expect(trail.some((r) => r.slug === 'marathon-pace-long-run' && r.reason === 'cadence')).toBe(true);
  });

  it('honours a per-cycle cap', () => {
    // §9.3 "1× per training cycle (signature workout)".
    const res = selectWorkout(base({
      slot: 'intervals', distance: '5k', phase: 'race_specific', weeklyMi: 55,
      cycleCounts: { 'michigan-fartlek': 1 },
    }));
    const trail = res.rejected;
    expect(trail.some((r) => r.slug === 'michigan-fartlek' && r.reason === 'per-cycle-cap')).toBe(true);
    if (res.ok) expect(res.entry.slug).not.toBe('michigan-fartlek');
  });
});

/* ──────────────────────────────────────────────────── §16 · combinations ── */

describe('SELECTOR · §16 combinations to avoid', () => {
  const entry = (slug: string) => WORKOUT_CATALOGUE.find((e) => e.slug === slug)!;

  it('keeps VO2max work away from the long run by 48 hours', () => {
    const hit = combinationViolation(entry('mile-repeats'), {
      dayOffset: 5,
      placedThisWeek: [{ slug: 'base-long-run', dayOffset: 6 }],
      inTaperWindow: false,
    });
    expect(hit).toContain('VO2max + long run within 48 hrs');
    const clear = combinationViolation(entry('mile-repeats'), {
      dayOffset: 2,
      placedThisWeek: [{ slug: 'base-long-run', dayOffset: 6 }],
      inTaperWindow: false,
    });
    expect(clear).toBeNull();
  });

  it('keeps a hard tempo five days clear of an MP long run', () => {
    const hit = combinationViolation(entry('continuous-tempo'), {
      dayOffset: 3,
      placedThisWeek: [{ slug: 'marathon-pace-long-run', dayOffset: 6 }],
      inTaperWindow: false,
    });
    expect(hit).toContain('MP long run + hard tempo within 5 days');
  });

  it('refuses two threshold sessions back to back, except the Norwegian pair', () => {
    const hit = combinationViolation(entry('continuous-tempo'), {
      dayOffset: 3,
      placedThisWeek: [{ slug: 'cruise-intervals', dayOffset: 2 }],
      inTaperWindow: false,
    });
    expect(hit).toContain('two threshold sessions back-to-back');

    // "Only the Norwegian double-day model handles this, and only with
    // sub-threshold pacing" — two ST sessions are the doc's own exception.
    const allowed = combinationViolation(entry('sub-threshold-intervals'), {
      dayOffset: 3,
      placedThisWeek: [{ slug: 'sub-threshold-intervals', dayOffset: 2 }],
      inTaperWindow: false,
    });
    expect(allowed).toBeNull();
  });

  it('keeps the fast-finish long run out of the taper window', () => {
    expect(
      combinationViolation(entry('fast-finish-long-run'), { dayOffset: 6, placedThisWeek: [], inTaperWindow: true }),
    ).toContain('fast finish long run before goal race');
    expect(
      combinationViolation(entry('fast-finish-long-run'), { dayOffset: 6, placedThisWeek: [], inTaperWindow: false }),
    ).toBeNull();
  });

  it('does not put an R-pace day the day before threshold work', () => {
    const hit = combinationViolation(entry('continuous-tempo'), {
      dayOffset: 3,
      placedThisWeek: [{ slug: '200m-repeats', dayOffset: 2 }],
      inTaperWindow: false,
    });
    expect(hit).toContain('R-pace day before threshold');
  });

  it('applies §16 inside selectWorkout, not just in isolation', () => {
    const res = selectWorkout(base({
      slot: 'tempo', distance: 'm', phase: 'race_specific', weeklyMi: 55, dayOffset: 3,
      placedThisWeek: [{ slug: 'marathon-pace-long-run', dayOffset: 6 }],
    }));
    const trail = res.rejected;
    expect(trail.some((r) => r.reason === 'combination')).toBe(true);
    if (res.ok) expect(res.entry.slug).not.toBe('continuous-tempo');
  });
});

/* ───────────────────────────────────────────────────────── phase mapping ── */

describe('SELECTOR · the engine\'s phases reach the doctrine\'s', () => {
  it('maps all four engine phases and covers all five doctrine phases', () => {
    const covered = new Set(Object.values(PHASE_FROM_ENGINE).flat());
    expect([...covered].sort()).toEqual([...DOCTRINE_PHASES].sort());
    expect(Object.keys(PHASE_FROM_ENGINE).sort()).toEqual(['BASE', 'QUALITY', 'RACE-SPECIFIC', 'TAPER']);
  });

  it('finds something for every engine phase at a real training volume', () => {
    for (const [engine, phases] of Object.entries(PHASE_FROM_ENGINE)) {
      const any = phases.some((phase) =>
        SLOTS.some((slot) => selectWorkout(base({ phase, slot, weeklyMi: 55, distance: 'm' })).ok),
      );
      expect(any, `${engine} has nothing the catalogue can place`).toBe(true);
    }
  });
});
