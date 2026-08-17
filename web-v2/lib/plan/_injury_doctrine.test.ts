/**
 * INJURY-1 · return-to-run must match Research/05-injury-return-protocols.md.
 *
 * The defect this locks out: the injury builder chose the WHOLE return
 * from a three-value severity enum (minor 2 weeks / moderate 3 / major
 * 4) and ran one generic walk-run ladder for every diagnosis.
 * `injury.site` was loaded and echoed into the phase rationale but never
 * reached the prescription.
 *
 * The worst case that produced: a suspected navicular bone stress injury
 * — an avascular site the research puts at 6+ weeks non-weight-bearing
 * (Research/05:447) and 4-9 months total return (:487) — got a walk-run
 * plan starting inside three weeks, against :463 "All confirmed BSIs: no
 * running until clinical clearance."
 *
 * These assertions encode the research tables directly. If a future edit
 * moves a number away from doctrine, this fails and names the citation.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveInjuryProtocol,
  stageForWeek,
  stageSessionNotes,
  crossTrainNotes,
  WALK_RUN_LADDER,
  MAX_WALK_RUN_STAGE,
  ALTERNATE_DAY_THROUGH_STAGE,
  INJURY_PLAN_MAX_WEEKS,
} from './injury-protocols';
import { injuryWeekShape } from './injury-builder';

const SAT = 6; // loadSettings default rest day

const resolve = (site: string, severity: 'minor' | 'moderate' | 'major' = 'moderate', notes?: string) =>
  resolveInjuryProtocol({ site, notes: notes ?? null, returnProtocol: null, severity });

/** Every day of every week of a whole plan, as the builder would write it. */
function wholePlan(site: string, severity: 'minor' | 'moderate' | 'major' = 'moderate', notes?: string) {
  const r = resolve(site, severity, notes);
  const weeks = [];
  for (let wi = 0; wi < r.planWeeks; wi++) weeks.push(injuryWeekShape(wi, r, SAT, null));
  return { resolved: r, weeks };
}

const isRunningRow = (d: { type: string; distance_mi: number }) =>
  d.type !== 'rest' || d.distance_mi > 0;

describe('INJURY-1 · doctrine conformance · Research/05 §§1, 9', () => {
  // ── The single most dangerous case ──────────────────────────────────
  describe('bone stress injury emits no running at all (:463)', () => {
    const bsiCases: Array<[string, string | undefined, string]> = [
      ['foot', 'suspected navicular stress fracture', 'bsi_high'],
      ['shin', 'anterior tibial cortex stress fracture, dreaded black line', 'bsi_high'],
      ['foot', 'Jones fracture', 'bsi_high'],
      ['hip', 'femoral neck stress fracture', 'bsi_high'],
      ['shin', 'posteromedial tibial shaft stress reaction', 'bsi_low'],
      ['shin', 'possible stress reaction', 'bsi_suspected'],
      ['foot', 'focal bone tenderness, positive hop test', 'bsi_suspected'],
    ];

    for (const [site, notes, expectedKey] of bsiCases) {
      it(`${notes ?? site} → ${expectedKey} · zero running rows`, () => {
        const { resolved, weeks } = wholePlan(site, 'moderate', notes);
        expect(
          resolved.protocol.key,
          `Research/05:440-454 stratifies BSI by site; "${notes}" must not fall through to a soft-tissue ladder`,
        ).toBe(expectedKey);
        expect(
          resolved.clearanceRequired,
          'Research/05:463 · "All confirmed BSIs: no running until clinical clearance."',
        ).toBe(true);
        expect(resolved.runStartWeek).toBeNull();
        const running = weeks.flat().filter(isRunningRow);
        expect(
          running,
          `Research/05:463 · a BSI plan may contain no running row in any week; found ${running.length}`,
        ).toEqual([]);
        expect(resolved.protocol.clearanceGate).toBeTruthy();
      });
    }

    it('the shipped defect · a navicular BSI is never a three-week walk-run plan (:447, :487)', () => {
      const r = resolve('foot', 'moderate', 'suspected navicular stress fracture');
      // :487 · "Total return commonly 4-9 months" = 16-39 weeks.
      expect(r.protocol.totalWeeks).toEqual([16, 39]);
      expect(r.planWeeks).toBeGreaterThan(4); // the old builder's ceiling
      expect(stageForWeek(r, 0)).toBeNull();
      expect(stageForWeek(r, 11)).toBeNull();
    });

    it('high-risk BSI cross-training is non-weight-bearing, low-risk is non-impact (:65-66)', () => {
      // :66 "High-risk BSI | Non-weight-bearing only until clinician clears."
      const high = resolve('foot', 'moderate', 'navicular stress fracture');
      expect(high.protocol.crossTrain).toBe('non_weight_bearing');
      expect(crossTrainNotes(high.protocol.crossTrain).toLowerCase()).toContain('non-weight-bearing');
      // :65 "Low-risk BSI | Non-impact only (pool, cycle, elliptical)".
      const low = resolve('shin', 'moderate', 'posteromedial tibial shaft stress reaction');
      expect(low.protocol.crossTrain).toBe('non_impact');
    });

    it('low-risk BSI carries the 8-16 week band (:475)', () => {
      const r = resolve('shin', 'moderate', 'metatarsal 3 stress fracture');
      expect(r.protocol.totalWeeks).toEqual([8, 16]);
    });
  });

  // ── Length comes from the site, not from the severity enum ──────────
  describe('plan length is site-driven (:475, :487, §§2-19 tables)', () => {
    it('different sites produce materially different lengths', () => {
      // The old builder returned 3 for every one of these at severity
      // 'moderate'. Each number below is the low end of that site's own
      // doctrine band, capped at INJURY_PLAN_MAX_WEEKS.
      const expected: Record<string, number> = {
        calf: 4,                    // :620 · grade I 2-4 weeks, grade II 4-8
        hip: 6,                     // :659-663 · hip flexor · phases to 6-8 weeks
        achilles: 12,               // :190-196 · phases to 11-12+
        shin: 12,                   // :406-411 · phases to 8-14
        knee: 9,                    // :313-321 · PFPS · phases to 9+
        'plantar fascia': 12,       // :141-148 · phases to 11-12+
      };
      for (const [site, weeks] of Object.entries(expected)) {
        expect(resolve(site).planWeeks, `${site} · Research/05 §§2-19 site table`).toBe(weeks);
      }
      const distinct = new Set(Object.keys(expected).map((s) => resolve(s).planWeeks));
      expect(distinct.size, 'a severity enum cannot express six different site protocols').toBeGreaterThan(3);
    });

    it('severity moves within the site band, it does not set it', () => {
      // Calf: :620 gives 2-4 (grade I) and 4-8 (grade II). Minor takes
      // the low end of the encoded band, major the high end.
      expect(resolve('calf', 'minor').planWeeks).toBe(4);
      expect(resolve('calf', 'major').planWeeks).toBe(8);
      // And no severity may exceed the window we actually write rows for.
      for (const sev of ['minor', 'moderate', 'major'] as const) {
        expect(resolve('achilles', sev).planWeeks).toBeLessThanOrEqual(INJURY_PLAN_MAX_WEEKS);
      }
    });

    it('site reaches the prescription · first running week differs by site', () => {
      // :313 PFPS runs from day one (pain-guided). :141-148 plantar
      // fasciopathy is walking only for four weeks.
      expect(resolve('knee').runStartWeek).toBe(0);
      expect(resolve('achilles').runStartWeek).toBe(2);
      expect(resolve('plantar fascia').runStartWeek).toBe(4);
      expect(resolve('foot', 'moderate', 'navicular stress fracture').runStartWeek).toBeNull();
    });

    it('a 7-10/10 shin takes the far end of the pain-dependent band (:407)', () => {
      // §8.4 phase 1 is "2-6 weeks (pain-dependent)". A major shin is
      // additionally the presentation :425 sends for imaging, so it
      // escalates to suspected BSI and stops running entirely.
      expect(resolve('shin', 'minor').runStartWeek).toBe(2);
      const major = resolve('shin', 'major');
      expect(major.protocol.riskClass).toBe('bsi_suspected');
      expect(major.runStartWeek).toBeNull();
    });
  });

  // ── The walk-run ladder itself ──────────────────────────────────────
  describe('walk-run ladder matches the eight-stage table (:21-30)', () => {
    it('every row is the research row', () => {
      const table = [
        [1, 1, 4, 5, 5], [2, 2, 3, 5, 10], [3, 3, 2, 5, 15], [4, 4, 2, 4, 16],
        [5, 5, 1, 4, 20], [6, 8, 2, 3, 24], [7, 12, 2, 2, 24],
      ];
      for (const [stage, run, walk, reps, total] of table) {
        const s = WALK_RUN_LADDER[stage - 1];
        expect([s.stage, s.runMin, s.walkMin, s.repeats, s.totalRunMin],
          `Research/05:21-30 stage ${stage}`).toEqual([stage, run, walk, reps, total]);
      }
      // Stage 8 is "25-30 (continuous)".
      const eight = WALK_RUN_LADDER[7];
      expect(eight.continuous).toBe(true);
      expect(eight.totalRunMin).toBeGreaterThanOrEqual(25);
      expect(eight.totalRunMin).toBeLessThanOrEqual(30);
      expect(WALK_RUN_LADDER.length).toBe(MAX_WALK_RUN_STAGE);
    });

    it('sessions per week never exceed the table (:23-30)', () => {
      // 3/wk at stages 1-3, "3-4" at 4-7 (we take the conservative low
      // end), 4 at stage 8.
      for (const s of WALK_RUN_LADDER) {
        expect(s.sessionsPerWk, `Research/05:21-30 stage ${s.stage}`).toBeLessThanOrEqual(4);
        expect(s.sessionsPerWk).toBeGreaterThanOrEqual(3);
      }
      expect(WALK_RUN_LADDER[0].sessionsPerWk).toBe(3);
      expect(WALK_RUN_LADDER[7].sessionsPerWk).toBe(4);
    });

    it('advances one stage at a time, never two (:33)', () => {
      // ":33 Spend at least 2 sessions at each stage before progressing"
      // — at three sessions a week, that is one stage per week.
      const r = resolve('achilles');
      let prev = 0;
      for (let wi = r.runStartWeek!; wi < r.planWeeks; wi++) {
        const s = stageForWeek(r, wi)!;
        expect(s.stage - prev, `week ${wi} jumped more than one stage`).toBeLessThanOrEqual(1);
        prev = s.stage;
      }
      expect(stageForWeek(r, r.runStartWeek!)!.stage).toBe(1);
      expect(prev).toBeLessThanOrEqual(MAX_WALK_RUN_STAGE);
    });

    it('the in-session pain rule uses the research numbers, not 4/10 (:42-45)', () => {
      // 0-2 green, 3-5 amber (hold, do not progress), 6+ red (stop).
      const notes = stageSessionNotes(WALK_RUN_LADDER[0], 'tendinopathy');
      expect(notes).toContain('0-2');
      expect(notes).toContain('3-5');
      expect(notes).toMatch(/6 or more/);
      expect(notes, 'the shipped copy said "Pain >= 4/10 = stop", a threshold Research/05 never states')
        .not.toMatch(/4\/10/);
      // :55 · on a healing bone the threshold is any pain at all.
      expect(stageSessionNotes(WALK_RUN_LADDER[0], 'bsi_low')).toMatch(/any pain/i);
    });
  });

  // ── Placement ───────────────────────────────────────────────────────
  describe('impact sessions are alternate-day (:17)', () => {
    it('no two running days are adjacent through the early stages', () => {
      for (const site of ['achilles', 'calf', 'shin', 'hamstring', 'plantar fascia']) {
        const { resolved, weeks } = wholePlan(site);
        weeks.forEach((days, wi) => {
          const stage = stageForWeek(resolved, wi);
          if (!stage || stage.stage > ALTERNATE_DAY_THROUGH_STAGE) return;
          const runDows = days.filter(isRunningRow).map((d) => d.dow).sort((a, b) => a - b);
          for (let i = 1; i < runDows.length; i++) {
            expect(
              runDows[i] - runDows[i - 1],
              `${site} week ${wi} stage ${stage.stage} · Research/05:17 "every other day during early stages" · running on dows ${runDows.join(',')}`,
            ).toBeGreaterThan(1);
          }
          // And the week must not wrap into a back-to-back pair either.
          if (runDows.length > 1) {
            expect((runDows[0] + 7) - runDows[runDows.length - 1]).toBeGreaterThan(1);
          }
        });
      }
    });

    it('running-day count never exceeds the stage sessions/wk cap (:21-30)', () => {
      for (const site of ['achilles', 'calf', 'knee', 'shin']) {
        const { resolved, weeks } = wholePlan(site);
        weeks.forEach((days, wi) => {
          const stage = stageForWeek(resolved, wi);
          const runDays = days.filter(isRunningRow).length;
          if (!stage) {
            expect(runDays, `${site} week ${wi} is off running`).toBe(0);
          } else {
            expect(runDays, `${site} week ${wi} · stage ${stage.stage} allows ${stage.sessionsPerWk}/wk`)
              .toBeLessThanOrEqual(stage.sessionsPerWk);
          }
        });
      }
    });

    it("a stated weekly_frequency still caps the week", () => {
      const r = resolve('achilles');
      const wk = injuryWeekShape(r.runStartWeek! + 1, r, SAT, 3);
      const active = wk.filter((d) => d.subLabel !== 'REST');
      expect(active.length).toBeLessThanOrEqual(3);
    });

    it('cross-training lands on the off-days, and at least one day is fully off', () => {
      const { resolved, weeks } = wholePlan('achilles');
      for (const days of weeks) {
        const rest = days.filter((d) => d.subLabel === 'REST');
        expect(rest.length, 'recovery is the work · never a seven-day active week').toBeGreaterThanOrEqual(1);
        const runDows = new Set(days.filter(isRunningRow).map((d) => d.dow));
        for (const d of days.filter((x) => x.subLabel === 'CROSS-TRAIN')) {
          expect(runDows.has(d.dow), 'cross-train may not share a day with an impact session').toBe(false);
        }
      }
      // Clearance-gated weeks are cross-training only.
      const bsi = wholePlan('foot', 'moderate', 'navicular stress fracture');
      for (const days of bsi.weeks) {
        expect(days.some((d) => d.subLabel === 'CROSS-TRAIN')).toBe(true);
      }
    });
  });

  // ── Conservative degrade ────────────────────────────────────────────
  describe('doctrine silence degrades to the most conservative rule (:11, :76, :101)', () => {
    it('a site with no Research/05 entry gets the general-principles scaffold', () => {
      const r = resolve('lower back');
      expect(r.protocol.key).toBe('unknown');
      // :11 · the walk-run scaffold covers "any injury that has required
      // a layoff longer than ~2 weeks", so two weeks off running first.
      expect(r.runStartWeek).toBe(2);
      expect(r.protocol.startStage).toBe(1);
      // :76 · "weeks off ≈ weeks to rebuild base".
      expect(r.planWeeks).toBeGreaterThanOrEqual(8);
      expect(r.protocol.citation).toContain('Research/05');
    });

    it('an empty site does not crash and does not start running immediately', () => {
      const r = resolveInjuryProtocol({ site: null, severity: 'moderate' });
      expect(r.protocol.key).toBe('unknown');
      expect(r.runStartWeek).toBe(2);
    });

    it('every protocol carries a line-level citation', () => {
      for (const site of ['achilles', 'calf', 'shin', 'knee', 'hip', 'foot', 'glute', 'hamstring', 'lower back']) {
        expect(resolve(site).protocol.citation, `${site} · every prescription needs a citation`)
          .toMatch(/Research\/05:/);
      }
    });
  });
});
