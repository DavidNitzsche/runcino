/**
 * lib/doctrine/registry.ts · THE DOCTRINE GATE.
 *
 * Every constant in this app that asserts something about human physiology has
 * a justification somewhere in `Research/`. Until now those two things lived in
 * different files with nothing holding them together, and the only mechanism
 * keeping a number honest was that somebody remembered why it was that number.
 *
 * The incident that made this file exist (2026-08-17, fixed in `52174bcd`):
 * post-race recovery for a half marathon prescribed 15 miles across 14 days —
 * five straight rest days — for a 33 mi/wk runner with a goal marathon 16 weeks
 * out. `Research/00b-recovery-protocols.md` has TWO adjacent columns: "total
 * recovery days (no quality)" (half = 10-14) and "days of zero/very-light
 * running" (half = 3-5). The engine encoded the first and spent it as if it
 * were the second, then sized every distance's recovery weeks off the MARATHON
 * reverse taper. Two weeks of no quality became two weeks of no running. The
 * owner found it on his phone. No test caught it, because the existing gates
 * (`_maint_invariants`, `_sweep_allusers`) check plan STRUCTURE — placement,
 * distance, alignment, counts — and nothing checked CONFORMANCE TO DOCTRINE.
 *
 * ── How this works ─────────────────────────────────────────────────────────
 *
 * Each entry names an engine constant, the doctrine file, a VERBATIM anchor
 * string in that file, a plain-English claim, and a `check` that must hold.
 * `_doctrine_gate.test.ts` resolves every anchor against the real file and runs
 * every check.
 *
 * Two rules make the mechanism worth having rather than ceremonial:
 *
 *   · ANCHOR ON QUOTED TEXT, NEVER LINE NUMBERS. Line numbers rot on the next
 *     edit; a table header survives everything except a change to what the
 *     table says — which is precisely when a human should be re-reading.
 *
 *   · READ THE NUMBERS OUT OF THE DOC. Wherever the doctrine states a band, the
 *     check parses that band at run time and compares the engine against it.
 *     A check that hardcodes both sides only proves the test agrees with
 *     itself. `RECOVERY.half-protocol-run-days` is the sharpest example: it
 *     counts the running days in the doc's own 14-day table and asserts the
 *     engine's `RECOVERY_RUN_DAYS.hm` equals that count.
 *
 * ── Adding a claim ─────────────────────────────────────────────────────────
 *
 * See CLAUDE.md §"Doctrine gate". Short version: append an entry. Nothing else
 * needs touching. If your claim reveals a real violation, DO NOT loosen the
 * claim — add an `exempt` key with an honest reason and report it.
 */
import {
  POST_RACE_RECOVERY_WEEKS,
  postRaceRecoveryWeeks,
  RECOVERY_WEEKLY_PCT_OF_BASE,
  RECOVERY_RUN_DAYS,
  RECOVERY_LONG_PCT,
  RECOVERY_EFFORT_SCALE,
  TAPER_RACE_WEEK_PCT_OF_PEAK,
  taperFactor,
  GENERAL_RAMP_CEILING,
  COMEBACK_RAMP_CEILING,
  TIER_TARGETS,
  MAINTENANCE_BY_TIER,
  type DistCategory,
  type GoalTier,
} from '@/lib/plan/goal-tiers';
import { VDOT_FULL_VALUE_DAYS, VDOT_EXPIRY_DAYS, FADE_TAIL_DAYS } from '@/lib/training/vdot';
import { expectedDaysForAnchor } from '@/lib/coach/recovery-phase';
import {
  GAP_SHAVE_FRACTIONS,
  RERAMP_RESUME_FRACTION,
  RERAMP_WEEKLY_GROWTH,
  classifyGapBand,
} from '@/lib/plan/adapt';
import { EASY_SHARE_FLOOR } from '@/lib/plan/intensity-distribution';
import { qualityFamilyFor } from '@/lib/plan/generate';
import {
  STRIDE_DURATION_S,
  STRIDE_RECOVERY_S,
  STRIDE_DEFAULT_REPS,
  STRIDE_DAYS_PER_WEEK,
} from '@/lib/plan/spec-builder';
import {
  GRADE_COST_PER_PCT,
  GRADE_MODEL_MAX_PCT,
  DESCENT_GIVEBACK_FRACTION,
  TREADMILL_AIR_RESISTANCE_GRADE_PCT,
  TREADMILL_COST_PER_PCT,
  composeEffortFactor,
  gradeFactor,
  treadmillEffectiveGradePct,
} from '@/lib/terrain/grade-adjust';
import { friel7Zones, lthrZones, pctMaxZones } from '@/lib/training/zones';
import { lthrFromMaxHr } from '@/lib/training/lthr';
import {
  EASY_HRMAX_CEILING_PCT,
  HEAT_CONFOUND_TEMP_C,
  DRIFT_CONFOUND_MINUTES,
  TERRAIN_CONFOUND_GAP_PCT,
  TERRAIN_CONFOUND_FT_PER_MI,
  OVER_CEILING_MAJORITY,
  raceWindowFor,
} from '@/lib/coach/easy-discipline';
import { vdotFromRace } from '@/lib/training/vdot';
import {
  READINESS_WEIGHTS,
  LOAD_CONTEXT_MULTIPLIER,
  loadContextMultiplier,
  computeReadiness,
} from '@/lib/coach/readiness';
import {
  ACWR_BANDS,
  SLEEP_FLOOR_TOLERANCE_H,
  SLEEP_TARGET_BY_MPW,
  sleepFloorForMileage,
  tierRulesFor,
  type ExperienceLevel,
} from '@/lib/coach/tier-rules';
import {
  GRADE_COST_PER_PCT as ELEV_GRADE_COST_PER_PCT,
  DESCENT_RECOVERY_FRACTION,
  MAX_DESCENT_CREDIT_S_PER_MI,
  DESCENT_HARD_CAP_S_PER_MI,
} from '@/lib/training/elevation-model';
import {
  dewpointAddPct,
  INTERVAL_ADJUSTMENT_FACTOR,
  effortSlowdownPct,
} from '@/lib/training/heat-model';
import { WBGT_FLAGS, heatBandForFlag } from '@/lib/coach/heat-gate';
import { HEAT_HR_CONFOUNDER, heatHrBumpBpm } from '@/lib/weather/heat-adjustment';
import type { DoctrineClaim } from './types';
import { matchLiteral, parseBand, parsePaceBandSec, parsePctBand, resolveCitation, sourceOf } from './resolve';

const CATS: DistCategory[] = ['5k', '10k', 'hm', 'm', 'ultra'];
const TIERS: GoalTier[] = ['elite', 'advanced', 'intermediate', 'developing'];

/** DistCategory → the row label it maps to in the Research/ distance tables. */
const DOC_ROW: Record<DistCategory, string> = {
  '5k': '5K',
  '10k': '10K',
  hm: 'Half marathon',
  m: 'Marathon',
  ultra: '50K',
};

function within(value: number, [lo, hi]: [number, number], what: string): void {
  if (value < lo || value > hi) {
    throw new Error(`${what}: engine has ${value}, doctrine says ${lo}–${hi}`);
  }
}

function atMost(value: number, ceiling: number, what: string): void {
  if (value > ceiling) {
    throw new Error(`${what}: engine has ${value}, doctrine ceiling is ${ceiling}`);
  }
}


/** Research/00a §"Volume progression rules" long-run cap, as a fraction band. */
function resolveShareCap(): [number, number] {
  const cite = resolveCitation('Research/00a-distance-running-training.md', '### Volume progression rules');
  const spec = cite.table().cell('Long-run cap', 'Specification');
  const [lo, hi] = parseBand(spec);
  return [lo / 100, hi / 100];
}

export const DOCTRINE_REGISTRY: DoctrineClaim[] = [
  // ══ RECOVERY · the incident ═══════════════════════════════════════════════
  {
    id: 'RECOVERY.post-race-duration',
    binds: ['lib/plan/goal-tiers.ts#POST_RACE_RECOVERY_WEEKS'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'How long a runner stays off quality work after a race is set per distance by the ' +
      '"total recovery days (no quality)" column. The engine expresses it in whole weeks, ' +
      'so each value must land inside its distance band once converted to days. The single ' +
      'ultra bucket spans four doctrine rows (50K through 100-mile) and is checked against ' +
      'the widest of them.',
    check({ cite, exempt }) {
      const t = cite.table();
      const col = 'Total recovery days (no quality)';
      for (const cat of CATS) {
        const days = POST_RACE_RECOVERY_WEEKS[cat] * 7;
        const band =
          cat === 'ultra'
            ? ([parseBand(t.cell('50K', col))[0], parseBand(t.cell('100-mile', col))[1]] as [number, number])
            : parseBand(t.cell(DOC_ROW[cat], col));
        if (days < band[0] && exempt(`floor-${cat}`)) continue;
        within(days, band, `POST_RACE_RECOVERY_WEEKS.${cat} = ${days} days`);
      }
    },
    exempt: {
      'floor-5k':
        '5K doctrine is 3-5 days, which is not expressible in whole weeks: 0 undershoots by ' +
        '3 days, 1 overshoots the ceiling by 2. The engine takes 0 because over-resting a 5K ' +
        'runner costs a whole training week, and the sub-week protocol is carried by the ' +
        'day-level recovery composer rather than the plan-mode gate.',
    },
  },
  {
    id: 'RECOVERY.zero-running-days',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_RUN_DAYS'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'The second column is a SEPARATE, much shorter quantity: days of zero or very-light ' +
      'running. Reading the first column as if it were this one is the exact defect that ' +
      'shipped. Rest days in the first recovery week must fall inside this band — neither ' +
      'fewer (under-recovered) nor more (the shipped bug).',
    check({ cite, exempt }) {
      const t = cite.table();
      const col = 'Days of zero/very-light running';
      for (const cat of CATS) {
        if (POST_RACE_RECOVERY_WEEKS[cat] === 0 && exempt(`unreachable-${cat}`)) continue;
        const restDays = 7 - RECOVERY_RUN_DAYS[cat][0];
        within(restDays, parseBand(t.cell(DOC_ROW[cat], col)), `${cat} recovery week 1 rest days`);
      }
    },
    exempt: {
      'unreachable-5k':
        'POST_RACE_RECOVERY_WEEKS["5k"] is 0, so no 5K recovery week is ever composed and ' +
        'RECOVERY_RUN_DAYS["5k"] is unreachable. It is kept for shape symmetry. If a 5K ' +
        'recovery week is ever enabled, delete this exemption first — the profile currently ' +
        'gives 3 rest days against a doctrine band of 1-2.',
    },
  },
  {
    id: 'RECOVERY.half-protocol-run-days',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_RUN_DAYS'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Half Marathon Recovery (14-day)',
    claim:
      'The half has its own day-by-day protocol, and it is not a shutdown: day 3 a jog, day ' +
      '4 easy, day 6 easy plus strides, day 7 a medium-long, then most of the second week. ' +
      "The engine's running-day counts are read straight off that table — a doc edit that " +
      'adds or removes a running day must move the constant with it.',
    check({ cite }) {
      const t = cite.table();
      const runs = (from: number, to: number) =>
        t.rows.filter((r) => {
          const day = Number(r.Day);
          if (!Number.isFinite(day) || day < from || day > to) return false;
          const s = r.Session ?? '';
          return !/^rest/i.test(s) && !/^resume/i.test(s);
        }).length;
      const [wk1, wk2] = [runs(1, 7), runs(8, 13)];
      if (RECOVERY_RUN_DAYS.hm[0] !== wk1 || RECOVERY_RUN_DAYS.hm[1] !== wk2) {
        throw new Error(
          `RECOVERY_RUN_DAYS.hm is [${RECOVERY_RUN_DAYS.hm}], but the 14-day protocol in ` +
            `${cite.doc} prescribes running on ${wk1} days in week 1 and ${wk2} in week 2`,
        );
      }
      if (RECOVERY_WEEKLY_PCT_OF_BASE.hm.length !== 2) {
        throw new Error('the half protocol is a 14-day table · RECOVERY_WEEKLY_PCT_OF_BASE.hm must cover 2 weeks');
      }
    },
  },
  {
    id: 'RECOVERY.marathon-reverse-taper',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_WEEKLY_PCT_OF_BASE'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Marathon Recovery (4-week reverse taper)',
    claim:
      'The marathon (and, by the engine bucketing, the ultra) rebuilds through a four-week ' +
      'reverse taper whose weekly volumes are stated as percentages of peak. Each engine ' +
      'percentage must sit inside its own week band.',
    check({ cite }) {
      const t = cite.table();
      const bands = t.rows.map((r) => parsePctBand(r['Volume vs. peak']));
      for (const cat of ['m', 'ultra'] as const) {
        const seq = RECOVERY_WEEKLY_PCT_OF_BASE[cat];
        if (seq.length !== bands.length) {
          throw new Error(
            `RECOVERY_WEEKLY_PCT_OF_BASE.${cat} has ${seq.length} weeks · the reverse taper in ` +
              `${cite.doc} has ${bands.length}`,
          );
        }
        seq.forEach((pct, i) => within(pct, bands[i], `RECOVERY_WEEKLY_PCT_OF_BASE.${cat} week ${i + 1}`));
      }
    },
  },
  {
    id: 'RECOVERY.sub-marathon-is-a-cutback',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_WEEKLY_PCT_OF_BASE'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'Below the marathon, post-race recovery is a cutback and never a shutdown. A distance ' +
      'whose zero-running band tops out under a week cannot be given marathon-depth volume ' +
      'percentages: the engine must keep every sub-marathon recovery week at or above half ' +
      'of base. This is the invariant the shipped defect broke.',
    check({ cite }) {
      const t = cite.table();
      for (const cat of ['5k', '10k', 'hm'] as const) {
        const zeroDays = parseBand(t.cell(DOC_ROW[cat], 'Days of zero/very-light running'));
        if (zeroDays[1] >= 7) continue; // doctrine really does want a week off · not our case
        for (const [i, pct] of RECOVERY_WEEKLY_PCT_OF_BASE[cat].entries()) {
          if (pct < 0.5) {
            throw new Error(
              `RECOVERY_WEEKLY_PCT_OF_BASE.${cat} week ${i + 1} is ${pct} of base · doctrine ` +
                `allows only ${zeroDays[0]}-${zeroDays[1]} very-light days for this distance, ` +
                'so a week at marathon depth would mean near-total rest',
            );
          }
        }
      }
    },
  },
  {
    id: 'RECOVERY.effort-scale',
    binds: [
      'lib/plan/goal-tiers.ts#RECOVERY_EFFORT_SCALE',
      'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
      'lib/plan/goal-tiers.ts#pickPlanMode',
      'lib/plan/generate.ts#composeRecoveryPlan',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Recovery by Effort (A vs. B vs. C Race)',
    claim:
      'Not every race earns the full recovery table. A B race takes 60-70% of A-race recovery ' +
      'duration and a C race 25-50%. The engine scales DURATION, so an A race is exactly 1.0 ' +
      'and the other two sit inside their stated bands — AND the constant is actually SPENT. A ' +
      'scale that is declared and imported nowhere means every tune-up triggers full A-race ' +
      'recovery, which is what shipped when this constant was first added.',
    check({ cite }) {
      const t = cite.table();
      const scale = (row: string) => parsePctBand(t.cell(row, 'Recovery scale'));
      if (RECOVERY_EFFORT_SCALE.A !== 1.0) throw new Error('an A race earns the full table · scale must be 1.0');
      within(RECOVERY_EFFORT_SCALE.B, scale('B race'), 'RECOVERY_EFFORT_SCALE.B');
      within(RECOVERY_EFFORT_SCALE.C, scale('C race / hard workout substitute'), 'RECOVERY_EFFORT_SCALE.C');
      // WIRED: a B race must actually get a shorter hole than an A race.
      for (const cat of CATS) {
        const a = postRaceRecoveryWeeks(cat, 'A');
        const b = postRaceRecoveryWeeks(cat, 'B');
        const c = postRaceRecoveryWeeks(cat, 'C');
        if (a !== POST_RACE_RECOVERY_WEEKS[cat]) {
          throw new Error(`postRaceRecoveryWeeks(${cat}, 'A') is ${a} · an A race earns the full table (${POST_RACE_RECOVERY_WEEKS[cat]})`);
        }
        if (b > a || c > b) {
          throw new Error(`postRaceRecoveryWeeks(${cat}) does not shorten with priority: A=${a} B=${b} C=${c}`);
        }
        if (a >= 2 && b >= a) {
          throw new Error(`postRaceRecoveryWeeks(${cat}, 'B') is ${b} · a B race must be a SHORTER hole than ${a}`);
        }
      }
      // And the two places a recovery window is decided both consult it.
      for (const [file, needle] of [
        ['web-v2/lib/plan/goal-tiers.ts', 'postRaceRecoveryWeeks(lastCat, lastRacePriority)'],
        ['web-v2/lib/plan/generate.ts', 'postRaceRecoveryWeeks(lastCat,'],
      ] as const) {
        if (!sourceOf(file).includes(needle)) {
          throw new Error(`${file} decides a recovery window without the effort scale · it will give a tune-up the full A-race hole`);
        }
      }
    },
  },
  {
    id: 'RECOVERY.denominator-is-peak',
    binds: [
      'lib/plan/goal-tiers.ts#RECOVERY_WEEKLY_PCT_OF_BASE',
      'lib/plan/generate.ts#recentPeakWeeklyMileage',
      'lib/plan/generate.ts#composeRecoveryPlan.peakAnchor',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Marathon Recovery (4-week reverse taper)',
    claim:
      'The reverse taper\'s weekly volumes are stated as a percentage of PEAK — the column ' +
      'header says so in as many words. Multiplying them by a trailing AVERAGE instead lands ' +
      'the whole recovery block roughly a third low, because the four weeks before a marathon ' +
      'are peak-taper-taper-race and their mean is nothing the runner ever trained at. The ' +
      'engine must therefore read a real peak week, and the reader must exist.',
    check({ cite }) {
      if (!/vs\.\s*peak/i.test(cite.table().headers.join(' '))) {
        throw new Error('the reverse-taper column is no longer stated "vs. peak" · re-read the claim');
      }
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      if (!/async function recentPeakWeeklyMileage\(/.test(src)) {
        throw new Error('no peak-week reader in generate.ts · the reverse taper is being multiplied by an average');
      }
      if (/recentPeakWeeklyMi: inputs\.compose\.recentWeeklyMi\b/.test(src)) {
        throw new Error(
          'recentPeakWeeklyMi is wired to the 28-day mean again ("proxy when peak unknown") · ' +
            'a percentage of peak multiplied by an average is not a percentage of peak',
        );
      }
      if (!/recentPeakWeeklyMi: Math\.max\(recentPeakWeeklyMi,/.test(src)) {
        throw new Error('composeRecoveryPlan is no longer fed the real peak week');
      }
    },
  },
  {
    id: 'RECOVERY.quality-ready-day',
    binds: ['lib/coach/recovery-phase.ts#expectedDays'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Distance | Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'The day a runner may next do quality work after a race is a column in the distance ' +
      'table — "Return to quality workouts" — and the coach surface must read it. It used to ' +
      'answer day 5 for a half while the plan engine, reading the SAME document one column ' +
      'over, held quality for 14 days. One runner, two surfaces, opposite advice. The surface ' +
      'may take the earliest day its band allows, never earlier, and never later than the ' +
      'band ends.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Return to quality workouts';
      const probe: [DistCategory, number][] = [['5k', 3.1], ['10k', 6.2], ['hm', 13.1], ['m', 26.2]];
      for (const [cat, mi] of probe) {
        const cell = t.cell(DOC_ROW[cat], col);
        // Marathon is stated in WEEKS ("Week 3-4"); the rest in days.
        const mult = /week/i.test(cell) ? 7 : 1;
        const [lo, hi] = parseBand(cell).map((n) => n * mult) as [number, number];
        within(expectedDaysForAnchor('race', mi), [lo, hi], `recovery-phase quality-ready day after a ${cat}`);
      }
      // And it must not contradict the plan engine, which holds quality for the
      // whole of POST_RACE_RECOVERY_WEEKS.
      for (const [cat, mi] of probe) {
        const engineDays = POST_RACE_RECOVERY_WEEKS[cat] * 7;
        if (engineDays > 0 && expectedDaysForAnchor('race', mi) * 2 < engineDays) {
          throw new Error(
            `recovery-phase says quality-ready on day ${expectedDaysForAnchor('race', mi)} after a ${cat} ` +
              `while the plan engine holds quality for ${engineDays} days · the two surfaces disagree`,
          );
        }
      }
    },
  },

  // ══ TAPER ═════════════════════════════════════════════════════════════════
  {
    id: 'TAPER.duration-by-distance',
    binds: ['lib/plan/generate.ts#BLOCK_SHAPE.taperWeeks'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | Taper length | Volume reduction (peak week) |',
    claim:
      'Taper length rises with race distance: days for a 5K, three weeks for a marathon. ' +
      'The engine plans in whole weeks, so each value must be a whole-week rounding of the ' +
      'doctrine band for that distance.',
    check({ cite }) {
      const t = cite.table();
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const docRow: Record<DistCategory, string> = { ...DOC_ROW, ultra: 'Ultra (50K-100M)' };
      for (const cat of CATS) {
        const m = matchLiteral(
          src,
          new RegExp(`'${cat}':\\s*\\{\\s*taperWeeks:\\s*(\\d+)`),
          `BLOCK_SHAPE['${cat}'].taperWeeks`,
        );
        const weeks = Number(m[1]);
        const [lo, hi] = parseBand(t.cell(docRow[cat], 'Taper length'));
        within(weeks, [Math.ceil(lo / 7), Math.ceil(hi / 7)], `BLOCK_SHAPE['${cat}'].taperWeeks`);
      }
    },
  },
  {
    id: 'TAPER.depth-per-week',
    binds: [
      'lib/plan/goal-tiers.ts#TAPER_RACE_WEEK_PCT_OF_PEAK',
      'lib/plan/goal-tiers.ts#taperFactor',
      'lib/plan/generate.ts#volumeCurve',
      'lib/plan/generate.ts#finalizeComposedPlan',
    ],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | Taper length | Volume reduction (peak week) |',
    claim:
      'How deep the taper cuts is set PER DISTANCE: a 5K sheds a quarter to a third of peak ' +
      'volume, a marathon nearly half, an ultra more. The race-week factor for every distance ' +
      'must land inside its own row of the reduction table — and there must be exactly ONE ' +
      'model, called from both places the engine writes a taper, because the defect this ' +
      'replaces was the marathon row hardcoded at two sites and applied to all five distances.',
    check({ cite }) {
      const t = cite.table();
      const docRow: Record<DistCategory, string> = { ...DOC_ROW, ultra: 'Ultra (50K-100M)' };
      for (const cat of CATS) {
        // §9.1 states the REDUCTION; the engine stores what REMAINS.
        const [cutLo, cutHi] = parsePctBand(t.cell(docRow[cat], 'Volume reduction (peak week)'));
        const remains: [number, number] = [1 - cutHi, 1 - cutLo];
        within(TAPER_RACE_WEEK_PCT_OF_PEAK[cat], remains, `TAPER_RACE_WEEK_PCT_OF_PEAK.${cat}`);
        // taperFactor must agree with the table at the race week, and must
        // DESCEND monotonically toward it from further out. A taper that goes
        // back up is not a taper.
        if (taperFactor(cat, 1) !== TAPER_RACE_WEEK_PCT_OF_PEAK[cat]) {
          throw new Error(`taperFactor(${cat}, 1) does not equal the race-week depth for that distance`);
        }
        for (const w of [2, 3]) {
          if (taperFactor(cat, w) <= taperFactor(cat, w - 1)) {
            throw new Error(`taperFactor(${cat}) does not descend between ${w} and ${w - 1} weeks out`);
          }
          if (taperFactor(cat, w) > 1) throw new Error(`taperFactor(${cat}, ${w}) exceeds peak volume`);
        }
      }
      // ONE model, both sites. The two hardcoded ternaries are gone; both
      // callers now go through goal-tiers' taperFactor.
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const calls = [...src.matchAll(/taperFactor\(taperCat, wksLeft\)/g)].length;
      if (calls < 2) {
        throw new Error(
          `expected both the volumeCurve and finalizeComposedPlan sites to call the shared ` +
            `taperFactor model · found ${calls}`,
        );
      }
      if (/wksLeft === 1 \? [\d.]+ : wksLeft === 2 \?/.test(src)) {
        throw new Error('a hardcoded taper-factor ternary is back in generate.ts · it must read the shared model');
      }
    },
  },
  {
    id: 'TAPER.marathon-descent-shape',
    binds: ['lib/plan/goal-tiers.ts#taperFactor'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.2 Marathon taper structure (3 weeks)',
    claim:
      'The marathon is the one distance whose week-by-week descent doctrine states outright: ' +
      '80-90% of peak three weeks out, 60-70% two weeks out, 40-50% race week. The shared ' +
      'descent shape every distance is rescaled from is the marathon\'s own, so the marathon ' +
      'must reproduce all three of its bands exactly.',
    check({ cite }) {
      const t = cite.table();
      const bandFor = (wk: string) => parsePctBand(t.cell(wk, 'Volume'));
      within(taperFactor('m', 3), bandFor('-3'), 'marathon taper factor, three weeks out');
      within(taperFactor('m', 2), bandFor('-2'), 'marathon taper factor, two weeks out');
      within(taperFactor('m', 1), bandFor('-1'), 'marathon taper factor, race week');
    },
  },
  {
    id: 'TAPER.validator-band-is-two-sided',
    binds: [
      'lib/plan/validate.ts#CONSTRAINTS.taperDropMinPct',
      'lib/plan/validate.ts#CONSTRAINTS.taperDropMaxPct',
    ],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | Taper length | Volume reduction (peak week) |',
    claim:
      'Every doctrine band has two ends and the validator must check both. The floor may not ' +
      'be stricter than the shallowest reduction doctrine allows for that distance (a validator ' +
      'demanding more than doctrine rejects correct plans) and may never be zero. The CEILING ' +
      'is the deepest reduction the row allows — without it, a taper that cuts a 5K by 55% ' +
      'passes clean, which is exactly how the marathon row survived being applied to all five ' +
      'distances.',
    check({ cite }) {
      const t = cite.table();
      const src = sourceOf('web-v2/lib/plan/validate.ts');
      const docRow: Record<DistCategory, string> = { ...DOC_ROW, ultra: 'Ultra (50K-100M)' };
      for (const cat of CATS) {
        const row = new RegExp(
          `'${cat}':\\s*\\{[^}]*taperDropMinPct:\\s*(\\d+)[^}]*taperDropMaxPct:\\s*(\\d+)`,
        );
        const m = matchLiteral(src, row, `CONSTRAINTS['${cat}'] taper band`);
        const [floorPct, ceilPct] = [Number(m[1]), Number(m[2])];
        const [lo, hi] = parseBand(t.cell(docRow[cat], 'Volume reduction (peak week)'));
        if (floorPct <= 0) throw new Error(`CONSTRAINTS['${cat}'].taperDropMinPct is ${floorPct} · a taper must drop volume`);
        atMost(floorPct, lo, `CONSTRAINTS['${cat}'].taperDropMinPct`);
        if (ceilPct !== hi) {
          throw new Error(
            `CONSTRAINTS['${cat}'].taperDropMaxPct is ${ceilPct} · doctrine's deepest stated ` +
              `reduction for this distance is ${hi}%`,
          );
        }
        if (floorPct >= ceilPct) {
          throw new Error(`CONSTRAINTS['${cat}'] taper band is inverted: floor ${floorPct} ≥ ceiling ${ceilPct}`);
        }
      }
    },
  },

  // ══ LONG RUN · ABSOLUTE TIME ══════════════════════════════════════════════
  {
    id: 'LONGRUN.absolute-time-cap',
    binds: ['lib/plan/generate.ts#LONG_RUN_MAX_HOURS', 'lib/plan/generate.ts#layoutWeek'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      "Doctrine's long-run cap has two clauses and the second is an ABSOLUTE TIME bound: " +
      '"or by absolute time: <3.0-3.5 h for marathoners". The engine cited that clause as its ' +
      'reason for letting the marathon long exceed the percentage cap, and never implemented ' +
      'it — so the bound doing the permitting did no bounding. The ceiling is read out of the ' +
      'doctrine cell, and the cap is actually applied against the runner\'s own easy pace.',
    check({ cite }) {
      const spec = cite.table().cell('Long-run cap', 'Specification');
      // The parenthetical carries the hours; parseBand strips parentheses, so
      // read the clause directly.
      const clause = spec.match(/absolute time:\s*[^)]*/i);
      if (!clause) {
        throw new Error('the long-run cap no longer states an absolute-time alternative · re-read the claim');
      }
      const hours = parseBand(clause[0].replace(/[–—]/g, '-'));
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const engine = Number(matchLiteral(src, /const LONG_RUN_MAX_HOURS = (\d*\.?\d+);/, 'LONG_RUN_MAX_HOURS')[1]);
      within(engine, hours, 'LONG_RUN_MAX_HOURS');
      // And it is WIRED. A ceiling nobody multiplies by is the defect this claim exists for.
      if (!/LONG_RUN_MAX_HOURS \* 3600/.test(src)) {
        throw new Error('LONG_RUN_MAX_HOURS is declared but never applied to a long run · implement the cap or delete it');
      }
    },
  },

  // ══ WEEKLY RAMP ═══════════════════════════════════════════════════════════
  {
    id: 'RAMP.ten-percent-is-regime-specific',
    binds: [
      'lib/plan/goal-tiers.ts#COMEBACK_RAMP_CEILING',
      'lib/plan/adapt.ts#RERAMP_WEEKLY_GROWTH',
      'lib/plan/seed-from-onboarding.ts#buildProgressiveCurve',
    ],
    doc: 'Research/05-injury-return-protocols.md',
    anchor: 'weekly mileage +≤10%/week',
    claim:
      'The ten-percent rule is doctrine for COMEBACK regimes — injury return, post-layoff, ' +
      'youth — and the engine holds those paths to it exactly, reading the number out of the ' +
      'doctrine sentence. It is NOT the general-case ramp; see RAMP.general-case-ceiling for ' +
      'why, and note that the doc states it as "convention, not strongly evidence-supported ' +
      'but a reasonable safety margin", which is an honest basis for a comeback cap and not ' +
      'for a universal one.',
    check({ cite }) {
      const stated = parseBand(cite.section[0].replace(/.*weekly mileage \+/, ''))[0];
      const ceiling = 1 + stated / 100;
      if (COMEBACK_RAMP_CEILING !== ceiling) {
        throw new Error(`COMEBACK_RAMP_CEILING is ${COMEBACK_RAMP_CEILING} · doctrine states ${ceiling}`);
      }
      atMost(RERAMP_WEEKLY_GROWTH, ceiling, 'RERAMP_WEEKLY_GROWTH');
      const seed = Number(
        matchLiteral(
          sourceOf('web-v2/lib/plan/seed-from-onboarding.ts'),
          /current \* (\d*\.?\d+)\)\);/,
          'buildProgressiveCurve',
        )[1],
      );
      atMost(seed, ceiling, 'onboarding-seed weekly ramp factor');
    },
  },
  {
    id: 'RAMP.general-case-ceiling',
    binds: [
      'lib/plan/goal-tiers.ts#GENERAL_RAMP_CEILING',
      'lib/plan/generate.ts#volumeCurve.climbFactor',
      'lib/plan/validate.ts#safe-ramp ceiling',
    ],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'For a runner who is not coming back from anything, doctrine\'s general ramp figures are ' +
      'in the base-growth row: trained athletes 5-15%, novices "safely +20-25% over 8 weeks". ' +
      'The engine\'s per-experience ceiling must sit inside those figures — no higher than the ' +
      'novice number doctrine actually reports for a novice, no higher than the trained number ' +
      'for everyone else, and never below the comeback cap (a healthy runner may not be held ' +
      'to a stricter ramp than someone returning from injury). Both places the app bounds a ' +
      'ramp — the generator and the validator that judges it — must read this same table, ' +
      'because "one doctrinal quantum, N disagreeing constants" is how the validator ended up ' +
      'rejecting plans the generator was correctly authoring.',
    check({ cite }) {
      const spec = cite.table().cell('Year-on-year base growth', 'Specification');
      const trained = parseBand(spec.split(';')[0]);            // 5-15
      const novice = parseBand(spec.replace(/^[^;]*;\s*/, ''));  // 20-25
      const trainedCeil = 1 + trained[1] / 100;
      const noviceCeil = 1 + novice[1] / 100;
      for (const [level, v] of Object.entries(GENERAL_RAMP_CEILING)) {
        const ceiling = level === 'beginner' ? noviceCeil : trainedCeil;
        atMost(v, ceiling, `GENERAL_RAMP_CEILING.${level}`);
        if (v < COMEBACK_RAMP_CEILING) {
          throw new Error(
            `GENERAL_RAMP_CEILING.${level} is ${v}, below the ${COMEBACK_RAMP_CEILING} comeback ` +
              'cap · a healthy runner may not ramp more slowly than an injury return',
          );
        }
      }
      // A novice ramps at least as fast as a trained runner · that is the whole
      // point of the exception doctrine records.
      if (GENERAL_RAMP_CEILING.beginner < GENERAL_RAMP_CEILING.intermediate) {
        throw new Error('GENERAL_RAMP_CEILING gives a novice a stricter ramp than a trained runner · doctrine says the opposite');
      }
      // Both bounding sites read the table · neither hardcodes a factor.
      for (const file of ['web-v2/lib/plan/generate.ts', 'web-v2/lib/plan/validate.ts']) {
        if (!/GENERAL_RAMP_CEILING\[/.test(sourceOf(file))) {
          throw new Error(`${file} does not read GENERAL_RAMP_CEILING · it is bounding a ramp with its own number`);
        }
      }
      // The dead per-experience table this replaced must stay dead.
      if (/^\s*const RAMP_PCT\b/m.test(sourceOf('web-v2/lib/plan/generate.ts'))) {
        throw new Error('RAMP_PCT is back in generate.ts · the live ramp table is GENERAL_RAMP_CEILING');
      }
    },
  },
  {
    id: 'RAMP.single-session-spike',
    binds: ['lib/plan/generate.ts#rampCeiling'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'A single run beyond 110% of the longest run in the prior 30 days raises overuse-injury ' +
      'risk by about 64%. This — not the weekly ramp — is the load constraint doctrine actually ' +
      'evidences, so the long-run ramp ceiling must not step past that multiple.',
    check({ cite }) {
      const t = cite.table();
      const stated = parseBand(t.cell('Single-session spike threshold', 'Specification'))[0] / 100;
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const seed = Number(matchLiteral(src, /const seed = Math\.round\(recentLongMi \* (\d*\.?\d+)\)/, 'rampCeiling seed')[1]);
      const step = Number(
        matchLiteral(src, /const stepCeil = recentLongMi \* Math\.pow\((\d*\.?\d+),/, 'rampCeiling step')[1],
      );
      atMost(seed, stated, 'long-run ramp seed vs the single-session spike threshold');
      atMost(step, stated, 'long-run per-step ramp vs the single-session spike threshold');
    },
  },

  // ══ CUTBACK / DOWN WEEKS ══════════════════════════════════════════════════
  {
    id: 'CUTBACK.cadence',
    binds: ['lib/plan/generate.ts#cutbackCadence', 'lib/plan/seed-from-onboarding.ts#buildProgressiveCurve'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Frequency',
    claim:
      'A cutback week comes every third or fourth week of load — three for injury-prone, ' +
      'returning, or late-block runners, four for the higher-mileage experienced. Every ' +
      'cadence the engine uses must be one of the cycles doctrine lists.',
    check({ cite }) {
      const cycles = new Set(cite.table().rows.map((r) => parseBand(r.Cycle)[0]));
      const engineCadences = [
        Number(
          matchLiteral(
            sourceOf('web-v2/lib/plan/generate.ts'),
            /tsbAtStart < -10\) \? (\d+) : (\d+)/,
            'cutbackCadence',
          )[1],
        ),
        Number(
          matchLiteral(
            sourceOf('web-v2/lib/plan/generate.ts'),
            /tsbAtStart < -10\) \? \d+ : (\d+)/,
            'cutbackCadence',
          )[1],
        ),
        Number(
          matchLiteral(
            sourceOf('web-v2/lib/plan/seed-from-onboarding.ts'),
            /const cutback = \(i \+ 1\) % (\d+) === 0;/,
            'onboarding seed cutback cadence',
          )[1],
        ),
      ];
      for (const n of engineCadences) {
        if (!cycles.has(n)) {
          throw new Error(
            `a cutback every ${n} weeks is not a cycle doctrine lists (${[...cycles].sort().join(', ')})`,
          );
        }
      }
    },
  },
  {
    id: 'CUTBACK.depth',
    binds: ['lib/plan/generate.ts#volumeCurve.deload', 'lib/plan/seed-from-onboarding.ts#buildProgressiveCurve'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Depth of Cutback by Mileage Tier',
    claim:
      'A cutback cuts 20-30% off the highest week of the preceding block. Shallower and the ' +
      'fatigue does not dissipate; deeper and it stops being a cutback and starts being a ' +
      'rest week, which doctrine explicitly says it is not.',
    check({ cite, exempt }) {
      const t = cite.table();
      const lows = t.rows.map((r) => parseBand(r['% reduction'])[0]);
      const highs = t.rows.map((r) => parseBand(r['% reduction'])[1]);
      const band: [number, number] = [Math.min(...lows) / 100, Math.max(...highs) / 100];
      const sites: [string, string, RegExp][] = [
        ['web-v2/lib/plan/generate.ts', 'volumeCurve deload', /const deload = Math\.round\(lastClimb \* (\d*\.?\d+)\)/],
        [
          'web-v2/lib/plan/seed-from-onboarding.ts',
          'onboarding-seed cutback',
          /volumeMi\.push\(round1\(current \* (\d*\.?\d+)\)\);/,
        ],
      ];
      for (const [file, binding, re] of sites) {
        const factor = Number(matchLiteral(sourceOf(file), re, binding)[1]);
        const cut = Math.round((1 - factor) * 1000) / 1000;
        if (cut < band[0] && exempt(binding)) continue;
        within(cut, band, `${binding} · cuts ${(cut * 100).toFixed(0)}%`);
      }
    },
    exempt: {
      'onboarding-seed cutback':
        'KNOWN VIOLATION (found seeding this registry, 2026-08-17). ' +
        'seed-from-onboarding.ts:197 cuts to 0.82 of the prior week — an 18% reduction, below ' +
        "doctrine's 20% floor and shallower than generate.ts's own 0.80 (which was raised from " +
        '0.85 for exactly this reason, see RC2-4 at generate.ts:794). Not fixed here because ' +
        'this gate is not the place to change generated plans; the engine audit owns it.',
    },
  },

  // ══ LONG RUN ══════════════════════════════════════════════════════════════
  {
    id: 'LONGRUN.share-is-tier-and-distance-dependent',
    binds: ['lib/plan/goal-tiers.ts#TIER_TARGETS.longRunShare'],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 4. Marathon Plans',
    claim:
      'TWO DOCTRINE SOURCES DISAGREE HERE, AND THE OWNER RULED ON THE RECONCILIATION ' +
      '(David, 2026-08-17). Research/00a §"Volume progression rules" caps the long run at ' +
      '25-30% of the week. Research/22\'s own sample peak weeks run far above that at the ' +
      'low-volume end — a Marathon-Beginner long is 20 miles inside a 37-mile week — and ' +
      'settle into 00a\'s band as volume rises. The ruling: "a marathon beginner\'s long run ' +
      'legitimately IS a bigger share of a small week; a 70-mpw runner\'s isn\'t." So the ' +
      'share is a function of tier and distance, read off Research/22\'s actual sample weeks; ' +
      '00a\'s 25-30% governs the higher-volume tiers where the sample plans already agree with ' +
      'it; and the safety bound for the low-volume, slow-runner case is 00a\'s OWN absolute-time ' +
      'clause, checked by LONGRUN.absolute-time-cap. This claim holds the reconciliation to its ' +
      'terms: every share must be under the doctrine row it came from, the shares must DESCEND ' +
      'as the tier rises (that is the whole ruling), and the advanced tiers must land inside ' +
      "00a's band.",
    check({ cite }) {
      // The engine's tiers map onto Research/22's named cohorts.
      const TIER_ROW: Record<string, string> = {
        developing: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
      };
      const DOC_SECTION: Partial<Record<DistCategory, string>> = {
        '5k': '5K', '10k': '10K', hm: 'Half Marathon', m: 'Marathon',
      };
      const doc = cite.doc;
      const all = sourceOf(doc).split('\n');
      /** peak weekly + peak long bands off a "### <Distance> — <Cohort>" block. */
      const rowBands = (distance: string, cohort: string): { weekly: [number, number]; long: [number, number] } => {
        const at = all.findIndex((l) => l.startsWith('### ') && l.includes(distance) && l.includes(cohort));
        if (at < 0) throw new Error(`DOCTRINE · no "### ${distance} — ${cohort}" section in ${doc}`);
        const block = all.slice(at, at + 20);
        const cell = (label: string) => {
          const line = block.find((l) => l.includes(`| ${label} |`));
          if (!line) throw new Error(`DOCTRINE · no "${label}" row under ${distance} — ${cohort} in ${doc}`);
          return line.split('|')[2];
        };
        return { weekly: parseBand(cell('Peak weekly volume')), long: parseBand(cell('Peak long run')) };
      };

      const [ceilLo, ceilHi] = (() => {
        const spec = resolveShareCap();
        return spec;
      })();

      for (const cat of CATS) {
        const section = DOC_SECTION[cat];
        // Ultra rows map to race DISTANCES, not experience tiers, and the
        // back-to-back long option makes a single-run share non-comparable.
        if (!section) continue;
        let prev = Infinity;
        for (const tier of ['developing', 'intermediate', 'advanced'] as const) {
          const share = TIER_TARGETS[cat][tier].longRunShare;
          const { weekly, long } = rowBands(section, TIER_ROW[tier]);
          // Read off the doc: the largest share the row can express — its
          // biggest long inside its smallest week. Research/22 prints a literal
          // sample peak week for several of these cohorts (HM-Advanced is 16 mi
          // in 63, Marathon-Beginner 20 in 37) and every one of them falls
          // inside this bound, so it accommodates the sample weeks the ruling
          // says to derive from while still catching an invented number.
          const docShare = long[1] / weekly[0];
          if (share > docShare + 0.01) {
            throw new Error(
              `TIER_TARGETS.${cat}.${tier}.longRunShare is ${share} · Research/22 ` +
                `§"${section} — ${TIER_ROW[tier]}" implies ${docShare.toFixed(2)}`,
            );
          }
          // THE RULING: the share must fall as the tier rises.
          if (share > prev) {
            throw new Error(
              `TIER_TARGETS.${cat}: ${tier} takes a LARGER long-run share (${share}) than the ` +
                `tier below it (${prev}) · the ruling is that the share shrinks as volume grows`,
            );
          }
          prev = share;
          // And the top tiers land inside 00a's band, where the sample plans agree with it.
          if (tier === 'advanced' && share > ceilHi + 0.005) {
            throw new Error(
              `TIER_TARGETS.${cat}.advanced.longRunShare is ${share} · at this volume the sample ` +
                `plans agree with Research/00a's ${ceilLo * 100}-${ceilHi * 100}% cap`,
            );
          }
        }
        // `elite` has no Research/22 row · hold it to the advanced share.
        if (TIER_TARGETS[cat].elite.longRunShare > TIER_TARGETS[cat].advanced.longRunShare + 0.01) {
          throw new Error(`TIER_TARGETS.${cat}.elite.longRunShare exceeds the advanced tier's · elite trains more volume, not a bigger share`);
        }
      }
    },
  },
  {
    id: 'LONGRUN.recovery-share',
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_LONG_PCT'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'A recovery week is still a training week: its long run obeys the same share ceiling. ' +
      'No recovery profile may schedule a peak-sized long.',
    check({ cite }) {
      const share = parseBand(cite.table().cell('Long-run cap', 'Specification'))[1] / 100;
      for (const cat of CATS) atMost(RECOVERY_LONG_PCT[cat], share, `RECOVERY_LONG_PCT.${cat}`);
    },
  },
  {
    id: 'VOLUME.tier-peak-bands',
    binds: ['lib/plan/goal-tiers.ts#TIER_TARGETS.peakWeeklyMileageBand'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume table',
    claim:
      'Peak weekly volume by race distance has a doctrine range spanning beginner through ' +
      'elite. Every tier band the engine plans to must overlap that range — a tier target ' +
      'outside it is either prescribing volume no cohort trains at or holding a runner below ' +
      'the floor for the distance.',
    check({ cite }) {
      const t = cite.table();
      const docRow: Record<DistCategory, string> = {
        '5k': '5K',
        '10k': '10K',
        hm: 'Half-marathon',
        m: 'Marathon',
        ultra: '50K',
      };
      for (const cat of CATS) {
        const row = t.row(docRow[cat]);
        const cols = t.headers.slice(1);
        const lo = Math.min(...cols.map((c) => parseBand(row[c])[0]));
        const hi = Math.max(...cols.map((c) => parseBand(row[c])[1]));
        for (const tier of TIERS) {
          const [tLo, tHi] = TIER_TARGETS[cat][tier].peakWeeklyMileageBand;
          if (tHi < lo || tLo > hi) {
            throw new Error(
              `TIER_TARGETS.${cat}.${tier}.peakWeeklyMileageBand [${tLo}, ${tHi}] does not overlap ` +
                `the doctrine volume range for ${docRow[cat]} (${lo}-${hi} mi/wk)`,
            );
          }
        }
      }
    },
  },
  {
    id: 'VOLUME.band-floor-is-what-plans-are-built-to',
    binds: [
      'lib/plan/goal-tiers.ts#TIER_TARGETS.peakWeeklyMileageBand',
      'lib/plan/goal-tiers.ts#TIER_TARGETS.peakLongMiBand',
      'lib/plan/generate.ts#volumeCurve.peakTarget',
    ],
    doc: 'Research/22-plan-templates.md',
    anchor: '## 4. Marathon Plans',
    claim:
      'volumeCurve builds to peakWeeklyMileageBand[0], so a band FLOOR set below the doctrine ' +
      "row is not a conservative choice — it is the number the plan reaches. Equally, a band " +
      'CEILING resting exactly on the doctrine row\'s floor caps the peak long at the least ' +
      'doctrine allows. Every tier band must therefore contain its Research/22 row rather than ' +
      'sit under it. This is the shape XTIER-1 fixed for one row in June without sweeping the ' +
      'class, which is how a sub-3 marathoner came to be built to 55 mi/wk against a 65-90 row.',
    check({ cite }) {
      const TIER_ROW: Record<string, string> = {
        developing: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced',
      };
      const DOC_SECTION: Partial<Record<DistCategory, string>> = {
        '5k': '5K', '10k': '10K', hm: 'Half Marathon', m: 'Marathon',
      };
      const all = sourceOf(cite.doc).split('\n');
      const rowBands = (distance: string, cohort: string) => {
        const at = all.findIndex((l) => l.startsWith('### ') && l.includes(distance) && l.includes(cohort));
        if (at < 0) throw new Error(`DOCTRINE · no "### ${distance} — ${cohort}" section in ${cite.doc}`);
        const block = all.slice(at, at + 20);
        const cell = (label: string) => {
          const line = block.find((l) => l.includes(`| ${label} |`));
          if (!line) throw new Error(`DOCTRINE · no "${label}" row under ${distance} — ${cohort}`);
          return line.split('|')[2];
        };
        return { weekly: parseBand(cell('Peak weekly volume')), long: parseBand(cell('Peak long run')) };
      };
      for (const cat of CATS) {
        const section = DOC_SECTION[cat];
        if (!section) continue;   // ultra rows are distance-keyed · see VOLUME.tier-peak-bands
        for (const tier of ['developing', 'intermediate', 'advanced'] as const) {
          const { weekly, long } = rowBands(section, TIER_ROW[tier]);
          const [wLo] = TIER_TARGETS[cat][tier].peakWeeklyMileageBand;
          const [, lHi] = TIER_TARGETS[cat][tier].peakLongMiBand;
          if (wLo < weekly[0]) {
            throw new Error(
              `TIER_TARGETS.${cat}.${tier}.peakWeeklyMileageBand floor is ${wLo} · plans are BUILT ` +
                `to this number and Research/22 §"${section} — ${TIER_ROW[tier]}" says ${weekly[0]}-${weekly[1]}`,
            );
          }
          if (lHi < long[0]) {
            throw new Error(
              `TIER_TARGETS.${cat}.${tier}.peakLongMiBand ceiling is ${lHi}, at or under the ` +
                `doctrine row's FLOOR of ${long[0]} · the XTIER-1 shape`,
            );
          }
        }
      }
    },
  },

  // ══ VDOT ANCHOR FRESHNESS ═════════════════════════════════════════════════
  {
    id: 'VDOT.anchor-freshness-window',
    binds: [
      'lib/training/vdot.ts#VDOT_FULL_VALUE_DAYS',
      'lib/training/vdot.ts#VDOT_EXPIRY_DAYS',
      'lib/training/vdot.ts#bestRecentVdot',
      'lib/training/vdot-inputs.ts#loadVdotInputs',
    ],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '| Time since race | Validity for current fitness                                  |',
    claim:
      'A race result is a reading of fitness ON RACE DAY, and doctrine states exactly how long ' +
      'it stays usable: fresh to 4 weeks, slightly stale to 8, stale to 12 ("use only as a ' +
      'floor"), expired after that ("Don\'t anchor pace prescription on this VDOT"). This one ' +
      'constant sets every prescribed pace for every runner in the app, so the full-value ' +
      'window and the expiry line are read out of the doctrine table rather than chosen: the ' +
      'full-value window is where "still usable" ends, and expiry is where "use only as a ' +
      'floor" ends. No caller may widen them.',
    check({ cite }) {
      const t = cite.table();
      // Rows are stated in weeks; the boundary of each band is its upper edge.
      const upperWeeks = (predicate: RegExp) => {
        const row = t.rows.find((r) => predicate.test(r[t.headers[1]]));
        if (!row) throw new Error(`DOCTRINE · no freshness row matching ${predicate} in ${cite.doc}`);
        return parseBand(row[t.headers[0]])[1];
      };
      const stillUsableDays = upperWeeks(/still usable/i) * 7;              // 8 weeks → 56
      const floorOnlyDays = upperWeeks(/only as a floor/i) * 7;             // 12 weeks → 84
      if (VDOT_FULL_VALUE_DAYS !== stillUsableDays) {
        throw new Error(
          `VDOT_FULL_VALUE_DAYS is ${VDOT_FULL_VALUE_DAYS} · doctrine's "still usable" band ends ` +
            `at ${stillUsableDays} days`,
        );
      }
      if (VDOT_EXPIRY_DAYS !== floorOnlyDays) {
        throw new Error(
          `VDOT_EXPIRY_DAYS is ${VDOT_EXPIRY_DAYS} · doctrine calls an anchor expired after ` +
            `${floorOnlyDays} days`,
        );
      }
      // The doc writes the rule at this engine in prose too · both must agree.
      const stated = resolveCitation(cite.doc, 'use ≤56 days as the canonical freshness window');
      if (!stated.text().includes('canonical freshness window')) {
        throw new Error('the implementation note stating the canonical window has moved · re-read the claim');
      }
      // The fade tail must land exactly on the expiry line, or the loader
      // fetches a band the selector will not honour (or starves one it will).
      if (VDOT_FULL_VALUE_DAYS + FADE_TAIL_DAYS !== VDOT_EXPIRY_DAYS) {
        throw new Error(
          `the fade tail (${FADE_TAIL_DAYS}d) does not carry the full-value window to expiry · ` +
            `${VDOT_FULL_VALUE_DAYS} + ${FADE_TAIL_DAYS} ≠ ${VDOT_EXPIRY_DAYS}`,
        );
      }
      // No caller may pass its own, wider window. The 180-day literal that used
      // to appear at four call sites is the defect this guards.
      for (const file of [
        'web-v2/lib/plan/drift-monitor.ts',
        'web-v2/lib/plan/seed-from-onboarding.ts',
        'web-v2/app/api/cron/snapshot-projections/route.ts',
        'web-v2/app/api/targets/projection/route.ts',
      ]) {
        if (/bestRecentVdot\([^)]*,\s*\d+\s*,/.test(sourceOf(file))) {
          throw new Error(`${file} passes a hardcoded lookback to bestRecentVdot · it must pass VDOT_FULL_VALUE_DAYS`);
        }
      }
    },
  },

  // ══ QUALITY ═══════════════════════════════════════════════════════════════
  {
    id: 'QUALITY.sessions-per-week',
    binds: ['lib/plan/goal-tiers.ts#TIER_TARGETS.qualityPerWeek'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Workout dose by race distance',
    claim:
      'Doctrine gives every road distance a VO2max dose, a threshold dose and a ' +
      'race-specific block, so at least one quality session a week is always warranted, and ' +
      'three is the ceiling any tier runs. Ultra distances get their stimulus from the long ' +
      'run rather than from repetitions, so they cap at one.',
    check({ cite }) {
      const t = cite.table();
      const ultraRows = t.rows.filter((r) => /50K|100K|100 mi/i.test(r.Race));
      const ultraIsLongRunDriven = ultraRows.every((r) => /rarely|sparingly/i.test(r.VO2max));
      for (const cat of CATS) {
        for (const tier of TIERS) {
          const q = TIER_TARGETS[cat][tier].qualityPerWeek;
          if (q < 1) throw new Error(`TIER_TARGETS.${cat}.${tier}.qualityPerWeek is ${q} · doctrine doses every distance`);
          if (q > 3) throw new Error(`TIER_TARGETS.${cat}.${tier}.qualityPerWeek is ${q} · three is the ceiling`);
          if (cat === 'ultra' && ultraIsLongRunDriven && q > 1) {
            throw new Error(
              `TIER_TARGETS.ultra.${tier}.qualityPerWeek is ${q} · doctrine calls ultra VO2max work ` +
                '"rarely" and puts the stimulus in the long run',
            );
          }
        }
      }
    },
  },
  {
    id: 'QUALITY.maintenance-never-two',
    binds: ['lib/plan/goal-tiers.ts#MAINTENANCE_BY_TIER'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Workout dose by race distance',
    claim:
      'With no race in the build window there is nothing to be race-specific for. Maintenance ' +
      'holds at most one quality session a week and never runs VO2max work, which is pure ' +
      'stress with no adaptation target.',
    check() {
      for (const tier of TIERS) {
        const shape = MAINTENANCE_BY_TIER[tier];
        if (shape.qualityPerWeek > 1) {
          throw new Error(`MAINTENANCE_BY_TIER.${tier}.qualityPerWeek is ${shape.qualityPerWeek} · maintenance is at most 1`);
        }
        if (/vo2|interval/i.test(shape.qualityType)) {
          throw new Error(`MAINTENANCE_BY_TIER.${tier}.qualityType is "${shape.qualityType}" · no VO2max work in maintenance`);
        }
      }
    },
  },

  // ══ PACE DERIVATION ═══════════════════════════════════════════════════════
  {
    id: 'PACE.threshold-anchor',
    binds: ['lib/training/vdot.ts#tPaceFromVdot'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Pace conversion from a race time',
    claim:
      'Threshold pace sits between half-marathon and 15K race pace — that is, at or slightly ' +
      'faster than HM pace, never slower. The engine anchors T to predicted HM pace with a ' +
      'small offset in that direction.',
    check({ cite }) {
      if (!/half-marathon pace to 15K pace/i.test(cite.text())) {
        throw new Error('the T-pace relationship no longer reads as half-marathon-to-15K · re-read the claim');
      }
      const off = Number(
        matchLiteral(
          sourceOf('web-v2/lib/training/vdot.ts'),
          /Math\.round\(hmPaceSPerMi - (\d+)\)/,
          'tPaceFromVdot HM offset',
        )[1],
      );
      if (off <= 0) throw new Error('T pace must be at least as fast as HM pace');
      if (off > 30) throw new Error(`T = HM - ${off}s/mi overshoots 15K pace · doctrine bounds T between HM and 15K`);
    },
  },
  {
    id: 'PACE.easy-band-off-threshold',
    binds: ['lib/plan/spec-builder.ts#buildWorkoutSpec.easyLo', 'lib/plan/spec-builder.ts#buildWorkoutSpec.easyHi'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Pace conversion from a race time',
    claim:
      'Research/01:142 gives E = MP + 60-90 s/mi. The engine derives M as T+18 (see ' +
      'PACE.marathon-offset), so that rule is E = T+78..T+108, and the engine emits ' +
      'T+80..T+120: floor +2, ceiling +12, both conservative-slow. RESOLVED 2026-08-17 ' +
      "after the owner asked which of two contradicting conclusions was right. The doc " +
      'contradicts ITSELF: its own §Numerical equivalencies VDOT-50 row gives ' +
      'E = T+104..T+156, 20-40 s/mi slower, which falsifies line 138\'s "within ' +
      '+/-2 sec/mi" accuracy claim. Settling it needs Daniels 3rd ed. Table 2, not in ' +
      'repo. Executed-data check: both candidate bands sit inside Daniels 65-78 %HRmax; ' +
      'the runner himself averages 81 %HRmax on easy days, faster than either. HR is the ' +
      'governor, so neither band is a safety violation. This claim binds the passage the ' +
      'engine actually derives from; the prior claim bound the other one, and the prior ' +
      'code comment cited the table row while quoting a figure computed off MP+60.',
    check({ cite }) {
      // E = MP + 60..90 (Research/01:142), and M = T + MARATHON_OFFSET_SEC.
      const mpOffset = 18;
      const want: [number, number] = [mpOffset + 60, mpOffset + 90];
      const src = sourceOf('web-v2/lib/plan/spec-builder.ts');
      const m = matchLiteral(
        src,
        /const easyLo = easyAnchorT \+ (\d+), easyHi = easyAnchorT \+ (\d+);/,
        'buildWorkoutSpec easy band',
      );
      const [lo, hi] = [Number(m[1]), Number(m[2])];
      within(lo, [want[0] - 15, want[0] + 15], 'easy-pace floor offset off T (Research/01:142 MP+60)');
      within(hi, [want[1] - 15, want[1] + 15], 'easy-pace ceiling offset off T (Research/01:142 MP+90)');
    },
  },
  {
    id: 'PACE.marathon-offset',
    binds: ['lib/plan/spec-builder.ts#buildWorkoutSpec.mp'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Numerical equivalencies',
    claim:
      'Marathon pace sits just slower than threshold — 7:17 against 6:51 in the worked ' +
      'example, a 26 s/mi gap. The engine derives M as a fixed offset off T and must land ' +
      'within 10 s/mi of that, the width over which the gap varies across the VDOT range.',
    check({ cite }) {
      const t = cite.table();
      const [tPace] = parsePaceBandSec(t.cell('Daniels T', 'Pace (min/mi)'));
      const [mPace] = parsePaceBandSec(t.cell('Daniels M', 'Pace (min/mi)'));
      const off = Number(
        matchLiteral(sourceOf('web-v2/lib/plan/spec-builder.ts'), /const mp = tPaceSec \+ (\d+);/, 'buildWorkoutSpec mp')[1],
      );
      within(off, [mPace - tPace - 10, mPace - tPace + 10], 'marathon-pace offset off T');
    },
  },
  {
    id: 'PACE.interval-offset',
    binds: ['lib/plan/spec-builder.ts#buildWorkoutSpec.interval'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Numerical equivalencies',
    claim:
      'Interval pace is 3K-5K race pace: 6:18 against a 6:51 threshold in the worked example, ' +
      '33 s/mi faster. The engine derives I as a fixed offset off T.',
    check({ cite, exempt }) {
      const t = cite.table();
      const [tPace] = parsePaceBandSec(t.cell('Daniels T', 'Pace (min/mi)'));
      const [iPace] = parsePaceBandSec(t.cell('Daniels I', 'Pace (min/mi)'));
      const off = Number(
        matchLiteral(
          sourceOf('web-v2/lib/plan/spec-builder.ts'),
          /const interval = tPaceSec - (\d+);/,
          'buildWorkoutSpec interval',
        )[1],
      );
      if (exempt('interval-runs-slow')) return;
      within(off, [tPace - iPace - 10, tPace - iPace + 10], 'interval-pace offset off T');
    },
    exempt: {
      'interval-runs-slow':
        'KNOWN VIOLATION, self-documented in the engine. spec-builder.ts:241-244 states plainly ' +
        'that I = T-18 "is a deliberate conservative deviation" from Daniels\' T-33, landing ' +
        'nearer 10-12K pace than 3-5K pace. Deliberate, but it is a departure from cited ' +
        'doctrine and should be visible as one rather than reading as Daniels.',
    },
  },
  {
    id: 'PACE.rep-offset',
    binds: ['lib/training/prescriptions.ts#derivePaces.rep'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Numerical equivalencies',
    claim:
      'Repetition pace is roughly mile race pace — 5:50 against a 6:51 threshold, 61 s/mi ' +
      'faster. It is the only pace targeting economy and recruitment rather than lactate ' +
      'clearance, so substituting a slower one wastes the workout.',
    check({ cite, exempt }) {
      const t = cite.table();
      const [tPace] = parsePaceBandSec(t.cell('Daniels T', 'Pace (min/mi)'));
      const [rPace] = parsePaceBandSec(t.cell('Daniels R', 'Pace (min/mi)'));
      const off = Number(
        matchLiteral(
          sourceOf('web-v2/lib/training/prescriptions.ts'),
          /rep:\s*fmtPace\(adj\(t - (\d+)\)\)/,
          'derivePaces rep',
        )[1],
      );
      if (exempt('rep-runs-slow')) return;
      within(off, [tPace - rPace - 10, tPace - rPace + 10], 'repetition-pace offset off T');
    },
    exempt: {
      'rep-runs-slow':
        'KNOWN VIOLATION (found seeding this registry, 2026-08-17). prescriptions.ts derives R ' +
        'as T-30 and its own comment calls that "~5K pace" — which is I pace, not R. Doctrine ' +
        "puts R at mile pace, T-61 in the worked example. The engine's R is 31 s/mi too slow, " +
        'so R sessions deliver interval stimulus rather than the neuromuscular/economy ' +
        'stimulus they are prescribed for. Note the live composer (spec-builder) emits no R ' +
        'pace at all, which bounds the blast radius. Engine audit owns the fix.',
    },
  },

  // ══ HEART RATE ════════════════════════════════════════════════════════════
  {
    id: 'HR.friel-lthr-zones',
    binds: ['lib/training/zones.ts#friel7Zones'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Friel 7-Zone Running HR Table',
    claim:
      'The seven Friel running zones are defined as percentages of LTHR, not of HRmax. Every ' +
      'boundary the engine emits is read straight off the doctrine table.',
    check({ cite }) {
      const t = cite.table();
      const lthr = 160;
      const zones = friel7Zones(lthr);
      if (zones.zones.length !== t.rows.length) {
        throw new Error(`friel7Zones emits ${zones.zones.length} zones · the doctrine table has ${t.rows.length}`);
      }
      t.rows.forEach((row, i) => {
        const [lo, hi] = parsePctBand(row['% LTHR']);
        const z = zones.zones[i];
        // Bottom zone is open-below and the top is open-above · check the bounded edge.
        if (i > 0) within(z.lower, [Math.round(lthr * lo) - 1, Math.round(lthr * lo) + 1], `Friel zone ${i + 1} floor`);
        if (i < t.rows.length - 1) {
          within(z.upper, [Math.round(lthr * hi) - 1, Math.round(lthr * hi) + 1], `Friel zone ${i + 1} ceiling`);
        }
      });
    },
  },
  {
    id: 'HR.lthr-five-zone-collapse',
    binds: ['lib/training/zones.ts#lthrZones'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Friel 7-Zone Running HR Table',
    claim:
      'The five-zone view the app shows is the Friel table with 5a/5b/5c merged into one Z5. ' +
      'Zones 1-4 must keep the exact Friel boundaries; collapsing the top three must not ' +
      'quietly move the threshold line.',
    check({ cite }) {
      const t = cite.table();
      const lthr = 160;
      const z = lthrZones(lthr).zones;
      if (z.length !== 5) throw new Error(`lthrZones emits ${z.length} zones · the five-zone view must emit 5`);
      for (let i = 1; i < 4; i++) {
        const [lo, hi] = parsePctBand(t.rows[i]['% LTHR']);
        within(z[i].lower, [Math.round(lthr * lo) - 1, Math.round(lthr * lo) + 1], `Z${i + 1} floor`);
        within(z[i].upper, [Math.round(lthr * hi) - 1, Math.round(lthr * hi) + 1], `Z${i + 1} ceiling`);
      }
      const [z5lo] = parsePctBand(t.rows[4]['% LTHR']);
      within(z[4].lower, [Math.round(lthr * z5lo) - 1, Math.round(lthr * z5lo) + 1], 'Z5 floor · the threshold line');
    },
  },
  {
    id: 'HR.pct-hrmax-zones',
    binds: ['lib/training/zones.ts#pctMaxZones'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### 5-Zone (ACSM / generic / commercial wearables)',
    claim:
      'When no LTHR is known the app falls back to the standard five %HRmax zones. Those are ' +
      'a published table, not a house convention, and must match it exactly.',
    check({ cite }) {
      const t = cite.table();
      const maxHr = 190;
      const z = pctMaxZones(maxHr).zones;
      if (z.length !== t.rows.length) throw new Error(`pctMaxZones emits ${z.length} zones · doctrine has ${t.rows.length}`);
      t.rows.forEach((row, i) => {
        const [lo, hi] = parsePctBand(row['% HRmax']);
        within(z[i].lower, [Math.round(maxHr * lo) - 1, Math.round(maxHr * lo) + 1], `%HRmax zone ${i + 1} floor`);
        within(z[i].upper, [Math.round(maxHr * hi) - 1, Math.round(maxHr * hi) + 1], `%HRmax zone ${i + 1} ceiling`);
      });
    },
  },
  {
    id: 'HR.lthr-from-hrmax',
    binds: ['lib/training/lthr.ts#lthrFromMaxHr'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: "## 8. Daniels' HR Zones",
    claim:
      'When only HRmax is known, LTHR is crosswalked from it. Threshold effort sits at a ' +
      'stated %HRmax band, so the crosswalk fraction must fall inside that band — outside it ' +
      'and every LTHR-anchored zone in the app shifts with it.',
    check({ cite }) {
      const band = parsePctBand(cite.table().cell('T (Threshold)', '%HRmax'));
      const maxHr = 190;
      const lthr = lthrFromMaxHr(maxHr);
      if (lthr == null) throw new Error('lthrFromMaxHr returned null for a valid HRmax');
      within(lthr / maxHr, band, 'lthrFromMaxHr fraction of HRmax');
    },
  },
  {
    id: 'HR.easy-run-ceiling',
    binds: ['lib/plan/spec-builder.ts#hrCapEasy', 'lib/training/zones.ts#judgeEasyRunHr'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Friel 7-Zone Running HR Table',
    claim:
      'An easy run is capped at the top of the aerobic zone. Both the prescription side and ' +
      'the judgement side use the same ceiling, and it is the Friel Z2 upper bound — not a ' +
      'rounder number chosen because it looked about right.',
    check({ cite }) {
      const ceiling = parsePctBand(cite.table().rows[1]['% LTHR'])[1];
      const sites: [string, string, RegExp][] = [
        ['web-v2/lib/plan/spec-builder.ts', 'hrCapEasy', /const lthrCap = lthr \? Math\.round\(lthr \* (\d*\.?\d+)\)/],
        [
          'web-v2/lib/training/zones.ts',
          'judgeEasyRunHr',
          /const easyCeilingBpm = Math\.round\(thresholdBpm \* (\d*\.?\d+)\)/,
        ],
      ];
      for (const [file, binding, re] of sites) {
        const v = Number(matchLiteral(sourceOf(file), re, binding)[1]);
        if (Math.abs(v - ceiling) > 0.005) {
          throw new Error(`${binding} caps easy at ${v} of LTHR · Friel Z2 tops out at ${ceiling}`);
        }
      }
    },
  },

  // ══ VDOT & PREDICTION ═════════════════════════════════════════════════════
  {
    id: 'VDOT.table-range',
    binds: ['lib/training/vdot.ts#vdotFromRace'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '## VDOT lookup table',
    claim:
      'The published table this app inverts spans a fixed VDOT range. A value outside it is ' +
      'extrapolation, not lookup, so the engine must reject exactly the range the table ' +
      'covers — the clamp bounds are read off the first and last rows of the doc table.',
    check({ cite }) {
      const vdots = cite
        .table()
        .rows.map((r) => Number(r.VDOT))
        .filter((n) => Number.isFinite(n));
      const [lo, hi] = [Math.min(...vdots), Math.max(...vdots)];
      // A time exactly on the slowest row must resolve; one meaningfully slower must not.
      // Probe one row inside the floor rather than exactly on it · the published
      // table is rounded to the second, so the slowest row can compute a hair
      // under `lo` and a knife-edge probe would test the rounding, not the clamp.
      const inside = cite.table().rows.find((r) => Number(r.VDOT) > lo)!;
      const [fiveKSec] = parsePaceBandSec(inside['5K']);
      if (vdotFromRace(fiveKSec, 3.10686) == null) {
        throw new Error(`a VDOT ${inside.VDOT} 5K does not resolve · the engine floor sits above the doctrine table`);
      }
      if (vdotFromRace(fiveKSec * 1.5, 3.10686) != null) {
        throw new Error(`a time far slower than VDOT ${lo} still resolves · the engine has no floor`);
      }
      const src = sourceOf('web-v2/lib/training/vdot.ts');
      const m = matchLiteral(src, /vdot < (\d+) \|\| vdot > (\d+)/, 'vdotFromRace clamp');
      if (Number(m[1]) !== lo || Number(m[2]) !== hi) {
        throw new Error(`vdotFromRace clamps to ${m[1]}-${m[2]} · the doctrine table spans ${lo}-${hi}`);
      }
    },
  },
  {
    id: 'PREDICT.riegel-exponent',
    binds: ['lib/training/vdot.ts#RIEGEL_EXPONENT'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: 'T2 = T1 × (D2 / D1)^1.06',
    claim:
      'Below the VDOT table floor the app falls back to Riegel. The fatigue exponent is not a ' +
      'tunable: it is the published constant, and it is read out of the formula as written.',
    check({ cite }) {
      const stated = Number(cite.section[0].match(/\^(\d*\.?\d+)/)![1]);
      const engine = Number(
        matchLiteral(sourceOf('web-v2/lib/training/vdot.ts'), /RIEGEL_EXPONENT = (\d*\.?\d+)/, 'RIEGEL_EXPONENT')[1],
      );
      if (engine !== stated) throw new Error(`RIEGEL_EXPONENT is ${engine} · doctrine states ${stated}`);
    },
  },
  {
    id: 'PREDICT.riegel-validity-window',
    binds: ['lib/training/vdot.ts#RIEGEL_MIN_DISTANCE_MI', 'lib/training/vdot.ts#RIEGEL_MAX_DISTANCE_MI'],
    doc: 'Research/02-race-time-prediction.md',
    anchor: 'Designed for events 3.5–230 minutes',
    claim:
      'Riegel was fitted for events from roughly 1500m to the marathon and falls apart at ' +
      'sprints and ultras. The engine must refuse to apply it outside that window rather ' +
      'than quietly extrapolating a marathon formula onto a 100K.',
    check({ cite }) {
      if (!/1500m to marathon/i.test(cite.text())) {
        throw new Error('the stated Riegel validity window no longer reads as 1500m-to-marathon');
      }
      const src = sourceOf('web-v2/lib/training/vdot.ts');
      const min = Number(matchLiteral(src, /RIEGEL_MIN_DISTANCE_MI = (\d*\.?\d+)/, 'RIEGEL_MIN_DISTANCE_MI')[1]);
      const max = Number(matchLiteral(src, /RIEGEL_MAX_DISTANCE_MI = (\d*\.?\d+)/, 'RIEGEL_MAX_DISTANCE_MI')[1]);
      within(min, [0.9, 1.0], 'RIEGEL_MIN_DISTANCE_MI (1500m ≈ 0.932 mi)');
      within(max, [26.0, 26.3], 'RIEGEL_MAX_DISTANCE_MI (the marathon)');
    },
  },

  // ══ COMEBACK / LAYOFF ═════════════════════════════════════════════════════
  {
    id: 'COMEBACK.layoff-bands',
    binds: ['lib/plan/adapt.ts#classifyGapBand', 'lib/plan/adapt.ts#GAP_SHAVE_FRACTIONS'],
    doc: 'Research/22-plan-templates.md',
    anchor: '| 8-14 days | 70% of pre-layoff volume for 1 wk, 85% for wk 2, full for wk 3 |',
    claim:
      'A layoff of 8-14 days resumes at 70% of pre-layoff volume, then 85%, then full. ' +
      'The band edges the engine classifies on, and the two shave fractions it applies, are ' +
      'read off that row.',
    check({ cite }) {
      const row = cite.section[0];
      const [gapLo, gapHi] = parseBand(row.split('|')[1]);
      const pcts = [...row.matchAll(/(\d+)%/g)].map((m) => Number(m[1]) / 100);
      if (classifyGapBand(gapLo - 1) === 'shave_70_85') {
        throw new Error(`a ${gapLo - 1}-day gap is classified as the 8-14 day band · doctrine starts it at ${gapLo}`);
      }
      if (classifyGapBand(gapLo) !== 'shave_70_85' || classifyGapBand(gapHi) !== 'shave_70_85') {
        throw new Error(`classifyGapBand does not cover the whole ${gapLo}-${gapHi} day band`);
      }
      if (classifyGapBand(gapHi + 1) === 'shave_70_85') {
        throw new Error(`a ${gapHi + 1}-day gap still shaves · past ${gapHi} days doctrine wants a rebuild`);
      }
      const engineFractions = GAP_SHAVE_FRACTIONS.map((f) => Math.round((1 - f) * 100) / 100);
      pcts.slice(0, 2).forEach((want, i) => {
        if (Math.abs(engineFractions[i] - want) > 0.005) {
          throw new Error(`comeback week ${i + 1} resumes at ${engineFractions[i]} of plan · doctrine says ${want}`);
        }
      });
    },
  },
  {
    id: 'COMEBACK.reramp-resume-fraction',
    binds: ['lib/plan/adapt.ts#RERAMP_RESUME_FRACTION', 'lib/plan/adapt.ts#RERAMP_WEEKLY_GROWTH'],
    doc: 'Research/22-plan-templates.md',
    anchor: 'Volume cap: weekly mileage ≤ 50% of lowest pre-layoff week initially',
    claim:
      'Coming back from a longer absence, the resume anchor is a fraction of pre-absence ' +
      'volume and the climb from there is the 10% rule strictly enforced. The anchor must be ' +
      'no more generous than doctrine allows for the harshest case, and the growth rate is ' +
      'the same ten percent used everywhere else.',
    check({ cite }) {
      const text = cite.text();
      if (!/10% rule strictly enforced/i.test(text)) {
        throw new Error('the comeback volume cap no longer states the 10% rule · re-read the claim');
      }
      if (RERAMP_WEEKLY_GROWTH !== 1.1) {
        throw new Error(`RERAMP_WEEKLY_GROWTH is ${RERAMP_WEEKLY_GROWTH} · doctrine enforces the 10% rule on the climb back`);
      }
      if (RERAMP_RESUME_FRACTION <= 0 || RERAMP_RESUME_FRACTION > 1) {
        throw new Error(`RERAMP_RESUME_FRACTION is ${RERAMP_RESUME_FRACTION} · it is a fraction of pre-absence volume`);
      }
    },
  },

  // ══ INTENSITY DISTRIBUTION · the 80/20 rule ═══════════════════════════════
  {
    id: 'INTENSITY.easy-share-floor',
    binds: ['lib/plan/intensity-distribution.ts#EASY_SHARE_FLOOR', 'lib/plan/generate.ts#applyIntensityFloor'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: 'converge on ≥75% of training volume in Z1',
    claim:
      'At least 75% of training volume is easy running. The engine had no notion of ' +
      'intensity distribution at all until 2026-08-17 — it sized volume, sized the long run ' +
      'and placed quality days without ever asking what fraction of the miles it had just ' +
      'authored were easy. The floor is read out of the sentence itself rather than written ' +
      'here, so a change to the doctrine number moves the engine and not the other way round.',
    check({ cite }) {
      const [, docFloorPct] = parseBand(cite.section[0]);
      const docFloor = docFloorPct / 100;
      if (Math.abs(EASY_SHARE_FLOOR - docFloor) > 0.001) {
        throw new Error(
          `EASY_SHARE_FLOOR is ${EASY_SHARE_FLOOR}, doctrine converges at ${docFloor}`,
        );
      }
      // The base-building table states the same floor with a ceiling. Both must
      // agree, or one of them has been edited and nobody looked at the other.
      const rules = resolveCitation(cite.doc, '### Practical base-building rules');
      const [baseLo] = parseBand(rules.table().cell('Most base running is easy', 'Application'));
      if (Math.abs(baseLo / 100 - docFloor) > 0.001) {
        throw new Error(
          `Research/00a states two different easy-volume floors: ${docFloor} in the TID ` +
          `section and ${baseLo / 100} in the base-building rules. Reconcile the doc first.`,
        );
      }
    },
  },

  // ══ WORKOUT VOCABULARY ════════════════════════════════════════════════════
  {
    id: 'STRIDES.doctrine-bands',
    binds: [
      'lib/plan/spec-builder.ts#STRIDE_DURATION_S',
      'lib/plan/spec-builder.ts#STRIDE_RECOVERY_S',
      'lib/plan/spec-builder.ts#STRIDE_DEFAULT_REPS',
      'lib/plan/spec-builder.ts#STRIDE_DAYS_PER_WEEK',
    ],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '### 7.2 Strides',
    claim:
      'A stride is 15-30 seconds at mile-to-5K pace, 4-8 of them, with 60-90 seconds of ' +
      'recovery, done 2-4 times a week, in every phase of every plan. The engine could not ' +
      'express one at all before 2026-08-17: expand-spec had no strides shape, so a plan row ' +
      'that read "2 mi + 4×20s strides" reached the watch as a flat two-mile jog. Each of ' +
      'the four constants is checked against its own row of the §7.2 table.',
    check({ cite }) {
      const t = cite.table();
      within(STRIDE_DURATION_S, parseBand(t.cell('Distance', 'Prescription').split('or')[1]), 'STRIDE_DURATION_S');
      within(STRIDE_DEFAULT_REPS, parseBand(t.cell('Reps', 'Prescription')), 'STRIDE_DEFAULT_REPS');
      within(STRIDE_RECOVERY_S, parseBand(t.cell('Recovery', 'Prescription')), 'STRIDE_RECOVERY_S');
      within(STRIDE_DAYS_PER_WEEK, parseBand(t.cell('Frequency', 'Prescription')), 'STRIDE_DAYS_PER_WEEK');
      // §7.2's own placement rule: strides never stop. A future edit that gates
      // them to one phase should fail here rather than pass quietly.
      if (!/all phases/i.test(t.cell('When in cycle', 'Prescription'))) {
        throw new Error('Research/04 §7.2 no longer places strides in all phases · re-read the claim');
      }
      // Research/00a's base-building rules state a narrower weekly frequency.
      // The engine must satisfy BOTH bands, not just the looser one.
      const baseRules = resolveCitation(
        'Research/00a-distance-running-training.md',
        '### Practical base-building rules',
      );
      within(
        STRIDE_DAYS_PER_WEEK,
        parseBand(baseRules.table().cell('Strides preserved', 'Application').split('strides')[1]),
        'STRIDE_DAYS_PER_WEEK (Research/00a base-building band)',
      );
    },
  },
  {
    id: 'VOCAB.phase-placement',
    binds: ['lib/plan/generate.ts#qualityFamilyFor'],
    doc: 'Research/04-workout-vocabulary.md',
    anchor: '## 15. Training-cycle placement summary',
    claim:
      'Each phase of a block has its own workout vocabulary, and §15 names it phase by ' +
      'phase. The engine asked the workout_library for two families out of twenty-one, so ' +
      'an eighteen-week marathon build contained three workout shapes — reps, tempo, long. ' +
      'Every family qualityFamilyFor now places must be named in the row for the phase it ' +
      'places it in.',
    check({ cite }) {
      const t = cite.table();
      // How the engine's phase labels map onto the doc's rows. QUALITY spans two
      // doctrine rows: the optional hill block and specific support.
      const ROWS: Record<string, string[]> = {
        QUALITY: ['Hill / strength (3–4 wks, optional)', 'Specific support (4–6 wks)'],
        'RACE-SPECIFIC': ['Race-specific (4–8 wks)'],
      };
      // The word to look for in the row's prose, per family.
      const KEYWORD: Record<string, RegExp> = {
        hills: /hill/i,
        fartlek: /fartlek/i,
        cutdown: /alternation|cutdown|mile repeats/i,
        combo: /alternation|race-pace/i,
        marathon_specific: /canova|MP long runs/i,
        race_specific: /race-pace workouts/i,
      };
      const cats: DistCategory[] = ['5k', '10k', 'hm', 'm', 'ultra'];
      const slots = ['intervals', 'threshold', 'tempo'] as const;
      for (const [phase, labels] of Object.entries(ROWS)) {
        const prose = labels.map((l) => t.cell(l, 'Primary workouts')).join(' ');
        for (const cat of cats) {
          for (const slot of slots) {
            // Both parities of the week index, and both ends of a phase.
            for (const [weekIdx, weeksToPhaseEnd] of [[0, 5], [1, 5], [4, 1], [5, 0]] as const) {
              const family = qualityFamilyFor(cat, phase, weekIdx, weeksToPhaseEnd, slot);
              if (!family) continue;
              const kw = KEYWORD[family];
              if (!kw) {
                throw new Error(`qualityFamilyFor places "${family}" with no doctrine keyword to check it against`);
              }
              if (!kw.test(prose)) {
                throw new Error(
                  `qualityFamilyFor puts "${family}" in the ${phase} phase (${cat}), but §15's ` +
                  `row for that phase reads "${prose}" — doctrine does not place it there.`,
                );
              }
            }
          }
        }
      }
      // BASE's row is easy running plus strides and hill sprints, and that is
      // what the engine puts there. If a future edit gives BASE a structured
      // quality slot this claim should be revisited, not silently widened.
      if (qualityFamilyFor('m', 'BASE', 0, 5, 'intervals') !== null) {
        throw new Error('the engine now places a quality family in BASE · §15 base row is easy volume + strides');
      }
    },
  },

  // ══ EASY-DAY DISCIPLINE ═══════════════════════════════════════════════════
  // The observational twin of the 80/20 intensity-distribution constraint being
  // built in the plan engine. That work governs how much easy volume is
  // PRESCRIBED; these claims govern how the app decides the easy volume was
  // actually run easy. Same passages, opposite direction.
  {
    id: 'EASY.hr-ceiling-observational',
    binds: ['lib/coach/easy-discipline.ts#EASY_HRMAX_CEILING_PCT'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '## Daniels training paces (E, M, T, I, R)',
    claim:
      'An easy run tops out at 78% of max HR. The observational side must use the same ' +
      'ceiling the prescription side is built on, read from the E row of the Daniels pace ' +
      'table, or the app judges by one number and prescribes by another.',
    check({ cite }) {
      const band = parsePctBand(cite.table().cell('E', '%HRmax'));
      if (Math.abs(EASY_HRMAX_CEILING_PCT - band[1]) > 0.005) {
        throw new Error(
          `EASY_HRMAX_CEILING_PCT is ${EASY_HRMAX_CEILING_PCT} · Daniels E tops out at ${band[1]} of HRmax`,
        );
      }
    },
  },
  {
    id: 'EASY.cap-not-looser-than-daniels',
    binds: ['lib/plan/spec-builder.ts#hrCapEasy'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: "## 8. Daniels' HR Zones",
    claim:
      'The easy HR cap the app PRESCRIBES must not permit more than the doctrine ceiling ' +
      'allows. hrCapEasy composes two anchors from two different systems - the Friel Z2 top ' +
      '(0.89 x LTHR) and the Daniels E top (0.78 x HRmax) - and a ceiling built from two ' +
      'candidates should take the binding one, not the loosest one.',
    check({ cite, exempt }) {
      const src = sourceOf('web-v2/lib/plan/spec-builder.ts');
      // The maxHR branch itself is unguarded by HR.easy-run-ceiling, which only
      // watches the LTHR branch. Check it against the doc's own E row.
      const pct = parsePctBand(cite.table().cell('E (Easy)', '%HRmax'))[1];
      const lit = Number(
        matchLiteral(
          src,
          /const maxHrCap = maxHr \? Math\.round\(maxHr \* (\d*\.?\d+)\)/,
          'hrCapEasy maxHr branch',
        )[1],
      );
      if (Math.abs(lit - pct) > 0.005) {
        throw new Error(`hrCapEasy's HRmax branch caps easy at ${lit} · Daniels E tops out at ${pct}`);
      }
      // The composition. MAX of two ceilings always returns the more permissive.
      // Consult the exemption ONLY when the violation is actually present, so
      // fixing the engine makes the gate report the exemption as stale and
      // force its deletion. An exemption marked used unconditionally is an
      // exemption that can outlive the bug it excuses.
      const composesWithMax = /return Math\.max\(lthrCap, maxHrCap\);/.test(src);
      if (composesWithMax && !exempt('max-of-two-ceilings')) {
        throw new Error(
          'hrCapEasy returns MAX(lthrCap, maxHrCap) · a ceiling assembled from two candidate ' +
            'ceilings must take the lower, or the looser system always wins',
        );
      }
    },
    exempt: {
      'max-of-two-ceilings':
        'KNOWN VIOLATION (found building the easy-discipline detector, 2026-08-17). hrCapEasy ' +
        'returns MAX(round(0.89 x LTHR), round(0.78 x HRmax)). Because the app itself derives ' +
        'LTHR as 0.90 x HRmax (lib/training/lthr.ts#lthrFromMaxHr, watched by HR.lthr-from-maxhr), ' +
        'the LTHR branch evaluates to 0.89 x 0.90 = 0.801 x HRmax, which is ALWAYS above the ' +
        '0.78 branch. The HRmax branch is therefore unreachable for any runner who has an LTHR, ' +
        'and the effective easy cap is structurally 80% of max where doctrine says 78%. For the ' +
        'owner: LTHR 162, HRmax 179, cap 144 bpm = 80.4 %HRmax; the doctrine ceiling is 140. ' +
        'NOT fixed here for two reasons. (1) spec-builder.ts is owned by a concurrent plan-engine ' +
        'agent this session. (2) The blast radius is wide: hr_cap_bpm is written into every ' +
        'generated workout_spec, echoed by the watch build (lib/watch/build-workout.ts, which ' +
        'uses a THIRD rule - LTHR-first with HRmax as fallback, not MAX), rendered on Today, the ' +
        'glance adapter and native, and changing it silently re-paces existing plans. ' +
        'RECOMMENDATION: change MAX to Math.min and re-generate, which moves the owner from 144 ' +
        'to 140. Until then lib/coach/easy-discipline.ts deliberately judges against ' +
        'max(doctrine, prescribed) so it can never accuse the runner of obeying the app.',
    },
  },
  {
    id: 'EASY.heat-confounds-the-read',
    binds: ['lib/coach/easy-discipline.ts#HEAT_CONFOUND_TEMP_C'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '### Limitations and Confounders',
    claim:
      'Heat raises heart rate at a fixed effort, so a hot easy day cannot be counted as ' +
      'evidence that the runner ran it too hard. The temperature at which the app stops ' +
      'trusting an easy-day HR reading is the one doctrine names as the onset of the effect.',
    check({ cite }) {
      const row = cite.table().rows.find((r) => /^heat/i.test(r.Confounder ?? ''));
      if (!row) throw new Error('the confounders table no longer carries a Heat row');
      // The threshold lives in the row LABEL ("Heat (≥25°C)"), which parseBand
      // strips as parenthetical, so read it directly.
      const m = (row.Confounder ?? '').match(/(\d+(?:\.\d+)?)\s*°?\s*C/);
      if (!m) throw new Error(`the Heat row no longer names a temperature: "${row.Confounder}"`);
      const docC = Number(m[1]);
      if (HEAT_CONFOUND_TEMP_C !== docC) {
        throw new Error(
          `HEAT_CONFOUND_TEMP_C is ${HEAT_CONFOUND_TEMP_C} · doctrine puts the heat effect at ${docC} C`,
        );
      }
      if (!/rises/i.test(row['Effect at fixed effort'] ?? '')) {
        throw new Error('the Heat row no longer says HR RISES at fixed effort · re-read the filter');
      }
    },
  },
  {
    id: 'EASY.drift-confounds-the-read',
    binds: ['lib/coach/easy-discipline.ts#DRIFT_CONFOUND_MINUTES'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| Cardiac drift (>30 min steady) | Rises |',
    claim:
      'Cardiac drift inflates average HR on long steady efforts, so past the duration at ' +
      'which doctrine quantifies the effect an easy run contributes to the pace read only. ' +
      'The engine cut-off is that duration, not a round number.',
    check({ cite }) {
      const m = cite.text().match(/over\s+(\d+)\s*min/i);
      if (!m) throw new Error('the cardiac-drift row no longer quantifies the effect over a duration');
      const docMin = Number(m[1]);
      if (DRIFT_CONFOUND_MINUTES !== docMin) {
        throw new Error(
          `DRIFT_CONFOUND_MINUTES is ${DRIFT_CONFOUND_MINUTES} · doctrine quantifies drift over ${docMin} min`,
        );
      }
    },
  },
  {
    id: 'EASY.terrain-confounds-the-read',
    binds: ['lib/coach/easy-discipline.ts#TERRAIN_CONFOUND_GAP_PCT'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Hills (Grade-Adjusted Pace)',
    claim:
      'A hilly easy run is a different observation, not a harder one. The grade at which the ' +
      'app stops trusting an easy-day read is the first row of the doctrine multiplier table ' +
      'whose pace cost reaches ten percent, and the net-climb proxy used until grade-adjusted ' +
      'pace lands is that same grade converted for rolling terrain.',
    check({ cite }) {
      const t = cite.table();
      const mult = parseBand(t.cell('+2%', 'Pace multiplier'))[0];
      const cost = mult - 1;
      if (Math.abs(TERRAIN_CONFOUND_GAP_PCT - cost) > 0.005) {
        throw new Error(
          `TERRAIN_CONFOUND_GAP_PCT is ${TERRAIN_CONFOUND_GAP_PCT} · the +2% grade row costs ${cost.toFixed(2)} of pace`,
        );
      }
      // Rolling terrain returning to its start climbs about half the distance,
      // so an average uphill grade of g implies net gain per mile of g/2 x 5280.
      const impliedFtPerMi = (0.02 / 2) * 5280;
      within(
        TERRAIN_CONFOUND_FT_PER_MI,
        [impliedFtPerMi - 10, impliedFtPerMi + 10],
        'TERRAIN_CONFOUND_FT_PER_MI vs the +2% grade converted for rolling terrain',
      );
    },
  },
  {
    id: 'EASY.post-race-context-window',
    binds: ['lib/coach/easy-discipline.ts#raceWindowFor'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '| Distance | Total recovery days (no quality) | Days of zero/very-light running |',
    claim:
      'Easy days inside a post-race recovery window are context, not evidence. The window is ' +
      'the "total recovery days (no quality)" column - explicitly NOT its neighbour "days of ' +
      'zero/very-light running", which is the confusion that caused the 52174bcd incident.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Total recovery days (no quality)';
      for (const [label, mi] of [
        ['5K', 3.1],
        ['10K', 6.2],
        ['Half marathon', 13.1],
        ['Marathon', 26.2],
      ] as [string, number][]) {
        const docHi = parseBand(t.cell(label, col))[1];
        const engine = raceWindowFor(mi, true);
        if (engine !== docHi) {
          throw new Error(
            `raceWindowFor(${mi}, after) is ${engine} · doctrine gives ${label} ${docHi} recovery days`,
          );
        }
      }
    },
  },
  {
    id: 'EASY.pre-race-context-window',
    binds: ['lib/coach/easy-discipline.ts#raceWindowFor'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.1 Taper duration by distance',
    claim:
      'Easy days inside a taper are deliberately conserved, not lazily run, so they are ' +
      'context rather than evidence. The pre-race window is the taper length doctrine gives ' +
      'for that race distance.',
    check({ cite }) {
      const t = cite.table();
      for (const [label, mi] of [
        ['5K', 3.1],
        ['10K', 6.2],
        ['Half marathon', 13.1],
        ['Marathon', 26.2],
      ] as [string, number][]) {
        const docHi = parseBand(t.cell(label, 'Taper length'))[1];
        const engine = raceWindowFor(mi, false);
        if (engine !== docHi) {
          throw new Error(
            `raceWindowFor(${mi}, before) is ${engine} · doctrine tapers ${label} for ${docHi} days`,
          );
        }
      }
    },
  },
  {
    id: 'EASY.share-of-volume-twin',
    binds: ['lib/coach/easy-discipline.ts#OVER_CEILING_MAJORITY'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Practical base-building rules',
    claim:
      'This detector is the observational twin of the intensity-distribution constraint in ' +
      'the plan engine: doctrine says most base running is easy, and prescribing that share ' +
      'is worthless if the easy runs are not run easy. The bar for calling it a pattern is a ' +
      'clear majority, and never stricter than the easy share doctrine itself asks for - ' +
      'requiring more bad days than doctrine requires good ones would be incoherent.',
    check({ cite }) {
      const share = parsePctBand(cite.table().cell('Most base running is easy', 'Application'))[0];
      if (share < 0.7) {
        throw new Error(
          `the base-building rule now puts only ${share} of volume in Z1 · re-read this claim`,
        );
      }
      within(
        OVER_CEILING_MAJORITY,
        [2 / 3 - 0.001, share],
        'OVER_CEILING_MAJORITY between a clear majority and the doctrine easy share',
      );
    },
  },

  // ══ TERRAIN · grade adjustment for executed runs ═══════════════════════════
  // Seeded 2026-08-17. CLAUDE.md §Doctrine gate listed "altitude, treadmill and
  // terrain pace conversions" as an unwatched claim area; the terrain half is
  // now watched. Altitude remains unseeded — nothing in the engine adjusts for
  // it yet, so there is no constant to bind.
  {
    id: 'TERRAIN.grade-cost-per-pct',
    binds: ['lib/terrain/grade-adjust.ts#GRADE_COST_PER_PCT'],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Mechanical Effects of Uphill Running',
    claim:
      'Running uphill costs a fixed fraction more per percent of grade, and that fraction is ' +
      'stated in this section. Every pace-judging surface — the post-run recap, the training ' +
      'VDOT candidates, the race split arithmetic — has to use that one number, or a hilly run ' +
      'reads as slow on one surface and as fitness on another.',
    check({ cite }) {
      const text = cite.text();
      const m = text.match(/rises\s*~?\s*(\d+(?:\.\d+)?)\s*%\s*per\s*1\s*%\s*of\s*grade/i);
      if (!m) {
        throw new Error(
          'the uphill energy-cost sentence is no longer in §Mechanical Effects of Uphill Running · ' +
            're-read the section before re-pointing this claim',
        );
      }
      const doctrinePct = Number(m[1]);
      const enginePct = GRADE_COST_PER_PCT * 100;
      if (Math.abs(enginePct - doctrinePct) > 0.05) {
        throw new Error(
          `GRADE_COST_PER_PCT is ${enginePct}% per 1% grade · doctrine says ${doctrinePct}%`,
        );
      }
      // The same coefficient must be the one the race-pacing path uses. Two
      // numbers here means the plan and the execution disagree about the
      // same hill. 2026-08-17: race/pacing.ts no longer declares its own
      // literal — the elevation consolidation moved it into
      // lib/training/elevation-model.ts, which pacing.ts and course-impact.ts
      // both call. This claim now compares the two exported constants
      // directly, which is stronger than a source scan: a refactor that moves
      // either one keeps failing here until they are reconciled.
      if (Math.abs(ELEV_GRADE_COST_PER_PCT - GRADE_COST_PER_PCT) > 1e-9) {
        throw new Error(
          `lib/training/elevation-model.ts uses ${ELEV_GRADE_COST_PER_PCT} per 1% grade but ` +
            `lib/terrain/grade-adjust.ts uses ${GRADE_COST_PER_PCT}. Planned courses and ` +
            `executed runs must cost a hill the same.`,
        );
      }
    },
  },
  {
    id: 'TERRAIN.grade-model-ceiling',
    binds: ['lib/terrain/grade-adjust.ts#GRADE_MODEL_MAX_PCT'],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Mechanical Effects of Uphill Running',
    claim:
      'The linear per-percent cost is only claimed to hold up to a stated grade. Past it the ' +
      'engine clamps rather than extrapolating, so a drifted barometer or a fat-fingered ' +
      'treadmill incline cannot produce an unbounded pace adjustment.',
    check({ cite }) {
      const m = cite.text().match(/up to\s*~?\s*(\d+)\s*[–-]\s*(\d+)\s*%/i);
      if (!m) throw new Error('the validity ceiling ("up to ~10–15%") is no longer stated in this section');
      within(GRADE_MODEL_MAX_PCT, [Number(m[1]), Number(m[2])], 'GRADE_MODEL_MAX_PCT');
    },
  },
  {
    id: 'TERRAIN.descent-giveback',
    binds: ['lib/terrain/grade-adjust.ts#DESCENT_GIVEBACK_FRACTION'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Hills (Grade-Adjusted Pace)',
    claim:
      'A descent does NOT refund what the equivalent climb charged — doctrine puts the giveback ' +
      'at a fraction of the loss. The asymmetry is the entire reason hills show up in a ' +
      'whole-run adjustment at all: with a symmetric coefficient every rolling loop would net ' +
      'to zero and terrain would be invisible to the engine.',
    check({ cite }) {
      const m = cite.text().match(/downhills give back roughly\s*(\d+)\s*[–-]\s*(\d+)\s*%/i);
      if (!m) {
        throw new Error(
          'the downhill-giveback sentence is no longer in §Hills (Grade-Adjusted Pace) · a change ' +
            'here changes how every executed run is judged',
        );
      }
      within(DESCENT_GIVEBACK_FRACTION * 100, [Number(m[1]), Number(m[2])], 'DESCENT_GIVEBACK_FRACTION');
      if (DESCENT_GIVEBACK_FRACTION >= 1) {
        throw new Error('a descent that gives back everything makes terrain invisible · doctrine says it does not');
      }
    },
  },
  {
    id: 'TERRAIN.treadmill-air-resistance-grade',
    binds: ['lib/terrain/grade-adjust.ts#TREADMILL_AIR_RESISTANCE_GRADE_PCT'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### General incline → outdoor pace conversion',
    claim:
      'One specific belt grade is metabolically equal to outdoor flat, because it stands in for ' +
      'the air resistance a treadmill runner never meets. The engine reads that grade out of ' +
      "the doc's own conversion table and treats it as zero terrain — otherwise every " +
      'treadmill run at the standard setting would be credited as a climb it was not.',
    check({ cite }) {
      const t = cite.table();
      const col = 'Equivalent outdoor pace adjustment';
      const flatRows = t.rows.filter((r) => /^[≈~]?\s*outdoor flat\s*$/i.test((r[col] ?? '').trim()));
      if (flatRows.length !== 1) {
        throw new Error(
          `the conversion table has ${flatRows.length} grades marked "≈ outdoor flat" · expected exactly one`,
        );
      }
      const [docGrade] = parseBand(flatRows[0][t.headers[0]] ?? '');
      if (docGrade !== TREADMILL_AIR_RESISTANCE_GRADE_PCT) {
        throw new Error(
          `TREADMILL_AIR_RESISTANCE_GRADE_PCT is ${TREADMILL_AIR_RESISTANCE_GRADE_PCT}% but doctrine ` +
            `puts outdoor-flat equivalence at ${docGrade}%`,
        );
      }
      // The engine must therefore make that belt setting a genuine no-op.
      if (treadmillEffectiveGradePct(TREADMILL_AIR_RESISTANCE_GRADE_PCT) !== 0) {
        throw new Error('the outdoor-flat-equivalent belt grade is not being treated as flat');
      }
      if (gradeFactor(treadmillEffectiveGradePct(TREADMILL_AIR_RESISTANCE_GRADE_PCT), 'treadmill') !== 1) {
        throw new Error('a treadmill run at the air-resistance grade is still being adjusted');
      }
    },
  },
  {
    id: 'TERRAIN.treadmill-cost-per-pct',
    binds: ['lib/terrain/grade-adjust.ts#TREADMILL_COST_PER_PCT'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### General incline → outdoor pace conversion',
    claim:
      'Belt grade above the flat-equivalent setting costs a stated fraction more per percent, ' +
      'measured against the same belt speed. It is a different reference frame from outdoor ' +
      'grade and therefore a separate constant, not the outdoor number reused.',
    check({ cite }) {
      const m = cite.text().match(/each 1%\s*of treadmill grade adds\s*~?\s*(\d+(?:\.\d+)?)\s*%/i);
      if (!m) throw new Error('the treadmill incline cost sentence is no longer in this section');
      const doctrinePct = Number(m[1]);
      const enginePct = TREADMILL_COST_PER_PCT * 100;
      if (Math.abs(enginePct - doctrinePct) > 0.05) {
        throw new Error(
          `TREADMILL_COST_PER_PCT is ${enginePct}% per 1% belt grade · doctrine says ${doctrinePct}%`,
        );
      }
    },
  },
  {
    id: 'TERRAIN.conditions-compose-multiplicatively',
    binds: ['lib/terrain/grade-adjust.ts#composeEffortFactor'],
    doc: 'Research/01-pace-zones-vdot.md',
    anchor: '### Combined conditions',
    claim:
      'When more than one condition is working on a runner, the adjustments multiply rather ' +
      'than add. The engine has exactly one function that does that stacking, so a hot run on ' +
      'a hilly route cannot be forgiven twice by two paths that each account for the day.',
    check({ cite }) {
      const text = cite.text();
      if (!/multiplicativel?y,\s*not\s*additively/i.test(text)) {
        throw new Error('§Combined conditions no longer states multiplicative stacking');
      }
      if (!/base_pace\s*×\s*\(1\s*\+\s*heat_adj\)/i.test(text)) {
        throw new Error('the combined-conditions formula no longer shows the heat leg as (1 + heat_adj)');
      }
      const heatPct = 4;
      const grade = gradeFactor(2);
      const composed = composeEffortFactor({ heatSlowdownPct: heatPct, gradeFactor: grade });
      const expected = (1 + heatPct / 100) * grade;
      if (Math.abs(composed.factor - expected) > 1e-12) {
        throw new Error(
          `composeEffortFactor returned ${composed.factor} · doctrine's product is ${expected}`,
        );
      }
      // Neutral legs must leave the other alone, or "no heat" would quietly
      // cancel a real hill.
      if (composeEffortFactor({ heatSlowdownPct: 0, gradeFactor: grade }).factor !== grade) {
        throw new Error('a neutral heat leg is not passing the terrain factor through unchanged');
      }
      if (composeEffortFactor({ heatSlowdownPct: heatPct, gradeFactor: 1 }).factor !== 1 + heatPct / 100) {
        throw new Error('flat terrain is not passing the heat factor through unchanged');
      }
    },
  },

  // ══ TIER-2 DOCTRINE (readiness · tier · elevation · heat) ═══════════════════
  {
    id: 'ELEVATION.descent-gives-back-half',
    binds: [
      'lib/training/elevation-model.ts#DESCENT_RECOVERY_FRACTION',
      'lib/training/elevation-model.ts#MAX_DESCENT_CREDIT_S_PER_MI',
      'lib/training/elevation-model.ts#DESCENT_HARD_CAP_S_PER_MI',
    ],
    doc: 'Research/11-course-specific-training.md',
    anchor: '### Pacing Rule for Hilly Courses',
    claim:
      'Doctrine states both sides of a hill in seconds per mile: climbs add 10-30, descents ' +
      'shave 5-15 and never more than 20. So a descent hands back about half of what the ' +
      'matching climb took, the per-mile credit is capped at the top of the descent band, and ' +
      'the hard floor is the stated 20. All three come out of this one code block.',
    check({ cite }) {
      const text = cite.text();
      const climbLine = text.split('\n').find((l) => /On climbs:/.test(l));
      const descentLine = text.split('\n').find((l) => /On descents:/.test(l));
      if (!climbLine || !descentLine) {
        throw new Error('the hilly-course pacing block no longer states both a climb and a descent rule');
      }
      const [climbLo, climbHi] = parseBand(climbLine);
      const [descLo, descHi] = parseBand(descentLine);
      const ratio = ((descLo + descHi) / 2) / ((climbLo + climbHi) / 2);
      if (Math.abs(DESCENT_RECOVERY_FRACTION - ratio) > 0.02) {
        throw new Error(
          `DESCENT_RECOVERY_FRACTION is ${DESCENT_RECOVERY_FRACTION} · doctrine's bands ` +
            `(climb ${climbLo}-${climbHi}, descent ${descLo}-${descHi} s/mi) give ${ratio.toFixed(2)}`,
        );
      }
      if (MAX_DESCENT_CREDIT_S_PER_MI !== descHi) {
        throw new Error(`MAX_DESCENT_CREDIT_S_PER_MI is ${MAX_DESCENT_CREDIT_S_PER_MI}, doctrine shaves at most ${descHi} s/mi`);
      }
      const hardCap = parseBand(descentLine.slice(descentLine.indexOf('minus')))[0];
      if (DESCENT_HARD_CAP_S_PER_MI !== hardCap) {
        throw new Error(`DESCENT_HARD_CAP_S_PER_MI is ${DESCENT_HARD_CAP_S_PER_MI}, doctrine caps at goal pace minus ${hardCap} s/mi`);
      }
    },
  },
  {
    id: 'ELEVATION.grade-energy-cost',
    binds: ['lib/training/elevation-model.ts#ELEV_GRADE_COST_PER_PCT'],
    doc: 'Research/11-course-specific-training.md',
    anchor: 'Energy cost rises ~3.3% per 1% of grade',
    claim:
      'Uphill running costs a fixed fraction of pace per 1% of grade, and that fraction is ' +
      'stated in the doc. It used to live in two places at two values — the race-splits model ' +
      'read it correctly and the Targets course chunk invented +10 s/mi per 100 ft/mi, which ' +
      'lands 3-6x lighter. One constant now, read from the sentence itself.',
    check({ cite }) {
      const pct = parseBand(cite.section[0].replace(/up to.*$/, ''))[0];
      if (Math.abs(ELEV_GRADE_COST_PER_PCT - pct / 100) > 0.0005) {
        throw new Error(`ELEV_GRADE_COST_PER_PCT is ${ELEV_GRADE_COST_PER_PCT}, doctrine says ${pct}% per 1% of grade`);
      }
      // The old model is gone, not merely bypassed.
      const src = sourceOf('web-v2/lib/training/course-impact.ts');
      if (/NET_CLIMB_S_PER_MI_PER_100FT|GROSS_FATIGUE_S_PER_MI_PER_100FT/.test(src)) {
        throw new Error('course-impact.ts still defines its own per-100-ft elevation coefficients');
      }
      if (!/courseElevationCostSec/.test(src)) {
        throw new Error('course-impact.ts no longer calls the shared elevation model');
      }
    },
  },
  {
    id: 'HEAT.band-taxonomy-is-wbgt',
    binds: ['lib/coach/heat-gate.ts#WBGT_FLAGS', 'lib/coach/heat-gate.ts#heatBandForFlag'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: '| WBGT (°F) | WBGT (°C) | Flag | Action |',
    claim:
      "Doctrine's heat taxonomy is the ACSM / Korey Stringer flag table, and the app had four " +
      'others: a slowdown-%% ladder on the verdict, a Tair ladder on the race projection, a ' +
      'different Tair ladder on the phone. Every band boundary and every flag name in the ' +
      'engine is read straight off this table, and the word the UI shows is a mapping of the ' +
      'flag rather than a scale of its own.',
    check({ cite }) {
      const t = cite.table();
      const docFlags = t.rows.map((r) => r['Flag'].toLowerCase());
      const engineFlags = WBGT_FLAGS.map((b) => b.flag);
      if (engineFlags.join(',') !== docFlags.join(',')) {
        throw new Error(`WBGT_FLAGS reads ${engineFlags.join(' · ')} · doctrine has ${docFlags.join(' · ')}`);
      }
      t.rows.forEach((row, i) => {
        const cell = row['WBGT (°F)'];
        const engine = WBGT_FLAGS[i].maxF;
        if (/^</.test(cell.trim())) {
          if (engine !== parseBand(cell)[0]) {
            throw new Error(`WBGT_FLAGS[${i}].maxF is ${engine}, doctrine's first band is ${cell}`);
          }
          return;
        }
        if (/^>/.test(cell.trim())) {
          if (engine !== Infinity) throw new Error(`WBGT_FLAGS[${i}].maxF is ${engine}, doctrine's last band is open-ended`);
          return;
        }
        const hi = parseBand(cell)[1];
        if (engine !== hi) throw new Error(`WBGT_FLAGS[${i}].maxF is ${engine}, doctrine's band ends at ${hi}`);
      });
      // The UI word must be a total mapping of the flag · a flag with no word
      // is a surface that will quietly invent one.
      for (const flag of new Set(engineFlags)) {
        if (heatBandForFlag(flag) == null) throw new Error(`flag "${flag}" maps to no display word`);
      }
      if (heatBandForFlag('unknown') != null) {
        throw new Error('an unknown flag maps to a heat word · a missing input must read as missing');
      }
    },
  },
  {
    id: 'HEAT.dewpoint-surcharge',
    binds: ['lib/training/heat-model.ts#dewpointAddPct'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: 'and +1% per 10°F dewpoint above 60°F',
    claim:
      'The dewpoint surcharge is additive on the temperature slowdown at the rate the ' +
      "quick-reference states, from the threshold it states. Every consumer gets it now — " +
      'before 2026-08-17 three of the five heat call sites never passed a dewpoint at all.',
    check({ cite }) {
      const line = cite.section[0].slice(cite.section[0].indexOf('dewpoint') - 30);
      const nums = line.match(/(\d+(?:\.\d+)?)/g)?.map(Number) ?? [];
      const [rate, per, threshold] = [nums[0], nums[1], nums[2]];
      if (dewpointAddPct(threshold) !== 0) {
        throw new Error(`the surcharge fires at exactly ${threshold}°F · doctrine says ABOVE it`);
      }
      const at = threshold + per;
      const got = dewpointAddPct(at);
      if (Math.abs(got - rate) > 0.001) {
        throw new Error(`dewpointAddPct(${at}) is ${got}% · doctrine says +${rate}% per ${per}°F above ${threshold}°F`);
      }
    },
  },
  {
    id: 'HEAT.interval-adjustment-is-half',
    binds: ['lib/training/heat-model.ts#INTERVAL_ADJUSTMENT_FACTOR'],
    doc: 'Research/06-weather-adjustments.md',
    anchor: 'apply **half** the continuous-run adjustment',
    claim:
      'Repeats with recovery between them cool partially, so they take half the continuous-run ' +
      'heat adjustment. The halving lives in the shared model, applied by a flag on the ' +
      'conditions, not re-implemented at whichever call site happens to remember it.',
    check() {
      if (INTERVAL_ADJUSTMENT_FACTOR !== 0.5) {
        throw new Error(`INTERVAL_ADJUSTMENT_FACTOR is ${INTERVAL_ADJUSTMENT_FACTOR} · doctrine says half`);
      }
      const conditions = { tempF: 80, humidityPct: 60, durationS: 3600 } as const;
      const continuous = effortSlowdownPct(conditions);
      const repeats = effortSlowdownPct({ ...conditions, intervalStyle: true });
      if (Math.abs(repeats - continuous * 0.5) > 1e-9) {
        throw new Error(`repeats got ${repeats}% against ${continuous}% continuous · doctrine halves it`);
      }
    },
  },
  {
    id: 'HR.heat-confounder-band',
    binds: ['lib/weather/heat-adjustment.ts#HEAT_HR_CONFOUNDER', 'lib/weather/heat-adjustment.ts#heatHrBumpBpm'],
    doc: 'Research/03-heart-rate-zones.md',
    anchor: '| Confounder | Effect at fixed effort | Magnitude |',
    claim:
      'Heat raises HR at fixed effort by the amount this table states, from the temperature ' +
      'this table states. The engine used to claim "~1 bpm per 1°F above ~60°F" and cite it to ' +
      'Research/06 §1, which carries no bpm number anywhere — and the code did not implement ' +
      "its own comment either. Both ends of the band and the threshold are read from the row.",
    check({ cite }) {
      const row = cite.table().row('Heat (≥25°C)');
      const [lo, hi] = parseBand(row['Magnitude']);
      if (HEAT_HR_CONFOUNDER.bandBpm[0] !== lo || HEAT_HR_CONFOUNDER.bandBpm[1] !== hi) {
        throw new Error(`HEAT_HR_CONFOUNDER band is ${HEAT_HR_CONFOUNDER.bandBpm.join('-')} bpm, doctrine says ${lo}-${hi}`);
      }
      // "Heat (≥25°C)" · the threshold sits inside the row label, in Celsius,
      // and parseBand strips parenthesised text — read it off the label direct.
      const label = row[cite.table().headers[0]];
      const c = label.match(/(\d+(?:\.\d+)?)\s*°?C/);
      if (!c) throw new Error(`the heat confounder row no longer states a temperature: "${label}"`);
      const thresholdC = Number(c[1]);
      const thresholdF = Math.round(thresholdC * 9 / 5 + 32);
      if (HEAT_HR_CONFOUNDER.thresholdF !== thresholdF) {
        throw new Error(`HEAT_HR_CONFOUNDER.thresholdF is ${HEAT_HR_CONFOUNDER.thresholdF}, doctrine's ${thresholdC}°C is ${thresholdF}°F`);
      }
      if (heatHrBumpBpm(thresholdF - 1) !== 0) {
        throw new Error('a heat HR bump is claimed below the doctrine threshold');
      }
      within(heatHrBumpBpm(thresholdF), [lo, hi], 'heatHrBumpBpm at the threshold');
      within(heatHrBumpBpm(120), [lo, hi], 'heatHrBumpBpm well above the band');
    },
  },
  {
    id: 'READINESS.hrv-floor',
    binds: ['lib/coach/readiness.ts#READINESS_WEIGHTS'],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: 'Below 40% under-uses the signal; above 50% breaks on noisy nights',
    claim:
      'HRV carries a stated floor as well as a target. The methodology says below 40% ' +
      'under-uses the signal and above 50% lets one bad PPG night swing the read, so the ' +
      "engine's HRV weight has to sit inside that band — both ends of it.",
    check({ cite }) {
      // The sentence states the two edges separately ("Below 40%… above 50%"),
      // so read them as the standalone percentages on the line rather than as
      // a dashed band.
      const nums = (cite.section[0].match(/\d+(?:\.\d+)?%/g) ?? []).map((s) => Number(s.replace('%', '')));
      if (nums.length < 2) {
        throw new Error('the HRV weight sentence no longer states two bounds · re-read the claim');
      }
      within(READINESS_WEIGHTS.hrv * 100, [Math.min(...nums), Math.max(...nums)], 'READINESS_WEIGHTS.hrv (%)');
    },
  },
  {
    id: 'READINESS.load-cannot-create-a-score',
    binds: ['lib/coach/readiness.ts#computeReadiness'],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: "create* a score; it can only modulate one",
    claim:
      'A runner with training history but no biometrics has no readiness score. Load can move ' +
      'a reading that exists; it cannot conjure one, and it cannot lift a score past the ' +
      "ceiling the day's own pillars could have reached.",
    check() {
      const runsButNoBiometrics = {
        sleep7Avg: null, hrvCurrent: null, hrvBaseline: null,
        rhrCurrent: null, rhrBaseline: null,
        hrRecoveryCurrent: null, hrRecoveryBaseline: null,
        loadAcwr: 1.15, loadAcute7: 4.6, loadChronic28: 4,
      } as unknown as Parameters<typeof computeReadiness>[0];
      const r = computeReadiness(runsButNoBiometrics);
      if (r.score !== null) {
        throw new Error(`a runner with only run history scored ${r.score} · load created a score out of nothing`);
      }
      // A real biometric day, with the freshest possible load bonus, must not
      // exceed what the pillars alone could have produced.
      const neutralDay = {
        sleep7Avg: 7.5, hrvCurrent: 60, hrvBaseline: 60,
        rhrCurrent: 50, rhrBaseline: 50,
        hrRecoveryCurrent: null, hrRecoveryBaseline: null,
        loadAcwr: 0.5, loadAcute7: 2, loadChronic28: 4,
      } as unknown as Parameters<typeof computeReadiness>[0];
      const fresh = computeReadiness(neutralDay);
      const maxedPillars = {
        ...neutralDay, hrvCurrent: 200, rhrCurrent: 20, sleep7Avg: 12,
      } as unknown as Parameters<typeof computeReadiness>[0];
      const ceiling = computeReadiness({ ...maxedPillars, loadAcwr: 1.15 } as never).score ?? 100;
      if ((fresh.score ?? 0) > ceiling) {
        throw new Error(`the load bonus lifted a neutral day to ${fresh.score}, past the pillar ceiling ${ceiling}`);
      }
    },
  },
  {
    id: 'READINESS.load-is-a-multiplier',
    binds: [
      'lib/coach/readiness.ts#LOAD_CONTEXT_MULTIPLIER',
      'lib/coach/readiness.ts#loadContextMultiplier',
    ],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: 'multiplier in the range [0.85, 1.10] applied after the biometric composite',
    claim:
      'Training load modulates the composite, it is not a pillar of it. Every value the ' +
      'multiplier can take sits inside the stated range, the penalty and bonus point the way ' +
      'doctrine says (penalise an ACWR spike, reward planned freshness), and the score module ' +
      'multiplies rather than adds.',
    check({ cite }) {
      // The range is written `[0.85, 1.10]` — a comma pair, not a dashed band.
      const m = cite.section[0].match(/\[\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*\]/);
      if (!m) throw new Error('the load-multiplier sentence no longer states a [lo, hi] range');
      const [lo, hi] = [Number(m[1]), Number(m[2])] as [number, number];
      for (const [name, v] of Object.entries(LOAD_CONTEXT_MULTIPLIER)) {
        within(v, [lo, hi], `LOAD_CONTEXT_MULTIPLIER.${name}`);
      }
      // Direction, straight from the sentence: "penalize when ATL spike +
      // ACWR > 1.5; bonus when ATL drops in a planned taper".
      const spike = loadContextMultiplier(1.7, 8, 4);
      if (!(spike < 1)) throw new Error(`ACWR 1.7 gives multiplier ${spike} · doctrine penalises an ATL spike`);
      const fresh = loadContextMultiplier(0.6, 2, 4);
      if (!(fresh > 1)) throw new Error(`ACWR 0.6 gives multiplier ${fresh} · doctrine rewards a planned taper`);
      const sweet = loadContextMultiplier(1.15, 4.6, 4);
      if (sweet !== 1) throw new Error(`a sweet-spot ACWR gives ${sweet} · the sweet spot is neutral, not a bonus`);
      // And it is genuinely applied as a multiplier on the finished composite.
      matchLiteral(
        sourceOf('web-v2/lib/coach/readiness.ts'),
        /Math\.min\(composite \* loadMult, pillarCeiling\)/,
        'lib/coach/readiness.ts#computeReadiness · post-composite multiplier',
      );
    },
  },
  {
    id: 'READINESS.pillar-weights',
    binds: ['lib/coach/readiness.ts#READINESS_WEIGHTS'],
    doc: 'BuildResearch/D1-recovery-score-methodology.md',
    anchor: '| Input | Weight | Source-of-truth metric | Baseline | Confidence floor |',
    claim:
      'The readiness pillars are weighted by signal fidelity, and the methodology names the ' +
      'split: HRV highest, sleep next, RHR last. The engine had HRV and sleep tied at 28% ' +
      'each, which inverts the ordering — sleep is one night of sample, HRV is a seven-day ' +
      'trend. Each weight is read out of the table at run time.',
    check({ cite }) {
      const t = cite.table();
      const want = (row: string) => parseBand(t.cell(row, 'Weight'))[0] / 100;
      const pairs: Array<[string, number]> = [
        ['HRV (LnRMSSD)', READINESS_WEIGHTS.hrv],
        ['RHR', READINESS_WEIGHTS.rhr],
        ['Sleep Quality Index', READINESS_WEIGHTS.sleep],
        ['Training-load context', READINESS_WEIGHTS.load],
      ];
      for (const [row, engine] of pairs) {
        const doctrine = want(row);
        if (Math.abs(engine - doctrine) > 0.005) {
          throw new Error(`READINESS_WEIGHTS for "${row}" is ${engine}, doctrine says ${doctrine}`);
        }
      }
      // The ordering claim itself, not just the numbers · a future edit that
      // moved all three by the same amount would still have to keep this.
      if (!(READINESS_WEIGHTS.hrv > READINESS_WEIGHTS.sleep && READINESS_WEIGHTS.sleep > READINESS_WEIGHTS.rhr)) {
        throw new Error('pillar weights no longer run HRV > sleep > RHR · that ordering is the fidelity claim');
      }
    },
  },
  {
    id: 'TIER.acwr-bands-have-no-tier-dimension',
    binds: ['lib/coach/tier-rules.ts#ACWR_BANDS', 'lib/coach/tier-rules.ts#tierRulesFor'],
    doc: 'Research/15-wearable-data.md',
    anchor: '| ACWR | Zone |',
    claim:
      "Gabbett's zones are one table with no experience column. The engine used to raise the " +
      'caution line to 1.5 and the danger line to 1.9 for advanced_plus, which loosens the ' +
      'safety threshold for the runners carrying the most load. Every tier now reads the same ' +
      "boundaries, and those boundaries are the doc's own.",
    check({ cite }) {
      const t = cite.table();
      const boundary = (label: string) => parseBand(t.row(label)[t.headers[0]])[0];
      const detraining = boundary('< 0.8');
      const caution = parseBand(t.row('1.3 – 1.5')[t.headers[0]])[0];
      const danger = boundary('> 1.5');
      const pairs: Array<[string, number, number]> = [
        ['detraining', ACWR_BANDS.detraining, detraining],
        ['caution', ACWR_BANDS.caution, caution],
        ['danger', ACWR_BANDS.danger, danger],
      ];
      for (const [name, engine, doctrine] of pairs) {
        if (engine !== doctrine) throw new Error(`ACWR_BANDS.${name} is ${engine}, doctrine says ${doctrine}`);
      }
      const tiers: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus'];
      for (const tier of tiers) {
        const r = tierRulesFor(tier, 55);
        if (r.acwrCaution !== ACWR_BANDS.caution || r.acwrSpike !== ACWR_BANDS.danger
          || r.acwrDetraining !== ACWR_BANDS.detraining) {
          throw new Error(`tier "${tier}" carries its own ACWR thresholds · doctrine has no tier dimension`);
        }
      }
    },
  },
  {
    id: 'TIER.sleep-floor-rises-with-mileage',
    binds: [
      'lib/coach/tier-rules.ts#SLEEP_TARGET_BY_MPW',
      'lib/coach/tier-rules.ts#sleepFloorForMileage',
    ],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### 20–40 mpw',
    claim:
      'The sleep requirement scales UP with weekly mileage — 7.5-9 h at 20-40 mpw through ' +
      '9-10 h at 80+. The engine used to scale it DOWN with experience (6.8 h beginner, 6.0 ' +
      'advanced_plus), which relaxed the bar for exactly the runners doctrine raises it for. ' +
      'The four rows are read out of their own tables and the floor is each row\'s target ' +
      'less one fixed tolerance.',
    check({ cite }) {
      const rows: Array<[string, number]> = [
        ['### 20–40 mpw', 30],
        ['### 40–60 mpw', 50],
        ['### 60–80 mpw', 70],
        ['### 80+ mpw', 95],
      ];
      let previous = 0;
      rows.forEach(([anchor, mpw], i) => {
        const section = i === 0
          ? cite
          : resolveCitation('Research/00b-recovery-protocols.md', anchor);
        const target = parseBand(section.table().cell('Sleep', 'Target'))[0];
        const engineTarget = SLEEP_TARGET_BY_MPW[i].band[0];
        if (Math.abs(engineTarget - target) > 0.01) {
          throw new Error(`SLEEP_TARGET_BY_MPW row ${i} target is ${engineTarget} h, doctrine says ${target} h`);
        }
        const floor = sleepFloorForMileage(mpw);
        if (Math.abs(floor - (target - SLEEP_FLOOR_TOLERANCE_H)) > 0.01) {
          throw new Error(`sleep floor at ${mpw} mpw is ${floor} h · doctrine target ${target} h less the ${SLEEP_FLOOR_TOLERANCE_H} h tolerance`);
        }
        if (floor <= previous && i > 0) {
          throw new Error(`the sleep floor did not rise from row ${i - 1} to row ${i} · doctrine scales it up with load`);
        }
        previous = floor;
      });
      // And it is genuinely tier-blind.
      const tiers: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'advanced_plus'];
      const floors = new Set(tiers.map((tier) => tierRulesFor(tier, 70).sleep7AvgFloor));
      if (floors.size !== 1) {
        throw new Error(`the sleep floor still varies by experience tier: ${[...floors].join(' · ')}`);
      }
    },
  },
];
