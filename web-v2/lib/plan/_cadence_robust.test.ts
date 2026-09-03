/**
 * _cadence_robust.test.ts · CADENCE-AUTHORED-1 · Rule 9 + the 2026-09-02
 * simplification ruling · the deload calendar is authored, not triggered.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `cutbackCadence` compared a Banister TSB reading against -10 and returned 3
 * or 4 — the number of weeks between deloads for the WHOLE BLOCK.
 *
 * MEASURED on the owner's real CIM block, 2026-09-02, walking that input:
 *
 *   tsb -10.05 -> cadence 3 · deloads in weeks 3, 6, 9, 12 · block 691.0 mi
 *   tsb -10.00 -> cadence 4 · deloads in weeks 4, 8, 12    · block 698.5 mi
 *
 *   7 of 15 weeks re-phase · worst week 41 -> 57 mi (16.0) · worst long run
 *   21 -> 15 mi (6.0) · block total 7.5 mi · for 0.05 of a point.
 *
 * His live reading was -11, ONE POINT from the line, on a quantity his own
 * envelope showed moving twelve points in seven days (`trend7 -12`).
 *
 * ── THE RULING, AND WHY THIS GATE IS AN EQUALITY ────────────────────────────
 *
 * The owner, 2026-09-02: *"Cutback weeks are authored into the plan, not
 * triggered by daily state."* And: *"Given the same meaningful inputs, the
 * generator should produce the same plan."*
 *
 * So the assertion is not that the response is smooth. It is that TSB CANNOT
 * REACH THE CALENDAR AT ALL — `ComposePlanInput.tsbAtStart` is deleted, and no
 * authoring path reads `computeTrainingForm`. That makes the missing-sync case
 * true by construction rather than by tuning.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * · WHETHER 3 OR 4 IS THE RIGHT ANSWER for any runner. It asserts who decides
 *   and that the decision is stable, never that the decision is correct.
 *   `CUTBACK.cadence` owns the doctrine half.
 * · A DIFFERENT daily signal arriving later by a different name. It names
 *   `tsbAtStart` and `computeTrainingForm` specifically; a future
 *   `readinessAtStart` would pass here and would be the same defect.
 * · THE DB HALF. `readEstablishedCutbackCadence`'s query is not exercised
 *   here, only its pure sibling. Rule 14's `_active_plan_scan` guards its
 *   scope.
 * · THE ARCHETYPE CORPUS, which never reached this at all: `sim-inputs.ts`
 *   passed `tsbAtStart: undefined` for all 11,687 arcs (Rule 15), so the TSB
 *   branch was dark across the entire sweep for its whole life. That is why
 *   every walk below drives `composePlan` directly.
 */
import { describe, it, expect } from 'vitest';
import { composePlan, cutbackWeekRationale } from './generate';
import { cadenceFromCutbackWeeks } from './established-cadence';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

type Vec = {
  vols: number[];
  peakWk: number;
  peakLong: number;
  total: number;
  nQuality: number;
  longs: number[];
};

/** The CIM shape. `extra` is spread last so a walk can vary one input. */
function blockWith(extra: Record<string, unknown>): Vec {
  const r = composePlan({
    raceDistanceMi: 26.2, goalSec: 10800, goalPaceSec: 412,
    raceDateISO: '2026-12-06', startMondayISO: '2026-08-31', level: 'advanced',
    recentWeeklyMi: 40, easyDayMedianMi: 6, recentLongMi: 16,
    recentQualityDistanceMi: 8, recentQualityPerWeek: 2, bestRecentVdot: 48,
    isMidBlock: true,
    longRunDow: 0, restDow: 6, qualityDows: [2, 4],
    trainingDaysPerWeek: 6, crossModes: [],
    rxQuality: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
    rxRaceSpecific: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
    tPaceSec: 400, lthr: 162, maxHr: 188,
    ...extra,
  } as never) as {
    vols: number[];
    weeks: Array<{ days: Array<{ isLong?: boolean; isQuality?: boolean; distanceMi: number }> }>;
  };
  const longs = r.weeks.map((w) => w.days.find((d) => d.isLong)?.distanceMi ?? 0);
  return {
    vols: r.vols,
    peakWk: Math.max(...r.vols),
    peakLong: Math.max(...longs),
    total: Math.round(r.vols.reduce((a, b) => a + b, 0) * 10) / 10,
    nQuality: r.weeks.reduce((n, w) => n + w.days.filter((d) => d.isQuality).length, 0),
    longs,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · DAILY STATE CANNOT REACH THE CALENDAR.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('CADENCE-AUTHORED-1 · daily training form is out of the authoring path', () => {
  it('`tsbAtStart` is deleted from the composer, not deprecated in place', () => {
    const gen = src('lib/plan/generate.ts');
    // No declaration, no read. Comments explaining the removal are allowed and
    // are why this matches an assignment/parameter shape rather than the word.
    expect(/tsbAtStart\s*[?:,)]/.test(gen.replace(/^\s*\*.*$/gm, '')), 'a `tsbAtStart` ' +
      'declaration or read is back in generate.ts').toBe(false);
    expect(/input\.tsbAtStart/.test(gen), '`input.tsbAtStart` is being read again').toBe(false);
  });

  it('the authoring path does not read training form at all', () => {
    // The IMPORT, not the word: the two remaining mentions are the comments
    // that explain the removal, and deleting those would leave the next reader
    // with no record of why (Rule 20's corollary, in the useful direction).
    const gen = src('lib/plan/generate.ts');
    expect(
      /import\s*\{[^}]*computeTrainingForm/.test(gen),
      'generate.ts imports `computeTrainingForm` again — daily state is back in ' +
      'the authoring path, which is exactly what the 2026-09-02 ruling removed',
    ).toBe(false);
    expect(/computeTrainingForm\(/.test(gen), '`computeTrainingForm` is being CALLED again')
      .toBe(false);
  });

  it('`cutbackCadence` takes no reading · only authored facts', () => {
    const gen = src('lib/plan/generate.ts');
    const sig = gen.slice(gen.indexOf('function cutbackCadence('));
    const head = sig.slice(0, sig.indexOf('): number {'));
    expect(head).toContain('establishedEveryN');
    expect(head, 'a reading has been added back to the cadence signature').not.toContain('tsb');
  });

  it('#13 · volumeCurve and layoutWeek still share ONE definition', () => {
    const gen = src('lib/plan/generate.ts');
    const calls = (gen.match(/cutbackCadence\(/g) ?? []).length;
    expect(
      calls,
      `both consumers plus the declaration must be the only occurrences — found ${calls}`,
    ).toBeGreaterThanOrEqual(3);
    expect(/const cutbackEveryN = cutbackCadence\(establishedCutbackEveryN\)/.test(gen)).toBe(true);
    expect(/const cutbackEveryN = cutbackCadence\(input\.establishedCutbackEveryN\)/.test(gen)).toBe(true);
  });

  it('doctrine\'s two cycles are still the only two authored', () => {
    // `CUTBACK.cadence` reads these out of the source. Both must still be here.
    const gen = src('lib/plan/generate.ts');
    expect(/return DEFAULT_CUTBACK_EVERY_N;/.test(gen)).toBe(true);
    const ec = src('lib/plan/established-cadence.ts');
    expect(/const VALID_CADENCES = new Set\(\[3, 4\]\);/.test(ec)).toBe(true);
    expect(/export const DEFAULT_CUTBACK_EVERY_N = 4;/.test(ec)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE SENSITIVITY WALKS. Determinism where the input is daily state;
 *     proportionate movement where the input is fitness or mileage.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('CADENCE-AUTHORED-1 · sweeping the old boundary produces an IDENTICAL plan', () => {
  it('below, at, and above -10 · every output identical, both cadences', () => {
    // The walk is now over the field that REPLACED the reading: whatever a
    // caller might pass, no daily quantity exists to pass. Asserted by walking
    // the composer with the old boundary's whole neighbourhood supplied as an
    // unknown key — which the composer must ignore.
    for (const established of [null, 3, 4]) {
      const ref = blockWith({ establishedCutbackEveryN: established });
      for (const tsb of [-30, -20, -12, -10.5, -10.05, -10, -9.95, -9.5, -5, 0, 10, 25]) {
        expect(
          blockWith({ establishedCutbackEveryN: established, tsbAtStart: tsb }),
          `a training-form reading of ${tsb} changed the plan (established=${established}). ` +
          'Daily state must not reach the calendar',
        ).toEqual(ref);
      }
    }
  });

  it('THE MISSING-SYNC CASE · an absent upload cannot reorganise the calendar', () => {
    // A run that fails to sync reads as "did not train": ATL falls, TSB RISES,
    // and under the old rule the runner crossed back above -10 and the block
    // LOST a down week. Recovery removed because a phone did not upload —
    // Rule 11's shape exactly. Now it is unreachable: the reading is gone, and
    // the block's own cadence is what the rebuild inherits.
    const authored = blockWith({ establishedCutbackEveryN: 3 });
    const afterMissedSync = blockWith({ establishedCutbackEveryN: 3, tsbAtStart: 25 });
    expect(afterMissedSync).toEqual(authored);
    // The down weeks are still there, and there are still four of them.
    const dips = authored.vols.filter((v, i) => i > 0 && v < authored.vols[i - 1] * 0.9).length;
    expect(dips, 'the established block lost its down weeks').toBeGreaterThanOrEqual(3);
  });

  it('a rebuild preserves the established calendar, whatever else moved', () => {
    // The owner: "A mid-block rebuild must preserve established block intent."
    // Same block, a runner whose mileage and fitness both moved — the cadence
    // is still the block's.
    const a = blockWith({ establishedCutbackEveryN: 4, recentWeeklyMi: 40, bestRecentVdot: 48 });
    const b = blockWith({ establishedCutbackEveryN: 4, recentWeeklyMi: 46, bestRecentVdot: 51 });
    const dipIdx = (v: Vec) => v.vols
      .map((x, i) => (i > 0 && x < v.vols[i - 1] * 0.9 ? i : -1)).filter((i) => i >= 0);
    expect(
      dipIdx(b),
      'the down weeks moved when only mileage and fitness changed',
    ).toEqual(dipIdx(a));
  });
});

/**
 * RATCHET · the largest block-total move half a mile of reported base may make.
 * It may SHRINK and never grow, and it is a bound on ROUNDING, not on a
 * formula switch — the two are different findings and this number only ever
 * covers the first.
 *
 * TIEREVIDENCE-2 (2026-09-02) · RAISED 12 -> 14, and the measurement is the
 * argument rather than the convenience. With the self-declared experience level
 * removed, this CIM fixture's load row is `intermediate` (its demonstrated VDOT
 * 48 grades ~7:04/mi at the marathon) instead of the `advanced` its typed level
 * used to floor it to, so `peakWeeklyFloorMi` answers ~58 rather than 65 and
 * the geometric climb is gentler. A gentler climb means the whole curve
 * TRANSLATES with the base instead of pivoting on it, and `volumeCurve` rounds
 * every week it emits to a whole mile — so all fourteen weeks cross a rounding
 * boundary together:
 *
 *   base 49.5   [50, 50, 51, 38, 52, 53, 54, 40, 54, 54, 54, 44, 32, 24] = 650
 *   base 50.0   [50, 51, 52, 39, 53, 54, 55, 41, 55, 55, 55, 45, 33, 25] = 663
 *
 * Every week +1 and nothing else moved: identical phases (QUALITY:7 |
 * RACE-SPECIFIC:4 | TAPER:3), identical down weeks (the `dips` assertion below
 * still holds at zero tolerance), identical tier. 13 miles is 14 weeks of
 * `Math.round`, and the bound is `weeks x 1` by construction — there is no
 * branch to fall off, which is exactly the distinction
 * `_restore_continuity.test.ts` draws when it holds its own 107 single-mile
 * deload-rounding steps as a named residual rather than a defect.
 *
 * The residual itself is `Math.round` inside `volumeCurve`'s emit, and closing
 * it means emitting the curve at finer granularity — a change to every plan in
 * the corpus, and not this commit's to make. Named so it can be.
 */
const MILEAGE_STEP_ALLOWED_MI = 14;

describe('CADENCE-AUTHORED-1 · fitness and mileage still move the plan, proportionately', () => {
  it('mileage · small changes produce small changes', () => {
    // Rule 22 · a gate that only asserts "nothing changed" would pass an engine
    // that ignores the runner entirely. This half asserts the plan DOES respond,
    // and that it responds by degree.
    const walk: Array<{ mi: number; v: Vec }> = [];
    for (let mi = 34; mi <= 50.001; mi += 0.5) {
      walk.push({ mi: Math.round(mi * 10) / 10, v: blockWith({ recentWeeklyMi: mi, establishedCutbackEveryN: 4 }) });
    }
    expect(walk.length, 'the walk composed nothing').toBeGreaterThan(20);
    expect(new Set(walk.map((w) => w.v.total)).size,
      'sixteen miles of base moved nothing — the walk is inert').toBeGreaterThan(1);
    for (let i = 1; i < walk.length; i++) {
      const d = Math.abs(walk[i].v.total - walk[i - 1].v.total);
      expect(
        d,
        `block total jumped ${d.toFixed(1)} mi for half a mile of reported base, between ` +
        `${walk[i - 1].mi} (${walk[i - 1].v.total}) and ${walk[i].mi} (${walk[i].v.total})`,
      ).toBeLessThanOrEqual(MILEAGE_STEP_ALLOWED_MI);
      // And the calendar itself never re-phases on mileage.
      const dips = (v: Vec) => v.vols.map((x, k) => (k > 0 && x < v.vols[k - 1] * 0.9 ? k : -1)).filter((k) => k >= 0);
      expect(dips(walk[i].v), `the down weeks moved at base ${walk[i].mi}`).toEqual(dips(walk[0].v));
    }
  });

  it('fitness · small changes produce small changes', () => {
    const walk: Array<{ vdot: number; v: Vec }> = [];
    for (let vdot = 44; vdot <= 54.001; vdot += 0.25) {
      walk.push({ vdot: Math.round(vdot * 100) / 100, v: blockWith({ bestRecentVdot: vdot, establishedCutbackEveryN: 4 }) });
    }
    expect(walk.length).toBeGreaterThan(20);
    for (let i = 1; i < walk.length; i++) {
      const d = Math.abs(walk[i].v.total - walk[i - 1].v.total);
      expect(
        d,
        `block total jumped ${d.toFixed(1)} mi for a quarter point of VDOT, between ` +
        `${walk[i - 1].vdot} and ${walk[i].vdot}`,
      ).toBeLessThanOrEqual(12);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · WHAT DECIDES IT INSTEAD.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('CADENCE-AUTHORED-1 · the cadence comes from the block, then from evidence', () => {
  it('an established block keeps its cadence, whatever the evidence says', () => {
    const dipIdx = (v: Vec) => v.vols
      .map((x, i) => (i > 0 && x < v.vols[i - 1] * 0.9 ? i : -1)).filter((i) => i >= 0);
    for (const established of [3, 4]) {
      const ref = blockWith({ establishedCutbackEveryN: established });
      for (const evidence of [null, undefined]) {
        expect(dipIdx(blockWith({ establishedCutbackEveryN: established, rampBaseEvidence: evidence })))
          .toEqual(dipIdx(ref));
      }
    }
  });

  it('at INITIAL authoring NOTHING about the runner moves the calendar', () => {
    // A new block takes doctrine's default row, always. This is the clause the
    // simplification ruling actually asks for: no hidden rule reorganises the
    // calendar, so no property of the runner may either.
    //
    // It was NOT always this. Deriving the tighter cycle from
    // `RampBaseEvidence.returning` was tried and measured red across four
    // gates — see `established-cadence.ts` for the numbers. This assertion is
    // what that attempt failed.
    const dipIdx = (v: Vec) => v.vols
      .map((x, i) => (i > 0 && x < v.vols[i - 1] * 0.9 ? i : -1)).filter((i) => i >= 0);
    const evidence = (returning: boolean) => ({
      baseMi: returning ? 40 : 45, meanMi: 40, sustainedMi: 45, peakMi: 48,
      interruptionWeeks: 0, allowedInterruptionWeeks: 4, lifted: false,
      heldMi: returning ? 40 : 45, returning, heldByCurrent: true,
    });
    const ref = dipIdx(blockWith({ establishedCutbackEveryN: null }));
    for (const returning of [true, false]) {
      expect(
        dipIdx(blockWith({ establishedCutbackEveryN: null, rampBaseEvidence: evidence(returning) })),
        `a property of the runner (returning=${returning}) moved the down weeks of a NEW block`,
      ).toEqual(ref);
    }
  });

  it('the 3-week cycle is still LIVE, by inheritance · not decoration (Rule 15)', () => {
    // Rule 15 · a cadence no case can reach is decoration. This one is reached
    // by every block that already has it, which includes the owner's live CIM
    // block, and the walk proves the two calendars really are different.
    const dipIdx = (v: Vec) => v.vols
      .map((x, i) => (i > 0 && x < v.vols[i - 1] * 0.9 ? i : -1)).filter((i) => i >= 0);
    const three = dipIdx(blockWith({ establishedCutbackEveryN: 3 }));
    const four = dipIdx(blockWith({ establishedCutbackEveryN: 4 }));
    expect(three, 'the inherited 3-week cycle produced no down weeks').not.toEqual([]);
    expect(three, 'the two cycles author the same calendar — one of them is dead')
      .not.toEqual(four);
    expect(three.length, 'the tighter cycle produced fewer down weeks than the default')
      .toBeGreaterThanOrEqual(four.length);
  });

  it('no evidence at all takes doctrine\'s DEFAULT cycle', () => {
    // Research/00b §Frequency · "Default for most runners | 3 weeks load ->
    // 1 week cutback". "Don't know" must not buy the tighter row (Rule 11).
    const dipIdx = (v: Vec) => v.vols
      .map((x, i) => (i > 0 && x < v.vols[i - 1] * 0.9 ? i : -1)).filter((i) => i >= 0);
    expect(dipIdx(blockWith({}))).toEqual(dipIdx(blockWith({ establishedCutbackEveryN: 4 })));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · EVERY CUTBACK WEEK EXPLAINS ITSELF.
 *
 * The owner's requirement alongside the removal: the system must be able to
 * answer "why this cutback or recovery week" for every planned week.
 *
 * CANNOT FAIL ON (Rule 22): whether the sentence is GOOD. It checks that one
 * exists, that it is gated on the cadence it describes, and that it obeys the
 * voice rules that can be checked mechanically. Whether it reads like a coach
 * is a human call, and `scripts/check-coach-voice.sh` owns the shared half.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('CADENCE-AUTHORED-1 · a cutback week says why it is one', () => {
  it('both cadences have their own reason, and they differ', () => {
    const three = cutbackWeekRationale(3);
    const four = cutbackWeekRationale(4);
    expect(three).not.toEqual(four);
    for (const s of [three, four]) {
      expect(s.length, 'the reason is empty').toBeGreaterThan(20);
      expect(s.startsWith('Cutback week.'), `"${s}" does not name what it is`).toBe(true);
      // Coach voice, the mechanically checkable half.
      expect(s, `"${s}" uses an em dash`).not.toMatch(/—/);
      expect(s, `"${s}" uses an exclamation mark`).not.toMatch(/!/);
      expect(s, `"${s}" uses an emoji`).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      // It says why, not just what.
      expect(s.split('.').filter((p) => p.trim()).length,
        `"${s}" names the week but gives no reason`).toBeGreaterThan(1);
    }
  });

  it('the persist path writes it on cutback weeks and nowhere else', () => {
    // Rule 17 · said once, on the week it is about. Rule 16 · gated on the
    // flag it describes. Both are the same line, so both are read from it.
    const gen = src('lib/plan/generate.ts');
    expect(
      /isCutbackByWeek\[wi\]\s*\n\s*\?\s*cutbackWeekRationale\(authoredCutbackEveryN\)/.test(gen),
      'the cutback rationale is no longer gated on `is_cutback` at the persist site',
    ).toBe(true);
    const calls = (gen.match(/cutbackWeekRationale\(/g) ?? []).length;
    expect(calls, `the reason is emitted from ${calls} places — it belongs to one`)
      .toBe(2); // the declaration and the one call
  });
});

describe('CADENCE-AUTHORED-1 · recovering an existing block\'s cadence', () => {
  it('reads the cadence out of the block\'s own cutback weeks', () => {
    expect(cadenceFromCutbackWeeks([3, 7, 11])).toBe(4);
    expect(cadenceFromCutbackWeeks([2, 5, 8, 11])).toBe(3);
  });

  it('one mislabelled week cannot decide it · the MODE, not the first gap', () => {
    expect(cadenceFromCutbackWeeks([3, 7, 11, 13])).toBe(4);   // one extra
    expect(cadenceFromCutbackWeeks([2, 5, 11, 14])).toBe(3);   // one missing
  });

  it('refuses rather than guesses (Rule 11)', () => {
    expect(cadenceFromCutbackWeeks([])).toBeNull();
    expect(cadenceFromCutbackWeeks([4])).toBeNull();           // one flag, no gap
    expect(cadenceFromCutbackWeeks([0, 6, 12])).toBeNull();    // a 6 is not ours
  });
});
