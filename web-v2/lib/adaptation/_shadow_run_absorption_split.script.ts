/**
 * lib/adaptation/_shadow_run_absorption_split.script.ts
 *
 * THE SHADOW-RUN for docs/reports/absorption-reader-split-2026-09-01.md, per
 * PRODUCT_DECISIONS.md 2026-09-01 §1's sequence: "shadow-run both across
 * historical runners and plan archetypes, report how many DURATION/VOLUME
 * decisions change and in which direction, check for discontinuities at
 * taper/race/recovery boundaries (Rule 9)".
 *
 * NOT a gate. NOT part of `npm test` — see `vitest.shadow-run.config.ts`'s
 * header for why it needs its own config. Every query it runs is a plain
 * SELECT through the existing readers (`readAdaptationSplit`,
 * `classifyAdaptation`); nothing here writes, and nothing here is imported by
 * any live path.
 *
 * Invoke with:
 *   npx vitest run --config vitest.shadow-run.config.ts
 *
 * Three sections, each printed to stdout for the report to quote from:
 *
 *   1 · REAL ACCOUNT. The only account in this database with a training
 *       history to shadow-run against — see the report for the corpus count.
 *       Per-date diff of `actual_load_absorption` vs `representative_execution`.
 *   2 · RULE 9 CONTINUITY WALK. Two real taper/recovery boundaries in that
 *       same account's history (Big Sur Marathon 2026-04-26, fully aged out;
 *       Americas Finest City half 2026-08-16, the live one), walked day by
 *       day across each edge.
 *   3 · SYNTHETIC FIXTURES. `_sweep_allusers.test.ts`'s archetype corpus has
 *       no `AdaptationInput`-shaped history at all (see the report) — these
 *       five hand-built fixtures are the partial substitute the decision doc
 *       allows, run directly through `classifyAdaptation` against a filtered
 *       and unfiltered read of the same underlying sessions.
 */
import { describe, it, expect } from 'vitest';
import { readAdaptationSplit, filterExecutionEvidenceByPrescribedWindow } from './load';
import {
  classifyAdaptation,
  type AdaptationInput,
  type AdaptationVerdict,
  type KeySessionRead,
} from './adaptation-model';
import {
  prescribedWindowsFrom,
  type RanRace,
} from '@/lib/training/normal-window';

const DAVID_UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

function fmtVerdict(v: AdaptationVerdict): string {
  const dims = v.dimensions
    .map((d) => `${d.dimension}=${d.score == null ? 'null' : d.score.toFixed(2)}`)
    .join(' ');
  return `${v.band}/${v.decision} conf=${v.confidence} step=${v.stepMultiplier} veto=${v.veto ?? '-'} [${dims}] :: ${v.summary}`;
}

/** Would `resolveProgressionStep` (progression-gate.ts) treat this band
 *  differently — TAKE/ACCELERATE vs HOLD vs BACK_OFF? Pure function of the
 *  band + veto alone; see progression-gate.ts switch. Restated here rather
 *  than imported so this script never has to construct the `planned` /
 *  `previous` / `weeklyMi` / `lever` / `family` arguments that function
 *  actually needs — the band transition is the load-bearing signal for "would
 *  this change", and is what this script diffs. */
function progressionLean(v: AdaptationVerdict): 'ACCELERATE-eligible' | 'TAKE' | 'HOLD' | 'BACK_OFF' {
  if (v.veto) return 'BACK_OFF';
  switch (v.band) {
    case 'strong': return 'ACCELERATE-eligible';
    case 'normal': return 'TAKE';
    case 'marginal': return 'HOLD';
    case 'poor': return 'BACK_OFF';
  }
}

describe('absorption-reader-split shadow run (report tool, not a gate)', () => {
  it('1 · real account — per-date diff of actual_load_absorption vs representative_execution', async () => {
    // Spans both real taper/recovery windows in the one real account this
    // database holds: Big Sur Marathon (fully aged out of any 42-day window
    // by today) and Americas Finest City half (the live block).
    const dates = [
      '2026-04-20', // pre-Big-Sur, clean window
      '2026-05-10', // inside Big Sur recovery
      '2026-06-15', // post-Big-Sur, clean window
      '2026-07-25', // pre-AFC, clean-ish window
      '2026-08-10', // inside AFC taper
      '2026-08-20', // inside AFC post-race recovery
      '2026-08-31', // today — AFC block just closing out of the 42-day window
    ];
    for (const d of dates) {
      const split = await readAdaptationSplit(DAVID_UUID, d).catch((e) => {
        console.log(`  ${d}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!split) continue;
      const a = split.actual_load_absorption;
      const r = split.representative_execution;
      const changed = a.band !== r.band || a.decision !== r.decision;
      console.log(`\n=== ${d} ${changed ? '  <<< CHANGED >>>' : ''} ===`);
      console.log(`  unfiltered (actual_load_absorption): ${fmtVerdict(a)}`);
      console.log(`  filtered   (representative_execution): ${fmtVerdict(r)}`);
      console.log(`  progression-lean unfiltered=${progressionLean(a)} filtered=${progressionLean(r)}`);
    }
    expect(true).toBe(true);
  }, 60_000);

  it('2a · Rule 9 walk — Big Sur Marathon taper START (2026-04-26, marathon, A)', async () => {
    const dates = ['2026-03-30', '2026-04-01', '2026-04-03', '2026-04-05', '2026-04-07', '2026-04-09', '2026-04-11'];
    for (const d of dates) {
      const split = await readAdaptationSplit(DAVID_UUID, d).catch((e) => {
        console.log(`  ${d}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!split) { console.log(`  ${d}  (unreadable)`); continue; }
      console.log(`  ${d}  ${fmtVerdict(split.representative_execution)}`);
    }
    expect(true).toBe(true);
  }, 60_000);

  it('2b · Rule 9 walk — Big Sur Marathon recovery END (~2026-05-24)', async () => {
    const dates = ['2026-05-18', '2026-05-20', '2026-05-22', '2026-05-24', '2026-05-26', '2026-05-28', '2026-05-30'];
    for (const d of dates) {
      const split = await readAdaptationSplit(DAVID_UUID, d).catch((e) => {
        console.log(`  ${d}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!split) { console.log(`  ${d}  (unreadable)`); continue; }
      console.log(`  ${d}  ${fmtVerdict(split.representative_execution)}`);
    }
    expect(true).toBe(true);
  }, 60_000);

  it('2c · Rule 9 walk — Americas Finest City taper START (2026-08-16, half, A)', async () => {
    const dates = ['2026-07-28', '2026-07-30', '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-05', '2026-08-07'];
    for (const d of dates) {
      const split = await readAdaptationSplit(DAVID_UUID, d).catch((e) => {
        console.log(`  ${d}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!split) { console.log(`  ${d}  (unreadable)`); continue; }
      console.log(`  ${d}  ${fmtVerdict(split.representative_execution)}`);
    }
    expect(true).toBe(true);
  }, 60_000);

  it('2d · Rule 9 walk — Americas Finest City recovery END (~2026-08-30)', async () => {
    const dates = ['2026-08-26', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31'];
    for (const d of dates) {
      const split = await readAdaptationSplit(DAVID_UUID, d).catch((e) => {
        console.log(`  ${d}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!split) { console.log(`  ${d}  (unreadable)`); continue; }
      console.log(`  ${d}  ${fmtVerdict(split.representative_execution)}`);
    }
    expect(true).toBe(true);
  }, 60_000);

  /* ── 3 · SYNTHETIC FIXTURES ────────────────────────────────────────────
   *
   * `_sweep_allusers.test.ts`'s `Arc`/`ArcHistory` shape carries
   * `dailyMiMostRecentFirst` / `recentQualityPerWeek` / `isMidBlock` for the
   * PLAN GENERATOR (`SimInputs`), not `AdaptationInput` — the Adaptation
   * Model's fields (`keySessionExecutions`, `targetVerdicts`, `trainingForm`,
   * `recoveryPctOfExpected`, `decouplingVerdicts`, ...) do not exist anywhere
   * in that corpus. It is not merely thin here — it is structurally unable to
   * express this reader's input at all. These five fixtures are the partial
   * substitute the decision doc allows for that gap. */

  const as_planned: KeySessionRead = { state: 'AS_PLANNED', stimulusCompletion: 1, earnsProgression: true };
  const missed: KeySessionRead = { state: 'MISSED', stimulusCompletion: 0, earnsProgression: false };

  function fixtureInput(sessions: Array<{ dateISO: string; read: KeySessionRead }>): AdaptationInput {
    return {
      keySessionExecutions: sessions.map((s) => s.read),
      keySessionsPlanned: sessions.length,
      keySessionsCompleted: sessions.filter((s) => s.read.state !== 'MISSED').length,
      targetVerdicts: null,
      repConsistency: null,
      rpeReported: null,
      rpeHarderThanExpected: null,
      decouplingVerdicts: null,
      lateDriftBpm: null,
      easyDiscipline: null,
      recoveryPctOfExpected: null,
      readinessBelowNormalDays: null,
      readinessWindowDays: null,
      weeklyPlannedMi: null,
      weeklyActualMi: null,
      trainingForm: null,
      distinctEvidenceWeeks: new Set(sessions.map((s) => s.dateISO.slice(0, 7))).size || null,
      adapterDowngrades: null,
      niggleSeverity: null,
      illnessActive: null,
      injuryActive: null,
    };
  }

  /**
   * MASKING-1 (2026-09-01) fidelity fix. This used to re-implement the filter
   * locally (`sessions.filter((s) => !isPrescribedNonNormal(...))`) rather
   * than calling the real, exported `filterExecutionEvidenceByPrescribedWindow`
   * — two definitions of one question, the exact shape Rule 16 warns about.
   * It also meant this script's `filteredVerdict` recomputed
   * `distinctEvidenceWeeks` from the FILTERED session list via `fixtureInput`,
   * which is not what production does: `loadRepresentativeExecutionInput`
   * only overrides `keySessionExecutions`/`keySessionsPlanned`/
   * `keySessionsCompleted`/`targetVerdicts` on top of the UNFILTERED base —
   * `distinctEvidenceWeeks` (trend) and every other dimension carry through
   * unchanged. That mismatch made trend go null in lockstep with execution in
   * a masked window, when in real production trend is independent (driven by
   * weekly-volume evidence, never by key-session dates) and would usually
   * stay populated. Fixed both: call the real function, and build the
   * filtered `AdaptationInput` the same way `loadRepresentativeExecutionInput`
   * does — `{ ...base, ...filtered }`. */
  function runFixture(label: string, sessions: Array<{ dateISO: string; read: KeySessionRead }>, race: RanRace | null) {
    const windows = race ? prescribedWindowsFrom([race]) : [];
    const base = fixtureInput(sessions);
    const unfilteredVerdict = classifyAdaptation(base);
    const rawRows = sessions.map((s) => ({
      dateISO: s.dateISO,
      readable: true,
      read: { state: s.read.state, stimulusCompletion: s.read.stimulusCompletion },
      earnsProgression: s.read.earnsProgression,
    }));
    const filteredFields = filterExecutionEvidenceByPrescribedWindow(rawRows, [], windows);
    const filteredVerdict = classifyAdaptation({ ...base, ...filteredFields });
    const changed = unfilteredVerdict.band !== filteredVerdict.band
      || unfilteredVerdict.decision !== filteredVerdict.decision;
    const permissiveFlip = unfilteredVerdict.decision !== 'PROGRESS' && filteredVerdict.decision === 'PROGRESS';
    console.log(`\n--- ${label} ${changed ? '  <<< CHANGED >>>' : '  (no change)'}${permissiveFlip ? '  <<< PERMISSIVE FLIP >>>' : ''} ---`);
    if (race) {
      const w = windows[0];
      console.log(`  race ${race.dateISO} (${race.priority}) → excluded ${w.fromISO}..${w.toISO}`);
    }
    console.log(`  unfiltered: ${fmtVerdict(unfilteredVerdict)}`);
    console.log(`  filtered:   ${fmtVerdict(filteredVerdict)}`);
  }

  it('3a · taper+recovery block masking a genuinely good runner (David\'s AFC shape)', () => {
    // 5 sessions BEFORE the race window, all clean; 3 MISSED sessions inside
    // the taper+recovery block (the plan itself asked for no quality there —
    // these are not failures, they are the engine's own prescription).
    const sessions = [
      { dateISO: '2026-07-07', read: as_planned },
      { dateISO: '2026-07-12', read: as_planned },
      { dateISO: '2026-07-16', read: as_planned },
      { dateISO: '2026-07-21', read: as_planned },
      { dateISO: '2026-07-28', read: as_planned },
      { dateISO: '2026-08-05', read: missed }, // inside taper
      { dateISO: '2026-08-12', read: missed }, // inside taper
      { dateISO: '2026-08-22', read: missed }, // inside recovery
    ];
    runFixture(
      '3a taper+recovery masking',
      sessions,
      { slug: 'fixture-half', dateISO: '2026-08-16', distanceMi: 13.1, priority: 'A' },
    );
    expect(true).toBe(true);
  });

  it('3b · genuine detraining, no race — must NOT be waved through as "just a taper"', () => {
    // Same 3-missed-of-8 shape as 3a, but with NO race anywhere near it. No
    // prescribed window exists, so filtering must change NOTHING — this is
    // the corollary's control case: absence of a race means these misses are
    // real, and representative_execution must read them exactly as
    // actual_load_absorption does.
    const sessions = [
      { dateISO: '2026-07-07', read: as_planned },
      { dateISO: '2026-07-12', read: as_planned },
      { dateISO: '2026-07-16', read: as_planned },
      { dateISO: '2026-07-21', read: as_planned },
      { dateISO: '2026-07-28', read: as_planned },
      { dateISO: '2026-08-05', read: missed },
      { dateISO: '2026-08-12', read: missed },
      { dateISO: '2026-08-22', read: missed },
    ];
    runFixture('3b genuine detraining (no race, control)', sessions, null);
    expect(true).toBe(true);
  });

  it('3c · clean window, no taper anywhere near — must be a true no-op', () => {
    const sessions = [
      { dateISO: '2026-07-01', read: as_planned },
      { dateISO: '2026-07-08', read: as_planned },
      { dateISO: '2026-07-15', read: as_planned },
      { dateISO: '2026-07-22', read: as_planned },
      { dateISO: '2026-07-29', read: as_planned },
      { dateISO: '2026-08-05', read: as_planned },
    ];
    // A race far outside the window, so the exclusion predicate touches
    // nothing in this session list at all.
    runFixture(
      '3c clean window (distant race, no-op expected)',
      sessions,
      { slug: 'fixture-far', dateISO: '2027-06-01', distanceMi: 26.2, priority: 'A' },
    );
    expect(true).toBe(true);
  });

  it('3d · window so sparse after filtering it falls to null evidence, not a fabricated poor score', () => {
    // ALL sessions sit inside the prescribed window — nothing survives the
    // filter. `readExecution` must return score:null (excluded from the
    // mean), never a manufactured `poor`, per Rule 11.
    const sessions = [
      { dateISO: '2026-08-03', read: missed },
      { dateISO: '2026-08-10', read: missed },
      { dateISO: '2026-08-17', read: missed },
      { dateISO: '2026-08-24', read: missed },
    ];
    runFixture(
      '3d fully-masked window (expect null execution dimension, not poor)',
      sessions,
      { slug: 'fixture-half-2', dateISO: '2026-08-16', distanceMi: 13.1, priority: 'A' },
    );
    expect(true).toBe(true);
  });

  it('3e · two races inside one 42-day window (compound taper+recovery)', () => {
    const sessions = [
      { dateISO: '2026-04-05', read: as_planned },
      { dateISO: '2026-04-20', read: missed }, // inside Big Sur taper
      { dateISO: '2026-04-30', read: missed }, // inside Big Sur recovery / Sombrero taper
      { dateISO: '2026-05-10', read: missed }, // inside Sombrero recovery
      { dateISO: '2026-05-20', read: as_planned },
    ];
    runFixture('3e compound (Big Sur + Sombrero back to back)', sessions, null);
    // Run again with BOTH races' windows via a second call, since runFixture
    // only takes one race — inline here rather than widening the helper for
    // a single fixture.
    const windows = prescribedWindowsFrom([
      { slug: 'big-sur', dateISO: '2026-04-26', distanceMi: 26.2, priority: 'hilly-excluded' },
      { slug: 'sombrero', dateISO: '2026-05-03', distanceMi: 13.1, priority: 'C' },
    ]);
    const base = fixtureInput(sessions);
    const unfilteredVerdict = classifyAdaptation(base);
    const rawRows = sessions.map((s) => ({
      dateISO: s.dateISO,
      readable: true,
      read: { state: s.read.state, stimulusCompletion: s.read.stimulusCompletion },
      earnsProgression: s.read.earnsProgression,
    }));
    const filteredFields = filterExecutionEvidenceByPrescribedWindow(rawRows, [], windows);
    const filteredVerdict = classifyAdaptation({ ...base, ...filteredFields });
    const permissiveFlip = unfilteredVerdict.decision !== 'PROGRESS' && filteredVerdict.decision === 'PROGRESS';
    console.log(`  (both windows applied)${permissiveFlip ? '  <<< PERMISSIVE FLIP >>>' : ''} unfiltered: ${fmtVerdict(unfilteredVerdict)}`);
    console.log(`  (both windows applied) filtered:   ${fmtVerdict(filteredVerdict)}`);
    expect(true).toBe(true);
  });
});
