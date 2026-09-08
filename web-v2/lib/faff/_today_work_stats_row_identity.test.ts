/**
 * lib/faff/_today_work_stats_row_identity.test.ts
 *
 * "PACE, ACROSS THE WORK" IS ABOUT THE RUN ON THE SCREEN.
 *
 * ── THE DEFECT (SIMROW-1 · TODAY, found live 2026-09-08) ────────────────────
 *
 * `/api/v5/today` resolved the watch-completion payload behind `paceWork`,
 * `hrAvgWork` and `cadenceAvgWork` with its own query: this runner, reason
 * `watch_completion`, this DATE, `ORDER BY ts DESC LIMIT 1`. It was never
 * joined to the run whose id the same block had already used to fetch
 * `workoutPhases`. So on any day carrying more than one completion payload it
 * composed the post-run card from whichever was written last.
 *
 * Confirmed against the owner's own rows, copied out of production into a
 * scratch database — not theorised. Three intents land on 2026-09-02:
 *
 *     id 921  sim-recovery-live#1038                     3 phases  ← taken
 *     id 920  sim-recovery-live#1101                     3 phases
 *     id 919  0645f40c-…-2026-09-02#0919                13 phases  ← his run
 *
 * The route's query, run verbatim against that data, returns id 921 — a
 * SIMULATOR payload, ahead of his real run by 47 minutes of timestamp. Its one
 * work phase is 31 s / 0.09 mi, so the screen read
 *
 *     Pace, across the work · 5:44     (his run: 8:26)
 *     hrAvgWork             · 167      (his run: 137)
 *     cadenceAvgWork        · 184      (his run: 165)
 *
 * Every number the runner read as his own effort belonged to somebody's test.
 * Two further production days resolve to a stranger the same way — 2026-08-27
 * and 2026-06-01, both to an unrelated `trd_` treadmill payload — so this is
 * not a simulator problem, it is "somebody's payload landed on this date".
 *
 * ── WHAT THIS FILE ASSERTS ──────────────────────────────────────────────────
 *
 *   A · the resolved stats come from the row matching the DISPLAYED RUN, not
 *       from a decoy with a later timestamp;
 *   B · with nothing matching the displayed run, the stats are ABSENT — never
 *       borrowed from another row (Rule 11: a refusal is a correct answer, a
 *       confident number off a stranger's payload is not);
 *   C · all three numbers come from ONE array, so a mixed row is impossible
 *       by construction (Rule 16);
 *   D · the route still CALLS the shared resolver. A behavioural test alone
 *       cannot catch a surface that stops calling it — CLAUDE.md Rule 16 says
 *       so in the sentence that motivated `race-projection.ts`'s own scan.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It cannot fail on the ARITHMETIC of `workAveragesFromPhases` being wrong —
 * it asserts identity of the source row, and takes the duration-weighting as
 * given (`_work_averages*` owns that). It cannot fail on the phone rendering
 * the wire fields under the wrong label. And it cannot fail on a fourth
 * surface growing its own copy of the lookup: guard D is scoped to this one
 * route, because that is the file the defect was found in.
 *
 * ── FALSIFIED ───────────────────────────────────────────────────────────────
 *
 * `OLD_LOOKUP` below reproduces the removed date+`ORDER BY ts DESC` query and
 * is asserted to pick the DECOY on the same fixtures the live path resolves
 * correctly. A test that cannot tell the broken implementation from the fixed
 * one is not evidence of anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn(async () => '2026-09-02'),
  runnerTimezoneOrPacific: vi.fn(async () => 'America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import { resolveStoredPhases } from '@/lib/postrun/load';
import { workStatsForDisplay } from '@/lib/runs/work-averages';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DATE = '2026-09-02';
const REAL_REF = `${USER}-${DATE}#0919`;

/* ══════════════════════════════════════════════════════════════════════════
 * THE FIXTURES · the owner's own rows, copied out of the scratch substrate
 * built by `scripts/adapt-harness-substrate.sh` from production, with only the
 * per-second `hrSamples` / `paceSamples` arrays stripped (nothing here reads
 * them). Field names, phase types and every number are verbatim.
 * ═══════════════════════════════════════════════════════════════════════ */

/** `coach_intents.id = 919` — his real 6.41 mi easy-plus-6-strides session. */
const REAL_PHASES = [
  { type: 'work', index: 0, label: '5.0 mi easy', avgHr: 137, maxHr: 149, verdict: 'hit', completed: true, avgCadence: 165, actualDistanceMi: 5, actualPaceSPerMi: 515, targetPaceSPerMi: 522, actualDurationSec: 2577 },
  { type: 'work', index: 1, label: 'Stride 1 of 6', avgHr: 147, maxHr: 148, completed: true, avgCadence: 171, actualDistanceMi: 0.05, actualPaceSPerMi: 401, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 2, label: 'Walk back', avgHr: 151, maxHr: 155, completed: true, avgCadence: 166, actualDistanceMi: 0.11, actualPaceSPerMi: 546, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { type: 'work', index: 3, label: 'Stride 2 of 6', avgHr: 147, maxHr: 148, completed: true, avgCadence: 177, actualDistanceMi: 0.06, actualPaceSPerMi: 347, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 4, label: 'Walk back', avgHr: 153, maxHr: 159, completed: true, avgCadence: 162, actualDistanceMi: 0.12, actualPaceSPerMi: 519, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { type: 'work', index: 5, label: 'Stride 3 of 6', avgHr: 149, maxHr: 153, completed: true, avgCadence: 174, actualDistanceMi: 0.06, actualPaceSPerMi: 349, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 6, label: 'Walk back', avgHr: 154, maxHr: 159, completed: true, avgCadence: 163, actualDistanceMi: 0.11, actualPaceSPerMi: 547, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { type: 'work', index: 7, label: 'Stride 4 of 6', avgHr: 152, maxHr: 154, completed: true, avgCadence: 157, actualDistanceMi: 0.05, actualPaceSPerMi: 365, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 8, label: 'Walk back', avgHr: 154, maxHr: 160, completed: true, avgCadence: 147, actualDistanceMi: 0.09, actualPaceSPerMi: 677, targetPaceSPerMi: 522, actualDurationSec: 60 },
  { type: 'work', index: 9, label: 'Stride 5 of 6', avgHr: 142, maxHr: 146, completed: true, avgCadence: 176, actualDistanceMi: 0.06, actualPaceSPerMi: 350, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 10, label: 'Walk back', avgHr: 157, maxHr: 163, completed: false, avgCadence: 148, actualDistanceMi: 0.1, actualPaceSPerMi: 563, targetPaceSPerMi: 522, actualDurationSec: 59 },
  { type: 'work', index: 11, label: 'Stride 6 of 6', avgHr: 152, maxHr: 157, completed: true, avgCadence: 161, actualDistanceMi: 0.05, actualPaceSPerMi: 431, targetPaceSPerMi: 401, actualDurationSec: 20 },
  { type: 'recovery', index: 12, label: 'Walk back', avgHr: 157, maxHr: 160, completed: true, avgCadence: 146, actualDistanceMi: 0.12, actualPaceSPerMi: 526, targetPaceSPerMi: 522, actualDurationSec: 61 },
];

/** `coach_intents.id = 921` — `sim-recovery-live#1038`, posted 47 minutes
 *  later. One 31-second work phase. This is what the screen was showing. */
const DECOY_SIM_PHASES = [
  { type: 'warmup', index: 0, label: 'Warm-up', avgHr: 166, maxHr: 166, completed: true, avgCadence: 183, actualDistanceMi: 0.18, actualPaceSPerMi: 178, actualDurationSec: 32 },
  { type: 'work', index: 1, label: 'Work', avgHr: 167, maxHr: 167, verdict: 'missed', completed: true, avgCadence: 184, actualDistanceMi: 0.09, actualPaceSPerMi: 344, targetPaceSPerMi: 391, actualDurationSec: 31 },
  { type: 'recovery', index: 2, label: 'Recovery', completed: false, actualDurationSec: 378 },
];

/** The same decoy under a field that carries NO `sim-` marker — the real
 *  2026-08-27 and 2026-06-01 shape, where the stranger is another treadmill
 *  session of the runner's own. `sim-%` exclusion alone does not save these;
 *  only matching the run does. */
const DECOY_TRD_FIELD = 'trd_CB6DBC5C-0345-4262-860B-D208DC7DAAF7';

/** The truth, computed by hand off `REAL_PHASES`:
 *    work seconds 2577+20+20+20+20+20+20 = 2697
 *    work miles   5 + .05+.06+.06+.05+.06+.05 = 5.33
 *    pace         2697 / 5.33 = 506.0 s/mi → 8:26
 *  Matches the SQL rollup run directly against the substrate. */
const TRUTH = { paceWork: '8:26', hrAvgWork: 137, cadenceAvgWork: 165 };
/** What the decoy produces, i.e. what the runner was actually shown. */
const DECOY_READING = { paceWork: '5:44', hrAvgWork: 167, cadenceAvgWork: 184 };

/* ══════════════════════════════════════════════════════════════════════════
 * THE MOCK DATABASE
 *
 * Rows, not canned answers. `pool.query` is routed by what the SQL asks for,
 * so the OLD lookup and the NEW resolver both run against ONE seeded table and
 * their disagreement is a property of the code, not of two different stubs.
 * ═══════════════════════════════════════════════════════════════════════ */

interface IntentRow { id: number; field: string; ts: string; phases: unknown[] }

let INTENTS: IntentRow[] = [];

/** The removed query, reproduced. `field` carrying no `-YYYY-MM-DD` suffix
 *  falls through to the timestamp compare — which is the same for every
 *  payload posted that day, so the tie is broken by `ts DESC` and nothing
 *  else. This is the whole defect in four lines. */
function OLD_LOOKUP(dateISO: string): IntentRow | null {
  const dated = /-\d{4}-\d{2}-\d{2}(#\d+)?$/;
  const matches = INTENTS.filter((r) =>
    dated.test(r.field)
      ? new RegExp(`-${dateISO}(#\\d+)?$`).test(r.field)
      : r.ts.slice(0, 10) === dateISO,
  );
  matches.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return matches[0] ?? null;
}

beforeEach(() => {
  INTENTS = [];
  vi.mocked(pool.query).mockReset();
  vi.mocked(pool.query).mockImplementation((async (sql: string, params: unknown[]) => {
    if (!/coach_intents/.test(sql)) return { rows: [] };
    // Rung 1 / rung 3 of `resolveStoredPhases` are told apart by whether the
    // SQL pins `field = $2`.
    if (/field = \$2/.test(sql)) {
      const want = String(params[1]);
      const hit = INTENTS.filter((r) => r.field === want).sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];
      return { rows: hit ? [{ value: { phases: hit.phases } }] : [] };
    }
    // Rung 3 · the legacy date match, bounded to non-`sim-` fields.
    const bounded = /field NOT LIKE 'sim-%'/.test(sql);
    const row = OLD_LOOKUP(String(params[1]));
    const ok = row && (!bounded || !row.field.startsWith('sim-'));
    return { rows: ok ? [{ value: { phases: row!.phases } }] : [] };
  }) as never);
});

/** Seed the real production shape: his run, then two later decoys. */
function seedRealDay(opts: { decoyField?: string } = {}) {
  INTENTS = [
    { id: 919, field: REAL_REF, ts: '2026-09-02T10:38:54', phases: REAL_PHASES },
    { id: 920, field: 'sim-recovery-live#1101', ts: '2026-09-02T11:25:53', phases: DECOY_SIM_PHASES },
    { id: 921, field: opts.decoyField ?? 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
  ];
}

/** What `/api/v5/today` does, through the two functions it actually calls. */
async function todayWorkStats(runData: Record<string, unknown>) {
  const phases = await resolveStoredPhases(USER, DATE, runData);
  return workStatsForDisplay(phases);
}

/* ══════════════════════════════════════════════════════════════════════════ */

describe('SIMROW-1 · TODAY — the work stats belong to the run on the screen', () => {
  it('the FIXTURES reproduce the defect: the old lookup takes the decoy', () => {
    seedRealDay();
    const picked = OLD_LOOKUP(DATE);
    // Rule 18 · falsify the check. If this ever stops selecting the simulator
    // row, the fixtures no longer express the bug and every assertion below is
    // passing for free.
    expect(picked?.field).toBe('sim-recovery-live#1038');
    expect(workStatsForDisplay(picked!.phases)).toEqual(DECOY_READING);
    // …and the same fixtures do hold his real run, so the two are genuinely
    // distinguishable rather than accidentally equal.
    expect(workStatsForDisplay(REAL_PHASES)).toEqual(TRUTH);
  });

  it('A · resolves the run\'s OWN completion, not the later decoy', async () => {
    seedRealDay();
    const stats = await todayWorkStats({ date: DATE, watchCompletionRef: REAL_REF });
    expect(stats).toEqual(TRUTH);
    expect(stats.paceWork).not.toBe(DECOY_READING.paceWork);
  });

  it('A2 · a decoy with NO `sim-` marker loses just the same', async () => {
    // 2026-08-27 and 2026-06-01 in production: the stranger is another
    // treadmill payload of the runner's own, which no `sim-%` exclusion sees.
    seedRealDay({ decoyField: DECOY_TRD_FIELD });
    expect(OLD_LOOKUP(DATE)?.field).toBe(DECOY_TRD_FIELD);
    const stats = await todayWorkStats({ date: DATE, watchCompletionRef: REAL_REF });
    expect(stats).toEqual(TRUTH);
  });

  it('A3 · the run row\'s own `data.phases` answers when the intent is gone', async () => {
    // Rung 2. Still THIS RUN'S array — written verbatim by the same request —
    // so it is not a fallback to a stranger, it is the same fact from the
    // other copy.
    INTENTS = [
      { id: 921, field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
    ];
    const stats = await todayWorkStats({ date: DATE, phases: REAL_PHASES });
    expect(stats).toEqual(TRUTH);
  });

  it('B · REFUSES rather than borrowing when nothing matches this run', async () => {
    // The decoy is present and is the only thing on the date. The run names no
    // completion and carries no phases of its own. The honest answer is "we do
    // not have this" — Rule 11 — and specifically NOT the decoy's numbers.
    INTENTS = [
      { id: 921, field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
      { id: 920, field: 'sim-recovery-live#1101', ts: '2026-09-02T11:25:53', phases: DECOY_SIM_PHASES },
    ];
    const stats = await todayWorkStats({ date: DATE });
    expect(stats).toEqual({ paceWork: null, hrAvgWork: null, cadenceAvgWork: null });
    // The old lookup, on the same seed, would have shown the simulator.
    expect(workStatsForDisplay(OLD_LOOKUP(DATE)!.phases)).toEqual(DECOY_READING);
  });

  it('B2 · a run that named a completion which no longer exists refuses too', async () => {
    INTENTS = [
      { id: 921, field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
    ];
    const stats = await todayWorkStats({ date: DATE, watchCompletionRef: `${USER}-${DATE}#9999` });
    expect(stats).toEqual({ paceWork: null, hrAvgWork: null, cadenceAvgWork: null });
  });

  it('C · all three numbers come from ONE array — never a mix', async () => {
    // The reviewer's own diagnostic tell was that `hrAvgWork` disagreed with
    // the phases on the screen. The structural guarantee is stronger than any
    // single value: whatever the matched row holds, the trio is exactly what
    // that ONE array produces, and nothing is topped up from elsewhere.
    seedRealDay();
    const runData = { date: DATE, watchCompletionRef: REAL_REF };
    const stats = await todayWorkStats(runData);
    const fromMatchedAlone = workStatsForDisplay(REAL_PHASES);
    expect(stats).toEqual(fromMatchedAlone);

    // And with a matched payload that carries NO heart rate at all: the HR and
    // cadence go null while the pace — which WAS measured — survives. Rule 11
    // cuts both ways. A null here means "not measured"; suppressing a real
    // pace because the strap was off would be inventing an absence, and
    // borrowing the decoy's 167 to fill the hole is the defect itself.
    const strapless = REAL_PHASES.map(({ avgHr, avgCadence, ...rest }) => rest);
    INTENTS = [{ id: 919, field: REAL_REF, ts: '2026-09-02T10:38:54', phases: strapless },
               { id: 921, field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES }];
    const bare = await todayWorkStats(runData);
    expect(bare).toEqual({ paceWork: TRUTH.paceWork, hrAvgWork: null, cadenceAvgWork: null });
    expect(bare.hrAvgWork).not.toBe(DECOY_READING.hrAvgWork);
    expect(bare.cadenceAvgWork).not.toBe(DECOY_READING.cadenceAvgWork);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D · THE ROUTE STILL CALLS THE OWNER
 *
 * Rule 16, in the sentence that produced `race-projection.ts`'s own scan: a
 * behavioural test cannot catch a surface that stops calling the shared
 * resolver, because the surface's own copy will pass every behavioural
 * assertion right up until the day two payloads land on one date.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('SIMROW-1 · TODAY — no second answer inside the route', () => {
  const ROUTE = path.join(process.cwd(), 'app/api/v5/today/route.ts');
  const SRC = fs.readFileSync(ROUTE, 'utf8');

  it('the scanner read a real file (Rule 18 · liveness)', () => {
    expect(SRC.length).toBeGreaterThan(10_000);
    expect(SRC).toContain('const completionPhases');
  });

  it('resolves phases through `resolveStoredPhases`', () => {
    expect(SRC).toContain('resolveStoredPhases');
    expect(SRC).toMatch(/const completionPhases[^=]*=\s*\(await resolveStoredPhases\(/);
  });

  it('derives the work stats through `workStatsForDisplay`', () => {
    expect(SRC).toContain('workStatsForDisplay(completionPhases)');
  });

  it('carries NO watch-completion lookup of its own', () => {
    // The exact shape that was removed. A route that grows this back has
    // re-opened the defect whatever the behavioural tests say.
    expect(SRC).not.toMatch(/reason = 'watch_completion'/);
    expect(SRC).not.toMatch(/FROM coach_intents[\s\S]{0,400}ORDER BY ts DESC LIMIT 1/);
  });
});
