/**
 * _declared_level_inert.test.ts · DECLAREDLEVEL-0 (2026-09-02)
 *
 * THE GATE THE OWNER ASKED FOR, in his own words:
 *
 *   "Prove that changing or deleting the self-declared experience level cannot
 *    change: plan volume; peak mileage; long-run progression; race
 *    prescriptions; race-plus-long-run permission; cutback placement;
 *    adaptation eligibility; or any coaching explanation presented as the
 *    evidence supporting those decisions."
 *
 * ── WHY IT IS A COMPOSITION AND NOT A GREP ──────────────────────────────────
 *
 * A grep for `experience_level` proves where the string appears. It cannot
 * prove the value is inert, because the label reaches the plan by THREE
 * separate routes out of one DB read in `loadGeneratorInputs`, and a check that
 * knew about two of them would report clean:
 *
 *   1. `ComposePlanInput.level` — read directly by the composer.
 *   2. `resolvePrescriptions(cat, phase, level)` → `rxQuality` /
 *      `rxRaceSpecific`. The workout library is level-filtered
 *      (`workout-library-static.ts` `matches()`: `if (args.level) { if
 *      (t.levelFit.length > 0 && !t.levelFit.includes(args.level)) return
 *      false; }`), so the label can change which SESSION a runner is
 *      prescribed without touching a single mile.
 *   3. `finalizeComposedPlan(composed, raceDistanceMi, level, terrain)` — a
 *      third positional argument nobody reading `ComposePlanInput` would find.
 *
 * So this file turns ONE knob, spreads it down all three routes exactly as
 * `generatePlan` does, and compares the composed blocks.
 *
 * ── WHAT "ABSENT" MEANS, AND WHY IT IS TESTED TWICE (Rule 11) ───────────────
 *
 * `profile.experience_level` is NULL for real production accounts. A sweep of
 * the four declared values only would miss a code path that DEFAULTS when the
 * value is missing — which is exactly the shape Rule 11 exists for, and
 * exactly what `detectVolumeOvershoot` was doing until this commit
 * (`(r.experience_level ?? 'intermediate')`, so an unstated label silently
 * became a 60 mi/wk ceiling). Two absences are therefore swept alongside the
 * four values:
 *
 *   · `null`      — the column is NULL. This is what `loadGeneratorInputs`
 *                   produces today: `(expRow?.experience_level ?? null)`.
 *   · OMITTED     — the key is not on the input object at all, so every read
 *                   sees `undefined` rather than `null`. A `?? 'intermediate'`
 *                   and a `=== null` behave differently across those two, and
 *                   a gate that swept only one could not tell.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * Stated as what it is structurally incapable of catching, not as what it
 * covers:
 *
 *   · A LEVEL READ FROM THE DATABASE INSIDE THE COMPOSER. Every input here is
 *     passed in. If some path deep in the composition did its own
 *     `SELECT experience_level`, this file would sweep a knob that path never
 *     reads and report clean. `composePlan` is pure today; that is a property
 *     someone must keep, and `check-goal-pace-leak.sh` is the model for gating
 *     a value that arrives by a side door.
 *   · THE PERSISTENCE LAYER. It compares what `composePlan` +
 *     `finalizeComposedPlan` produce. `persistPlan` writes rows from that, and
 *     a level-dependent decision taken in the WRITER would not be seen here.
 *   · THE ADAPTATION ENGINE'S RUNTIME. "Adaptation eligibility" is asserted as
 *     the authored bands and cadence the adapters read
 *     (`tier_peak_weekly_band` → `adaptive-ramp.ts` `readTierUpper`,
 *     `tier_peak_long_band`, `cutback_every_n`, `goal_tier`, `capacity_tier`).
 *     It does not run `detectVolumeOvershoot` or `tryAdaptiveBump` against a
 *     database. That the overshoot detector no longer reads a label at all is
 *     asserted by source, below, not behaviourally.
 *   · WHETHER THE PLAN IS ANY GOOD. Identical is not correct. Every runner in
 *     this file could get the same wrong plan and every assertion would pass.
 *   · A SECOND SELF-DECLARED AUTHORITY. It sweeps the experience level only.
 *     `bestRecentVdotSelfReported` is the same class of input and is out of
 *     scope here; `_authoring_input_surface.test.ts` is the ratchet that keeps
 *     both on the record until they are gone.
 *   · A DIFFERENCE OUTSIDE THE COMPOSED BLOCK. It compares the whole
 *     `ComposePlanResult`, which is broad, but a level-dependent side effect
 *     written to a module-level variable or a log line is invisible to it.
 *
 * DISTRIBUTION (Rule 22): this gate has one verdict, not two, so there is no
 * hold/accelerate imbalance to state. What there IS to state is the direction
 * of its blindness: it can only ever prove SAMENESS. It cannot notice that the
 * plan the six runners share is too easy, too hard, or built on the wrong
 * evidence. It is a check that an authority is dead, and nothing more.
 *
 * LIVENESS (Rule 18): the sweep asserts it composed six non-trivial blocks and
 * that each is a real marathon build with a race embedded in it, so a fixture
 * that silently stopped composing cannot report clean by comparing six empty
 * objects to each other.
 *
 * FALSIFIED (Rule 18): re-introducing a single read of the label — a
 * `level === 'advanced' ? x : y` in the composer — makes this file name the
 * dimension that moved. The observed output is in the commit's report.
 *
 * ── THIS FILE IS DELIBERATELY RED ON FIRST LANDING ──────────────────────────
 *
 * Rule 12's precedent (`_coach_sensible.test.ts`, "deliberately red while it is
 * open"). The gate is the FINDING, not a claim that the finding is closed, and
 * it is written to the standard the plan must reach rather than to whatever
 * the plan does today. Measured on this exact fixture, 2026-09-02:
 *
 *   DIMENSION                        STATE   WHAT MOVES, AND WHO OWNS IT
 *   plan volume                      RED     tier bands · load-tier path
 *   peak mileage                     RED     51 / 52 / 60 / 60 / 52
 *   long-run progression             RED     week 1 long: 20 / 19 / 18 / 18 / 19
 *   race prescriptions               RED     workout-library levelFit · see below
 *   race-plus-long-run permission    GREEN   the Dodgers grant is identical
 *   cutback placement                GREEN   identical
 *   adaptation eligibility           RED     goal_tier / capacity_tier /
 *                                            tier_band_anchor. The published
 *                                            bands themselves are already
 *                                            identical.
 *   coaching explanation             RED     row text, via the two above
 *
 * TWO SEPARATE CAUSES, and neither is fixed by this commit:
 *
 *   1. THE LOAD-TIER PATH — `goal-tiers.ts` `resolveLoadTier` / `TIER_TARGETS`
 *      and the tier-band derivation in `generate.ts`. Owned by a parallel
 *      change removing `level` from it. On this fixture the effect is exactly
 *      what the doctrine names: `composed_row_band_weekly` reads [45, 55] for
 *      every value EXCEPT 'advanced' / 'advanced_plus', which read [65, 90] —
 *      against a demonstrated peak of 52.3 — and the authored peak follows,
 *      51 / 52 / 60. Typing a word buys eight miles a week.
 *
 *      Note the inversion in the long-run row, which is Rule 9's signature in
 *      reverse: the runner who declares LESS gets a LONGER week-one long run
 *      (beginner 20.0, advanced 18.0) off byte-identical history.
 *
 *   2. THE WORKOUT LIBRARY'S OWN LEVEL FILTER — `resolvePrescriptions(cat,
 *      phase, level)` → `pickWorkout({ level })`, which drops every template
 *      whose `levelFit` excludes the declared band. All 54 templates carry a
 *      non-empty `levelFit`, so this genuinely selects: on this fixture
 *      'advanced' draws "8×3 min hills @ T-10K effort" where an undeclared
 *      runner draws "6×90s hills @ 5K-10K effort". NOT FIXED HERE, and the
 *      reason is a decision somebody has to make rather than an oversight:
 *      with `level` undefined the filter does not narrow, it switches OFF, and
 *      the lowest-id template wins for everyone — an ARBITRARY authority in
 *      place of a bad one, in the one direction this app can least afford
 *      (it makes the owner's own sessions easier). The doctrine-correct
 *      replacement is selection on DEMONSTRATED capacity, which
 *      `docs/ADAPTATION_PROGRESSION_DOCTRINE.md` states is not yet built.
 *      Flagged as a decision, not silently defaulted.
 *
 * WHEN IT GOES GREEN, DO NOT LOOSEN IT. Both causes are real defects against
 * the doctrine, both are measured above, and a gate edited to match the engine
 * is a gate that has stopped meaning anything (Rule 18).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  composePlan, finalizeComposedPlan, resolvePrescriptions,
  type ComposePlanInput, type ComposePlanResult, type ComposedWeek,
  type DOW, type DayPlan, type LevelKey,
} from './generate';
import { tPaceFromGoal } from './spec-builder';
import { prerequisitesFor, type EvidenceRequirement } from './strategy-contracts';
import type { ProgressionLever } from '@/lib/prescription/levers';

/* ─────────────────────────────────────────────────────────────── the sweep */

/** The four declarable values, plus the two ways of not declaring one. */
const SWEEP = [
  'beginner', 'intermediate', 'advanced', 'advanced_plus',
  null,        // the column is NULL — the real production state
  'OMITTED',   // the key never reaches the input object at all
] as const;
type SweepValue = (typeof SWEEP)[number];

const asLevel = (v: SweepValue): LevelKey | undefined =>
  v === 'OMITTED' ? undefined : (v as LevelKey);

/**
 * The owner's own block, on his measured numbers (2026-09-02): CIM on
 * 2026-12-06 off a 46 mi/wk base, a 20-mile recent long run, six days a week,
 * with the Dodgers 10K embedded on 2026-09-26 the day before a long run — the
 * pairing the designed-weekend grant exists to decide. His evidence is real:
 * best two-day total 29.4 mi from 2026-04-25, sustained 46.4 mi/wk.
 *
 * The race is IN the fixture on purpose. A sweep over a plain block would not
 * exercise `embedMidBlockRaces`, `resolveDesignedRaceWeekend`, or the grant
 * record — three of the eight dimensions the owner named — and would report
 * clean while never reaching them (Rule 15).
 */
const DODGERS: NonNullable<ComposePlanInput['midBlockRaces']> = [
  { slug: 'dodgers', name: 'Dodgers', date: '2026-09-26', distanceMi: 6.21, goalPaceSec: null, priority: 'C' },
];

async function inputAt(v: SweepValue): Promise<ComposePlanInput> {
  const level = asLevel(v);
  // ROUTE 2 · exactly what `loadGeneratorInputs` does with the same value.
  // Passing a fixed `inlinePrescriptions()` here instead would hide the
  // workout library's own level filter, which is the subtlest of the three
  // routes and the one a reader of `ComposePlanInput` would never find.
  const [rxQuality, rxRaceSpecific] = await Promise.all([
    resolvePrescriptions('m', 'quality', (level ?? null) as LevelKey),
    resolvePrescriptions('m', 'race_specific', (level ?? null) as LevelKey),
  ]);
  const base = {
    raceDistanceMi: 26.2,
    goalSec: 10800,
    goalPaceSec: Math.round(10800 / 26.2),
    raceDateISO: '2026-12-06',
    startMondayISO: '2026-08-17',
    recentWeeklyMi: 46,
    easyDayMedianMi: 7,
    recentLongMi: 20,
    bestRecentVdot: 44,
    isMidBlock: true,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: 6,
    crossModes: [],
    rxQuality,
    rxRaceSpecific,
    tPaceSec: tPaceFromGoal(10800, 26.2),
    lthr: 168,
    maxHr: 180,
    midBlockRaces: DODGERS,
    demonstratedPairMi: 29.4,
    demonstratedPairFromISO: '2026-04-25',
    demonstratedLongMi: 21.5,
    rampBaseEvidence: {
      baseMi: 46, meanMi: 44, sustainedMi: 46.4, heldMi: 46, peakMi: 52.3,
      returning: false, interruptionWeeks: 0, allowedInterruptionWeeks: 4, lifted: false,
    },
  } as unknown as ComposePlanInput;
  // ROUTE 1 · and the OMITTED case is the key genuinely not being there, not
  // the key being there holding `undefined`.
  if (v !== 'OMITTED') (base as { level?: LevelKey }).level = level as LevelKey;
  return base;
}

async function composeAt(v: SweepValue): Promise<ComposePlanResult> {
  const input = await inputAt(v);
  const composed = composePlan(input);
  // ROUTE 3 · the third positional argument.
  finalizeComposedPlan(composed, 26.2, (asLevel(v) ?? null) as LevelKey);
  return composed;
}

/* ─────────────────────────────────────── the eight dimensions, by name */

const longOf = (w: ComposedWeek): DayPlan | undefined => w.days.find((d) => d.isLong);
const st = (c: ComposePlanResult, k: string): unknown => c.authoredState[k] ?? null;

/**
 * One reader per thing the owner named. Each returns a JSON-stable value, so a
 * failure names the DIMENSION that moved rather than dumping a whole block.
 */
const DIMENSIONS: Record<string, (c: ComposePlanResult) => unknown> = {
  'plan volume': (c) => c.weeks.map((w) => w.weeklyMi),
  'peak mileage': (c) => Math.max(...c.weeks.map((w) => w.weeklyMi)),
  'long-run progression': (c) => c.weeks.map((w) => longOf(w)?.distanceMi ?? null),
  // Every race row the block carries, in full: the distance, the label, the
  // note, and the tune-up's own pace target.
  'race prescriptions': (c) => c.weeks.flatMap((w) => w.days
    .filter((d) => d.type === 'race' || d.type === 'race_week_tuneup')
    .map((d) => ({ startISO: w.startISO, ...d }))),
  // The grant or the named refusal, verbatim off the placement record — this
  // is the Dodgers weekend decision itself.
  'race-plus-long-run permission': (c) => st(c, 'placement_compromises'),
  'cutback placement': (c) => c.weeks.map((w) => !!w.isCutback),
  // What the adapters actually read off a persisted block.
  'adaptation eligibility': (c) => ({
    tier_peak_weekly_band: st(c, 'tier_peak_weekly_band'),
    tier_peak_long_band: st(c, 'tier_peak_long_band'),
    tier_band_anchor: st(c, 'tier_band_anchor'),
    cutback_every_n: st(c, 'cutback_every_n'),
    goal_tier: st(c, 'goal_tier'),
    capacity_tier: st(c, 'capacity_tier'),
    load_tier_reduced_by_goal: st(c, 'load_tier_reduced_by_goal'),
  }),
  // "any coaching explanation presented as the evidence supporting those
  // decisions" — every sentence the runner reads on a row, plus the stored
  // accounts of why the block is shaped as it is.
  'coaching explanation': (c) => ({
    rows: c.weeks.flatMap((w) => w.days.map((d) => [d.subLabel, d.notes])),
    long_run_ceiling: st(c, 'long_run_ceiling'),
    phase_answers: st(c, 'phase_answers'),
    block_strategy: st(c, 'block_strategy'),
    thesis_at_authoring: st(c, 'thesis_at_authoring'),
    ramp_base: st(c, 'ramp_base'),
  }),
};

/* ══════════════════════════════════════════════════════════════════════ */

describe('DECLAREDLEVEL-0 · the self-declared experience level cannot move the plan', () => {
  const blocks: Array<{ v: SweepValue; c: ComposePlanResult }> = [];

  const ensure = async (): Promise<void> => {
    if (blocks.length > 0) return;
    for (const v of SWEEP) blocks.push({ v, c: await composeAt(v) });
  };

  it('LIVENESS · six real blocks were composed, not six empty objects', async () => {
    await ensure();
    expect(blocks.length).toBe(6);
    for (const { v, c } of blocks) {
      expect(c.weeks.length, `${String(v)} composed no weeks`).toBeGreaterThan(10);
      expect(
        c.weeks.some((w) => w.days.some((d) => d.type === 'race')),
        `${String(v)} composed no race row — the Dodgers embed never ran, so three `
        + 'of the eight dimensions are unreachable in this sweep (Rule 15)',
      ).toBe(true);
      expect(
        Math.max(...c.weeks.map((w) => w.weeklyMi)),
        `${String(v)} composed a block with no volume`,
      ).toBeGreaterThan(20);
    }
  });

  for (const dimension of Object.keys(DIMENSIONS)) {
    it(`${dimension} is byte-identical across all four declared values and both absences`, async () => {
      await ensure();
      const rd = DIMENSIONS[dimension];
      const reference = JSON.stringify(rd(blocks[0].c));
      for (const { v, c } of blocks.slice(1)) {
        expect(
          JSON.stringify(rd(c)),
          `experience level ${String(v)} changed "${dimension}" against `
          + `${String(blocks[0].v)}. The self-declared label has no authority over `
          + 'this decision (docs/PLAN_SIMPLIFICATION_DOCTRINE.md §"What may not"), '
          + 'so a difference here is the defect, not the fixture.',
        ).toBe(reference);
      }
    });
  }

  it('THE WHOLE BLOCK is byte-identical · nothing outside the eight dimensions moved either', async () => {
    await ensure();
    // The per-dimension cases above exist to NAME what moved. This one exists
    // so a level-dependent field nobody thought to enumerate cannot slip
    // between them.
    const reference = JSON.stringify(blocks[0].c);
    for (const { v, c } of blocks.slice(1)) {
      expect(
        JSON.stringify(c) === reference,
        `experience level ${String(v)} produced a different composed block from `
        + `${String(blocks[0].v)} somewhere outside the eight named dimensions.`,
      ).toBe(true);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * THE RECORDS · the label may not be PERSISTED as evidence either
 *
 * "Do not merely stop reading it while continuing to persist it as purported
 * evidence." The behavioural sweep above proves the label changes nothing. It
 * cannot prove the label is absent from what gets written down, because a
 * field recorded identically in all six blocks is byte-identical by
 * definition. These are the source assertions that close that gap.
 * ══════════════════════════════════════════════════════════════════════ */

const readSrc = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('DECLAREDLEVEL-0 · the label is not persisted inside a decision record', () => {
  it('the designed-weekend grant carries no declared field, at the type level', () => {
    const src = readSrc('lib/plan/designed-race-weekend.ts');
    const i = src.indexOf('interface DesignedWeekendEvidence');
    expect(i, 'DesignedWeekendEvidence not found — this gate is reading the wrong file')
      .toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf('\n}', i));
    // LIVENESS · the slice really is the interface body.
    expect(/demonstratedPairMi/.test(body), 'the evidence body parsed empty').toBe(true);
    expect(/\bdeclaredLevel\b/.test(body), 'declaredLevel is back on the grant evidence').toBe(false);
    expect(/\bdeclaredDaysPerWeek\b/.test(body)).toBe(false);
  });

  it('the volume-overshoot finding neither reads nor records an experience level', () => {
    const src = readSrc('lib/plan/adapt.ts');
    // The table itself is gone.
    expect(/export const EXPERIENCE_CAPS_MI/.test(src), 'EXPERIENCE_CAPS_MI is back').toBe(false);
    // And the detector no longer selects the column. Comments quoting the old
    // code are fine; a live `SELECT experience_level` is not.
    const live = src.split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
      .join('\n');
    // LIVENESS · the comment strip did not eat the file.
    expect(live.length, 'adapt.ts parsed to nothing after stripping comments')
      .toBeGreaterThan(10000);
    expect(
      /experience_level/.test(live),
      'adapt.ts reads profile.experience_level again — an adaptation decision '
      + 'may not be taken on a self-declared band',
    ).toBe(false);
  });

  it('editing the label does not fire a plan rebuild, so no proposal records it as the cause', () => {
    const src = readSrc('app/api/profile/route.ts');
    const i = src.indexOf('const PLAN_SHAPING');
    expect(i, 'PLAN_SHAPING not found — this gate is reading the wrong file').toBeGreaterThan(-1);
    const set = src.slice(i, src.indexOf(']);', i));
    // LIVENESS · the slice really is the set, not an empty string that would
    // satisfy the assertion below for free.
    expect(/'weekly_frequency'/.test(set), 'PLAN_SHAPING parsed empty').toBe(true);
    expect(
      /'experience_level'/.test(set),
      'experience_level is back on PLAN_SHAPING · rebuildActivePlanForPrefs would '
      + "persist plan_proposals.reasons.fields = ['experience_level'], a stored "
      + 'claim that the label caused a replan',
    ).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * THE SAME CLASS, GENERALISED · A PERSISTED EXPLANATION MAY NOT CITE A
 * MECHANISM THAT NO LONGER EXISTS
 *
 * `declaredLevel` was one field. The DEFECT is broader than one field, and it
 * had a second live instance found the same day, in a different name:
 * `prerequisitesFor('weekly_volume')` returned
 *
 *   { kind: 'READINESS',
 *     statement: 'No readiness pull-back is active.',
 *     owner: 'lib/coach/readiness.ts#scoreReadiness' }
 *
 * which lands in `authored_state.block_strategy` and was shown to the owner on
 * week 4 of his own block as one of the two prerequisites justifying a 48 →
 * 56.2 mi step. Readiness pull-backs were removed from training decisions
 * entirely, and `scoreReadiness` has never existed — the module exports
 * `computeReadiness`. A persisted, runner-visible claim, citing deleted
 * machinery, owned by a symbol that resolves to nothing.
 *
 * The existing contract test asserted `req.owner` matched `/#|\.ts/`. A
 * dangling symbol passes that, which is why this survived: the one field on
 * `EvidenceRequirement` whose entire purpose is to be checkable was checked
 * for SHAPE and never for TRUTH.
 *
 * WHAT THIS SECTION CANNOT FAIL ON (Rule 22):
 *   · An owner that resolves but is the WRONG owner. `#tryAdaptiveBump` exists;
 *     whether it is really what answers an absorption question is a review
 *     judgment, not a resolvable fact.
 *   · A `statement` that is honest today and stale tomorrow for a reason with
 *     no vocabulary. The removed-authority scan below reads the doctrine's own
 *     §"What may not" list, so it grows when that list grows — but a mechanism
 *     retired without appearing on that list is invisible to it.
 *   · Any explanation string built anywhere else in the engine. This resolves
 *     `prerequisitesFor` and nothing else.
 * ══════════════════════════════════════════════════════════════════════ */

/** Every lever the union admits. Listed rather than derived so a new lever
 *  with no prerequisite fails the exhaustiveness check below. */
const LEVERS: ProgressionLever[] = [
  'weekly_volume', 'run_frequency', 'long_run_duration', 'quality_duration',
  'interval_duration', 'rep_count', 'recovery_duration', 'work_density',
  'pace', 'race_specificity', 'goal_pace_exposure',
];

/** `path#symbol` → does the file exist, and is the symbol declared in it? */
function resolveOwner(owner: string): string | null {
  const [rel, symbol] = owner.split('#');
  const abs = path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) return `file does not exist: ${rel}`;
  if (!symbol) return null;               // the module itself is the owner
  const src = fs.readFileSync(abs, 'utf8');
  const declared = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?(?:function|const|let|var|class|type|interface|enum)\\s+${symbol}\\b`,
  );
  return declared.test(src) ? null : `no declaration of \`${symbol}\` in ${rel}`;
}

describe('DECLAREDLEVEL-0 · every prerequisite names an owner that exists', () => {
  const all: Array<{ lever: ProgressionLever; req: EvidenceRequirement }> =
    LEVERS.flatMap((lever) => prerequisitesFor(lever).map((req) => ({ lever, req })));

  it('LIVENESS · prerequisites were actually read for every lever', () => {
    expect(all.length, 'prerequisitesFor returned nothing — this gate is inert')
      .toBeGreaterThan(8);
    for (const lever of LEVERS) {
      expect(
        all.some((x) => x.lever === lever),
        `${lever} has no prerequisite at all · a step with no stated condition `
        + 'is a progression nobody has to earn',
      ).toBe(true);
    }
    // And the resolver can distinguish. A check that returns null for
    // everything would pass the whole suite silently.
    expect(resolveOwner('lib/coach/readiness.ts#scoreReadiness'))
      .toBe('no declaration of `scoreReadiness` in lib/coach/readiness.ts');
    expect(resolveOwner('lib/coach/readiness.ts#computeReadiness')).toBe(null);
    expect(resolveOwner('lib/plan/no-such-file.ts')).toBe('file does not exist: lib/plan/no-such-file.ts');
  });

  it('every owner string resolves to a real file and a real declaration', () => {
    const dangling = all
      .map(({ lever, req }) => ({ lever, owner: req.owner, why: resolveOwner(req.owner) }))
      .filter((x) => x.why != null);
    expect(
      dangling,
      'A prerequisite names an owner that does not exist. This is persisted in '
      + 'authored_state.block_strategy and shown to the runner as the reason a '
      + 'week steps up, so a dangling owner is a coaching explanation pointing at '
      + 'nothing (Rule 20: gate the claim or delete the sentence).\n'
      + dangling.map((x) => `  ${x.lever} → ${x.owner} · ${x.why}`).join('\n'),
    ).toEqual([]);
  });

  it('no prerequisite cites an authority the doctrine removed', () => {
    // Read the removed-authority list out of the doctrine at run time rather
    // than restating it here (Rule 18: a check that hardcodes both sides only
    // proves the test agrees with itself).
    const doctrine = fs.readFileSync(
      path.join(process.cwd(), '..', 'docs', 'PLAN_SIMPLIFICATION_DOCTRINE.md'), 'utf8',
    );
    const i = doctrine.indexOf('## What may not');
    expect(i, 'the doctrine\'s §"What may not" heading has moved — this gate is '
      + 'reading the wrong section').toBeGreaterThan(-1);
    // Whitespace-normalised: the list is prose-wrapped, so "resting\nHR"
    // must read as "resting HR".
    const section = doctrine.slice(i, doctrine.indexOf('\n## ', i + 4)).replace(/\s+/g, ' ');
    // The terms that name a removed mechanism and are unambiguous enough to
    // match on. Each must actually appear in the doctrine section, so the list
    // cannot drift into asserting something the doctrine does not say.
    const REMOVED = [
      'readiness', 'illness', 'injury', 'TSB', 'HRV', 'resting HR',
      'experience-level', 'plan-drift',
    ];
    for (const term of REMOVED) {
      expect(
        section.toLowerCase().includes(term.toLowerCase()),
        `"${term}" is not in the doctrine's removed-authority list any more — `
        + 'delete it here rather than leaving this gate asserting something the '
        + 'doctrine no longer says',
      ).toBe(true);
    }
    const offenders = all.flatMap(({ lever, req }) => {
      const text = `${req.kind} ${req.statement} ${req.owner}`.toLowerCase();
      return REMOVED.filter((t) => text.includes(t.toLowerCase()))
        .map((t) => `  ${lever} → cites "${t}" · ${req.statement}`);
    });
    expect(
      offenders,
      'A prerequisite cites a mechanism the doctrine removed. The runner reads '
      + 'this as the reason his week steps up.\n' + offenders.join('\n'),
    ).toEqual([]);
  });
});
