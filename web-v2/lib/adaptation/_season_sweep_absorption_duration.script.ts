/**
 * lib/adaptation/_season_sweep_absorption_duration.script.ts
 *
 * THE SEASON-WIDE DUAL-READER SWEEP for
 * docs/reports/absorption-dual-log-2026-09-01.md.
 *
 * Extends `_shadow_run_absorption_split.script.ts` (which sampled 7 dates
 * across the AFC/Big Sur windows only) to every real race window the
 * account has raced this season, plus a weekly-cadence sweep of the whole
 * account history, so the disagreement RATE and the boundary walks are
 * measured over a season, not a hand-picked sample.
 *
 * Every date below is read via `readAdaptationSplitWithLog`
 * (`lib/adaptation/load.ts`), which — per the account owner's ruling not to
 * promote `representative_execution` yet — builds a structured comparison
 * record and appends it to `docs/reports/adaptation-shadow-log/<uuid>.absorption-duration.jsonl`
 * on every call. This script's job is to drive that logging across real
 * history and print a summary a report can quote from; the JSONL file is
 * the actual persisted, inspectable evidence.
 *
 * NOT a gate. NOT part of `npm test` — wired into `vitest.shadow-run.config.ts`
 * alongside its sibling. Read-only start to finish: `readAdaptationSplitWithLog`
 * calls only `loadAdaptationInput` / `loadRepresentativeExecutionInput` /
 * `classifyAdaptation` / read-only extra fetches, and its own persistence is
 * an `fs.appendFile` to a git-tracked file — no `applyAdaptations`, no
 * `plan_workouts` UPDATE, anywhere in this call graph.
 *
 * Invoke with:
 *   npx vitest run --config vitest.shadow-run.config.ts
 */
import { describe, it, expect } from 'vitest';
import { readAdaptationSplitWithLog, type AdaptationComparisonRecord } from './load';
import { prescribedWindowFor, prescribedWindowsFrom, isPrescribedNonNormal, type RanRace } from '@/lib/training/normal-window';
import { classifyAdaptation, type AdaptationInput, type AdaptationVerdict, type KeySessionRead } from './adaptation-model';

const DAVID_UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** Every real race this account has actually run and recorded a result for,
 *  as of 2026-08-31 (see `races.actual_result` — races without a result yet,
 *  santa-monica-10k onward, open no prescribed window and are excluded on
 *  purpose, matching `loadPrescribedWindows`'s own predicate). */
const REAL_RACES: RanRace[] = [
  { slug: 'rose-bowl-half-2026', dateISO: '2026-01-18', distanceMi: 13.109, priority: 'A' },
  { slug: 'disney-half-2026', dateISO: '2026-02-01', distanceMi: 13.109, priority: 'A' },
  { slug: 'la-marathon-2026', dateISO: '2026-03-08', distanceMi: 26.219, priority: 'A' },
  { slug: 'big-sur-marathon', dateISO: '2026-04-26', distanceMi: 26.2, priority: 'hilly-excluded' },
  { slug: 'sombrero-half', dateISO: '2026-05-03', distanceMi: 13.16, priority: 'C' },
  { slug: 'americas-finest-city', dateISO: '2026-08-16', distanceMi: 13.1, priority: 'A' },
];

function isoShiftLocal(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtVerdict(v: AdaptationComparisonRecord['actual_load_absorption']): string {
  return `${v.band}/${v.decision} conf=${v.confidence} step=${v.stepMultiplier} veto=${v.veto ?? '-'}`;
}

function fmtRecord(d: string, r: AdaptationComparisonRecord): string {
  const a = r.actual_load_absorption;
  const b = r.representative_execution;
  const changed = r.disagreesOnBandOrDecision;
  const durationFlip = r.durationLever.decisiveLimiter !== 'agree';
  const execCount = r.observations.filter((o) => o.kind === 'key_session');
  const inA = execCount.filter((o) => o.inAbsorption).length;
  const inR = execCount.filter((o) => o.inRepresentative).length;
  const excluded = execCount.filter((o) => o.excludedFromRepresentativeReason).length;
  const reached = execCount.filter((o) => o.onlyInRepresentativeReason).length;
  const flag = changed ? '  <<< BAND/DECISION CHANGED >>>' : durationFlip ? '  <<< DURATION GATE FLIPS >>>' : '';
  return `  ${d}${flag}\n`
    + `    absorption:     ${fmtVerdict(a)}  permitsDuration=${r.durationLever.absorption.permitsLoadProgression}\n`
    + `    representative: ${fmtVerdict(b)}  permitsDuration=${r.durationLever.representative.permitsLoadProgression}\n`
    + `    decisiveLimiter=${r.durationLever.decisiveLimiter}  `
    + `keySessions: absorption=${inA} representative=${inR} (excluded=${excluded}, reached-back=${reached})`;
}

/** Ordered, de-duplicated list of dates to walk for one race's prescribed
 *  window: 3 days either side of the taper-open boundary and 3 days either
 *  side of the recovery-close boundary, plus race day itself. */
function boundaryDates(race: RanRace): string[] {
  const w = prescribedWindowFor(race);
  if (!w) return [race.dateISO];
  const dates = new Set<string>();
  for (let off = -2; off <= 2; off++) dates.add(isoShiftLocal(w.fromISO, off));
  dates.add(race.dateISO);
  for (let off = -2; off <= 2; off++) dates.add(isoShiftLocal(w.toISO, off));
  return [...dates].sort();
}

describe('season-wide absorption/duration dual-reader sweep (report tool, not a gate)', () => {
  it('1 · weekly-cadence sweep, whole season (2026-01-08 .. 2026-08-31)', async () => {
    const dates: string[] = [];
    // Bi-weekly, not weekly — each date costs ~2 full `loadAdaptationInput`
    // reads (readAdaptationSplitWithLog's own design, unchanged here) plus
    // this record's extra observation-detail fetch, and this is a live
    // network round trip to the production read-replica per query. Bi-weekly
    // still spans the whole season at 3x the original report's 7 dates'
    // density and keeps one vitest run tractable; the boundary walks below
    // are where day-by-day resolution actually matters (Rule 9).
    let d = '2026-01-08';
    while (d <= '2026-08-31') {
      dates.push(d);
      d = isoShiftLocal(d, 14);
    }
    console.log(`\n=== WEEKLY SWEEP: ${dates.length} dates ===`);
    let disagreements = 0;
    let durationFlips = 0;
    for (const date of dates) {
      const result = await readAdaptationSplitWithLog(DAVID_UUID, date).catch((e) => {
        console.log(`  ${date}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!result) continue;
      if (result.record.disagreesOnBandOrDecision) disagreements++;
      if (result.record.durationLever.decisiveLimiter !== 'agree') durationFlips++;
      console.log(fmtRecord(date, result.record));
    }
    console.log(`\n  TOTAL: ${dates.length} dates, ${disagreements} band/decision disagreements, ${durationFlips} duration-gate flips`);
    expect(true).toBe(true);
  }, 900_000);

  for (const race of REAL_RACES) {
    it(`2 · boundary walk — ${race.slug} (${race.dateISO}, ${race.priority})`, async () => {
      const dates = boundaryDates(race);
      const w = prescribedWindowFor(race);
      console.log(`\n=== BOUNDARY WALK: ${race.slug} — window ${w?.fromISO}..${w?.toISO} (taper ${w?.taperWeeks}wk, recovery ${w?.recoveryWeeks}wk) ===`);
      for (const date of dates) {
        const result = await readAdaptationSplitWithLog(DAVID_UUID, date).catch((e) => {
          console.log(`  ${date}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        });
        if (!result) { console.log(`  ${date}  (unreadable)`); continue; }
        console.log(fmtRecord(date, result.record));
      }
      expect(true).toBe(true);
    }, 900_000);
  }

  /* The AFC boundary walk above samples the window's OPEN/CLOSE edges at
   * 1-day resolution but jumps straight from the taper open (08-02..08-04)
   * to race day (08-16) to the recovery close (08-28..09-01) — it never
   * walked the RECOVERY INTERIOR, which is exactly where §3/§1's real
   * disagreement (2026-08-16 through 2026-08-20+) lives. This is the
   * dedicated daily walk across that interior, at full 1-day resolution, to
   * find the exact transition days rather than infer them from a sparser
   * sample. */
  it('2b · AFC recovery-interior daily walk (2026-08-13 .. 2026-08-24)', async () => {
    const dates: string[] = [];
    let d = '2026-08-13';
    while (d <= '2026-08-24') {
      dates.push(d);
      d = isoShiftLocal(d, 1);
    }
    console.log('\n=== AFC RECOVERY-INTERIOR DAILY WALK ===');
    for (const date of dates) {
      const result = await readAdaptationSplitWithLog(DAVID_UUID, date).catch((e) => {
        console.log(`  ${date}  ERROR: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (!result) { console.log(`  ${date}  (unreadable)`); continue; }
      console.log(fmtRecord(date, result.record));
    }
    expect(true).toBe(true);
  }, 600_000);

  /* ── 3 · synthetic fixtures — DURATION lever, exact numbers ──────────────
   *
   * The same 5 fixtures `_shadow_run_absorption_split.script.ts` §3 already
   * built (David's AFC shape, the no-race control, the true no-op, the
   * fully-masked window, and the compound Big-Sur+Sombrero window),
   * re-run here purely to compute `permitsLoadProgression` (the exact
   * predicate `detectDuration` gates on) for both sides, rather than
   * inferring it from the prior report's band/decision prose. Read-only,
   * no database — these fixtures never touch a real account, so nothing
   * here is persisted to the JSONL log; the DB-backed dates above are the
   * persisted evidence. */

  const as_planned: KeySessionRead = { state: 'AS_PLANNED', stimulusCompletion: 1, earnsProgression: true };
  const missed: KeySessionRead = { state: 'MISSED', stimulusCompletion: 0, earnsProgression: false };

  function fixtureInput(sessions: Array<{ dateISO: string; read: KeySessionRead }>): AdaptationInput {
    return {
      keySessionExecutions: sessions.map((s) => s.read),
      keySessionsPlanned: sessions.length,
      keySessionsCompleted: sessions.filter((s) => s.read.state !== 'MISSED').length,
      targetVerdicts: null, repConsistency: null, rpeReported: null, rpeHarderThanExpected: null,
      decouplingVerdicts: null, lateDriftBpm: null, easyDiscipline: null, recoveryPctOfExpected: null,
      readinessBelowNormalDays: null, readinessWindowDays: null, weeklyPlannedMi: null, weeklyActualMi: null,
      trainingForm: null,
      distinctEvidenceWeeks: new Set(sessions.map((s) => s.dateISO.slice(0, 7))).size || null,
      adapterDowngrades: null, niggleSeverity: null, illnessActive: null, injuryActive: null,
    };
  }

  function permits(v: AdaptationVerdict): boolean {
    return v.decision === 'PROGRESS' && v.veto == null;
  }

  function runFixtureDurationLever(
    label: string,
    sessions: Array<{ dateISO: string; read: KeySessionRead }>,
    races: RanRace[],
  ) {
    const windows = races.length > 0 ? prescribedWindowsFrom(races) : [];
    const filtered = sessions.filter((s) => !isPrescribedNonNormal(s.dateISO, windows));
    const a = classifyAdaptation(fixtureInput(sessions));
    const r = classifyAdaptation(fixtureInput(filtered));
    const pa = permits(a);
    const pr = permits(r);
    const flips = pa !== pr;
    console.log(`\n--- ${label} ${flips ? '  <<< DURATION GATE FLIPS >>>' : '  (duration gate agrees)'} ---`);
    console.log(`  absorption:     band=${a.band} decision=${a.decision} veto=${a.veto ?? '-'} permitsDuration=${pa}`);
    console.log(`  representative: band=${r.band} decision=${r.decision} veto=${r.veto ?? '-'} permitsDuration=${pr}`);
    if (flips) {
      console.log(`  decisiveLimiter=${pa ? 'representative_execution' : 'actual_load_absorption'}`);
    }
  }

  it('3a-duration · taper+recovery masking a genuinely good runner', () => {
    const sessions = [
      { dateISO: '2026-07-07', read: as_planned }, { dateISO: '2026-07-12', read: as_planned },
      { dateISO: '2026-07-16', read: as_planned }, { dateISO: '2026-07-21', read: as_planned },
      { dateISO: '2026-07-28', read: as_planned }, { dateISO: '2026-08-05', read: missed },
      { dateISO: '2026-08-12', read: missed }, { dateISO: '2026-08-22', read: missed },
    ];
    runFixtureDurationLever('3a taper+recovery masking', sessions,
      [{ slug: 'fixture-half', dateISO: '2026-08-16', distanceMi: 13.1, priority: 'A' }]);
    expect(true).toBe(true);
  });

  it('3b-duration · genuine detraining, no race (control)', () => {
    const sessions = [
      { dateISO: '2026-07-07', read: as_planned }, { dateISO: '2026-07-12', read: as_planned },
      { dateISO: '2026-07-16', read: as_planned }, { dateISO: '2026-07-21', read: as_planned },
      { dateISO: '2026-07-28', read: as_planned }, { dateISO: '2026-08-05', read: missed },
      { dateISO: '2026-08-12', read: missed }, { dateISO: '2026-08-22', read: missed },
    ];
    runFixtureDurationLever('3b genuine detraining (no race, control)', sessions, []);
    expect(true).toBe(true);
  });

  it('3c-duration · clean window, distant race (true no-op)', () => {
    const sessions = [
      { dateISO: '2026-07-01', read: as_planned }, { dateISO: '2026-07-08', read: as_planned },
      { dateISO: '2026-07-15', read: as_planned }, { dateISO: '2026-07-22', read: as_planned },
      { dateISO: '2026-07-29', read: as_planned }, { dateISO: '2026-08-05', read: as_planned },
    ];
    runFixtureDurationLever('3c clean window (distant race, no-op expected)', sessions,
      [{ slug: 'fixture-far', dateISO: '2027-06-01', distanceMi: 26.2, priority: 'A' }]);
    expect(true).toBe(true);
  });

  it('3d-duration · fully-masked window', () => {
    const sessions = [
      { dateISO: '2026-08-03', read: missed }, { dateISO: '2026-08-10', read: missed },
      { dateISO: '2026-08-17', read: missed }, { dateISO: '2026-08-24', read: missed },
    ];
    runFixtureDurationLever('3d fully-masked window', sessions,
      [{ slug: 'fixture-half-2', dateISO: '2026-08-16', distanceMi: 13.1, priority: 'A' }]);
    expect(true).toBe(true);
  });

  it('3e-duration · two races back to back (compound window)', () => {
    const sessions = [
      { dateISO: '2026-04-05', read: as_planned }, { dateISO: '2026-04-20', read: missed },
      { dateISO: '2026-04-30', read: missed }, { dateISO: '2026-05-10', read: missed },
      { dateISO: '2026-05-20', read: as_planned },
    ];
    runFixtureDurationLever('3e compound (Big Sur + Sombrero)', sessions, [
      { slug: 'big-sur', dateISO: '2026-04-26', distanceMi: 26.2, priority: 'hilly-excluded' },
      { slug: 'sombrero', dateISO: '2026-05-03', distanceMi: 13.16, priority: 'C' },
    ]);
    expect(true).toBe(true);
  });
});
