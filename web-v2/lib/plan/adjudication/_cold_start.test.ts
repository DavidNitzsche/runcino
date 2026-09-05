/**
 * lib/plan/adjudication/_cold_start.test.ts · A RUNNER THIS LAYER HAS NEVER
 * SEEN RUN GETS A PLAN, HONESTLY.
 *
 * ── WHAT THIS GATE IS FOR ──────────────────────────────────────────────────
 *
 * Measured on production, 2026-09-05: six of seven active plans belong to
 * accounts with zero canonical runs, and every one of them failed promotion —
 * not on a defect in the plan, but on `progression · no decision in this block
 * advances anything`, because a hold hard-coded to SUPPORTED beat an UNKNOWN
 * push in every week of every block.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · IT CANNOT FAIL ON THE OPENING BAND BEING THE WRONG COACHING ANSWER. It
 *   checks that the constant equals `Research/00a`'s beginner column, parsed
 *   out of the document at run time. Whether that column suits a runner who is
 *   experienced but has not connected a watch, nothing here can tell — and that
 *   case is real and common.
 * · IT CANNOT FAIL ON THE CALIBRATION BEING ACHIEVABLE. It checks that a
 *   schedule exists and is dated before the thing it informs. Whether the
 *   runner can complete three consecutive weeks at the bar is his business.
 * · IT CANNOT FAIL ON THE PLAN ITSELF. The blocks below are constructed here.
 *   A cold-start block whose every week is defensible and whose every week is
 *   also badly chosen passes: this asks whether the decisions are ADJUDICABLE,
 *   not whether they are good.
 * · IT CANNOT FAIL ON A RUNNER WHOSE HISTORY IS PRESENT BUT WRONG. Cold start
 *   turns on ABSENCE only, and a fabricated peak week reads as an established
 *   runner here.
 *
 * ── DISTRIBUTION (Rule 22 §2) ──────────────────────────────────────────────
 *
 * The cases below deliberately run BOTH ways: a cold start that promotes, and
 * six distinct dishonest cold starts that must be blocked by name. A suite that
 * only proved "the new runner now promotes" would pass an implementation that
 * promoted everything.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  COLD_START_ACCELERATED_STEP_MAX, COLD_START_LONG_RUN_SHARE_OF_WEEK,
  COLD_START_WEEKLY_BAND_MI, RACE_DISTANCE_KEYS, calibrationFor, coldStartClassFor,
  coldStartFaults, coldStartFor, researchAllowanceFor,
} from './cold-start';
import { athleteEvidenceFor, checkPromotion } from './adjudicate';
import { adjudicateColdStartBlock, holdClassFor, type ComposedWeekLike } from '../adjudication-corpus';
import type { AthleteEvidence } from './contract';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const DOC = 'Research/00a-distance-running-training.md';
const doc = () => readFileSync(path.join(REPO_ROOT, DOC), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
 * 0 · THE NUMBERS COME OUT OF THE DOCUMENT  ·  Rule 18
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the research allowance is READ from Research/00a, not hardcoded twice', () => {
  it('liveness · the document and its two tables are present', () => {
    const t = doc();
    expect(t).toContain('### Volume table — miles per week (km in parentheses)');
    expect(t).toContain('### Volume progression rules');
  });

  it('the beginner weekly band matches the doc\'s own beginner column', () => {
    // SCOPED TO THE SECTION, not to the whole file. `| Half-marathon |` and
    // `| Marathon |` both also start rows in the intensity-distribution table
    // ninety lines earlier, and a first-match search over the file would have
    // read that table's second column as a volume band. Rule 14 in miniature:
    // the query names the population it reads.
    const t = doc();
    const from = t.indexOf('### Volume table — miles per week (km in parentheses)');
    const to = t.indexOf('### Volume progression rules', from);
    expect(from, 'the volume table is gone').toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const table = t.slice(from, to);
    const rows: Record<string, string> = {
      '5k': '5K', '10k': '10K', half: 'Half-marathon', marathon: 'Marathon',
      '50k': '50K', '100k': '100K',
    };
    for (const key of RACE_DISTANCE_KEYS) {
      const line = table.split('\n').find((l) => l.startsWith(`| ${rows[key]} |`));
      expect(line, `no volume-table row for ${rows[key]}`).toBeTruthy();
      // "| 5K | 10–20 (16–32) | ..." · the FIRST cell after the label is the
      // beginner column, and the parenthesised figure is km.
      const beginner = line!.split('|')[2].trim().replace(/\(.*\)/, '').trim();
      const [lo, hi] = beginner.split(/[–-]/).map((n) => Number(n.trim()));
      expect([lo, hi], `${key} beginner band drifted from the doc`)
        .toEqual([...COLD_START_WEEKLY_BAND_MI[key]]);
    }
  });

  it('the long-run share matches the doc\'s own long-run cap', () => {
    const line = doc().split('\n').find((l) => l.startsWith('| Long-run cap |'));
    expect(line, 'no long-run cap row').toBeTruthy();
    // The doc writes the cap as a BAND with one percent sign: "<=25-30% of
    // weekly volume". Parsing bare `(\d+)%` reads only the upper number and
    // would agree with any constant that happened to match it.
    const band = line!.match(/(\d+)[–-](\d+)%/);
    expect(band, 'the long-run cap is no longer stated as a percentage band').toBeTruthy();
    expect(COLD_START_LONG_RUN_SHARE_OF_WEEK).toBe(Number(band![2]) / 100);
    expect(COLD_START_LONG_RUN_SHARE_OF_WEEK).toBeGreaterThan(Number(band![1]) / 100);
  });

  it('the accelerated ramp matches the doc\'s own novice trial figure', () => {
    const line = doc().split('\n').find((l) => l.startsWith('| Year-on-year base growth |'));
    expect(line, 'no base-growth row').toBeTruthy();
    // "novices safely +20–25% over 8 weeks vs. +10% over 12 in trial data"
    const novice = line!.match(/novices safely \+(\d+)[–-](\d+)%/);
    expect(novice, 'the doc no longer states a novice ramp band').toBeTruthy();
    expect(COLD_START_ACCELERATED_STEP_MAX).toBe(Number(novice![2]) / 100);
  });

  it('a research allowance carries CALCULATED_PHYSIOLOGY and a resolvable anchor', () => {
    for (const key of RACE_DISTANCE_KEYS) {
      for (const q of ['WEEKLY_VOLUME', 'LONG_RUN'] as const) {
        const a = researchAllowanceFor(q, key)!;
        expect(a.provenance).toBe('CALCULATED_PHYSIOLOGY');
        expect(doc().includes(a.anchor), `${a.anchor} no longer resolves in ${a.doc}`).toBe(true);
        expect(a.value).toBeGreaterThan(0);
      }
    }
  });

  it('Rule 11 · the marathon-pace dose has NO allowance, and says so', () => {
    // No research table states an opening M dose for a runner with no record.
    // Inventing a share of something would be a policy assumption in a research
    // number's clothes, which `adjudicate.ts` already calls out about its own
    // volume band.
    for (const key of RACE_DISTANCE_KEYS) {
      expect(researchAllowanceFor('MARATHON_PACE_DOSE', key)).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE POSTURE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the cold-start posture', () => {
  const cold = (max: number | null) => coldStartFor({
    quantity: 'WEEKLY_VOLUME', distance: 'marathon',
    demonstratedMaxToday: max, reassessOnISO: '2026-09-01',
  });

  it('fires only on a genuinely ABSENT maximum, never on a measured zero', () => {
    expect(cold(null)).not.toBeNull();
    expect(cold(0), 'a measured zero was read as an absence').toBeNull();
    expect(cold(31)).toBeNull();
  });

  it('is LOW confidence, with a sentence that says what is missing', () => {
    const p = cold(null)!;
    expect(p.confidence).toBe('LOW');
    expect(p.confidenceSentence).toContain('Nothing in this runner');
    expect(p.reason).toBe('NO_DEMONSTRATED_MAXIMUM');
    expect(p.inventsNoAthleteSupport).toBe(true);
  });

  it('schedules calibration that is EXACTLY the canonical contract\'s own bar', () => {
    // Rule 16 · a cold-start runner is asked to demonstrate the same thing an
    // established one is. These strings are built from `contract-constants.ts`,
    // so the assertion is that the numbers travelled rather than being retyped.
    const v = calibrationFor('WEEKLY_VOLUME', '2026-09-01')[0];
    expect(v.measurable).toContain('3 consecutive non-cutback weeks');
    expect(v.measurable).toContain('95%');
    const l = calibrationFor('LONG_RUN', '2026-09-01')[0];
    expect(l.measurable).toContain('2 most recent prescribed long runs');
  });

  it('faster progression is the doc\'s own novice figure, not a chosen one', () => {
    const p = cold(null)!;
    expect(p.acceleratedProgression!.maxStep).toBe(COLD_START_ACCELERATED_STEP_MAX);
    expect(p.acceleratedProgression!.basis).toContain('novices ramping');
    // Rule 21 · headroom doctrine already allows, never a weakened guard. The
    // ESTABLISHED runner's band is untouched: `coldStartFor` returns null for
    // him, so he never reaches this figure at all.
    expect(cold(31)).toBeNull();
  });

  it('is capped at ALLOWED · a cold start can never be SUPPORTED', () => {
    const p = cold(null)!;
    const allowance = p.allowance!.value;
    expect(coldStartClassFor(allowance - 1, p)).toBe('ALLOWED');
    expect(coldStartClassFor(allowance, p)).toBe('ALLOWED');
    expect(coldStartClassFor(allowance + 0.1, p)).toBe('CONDITIONAL');
    expect(coldStartClassFor(null, p)).toBe('UNKNOWN');
    // and there is no input at all that produces SUPPORTED
    for (let mi = 0; mi <= 120; mi += 0.5) {
      expect(coldStartClassFor(mi, p)).not.toBe('SUPPORTED');
    }
  });

  it('Rule 9 · the band edge buys a gate, never a refusal', () => {
    // Both sides of the allowance are PRESCRIBED. The difference is whether the
    // decision carries an earning gate and a reassessment, which is a
    // difference of degree, and it is the same shape `classifyStep`'s own bands
    // already have.
    const p = cold(null)!;
    const classes = new Set<string>();
    for (let mi = p.allowance!.value - 2; mi <= p.allowance!.value + 2; mi += 0.1) {
      classes.add(coldStartClassFor(Math.round(mi * 10) / 10, p));
    }
    expect([...classes].sort()).toEqual(['ALLOWED', 'CONDITIONAL']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · PER QUANTITY, NOT PER PLAN
 * ═══════════════════════════════════════════════════════════════════════ */

describe('conservative only where evidence is genuinely absent', () => {
  it('a runner with a peak week but no long run is cold on the LONG RUN only', () => {
    expect(coldStartFor({
      quantity: 'WEEKLY_VOLUME', distance: 'half',
      demonstratedMaxToday: 34, reassessOnISO: '2026-09-01',
    })).toBeNull();
    expect(coldStartFor({
      quantity: 'LONG_RUN', distance: 'half',
      demonstratedMaxToday: null, reassessOnISO: '2026-09-01',
    })).not.toBeNull();
  });

  it('the HOLD option stops claiming support the runner has not given', () => {
    // This was the actual defect: a SUPPORTED hold for a runner with no
    // demonstrated level. Both directions asserted, so a future fix that made
    // EVERY hold unknown would fail too.
    expect(holdClassFor(null)).toBe('UNKNOWN');
    expect(holdClassFor(48.5)).toBe('SUPPORTED');
    expect(holdClassFor(0)).toBe('SUPPORTED');
  });

  it('the demonstrated-maximum fields stay NULL · no invented athlete support', () => {
    const e = athleteEvidenceFor({
      what: 'a 30 mi week',
      asOfISO: '2026-10-01',
      prescribed: 30,
      demonstratedMaxToday: null,
      demonstratedMaxProjected: null,
      comparables: [],
      historyWindow: 'no completed runs',
      coldStart: coldStartFor({
        quantity: 'WEEKLY_VOLUME', distance: 'marathon',
        demonstratedMaxToday: null, reassessOnISO: '2026-09-24',
      }),
    });
    expect(e.evidenceClass).toBe('ALLOWED');
    expect(e.demonstratedMaxToday.value).toBeNull();
    expect(e.demonstratedMaxToday.provenance).toBe('ATHLETE_EVIDENCE');
    expect(e.coldStart).not.toBeNull();
    expect(e.coldStart!.allowance!.provenance).toBe('CALCULATED_PHYSIOLOGY');
    // The two are printed in different voices, which `evidenceProvenance`
    // already checks at the gate.
    expect(e.demonstratedMaxToday.provenance)
      .not.toBe(e.coldStart!.allowance!.provenance);
  });

  it('a caller cannot declare a cold start for a runner who HAS a maximum', () => {
    const e = athleteEvidenceFor({
      what: 'a 50 mi week',
      asOfISO: '2026-10-01',
      prescribed: 50,
      demonstratedMaxToday: 48.5,
      demonstratedMaxProjected: 48.5,
      comparables: [],
      historyWindow: 'a year',
      coldStart: coldStartFor({
        quantity: 'WEEKLY_VOLUME', distance: 'marathon',
        demonstratedMaxToday: null, reassessOnISO: '2026-09-24',
      }),
    });
    expect(e.coldStart).toBeNull();
    expect(e.evidenceClass).not.toBe('ALLOWED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · IT PROMOTES, AND IT DOES NOT BYPASS ADJUDICATION
 * ═══════════════════════════════════════════════════════════════════════ */

/** A plain, sane opening block for a marathon beginner. */
const openingBlock = (): ComposedWeekLike[] => {
  const weeks: ComposedWeekLike[] = [];
  let mi = 20;
  for (let i = 0; i < 12; i += 1) {
    const startISO = new Date(Date.parse('2026-09-07T00:00:00Z') + i * 7 * 86_400_000)
      .toISOString().slice(0, 10);
    const isTaper = i >= 10;
    const weekly = isTaper ? Math.round(mi * 0.7) : mi;
    const long = Math.round(weekly * 0.3);
    weeks.push({
      startISO,
      phase: isTaper ? 'TAPER' : 'BASE',
      weeklyMi: weekly,
      isRaceWeek: false,
      days: [
        { type: 'easy', distanceMi: weekly - long, isQuality: false, isLong: false },
        { type: 'long', distanceMi: long, isQuality: false, isLong: true },
      ],
    });
    // Inside the novice ramp the trial supports, and a cutback every fourth.
    if (!isTaper) mi = (i + 1) % 4 === 0 ? Math.round(mi * 0.8) : Math.round(mi * 1.06);
  }
  return weeks;
};

describe('a cold-start block promotes', () => {
  const run = () => adjudicateColdStartBlock({
    weeks: openingBlock(),
    raceDistance: 'marathon',
    why: 'no completed runs are recorded for this account',
  });

  it('it promotes, and it made real cold-start decisions', () => {
    const adj = run();
    expect(adj.result.blockedBecause, adj.result.blockedBecause.join(' | ')).toEqual([]);
    expect(adj.result.mayPromote).toBe(true);
    // Rule 18 §2 · not vacuously true on an empty set.
    expect(adj.result.coldStartDecisions).toBeGreaterThan(0);
  });

  it('it advances · the thing the old policy could not do', () => {
    const adj = run();
    expect(adj.result.traces.some((t) => t.chosen === 'PUSH')).toBe(true);
    expect(adj.result.check.progression).toBe(true);
  });

  it('every cold-start decision carries a reassessment and low confidence', () => {
    for (const t of run().result.traces) {
      if (t.athlete.coldStart === null) continue;
      expect(t.reassessOnISO, `${t.decisionId} has no reassessment`).not.toBeNull();
      expect(t.athlete.coldStart.confidence).toBe('LOW');
      expect(t.athlete.coldStart.calibration.length).toBeGreaterThan(0);
    }
  });

  it('nothing is classed SUPPORTED anywhere in the block', () => {
    for (const t of run().result.traces) {
      expect(t.athlete.evidenceClass, `${t.decisionId}`).not.toBe('SUPPORTED');
    }
  });

  it('and every OTHER promotion dimension still had to hold', () => {
    // The cold start does not wave the block through: the ten dimensions that
    // existed before are all still evaluated and all still true here.
    const c = run().result.check;
    for (const [k, v] of Object.entries(c)) expect(v, `${k} is false`).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3b · THE LEGACY READING CANNOT BECOME A SECOND LIVE ENGINE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('LEGACY_NO_COLD_START is reachable from the replay script and nowhere else', () => {
  const LIB = path.join(__dirname, '..', '..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('._')) continue;
      const q = path.join(dir, name);
      if (statSync(q).isDirectory()) walk(q, out);
      else if (q.endsWith('.ts')) out.push(q);
    }
    return out;
  }

  /** Comments are prose and may legitimately NAME what they are about. */
  const stripComments = (src: string): string => src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, p1: string) => p1);

  const ALL = walk(LIB);

  it('liveness · the scanner read the library', () => {
    // Rule 18 §2 · a scanner that looked at nothing must not report clean.
    expect(ALL.length).toBeGreaterThan(100);
    expect(ALL.some((f) => f.endsWith('adjudication-corpus.ts'))).toBe(true);
  });

  it('ORACLE · the detector fires on a planted call', () => {
    expect(stripComments("const r = 'LEGACY_NO_COLD_START';"))
      .toContain('LEGACY_NO_COLD_START');
    expect(stripComments('/* LEGACY_NO_COLD_START in prose */\nconst x = 1;'))
      .not.toContain('LEGACY_NO_COLD_START');
  });

  it('only the definition, the replay and this file name it in CODE', () => {
    const namers = ALL.filter((f) => stripComments(readFileSync(f, 'utf8'))
      .includes('LEGACY_NO_COLD_START'));
    // Liveness first: the definition and the replay MUST be in the list, or
    // the scanner has stopped matching and would report clean on anything.
    const rel = namers.map((f) => path.relative(LIB, f)).sort();
    expect(rel, 'the scanner found nobody, so it is not matching')
      .toContain('plan/adjudication-corpus.ts');
    expect(rel).toContain('plan/adjudication/_promotion_replay.script.ts');

    // The assertion itself, stated as a PROPERTY rather than a fixed list, so
    // a NEW caller fails while a rename or a reordering does not. An
    // `expect(rel).toEqual(list.filter(x => rel.includes(x)))` would have been
    // satisfied by any list at all, which is Rule 18's "a check nothing can
    // make fail".
    for (const f of namers) {
      const r = path.relative(LIB, f);
      expect(
        r === 'plan/adjudication-corpus.ts' || /\.(test|script)\.ts$/.test(r),
        `${r} names LEGACY_NO_COLD_START in code. It is a counterfactual reading, `
        + 'not a fallback, and it may not acquire a live caller.',
      ).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE DISHONEST COLD STARTS, BLOCKED BY NAME
 * ═══════════════════════════════════════════════════════════════════════ */

describe('coldStartFaults · six ways to be dishonest, each named', () => {
  const posture = coldStartFor({
    quantity: 'WEEKLY_VOLUME', distance: 'marathon',
    demonstratedMaxToday: null, reassessOnISO: '2026-09-24',
  })!;
  const athlete = (o: Partial<AthleteEvidence> = {}): AthleteEvidence => ({
    ...athleteEvidenceFor({
      what: 'a 30 mi week', asOfISO: '2026-10-01', prescribed: 30,
      demonstratedMaxToday: null, demonstratedMaxProjected: null,
      comparables: [], historyWindow: 'nothing', coldStart: posture,
    }),
    ...o,
  });
  const faults = (o: {
    athlete?: AthleteEvidence; posture?: typeof posture; hasGate?: boolean; landsOnISO?: string;
  } = {}) => coldStartFaults({
    decisionId: 'wk:2026-10-01',
    athlete: o.athlete ?? athlete(),
    posture: o.posture ?? posture,
    hasGate: o.hasGate ?? true,
    landsOnISO: o.landsOnISO ?? '2026-10-01',
  });

  it('the honest case is clean · liveness', () => {
    expect(faults()).toEqual([]);
  });

  it('1 · a cold start that also reports a demonstrated maximum', () => {
    const f = faults({
      athlete: athlete({
        demonstratedMaxToday: { value: 40, provenance: 'ATHLETE_EVIDENCE', basis: 'x' },
      }),
    });
    expect(f.join(' ')).toContain('One of the two is false');
  });

  it('2 · a cold start classed SUPPORTED', () => {
    expect(faults({ athlete: athlete({ evidenceClass: 'SUPPORTED' }) }).join(' '))
      .toContain('ALLOWED is the strongest class available');
  });

  it('3 · a cold start classed CONTRAINDICATED', () => {
    expect(faults({ athlete: athlete({ evidenceClass: 'CONTRAINDICATED' }) }).join(' '))
      .toContain('argues neither for nor against it');
  });

  it('4 · a cold start with no calibration scheduled', () => {
    expect(faults({ posture: { ...posture, calibration: [] } }).join(' '))
      .toContain('makes the low confidence permanent');
  });

  it('5 · a reassessment scheduled AFTER the thing it guards', () => {
    expect(faults({ posture: { ...posture, reassessOnISO: '2026-11-01' } }).join(' '))
      .toContain('cannot change anything');
  });

  it('6 · a prescription past the research allowance with no gate', () => {
    const over = athleteEvidenceFor({
      what: 'a 90 mi week', asOfISO: '2026-10-01', prescribed: 90,
      demonstratedMaxToday: null, demonstratedMaxProjected: null,
      comparables: [], historyWindow: 'nothing', coldStart: posture,
    });
    expect(over.evidenceClass).toBe('CONDITIONAL');
    expect(faults({ athlete: over, hasGate: false }).join(' '))
      .toContain('it has to be earned');
  });

  it('and a no-allowance quantity with no gate is a number with nothing behind it', () => {
    const mp = coldStartFor({
      quantity: 'MARATHON_PACE_DOSE', distance: 'marathon',
      demonstratedMaxToday: null, reassessOnISO: '2026-09-24',
    })!;
    expect(mp.allowance).toBeNull();
    expect(faults({ posture: mp, hasGate: false }).join(' '))
      .toContain('nothing behind it at all');
  });

  it('checkPromotion blocks on every one of them, by dimension name', () => {
    const t = {
      decisionId: 'wk:2026-10-01', dateISO: '2026-10-01', what: 'weekly volume',
      windowDays: 7 as const,
      athlete: athlete({ evidenceClass: 'SUPPORTED' }),
      stacked: null, demand: null,
      options: [
        { option: 'PUSH' as const, describe: 'p', evidenceClass: 'ALLOWED' as const, heuristicRankScore: { value: 0.7, provenance: 'POLICY_ASSUMPTION' as const, basis: 'b' }, risk: '' },
        { option: 'HOLD' as const, describe: 'h', evidenceClass: 'UNKNOWN' as const, heuristicRankScore: null, risk: '' },
        { option: 'PULL_BACK' as const, describe: 'b', evidenceClass: 'UNKNOWN' as const, heuristicRankScore: null, risk: '' },
      ],
      chosen: 'PUSH' as const, because: 'x', rejected: [], conflicts: [], citations: [],
      reassessOnISO: '2026-09-24', earningGate: null,
    };
    const r = checkPromotion([t], { weeks: [] });
    expect(r.check.coldStartHonesty).toBe(false);
    expect(r.blockedBecause.join(' ')).toContain('coldStartHonesty ·');
    expect(r.mayPromote).toBe(false);
  });
});
