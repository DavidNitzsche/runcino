/**
 * _block_anchor.test.ts · BLOCKANCHOR-1 · a rebuild begins where its block did.
 *
 * THE DEFECT THIS EXISTS FOR (measured live 2026-09-02, read-only, against the
 * owner's plan `pln_9a57561debb776e5`). The block was authored 2026-08-30 over
 * 2026-08-24 → 2026-12-06 — 15 weeks, 103 rows. Every rebuild path passes
 * neither `startAnchor` nor `startDateISO`, so week 0 snapped to the CURRENT
 * week and a rebuild on 09-02 composed 14 weeks from 08-31, re-phasing the
 * whole block: peak week 61.0 → 57.5, peak long 21.5 → 20.0, both peaks sliding
 * two weeks later. `startDateISO` could not express the fix because its clamp
 * ("≥ today") is an ONBOARDING rule and correct as such.
 *
 * WHAT THIS FILE CANNOT FAIL ON (Rule 22, stated rather than implied):
 *
 *   · It cannot fail on a wrong VOLUME. Every assertion here is about the
 *     CALENDAR a block occupies — which day week 0 starts on and which days are
 *     written. A rebuild that keeps the exact right span and prescribes
 *     nonsense inside it passes this file completely. `_maint_invariants`,
 *     `_coach_sensible` and `_audit_periodization` own that.
 *   · It cannot fail on the anchor being resolved and then IGNORED downstream,
 *     except through the two wiring assertions at the end, which read source
 *     text. A behavioural test cannot see a call site that quietly stops
 *     calling the resolver, which is the Rule 16 failure this pairs against.
 *   · `decideBlockAnchor` is pure, so nothing here exercises the QUERY in
 *     `readActiveBlockFacts` — a query that reads the wrong population (Rule
 *     14) would still hand this file a well-formed `ActiveBlockFacts`. The
 *     read-only proof script is what exercised that against production.
 *   · It says nothing about whether a preserved anchor is the RIGHT product
 *     answer for a maintenance or recovery block; those are refused by name
 *     here, and that refusal is a judgement, not a measurement.
 *
 * DISTRIBUTION (Rule 22). Nine refusal clauses against one preservation, which
 * looks lopsided and is deliberate: preserving is the single behaviour and each
 * refusal is a distinct authoring path that must NOT inherit. The balance that
 * matters is the other one — every refusal is asserted BOTH ways (the clause
 * fires on its own case, and does not fire on the neighbouring case), and the
 * preservation is asserted to survive a full walk of the block's calendar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideBlockAnchor,
  type ActiveBlockFacts,
  type BlockAnchorRead,
} from './block-anchor';
import { persistsComposedDay, requestedBlockStartISO, weekStartBoundaryOf } from './generate';

/** The owner's live block, as production held it on 2026-09-02. */
const LIVE: ActiveBlockFacts = {
  planId: 'pln_9a57561debb776e5',
  mode: 'race-prep',
  raceId: 'cim',
  goalISO: '2026-12-06',
  firstDayISO: '2026-08-24',
  lastDayISO: '2026-12-06',
};
const TODAY = '2026-09-02';
const RACE_TARGET = { raceSlug: 'cim', isOpenBlock: false };

function decide(over: Partial<Parameters<typeof decideBlockAnchor>[0]> = {}): BlockAnchorRead {
  return decideBlockAnchor({
    todayISO: TODAY,
    startAnchor: 'monday',
    startDateISO: undefined,
    active: LIVE,
    target: RACE_TARGET,
    lastFinishedRaceISO: '2026-08-16',   // his half, before the block started
    ...over,
  });
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('BLOCKANCHOR-1 · the live shape', () => {
  it('a rebuild of the active block inherits 2026-08-24', () => {
    const r = decide();
    expect(r.preserved).toBe(true);
    if (!r.preserved) return;
    expect(r.anchorISO).toBe('2026-08-24');
    expect(r.planId).toBe('pln_9a57561debb776e5');
  });

  it('the anchor snaps to the same training-week boundary it already is', () => {
    // long run Sunday → training week starts Monday. 08-24 IS a Monday, so the
    // snap is a provable no-op and the composed week 0 is the live week 0.
    expect(weekStartBoundaryOf('2026-08-24', 1)).toBe('2026-08-24');
  });

  it('without the anchor the block loses its first week · the defect, named', () => {
    // What the engine did before this landed: week 0 from the CURRENT week.
    expect(weekStartBoundaryOf(TODAY, 1)).toBe('2026-08-31');
    expect(weekStartBoundaryOf(TODAY, 1)).not.toBe(LIVE.firstDayISO);
  });
});

describe('BLOCKANCHOR-1 · every refusal fires on its own case and not its neighbour', () => {
  it('caller_named_a_start · onboarding is untouched', () => {
    expect(decide({ startAnchor: 'today' })).toMatchObject({ preserved: false, reason: 'caller_named_a_start' });
    expect(decide({ startDateISO: '2026-09-14' })).toMatchObject({ preserved: false, reason: 'caller_named_a_start' });
    // …and the neighbour: the same runner with neither still preserves.
    expect(decide().preserved).toBe(true);
  });

  it('the onboarding clamp itself is intact · this did not loosen it', () => {
    // The reason a new input exists at all. `startDateISO` still cannot express
    // a past start, so onboarding still cannot schedule runs before signup.
    expect(requestedBlockStartISO(TODAY, 'today', '2026-08-24')).toBe(TODAY);
    expect(requestedBlockStartISO(TODAY, 'today', '2026-09-14')).toBe('2026-09-14');
  });

  it('no_active_plan · a first authoring', () => {
    expect(decide({ active: null })).toMatchObject({ preserved: false, reason: 'no_active_plan' });
  });

  it('not_a_build_block · maintenance and recovery blocks do not anchor a build', () => {
    for (const mode of ['maintenance', 'recovery', null]) {
      expect(decide({ active: { ...LIVE, mode } })).toMatchObject({ preserved: false, reason: 'not_a_build_block' });
    }
    expect(decide({ active: { ...LIVE, mode: 'race-prep' } }).preserved).toBe(true);
  });

  it('different_target · a graduation to the next A race does NOT inherit', () => {
    expect(decide({ target: { raceSlug: 'la-marathon', isOpenBlock: false } }))
      .toMatchObject({ preserved: false, reason: 'different_target' });
    // A goal-mode rebuild of a goal-mode plan matches on the goal's deadline.
    const goalPlan = { ...LIVE, raceId: null, goalISO: '2026-12-06' };
    expect(decide({ active: goalPlan, target: { goalRaceDateISO: '2026-12-06', isOpenBlock: false } }).preserved).toBe(true);
    expect(decide({ active: goalPlan, target: { goalRaceDateISO: '2027-03-01', isOpenBlock: false } }))
      .toMatchObject({ preserved: false, reason: 'different_target' });
    // A goal-mode rebuild must not inherit a RACE-anchored block's start.
    expect(decide({ target: { goalRaceDateISO: '2026-12-06', isOpenBlock: false } }))
      .toMatchObject({ preserved: false, reason: 'different_target' });
    // No target named at all is not a rebuild of this block either.
    expect(decide({ target: { isOpenBlock: false } }))
      .toMatchObject({ preserved: false, reason: 'different_target' });
  });

  it('open_block_has_no_prior_geometry · a post-race open block begins now', () => {
    expect(decide({ target: { isOpenBlock: true } }))
      .toMatchObject({ preserved: false, reason: 'open_block_has_no_prior_geometry' });
  });

  it('active_plan_has_no_rows', () => {
    expect(decide({ active: { ...LIVE, firstDayISO: null } }))
      .toMatchObject({ preserved: false, reason: 'active_plan_has_no_rows' });
  });

  it('block_already_ended · a spent calendar is not an anchor', () => {
    expect(decide({ active: { ...LIVE, lastDayISO: '2026-09-01' } }))
      .toMatchObject({ preserved: false, reason: 'block_already_ended' });
    // The boundary is the honest one: a block whose last day IS today is still
    // running, and inherits.
    expect(decide({ active: { ...LIVE, lastDayISO: TODAY } }).preserved).toBe(true);
  });

  it('race_finished_inside_block · recovery and graduation own their own start', () => {
    expect(decide({ lastFinishedRaceISO: '2026-08-30' }))
      .toMatchObject({ preserved: false, reason: 'race_finished_inside_block' });
    // A race that finished BEFORE the block began does not disturb it — which
    // is the owner's own case (his half on 08-16, block from 08-24).
    expect(decide({ lastFinishedRaceISO: '2026-08-16' }).preserved).toBe(true);
    expect(decide({ lastFinishedRaceISO: null }).preserved).toBe(true);
  });

  it('a refusal carries no anchorISO · Rule 11 is a type error, not a discipline', () => {
    const r = decide({ active: null });
    expect(r.preserved).toBe(false);
    // @ts-expect-error — the refusal branch has no anchorISO field at all.
    expect(r.anchorISO).toBeUndefined();
  });
});

describe('BLOCKANCHOR-1 · Rule 9 · no cliff, and one removed', () => {
  it('the anchor does not move as the block ages · a rebuild any day composes the same geometry', () => {
    const seen = new Set<string>();
    for (let k = 0; k <= 95; k++) {
      const today = addDays('2026-08-24', k);
      if (today > LIVE.lastDayISO!) break;
      const r = decide({ todayISO: today });
      expect(r.preserved).toBe(true);
      if (r.preserved) seen.add(r.anchorISO);
    }
    expect([...seen]).toEqual(['2026-08-24']);
  });

  it('the UNANCHORED behaviour it replaces stepped a whole week every seven days', () => {
    // The discontinuity this change removes, measured. Same block, same
    // runner, one day apart across a week boundary: the composed week 0 jumps.
    const sun = weekStartBoundaryOf('2026-09-06', 1);   // Sunday
    const mon = weekStartBoundaryOf('2026-09-07', 1);   // Monday, +1 day
    expect(sun).toBe('2026-08-31');
    expect(mon).toBe('2026-09-07');
    // …and with the anchor, the same two days answer identically.
    expect(decide({ todayISO: '2026-09-06' })).toMatchObject({ anchorISO: '2026-08-24' });
    expect(decide({ todayISO: '2026-09-07' })).toMatchObject({ anchorISO: '2026-08-24' });
  });
});

describe('BLOCKANCHOR-1 · the past is inherited, never re-prescribed', () => {
  /**
   * The anchor puts week 0 back on 2026-08-24, which means the composer now
   * emits days for a week that has already happened. BACKDATE-1 is what stops
   * that becoming a rewrite, and this asserts the two mechanisms compose:
   * every SEALED day is written (Rule 15 then overlays the prior
   * prescription), every UNSEALED past day is dropped, every future day lands.
   */
  const SEALED = new Set(['2026-08-24', '2026-08-26', '2026-08-27', '2026-08-28',
    '2026-08-30', '2026-08-31', '2026-09-01']);

  it('clipBeforeISO is still null on the regen path · the anchor did not touch it', () => {
    expect(requestedBlockStartISO(TODAY, 'monday', undefined)).toBe(null);
  });

  it('walks the anchored block · nothing new lands in the past, nothing completed is lost', () => {
    const clipBeforeISO = requestedBlockStartISO(TODAY, 'monday', undefined);
    const written: string[] = [];
    const dropped: string[] = [];
    for (let k = 0; k < 15 * 7; k++) {
      const dateISO = addDays('2026-08-24', k);
      const keep = persistsComposedDay({
        dateISO, todayISO: TODAY, clipBeforeISO, sealed: SEALED.has(dateISO),
      });
      (keep ? written : dropped).push(dateISO);
    }
    // Every completed session survives the rebuild.
    for (const iso of SEALED) expect(written).toContain(iso);
    // No past day the runner did NOT run is authored after the fact.
    expect(written.filter((iso) => iso < TODAY && !SEALED.has(iso))).toEqual([]);
    // The two unsealed past days in his week 0 are exactly what is dropped.
    expect(dropped).toContain('2026-08-25');
    expect(dropped).toContain('2026-08-29');
    // And the block is not truncated: every day from today forward is written.
    expect(dropped.filter((iso) => iso >= TODAY)).toEqual([]);
  });
});

describe('BLOCKANCHOR-1 · wiring · the resolver is actually called and actually consumed', () => {
  /**
   * Rule 16's own lesson: a behavioural test cannot catch a surface that stops
   * calling the shared resolver. These two read the source, and they are the
   * only assertions in this file that can fail on a wiring regression.
   */
  const src = readFileSync(join(__dirname, 'generate.ts'), 'utf8');

  it('composeForUserInternal resolves the anchor and hands it to loadGeneratorInputs', () => {
    expect(src).toMatch(/const anchorRead = await resolveBlockAnchor\(/);
    expect(src).toMatch(/const blockAnchorISO = anchorRead\.preserved \? anchorRead\.anchorISO : null;/);
    expect(src).toMatch(/loadGeneratorInputs\(userId, raceSlug, startAnchor, startDateISO, goalTarget, openTarget, blockAnchorISO\)/);
  });

  it('loadGeneratorInputs snaps week 0 through the anchor, and leaves the clip alone', () => {
    expect(src).toMatch(
      /const startMondayISO = weekStartBoundaryOf\(blockStartISO \?\? blockAnchorISO \?\? todayISO, weekStartDow\);/,
    );
    // `clipBeforeISO` must still be the caller-named start and nothing else —
    // if the anchor ever reaches it, BACKDATE-1 stops holding.
    expect(src).not.toMatch(/clipBeforeISO:\s*blockAnchorISO/);
  });
});
