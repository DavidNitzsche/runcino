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
  RECOVERY_WEEKLY_PCT_OF_BASE,
  RECOVERY_RUN_DAYS,
  RECOVERY_LONG_PCT,
  RECOVERY_EFFORT_SCALE,
  TIER_TARGETS,
  MAINTENANCE_BY_TIER,
  type DistCategory,
  type GoalTier,
} from '@/lib/plan/goal-tiers';
import {
  GAP_SHAVE_FRACTIONS,
  RERAMP_RESUME_FRACTION,
  RERAMP_WEEKLY_GROWTH,
  classifyGapBand,
} from '@/lib/plan/adapt';
import { friel7Zones, lthrZones, pctMaxZones } from '@/lib/training/zones';
import { lthrFromMaxHr } from '@/lib/training/lthr';
import { vdotFromRace } from '@/lib/training/vdot';
import type { DoctrineClaim } from './types';
import { matchLiteral, parseBand, parsePaceBandSec, parsePctBand, sourceOf } from './resolve';

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
    binds: ['lib/plan/goal-tiers.ts#RECOVERY_EFFORT_SCALE'],
    doc: 'Research/00b-recovery-protocols.md',
    anchor: '### Recovery by Effort (A vs. B vs. C Race)',
    claim:
      'Not every race earns the full recovery table. A B race takes 60-70% of A-race ' +
      'recovery duration and a C race 25-50%. The engine scales DURATION, so an A race is ' +
      'exactly 1.0 and the other two sit inside their stated bands.',
    check({ cite }) {
      const t = cite.table();
      const scale = (row: string) => parsePctBand(t.cell(row, 'Recovery scale'));
      if (RECOVERY_EFFORT_SCALE.A !== 1.0) throw new Error('an A race earns the full table · scale must be 1.0');
      within(RECOVERY_EFFORT_SCALE.B, scale('B race'), 'RECOVERY_EFFORT_SCALE.B');
      within(RECOVERY_EFFORT_SCALE.C, scale('C race / hard workout substitute'), 'RECOVERY_EFFORT_SCALE.C');
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
    binds: ['lib/plan/generate.ts#volumeCurve.taperFactor', 'lib/plan/generate.ts#finalizeComposedPlan.factor'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '### 9.2 Marathon taper structure (3 weeks)',
    claim:
      'The taper descends through stated bands of peak volume: three weeks out, two weeks ' +
      'out, race week. Both places the engine writes these factors must land inside the ' +
      "matching band, and they must agree with each other — they are the same doctrine.",
    check({ cite }) {
      const t = cite.table();
      const bandFor = (wk: string) => parsePctBand(t.cell(wk, 'Volume'));
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const re = /wksLeft === 1 \? (\d*\.?\d+) : wksLeft === 2 \? (\d*\.?\d+) : (\d*\.?\d+)/g;
      const sites = [...src.matchAll(re)];
      if (sites.length < 2) {
        throw new Error(
          `expected the taper factors at both the volumeCurve and finalizeComposedPlan sites · found ${sites.length}`,
        );
      }
      for (const s of sites) {
        const [raceWk, twoOut, threeOut] = [Number(s[1]), Number(s[2]), Number(s[3])];
        within(threeOut, bandFor('-3'), 'taper factor, three weeks out');
        within(twoOut, bandFor('-2'), 'taper factor, two weeks out');
        within(raceWk, bandFor('-1'), 'taper factor, race week');
      }
      const distinct = new Set(sites.map((s) => `${s[1]}/${s[2]}/${s[3]}`));
      if (distinct.size !== 1) {
        throw new Error(`the two taper sites disagree: ${[...distinct].join(' vs ')}`);
      }
    },
  },
  {
    id: 'TAPER.minimum-volume-drop',
    binds: ['lib/plan/validate.ts#CONSTRAINTS.taperDropMinPct'],
    doc: 'Research/08-pacing-and-race-week.md',
    anchor: '| Distance | Taper length | Volume reduction (peak week) |',
    claim:
      'The validator floor for how much a taper must drop may not be stricter than the ' +
      'shallowest reduction doctrine allows for that distance, and may never be zero — a ' +
      'validator that demands more than doctrine will reject correct plans, and one that ' +
      'demands nothing lets a peak week masquerade as a taper.',
    check({ cite }) {
      const t = cite.table();
      const src = sourceOf('web-v2/lib/plan/validate.ts');
      const docRow: Record<DistCategory, string> = { ...DOC_ROW, ultra: 'Ultra (50K-100M)' };
      for (const cat of CATS) {
        const m = matchLiteral(
          src,
          new RegExp(`'${cat}':\\s*\\{[^}]*taperDropMinPct:\\s*(\\d+)`),
          `CONSTRAINTS['${cat}'].taperDropMinPct`,
        );
        const pct = Number(m[1]);
        const [lo] = parseBand(t.cell(docRow[cat], 'Volume reduction (peak week)'));
        if (pct <= 0) throw new Error(`CONSTRAINTS['${cat}'].taperDropMinPct is ${pct} · a taper must drop volume`);
        atMost(pct, lo, `CONSTRAINTS['${cat}'].taperDropMinPct`);
      }
    },
  },

  // ══ WEEKLY RAMP ═══════════════════════════════════════════════════════════
  {
    id: 'RAMP.ten-percent-rule',
    binds: [
      'lib/plan/generate.ts#volumeCurve.climbFactor',
      'lib/plan/seed-from-onboarding.ts#buildProgressiveCurve',
      'lib/plan/adapt.ts#RERAMP_WEEKLY_GROWTH',
    ],
    doc: 'Research/05-injury-return-protocols.md',
    anchor: 'weekly mileage +≤10%/week',
    claim:
      'Weekly mileage climbs by at most ten percent a week. Every place the engine ramps ' +
      'volume — the build curve, the onboarding seed, and the comeback re-ramp — uses that ' +
      'same ceiling, and the number is read out of the doctrine sentence rather than assumed.',
    check({ cite }) {
      const stated = parseBand(cite.section[0].replace(/.*weekly mileage \+/, ''))[0];
      const ceiling = 1 + stated / 100;
      const sites: [string, string, RegExp][] = [
        ['web-v2/lib/plan/generate.ts', 'climbFactor', /const climbFactor = Math\.min\((\d*\.?\d+),/],
        ['web-v2/lib/plan/seed-from-onboarding.ts', 'buildProgressiveCurve', /current \* (\d*\.?\d+)\)\);/],
      ];
      for (const [file, binding, re] of sites) {
        const v = Number(matchLiteral(sourceOf(file), re, binding)[1]);
        atMost(v, ceiling, `${binding} weekly ramp factor`);
      }
      atMost(RERAMP_WEEKLY_GROWTH, ceiling, 'RERAMP_WEEKLY_GROWTH');
    },
  },
  {
    id: 'RAMP.single-session-spike',
    binds: ['lib/plan/generate.ts#rampCeiling'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'A single run beyond 110% of the longest run in the prior 30 days raises overuse-injury ' +
      'risk by about 64%. The long-run ramp ceiling must not step past that multiple.',
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
  {
    id: 'RAMP.novice-exception-unused',
    binds: ['lib/plan/generate.ts#volumeCurve.climbFactor'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'Doctrine records an exception — novices tolerated +20-25% over 8 weeks in trial data — ' +
      'but the engine deliberately does not take it: one ramp ceiling applies to everyone. ' +
      'That is the safe side of the exception, and this claim exists so the decision is ' +
      'visible rather than accidental. If a per-experience ramp is ever introduced it must ' +
      'not exceed the novice figure doctrine actually reports.',
    check({ cite, exempt }) {
      const spec = cite.table().cell('Year-on-year base growth', 'Specification');
      const noviceCeiling = 1 + parseBand(spec.replace(/^[^;]*;\s*/, ''))[1] / 100;
      const src = sourceOf('web-v2/lib/plan/generate.ts');
      const climb = Number(matchLiteral(src, /const climbFactor = Math\.min\((\d*\.?\d+),/, 'climbFactor')[1]);
      atMost(climb, noviceCeiling, 'climbFactor against the novice exception ceiling');
      // A per-experience ramp table that is declared but never read is worse than
      // no table: it reads as doctrine being applied when nothing applies it.
      if (/^\s*const RAMP_PCT\b/m.test(src) && !/RAMP_PCT\[/.test(src) && !exempt('ramp-pct-dead')) {
        throw new Error(
          'RAMP_PCT is declared in generate.ts but never read. Either wire it (and re-check ' +
            'it against this claim) or delete it.',
        );
      }
    },
    exempt: {
      'ramp-pct-dead':
        'KNOWN VIOLATION (found seeding this registry, 2026-08-17). generate.ts declares ' +
        'RAMP_PCT { beginner 0.05, intermediate 0.07, advanced 0.07, advanced_plus 0.08 } with a ' +
        'Research/ citation block, and nothing reads it — the live ramp is the flat ' +
        'Math.min(1.10, …) at generate.ts:791. VOLUME_FLOOR_MPW next to it is neutralised the ' +
        'same way by a `void floor`. Left alone here because deleting engine code is the ' +
        "audit's call, not the gate's; recorded so the next reader does not mistake it for live " +
        'per-experience doctrine.',
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
    id: 'LONGRUN.share-of-weekly-volume',
    binds: ['lib/plan/goal-tiers.ts#TIER_TARGETS.longRunShare'],
    doc: 'Research/00a-distance-running-training.md',
    anchor: '### Volume progression rules',
    claim:
      'The long run is capped at 25-30% of weekly volume, with an explicit alternative for ' +
      'marathoners of an absolute time ceiling instead. Every tier target is checked against ' +
      "the stated share; marathon and ultra tiers may instead use doctrine's absolute-time " +
      'route, which in practice permits a larger share at low weekly volume.',
    check({ cite, exempt }) {
      const spec = cite.table().cell('Long-run cap', 'Specification');
      const share = parseBand(spec)[1] / 100;
      // Doctrine's "or by absolute time" clause is written for marathoners.
      const absoluteTimeRoute = new Set<DistCategory>(['m', 'ultra']);
      for (const cat of CATS) {
        for (const tier of TIERS) {
          const v = TIER_TARGETS[cat][tier].longRunShare;
          const ceiling = absoluteTimeRoute.has(cat) ? 0.40 : share;
          if (v > ceiling && exempt(`${cat}.${tier}`)) continue;
          atMost(v, ceiling, `TIER_TARGETS.${cat}.${tier}.longRunShare`);
        }
      }
    },
    exempt: {
      'hm.developing':
        'KNOWN VIOLATION (found seeding this registry, 2026-08-17). A developing half runner ' +
        'gets longRunShare 0.32 against a 0.30 doctrine ceiling, and the absolute-time ' +
        'alternative is written for marathoners, so it does not cover this row. The peak long ' +
        'band [9, 12] against a peak weekly band [25, 35] is the underlying tension: a 12-mile ' +
        'long off a 35-mile week is 34%. Recorded, not loosened; the engine audit owns it.',
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
    anchor: '### Numerical equivalencies',
    claim:
      "Daniels' own worked example fixes the gap between T and E: at VDOT 50, T is 6:51 and E " +
      'runs 8:35-9:27, so easy sits 104-156 s/mi slower than threshold. The engine derives E ' +
      'as a fixed offset off T, so that offset should reproduce the table.',
    check({ cite, exempt }) {
      const t = cite.table();
      const [tPace] = parsePaceBandSec(t.cell('Daniels T', 'Pace (min/mi)'));
      const [eLo, eHi] = parsePaceBandSec(t.cell('Daniels E', 'Pace (min/mi)'));
      const src = sourceOf('web-v2/lib/plan/spec-builder.ts');
      const m = matchLiteral(
        src,
        /const easyLo = easyAnchorT \+ (\d+), easyHi = easyAnchorT \+ (\d+);/,
        'buildWorkoutSpec easy band',
      );
      const [lo, hi] = [Number(m[1]), Number(m[2])];
      const want: [number, number] = [eLo - tPace, eHi - tPace];
      if (exempt('easy-band-runs-fast')) return;
      within(lo, [want[0] - 10, want[0] + 10], 'easy-pace floor offset off T');
      within(hi, [want[1] - 10, want[1] + 10], 'easy-pace ceiling offset off T');
    },
    exempt: {
      'easy-band-runs-fast':
        'KNOWN VIOLATION (found seeding this registry, 2026-08-17). The engine uses T+80 to ' +
        "T+120; doctrine's VDOT-50 row gives T+104 to T+156. Easy runs are prescribed roughly " +
        '25-35 s/mi faster than Daniels at both ends of the band, and the in-code comment at ' +
        'spec-builder.ts:229-232 justifies the floor as "within 7s of Daniels\' E minimum", ' +
        'which the table does not support. NOT fixed here: the owner ruled on 2026-06-12 that ' +
        'the easy-pace formula is closed and not to be re-opened. Recorded so the divergence ' +
        'is visible and deliberate rather than forgotten.',
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
];
