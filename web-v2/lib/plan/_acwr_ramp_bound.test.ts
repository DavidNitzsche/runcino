/**
 * lib/plan/_acwr_ramp_bound.test.ts · the gate that replaced the readiness bar
 * on the upward path.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS
 *
 * `detectRampSignals` gate 1 used to be "readiness GREEN". The owner ruled
 * (2026-09-02) that HE decides how ready he is, so a readiness snapshot may no
 * longer decide whether his plan is allowed to grow, and
 * `_ramp_readiness_bar.test.ts` — which was entirely about that bar — is
 * deleted. This file is its replacement, and it is NOT a like-for-like port:
 * the question the gate asks has changed, so the properties have changed with
 * it.
 *
 * Deleting the readiness gate and stopping there would have made this module
 * STRICTLY MORE PERMISSIVE — a missing input silently ENABLING a load
 * increase, which is CLAUDE.md Rule 11 in its worst direction. So it was
 * replaced by `acwrHeadroom`: the acute:chronic workload ratio, read from what
 * the runner ACTUALLY RAN (`lib/coach/acwr.ts`, over `runs`), asking the one
 * thing the readiness gate was reaching for that training can answer — is he
 * already carrying more than he has built up to.
 *
 * ── BOTH DIRECTIONS, DELIBERATELY (Rule 21, Rule 22) ───────────────────────
 *
 * Rule 22's measurement on this repo: 29 test files know how to HOLD a runner
 * back, 2 know what it means to ACCELERATE one. A gate that only ever asks
 * "did you correctly refuse?" will pass an engine that can only refuse. So the
 * PERMIT direction is asserted first and hardest here:
 *
 *   · a ratio inside the sweet spot PERMITS, and permits alongside every other
 *     gate green, so this is a bar and not a wall;
 *   · a ratio in the DETRAINING zone (< 0.8) also permits — the gate is a
 *     ceiling on adding, never a window, and a runner who has been doing
 *     little is not thereby refused more;
 *   · only at or above doctrine's own sweet-spot ceiling does it refuse.
 *
 * ── THE THREE FACTS, KEPT APART (Rule 11) ──────────────────────────────────
 *
 * A real ratio, "not enough history to answer honestly", and "the read threw"
 * are three facts. The last two both refuse — a guard that cannot see its own
 * evidence must not authorise more mileage — but they stay DISTINGUISHABLE in
 * `details.acwrAbsentReason`, because a runner with no chronic baseline yet
 * and a database outage are opposite things to report.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22, stated as required) ────────────
 *
 *   · It cannot fail on `computeAcwr` computing the WRONG RATIO. The ratio is
 *     mocked here so the gate's response to a ratio can be walked; the
 *     arithmetic, the windows, the dedupe and the three absent-reasons belong
 *     to `lib/coach/_acwr.test.ts` and are asserted there. If `computeAcwr`
 *     started returning 0.4 for a runner who has doubled his week, every
 *     assertion below still passes.
 *   · It cannot fail on the OTHER four ramp gates being wrong. It poses them
 *     green so the permit direction is reachable; `_guard_fail_closed.test.ts`
 *     owns their failure postures.
 *   · It cannot fail on the bump, once permitted, being the RIGHT SIZE. That
 *     is `buildBumpAction`'s tier ceiling and `_bump_pullback_guard.test.ts`'s
 *     48-hour window.
 *   · It cannot see whether the cron actually CALLS any of this. Rule 21's
 *     complaint — wired, tested and inert — is not answerable from a unit
 *     test, and this file does not claim to answer it.
 *
 * Rule 18 · falsified before it was trusted. Inverting the comparison in
 * `detectRampSignals` (`>` for `<`) turns the permit cases red and the refusal
 * case red, in both the walk and the fixture tests. The observed output is in
 * the session report.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_acwr_ramp_bound.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// vi.mock is hoisted · these must precede every import that resolves them.
vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

vi.mock('@/lib/runtime/runner-tz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runnerToday: vi.fn().mockResolvedValue('2026-09-02'),
}));

vi.mock('@/lib/coach/acwr', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  computeAcwr: vi.fn(),
}));

vi.mock('@/lib/execution/load', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadKeySessionExecutions: vi.fn(),
}));

import { pool } from '@/lib/db/pool';
import { computeAcwr, type AcwrAbsentReason, type AcwrResult } from '@/lib/coach/acwr';
import { loadKeySessionExecutions } from '@/lib/execution/load';
import { detectRampSignals, ceilingCanNeverBind } from './adaptive-ramp';

const UUID = '00000000-0000-0000-0000-000000000042';

/** Tier band 30-50 mi, plan peaking at 30 · genuine headroom to the upper. */
const PLAN = {
  id: 'pln_acwr',
  authoredState: {
    tier_peak_weekly_band: [30, 50],
    tier_peak_long_band: [12, 20],
  } as Record<string, unknown>,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
/** Every statement the code under test issued · the liveness probe reads it. */
let issued: string[] = [];

/**
 * Answer every read the signal pass makes so that the four gates OTHER than
 * ACWR come back green. Without this the permit direction is unreachable and
 * the file could only ever assert refusals — which is exactly the bias Rule 22
 * names.
 */
function greenRouter(sql: string): { rows: Record<string, unknown>[] } {
  issued.push(sql);
  // Last long run, 2.0% decoupling · well inside the 5% cap.
  if (sql.includes('aerobicDecouplingPct')) return { rows: [{ decoupling: 2.0 }] };
  // Plan peaks at 30 against a 50 upper · 20 mi of headroom.
  if (sql.includes('MAX(weekly)')) return { rows: [{ peak_weekly: 30, peak_long: 12 }] };
  // The measured anchor the execution reader is sized against.
  if (sql.includes('projection_snapshots')) return { rows: [{ vdot: '52' }] };
  // No bump on record · the 7-day cooldown is open.
  if (sql.includes('coach_intents')) return { rows: [] };
  return { rows: [] };
}

/** Two key sessions in the window, both of which EARNED progression. */
const TWO_EARNED = [
  { dateISO: '2026-08-30', readable: true, replacedByRace: false, earnsProgression: true },
  { dateISO: '2026-08-26', readable: true, replacedByRace: false, earnsProgression: true },
];

const ratio = (acwr: number): AcwrResult => ({
  acwr, acute7: 6.0, chronic28: +(6.0 / acwr).toFixed(2), coverageDays: 28, reason: null,
});

const absent = (reason: AcwrAbsentReason): AcwrResult => ({
  acwr: null, acute7: null, chronic28: null, coverageDays: 28, reason,
});

/** Arm the ratio read, then run the signal pass. */
async function signalsFor(read: AcwrResult | Error) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = computeAcwr as any;
  if (read instanceof Error) fn.mockRejectedValue(read);
  else fn.mockResolvedValue(read);
  return detectRampSignals(UUID, PLAN);
}

beforeEach(() => {
  vi.clearAllMocks();
  issued = [];
  query.mockImplementation(async (sql: unknown) => greenRouter(String(sql)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (loadKeySessionExecutions as any).mockResolvedValue(TWO_EARNED);
});

/* ══════════════════════════════════════════════════════════════════════════
 * DOCTRINE · the number is READ from the research, not restated here.
 *
 * Rule 18: "read numbers out of the cited source at run time rather than
 * hardcoding both sides — a check that hardcodes both only proves the test
 * agrees with itself."
 * ═══════════════════════════════════════════════════════════════════════ */

/** Gabbett's sweet-spot upper bound, parsed out of Research/15's own table. */
function sweetSpotUpperFromResearch(): number {
  const doc = path.join(process.cwd(), '..', 'Research', '15-wearable-data.md');
  const src = fs.readFileSync(doc, 'utf8');
  const anchor = '### Acute:Chronic Workload Ratio (ACWR)';
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`Research/15 no longer carries the anchor "${anchor}"`);
  // `| 0.8 – 1.3 | Sweet spot |` · en-dash in the source, so match loosely.
  const row = /\|\s*([\d.]+)\s*[–—-]\s*([\d.]+)\s*\|\s*Sweet spot\s*\|/i.exec(src.slice(at));
  if (!row) throw new Error('Research/15 §ACWR no longer carries a "Sweet spot" band row');
  return Number(row[2]);
}

describe('ACWR ramp bound · doctrine supplies the number', () => {
  it('the research still carries the band this gate is built on', () => {
    const upper = sweetSpotUpperFromResearch();
    expect(upper).toBeGreaterThan(1);
    expect(upper).toBeLessThan(2);
  });

  it('RULE 21 · the bar to ADD is doctrine\'s own edge, not a stricter one of ours', async () => {
    /* The property the deleted `_ramp_readiness_bar.test.ts` existed to
     * protect, restated for the gate that replaced it: the bar to go UP may
     * not be higher than doctrine's. The old readiness gate failed exactly
     * this — it blocked every bump on ONE dragging pillar, three whole domains
     * below what the pull-back path needed before it could touch the plan, so
     * the fitter runner got the worse plan.
     *
     * Walked rather than read off a constant, because the constant is not
     * exported and because behaviour is what the runner gets. The flip point
     * of the real gate must land ON doctrine's sweet-spot ceiling. */
    const upper = sweetSpotUpperFromResearch();
    let lastPermitted: number | null = null;
    let firstRefused: number | null = null;
    for (let r = 100; r <= 160; r++) {
      const v = r / 100;
      const s = await signalsFor(ratio(v));
      if (s.acwrHeadroom) lastPermitted = v;
      else if (firstRefused === null) firstRefused = v;
    }
    expect(firstRefused, 'the gate never refused anywhere in 1.00-1.60').not.toBeNull();
    expect(lastPermitted, 'the gate never permitted anywhere in 1.00-1.60').not.toBeNull();
    // Refusal begins exactly at doctrine's ceiling · not below it (stricter
    // than the research, the Rule 21 defect) and not above it (a guard the
    // research does not support).
    expect(firstRefused).toBeCloseTo(upper, 5);
    expect(lastPermitted).toBeCloseTo(upper - 0.01, 5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE PERMIT DIRECTION · asserted first, because the engine's instinct and
 * this suite's instinct are both to refuse.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ACWR ramp bound · a runner inside his band is PERMITTED to grow', () => {
  it('LIVENESS · the signal pass actually ran and actually read the ratio', async () => {
    // Rule 18 §2 · a scan that opens nothing reports clean, which is worse
    // than reporting nothing because it also reports confidence. Every
    // assertion in this file is downstream of these three facts.
    const s = await signalsFor(ratio(0.95));
    expect(computeAcwr, 'the gate never asked for a ratio').toHaveBeenCalledTimes(1);
    expect(issued.length, 'the signal pass issued no statements at all').toBeGreaterThan(0);
    expect(s.details.acwr, 'the ratio never reached the details object').toBe(0.95);
  });

  it('a ratio inside the sweet spot permits', async () => {
    const s = await signalsFor(ratio(0.95));
    expect(s.acwrHeadroom).toBe(true);
    expect(s.details.acwrAbsentReason).toBeNull();
  });

  it('THE BAR IS NOT A WALL · every gate can be green at once', async () => {
    /* Rule 21's standard for an adaptation: compute what the runner would have
     * to DO to trigger it, and check that a real week could. The upward path
     * in this app has fired ZERO times in 309 production intents, and the
     * cause was never a bar that was too high — it was gates reading fields
     * that could not be populated. So the permit case is posed end to end:
     * two key sessions earned, a clean long, headroom to the tier upper, no
     * bump in the cooldown, ratio in the band. If this cannot go green, the
     * ramp is unreachable again and this test says so rather than passing on
     * a refusal. */
    const s = await signalsFor(ratio(1.05));
    expect({
      acwrHeadroom: s.acwrHeadroom,
      lastQualityOnPace: s.lastQualityOnPace,
      lastLongClean: s.lastLongClean,
      belowTierUpper: s.belowTierUpper,
      noBumpRecent: s.noBumpRecent,
    }).toEqual({
      acwrHeadroom: true,
      lastQualityOnPace: true,
      lastLongClean: true,
      belowTierUpper: true,
      noBumpRecent: true,
    });
  });

  it('A LOW RATIO IS NOT A REFUSAL · the gate is a ceiling on adding, not a window', async () => {
    /* Research/15 calls < 0.8 "detraining / undertrained". That is a reason to
     * give a runner MORE, and it is precisely the reading a coach must not
     * turn into a refusal — the whole point of the ratio here is that the
     * plan may not stack an increase on top of one the runner has already
     * taken. Reading the sweet spot as a two-sided window would make a runner
     * coming back from a quiet fortnight permanently ineligible for the ramp
     * that exists to bring him back. */
    for (const low of [0.4, 0.6, 0.79, 0.8]) {
      const s = await signalsFor(ratio(low));
      expect(s.acwrHeadroom, `ratio ${low} was refused · the ceiling became a window`).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE REFUSAL DIRECTION · and Rule 11's three facts, kept apart.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ACWR ramp bound · a runner already carrying an increase is refused', () => {
  it('at and above the ceiling, no headroom', async () => {
    const upper = sweetSpotUpperFromResearch();
    for (const high of [upper, upper + 0.01, 1.5, 1.8, 3.0]) {
      const s = await signalsFor(ratio(high));
      expect(s.acwrHeadroom, `ratio ${high} authorised MORE load`).toBe(false);
      // The number itself survives the refusal · a refusal that also erased
      // its evidence would leave the intent log unable to say why.
      expect(s.details.acwr).toBe(high);
      expect(s.details.acwrAbsentReason).toBeNull();
    }
  });

  it('RULE 11 · an unreadable ratio refuses, and says the READ FAILED', async () => {
    // A thrown read is not "this runner has no history". Collapsing them
    // would make an outage look like a cold-start account in the audit, and
    // the fix for those two is not the same fix.
    const s = await signalsFor(new Error('connection terminated unexpectedly'));
    expect(s.acwrHeadroom).toBe(false);
    expect(s.details.acwr).toBeNull();
    expect(s.details.acwrAbsentReason).toBe('read_failed');
  });

  it('RULE 11 · a not-yet-computable ratio refuses, and KEEPS ITS OWN reason', async () => {
    /* Three distinct ways the ratio cannot honestly be computed, and each one
     * must arrive downstream as itself. "We have no chronic baseline yet" is
     * the state in which an added week is LEAST defensible, so it refuses —
     * but it is a fact about the runner's history, and `read_failed` is a fact
     * about our infrastructure. One name for two quantities is a Rule 16
     * violation, and here it would also be a Rule 11 one. */
    const reasons: AcwrAbsentReason[] = [
      'insufficient_coverage', 'insufficient_runs', 'no_chronic_load',
    ];
    const seen = new Set<string>();
    for (const reason of reasons) {
      const s = await signalsFor(absent(reason));
      expect(s.acwrHeadroom, `${reason} authorised more load`).toBe(false);
      expect(s.details.acwr).toBeNull();
      expect(s.details.acwrAbsentReason).toBe(reason);
      seen.add(String(s.details.acwrAbsentReason));
    }
    // And they are distinct from each other AND from the failure above · if
    // the gate ever normalised them to one string, the loop above would still
    // pass on a single shared value.
    expect(seen.size, 'the three absent reasons collapsed into fewer').toBe(reasons.length);
    expect(seen.has('read_failed'), 'an absent reason was reported as a read failure').toBe(false);
  });

  it('a refused ratio shuts the WHOLE ramp, not just its own signal', async () => {
    // The other four gates are green in this fixture, so if the aggregate
    // could still go green the bound would be decorative.
    const s = await signalsFor(ratio(1.4));
    const allGreen = s.acwrHeadroom && s.lastQualityOnPace && s.lastLongClean
      && s.belowTierUpper && s.noBumpRecent;
    expect(allGreen, 'the ramp stayed green with the load ratio past its ceiling').toBe(false);
  });
});

/**
 * TIEREVIDENCE-2 · the inert-gate detector.
 *
 * Appended 2026-09-02. `tier_peak_weekly_band` became evidence-derived while
 * the composed block is still shaped by the capacity tier's floor, so a plan
 * can be authored whose own peak week sits ABOVE its published ceiling — the
 * owner's block does, at ~55.8 against ~55. `belowTierUpper` is then false on
 * every tick forever, which is indistinguishable from "no headroom today"
 * unless something says otherwise. That is CLAUDE.md Rule 21's signature:
 * wired, doctrine-bound, cron-mounted and inert.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): it tests the DETECTOR, not the ramp. It
 * cannot tell whether the ceiling is the right number, cannot see the live
 * demonstrated peak the Rule 10 recompute would use, and has no opinion on
 * whether the bump would fire if the ceiling were correct. It only asserts
 * that a structurally-unreachable gate is NAMED rather than reported as an
 * ordinary refusal.
 */
describe('TIEREVIDENCE-2 · an unreachable ceiling is named, not silently false', () => {
  const anchored = (authoredPeak: number, ceiling: number) => ({
    tier_peak_weekly_band: [30, ceiling],
    tier_band_anchor: { authored_peak_weekly_mi: authoredPeak, authored_peak_long_mi: 18 },
  });

  it('reports INERT when the block peak sits at or above its own ceiling', () => {
    const v = ceilingCanNeverBind(anchored(55.8, 55), 'tier_peak_weekly_band');
    expect(v.inert).toBe(true);
    if (v.inert) {
      expect(v.ceiling).toBe(55);
      expect(v.authoredPeak).toBe(55.8);
    }
  });

  it('reports INERT at exact equality · headroom of zero is still no headroom', () => {
    expect(ceilingCanNeverBind(anchored(55, 55), 'tier_peak_weekly_band').inert).toBe(true);
  });

  it('does NOT report inert when real headroom exists', () => {
    expect(ceilingCanNeverBind(anchored(45, 55), 'tier_peak_weekly_band').inert).toBe(false);
  });

  it('Rule 11 · an absent stamp is "cannot tell", never "inert"', () => {
    expect(ceilingCanNeverBind({ tier_peak_weekly_band: [30, 55] }, 'tier_peak_weekly_band').inert)
      .toBe(false);
    expect(ceilingCanNeverBind({}, 'tier_peak_weekly_band').inert).toBe(false);
  });

  it('Rule 11 · a zero or missing peak is not a finding either', () => {
    expect(ceilingCanNeverBind(anchored(0, 55), 'tier_peak_weekly_band').inert).toBe(false);
    expect(
      ceilingCanNeverBind(
        { tier_peak_weekly_band: [30, 55], tier_band_anchor: {} },
        'tier_peak_weekly_band',
      ).inert,
    ).toBe(false);
  });
});
