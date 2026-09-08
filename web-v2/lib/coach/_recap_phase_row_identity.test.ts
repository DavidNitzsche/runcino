/**
 * lib/coach/_recap_phase_row_identity.test.ts
 *
 * THE RECAP DESCRIBES THE RUN IT WAS ASKED ABOUT.
 *
 * ── THE DEFECT (SIMROW-1 · RECAP, found 2026-09-08) ─────────────────────────
 *
 * `GET /api/runs/[id]/recap` resolved the per-rep phases behind its recap
 * sentences with its own query: this runner, reason `watch_completion`, this
 * DATE, `ORDER BY ts DESC LIMIT 1`, inside a swallowing try/catch. It was
 * never joined to `runRow.id` — the run the route had already resolved through
 * `resolveCanonicalRunRowId` sixty lines above. It was the last completely
 * unmodified copy of the shape: no `watchCompletionRef` branch and, unlike
 * `loadPhaseBreakdown`, not even a `sim-%` bound.
 *
 * Confirmed against the owner's production rows, read through `faff_readonly`
 * — not theorised. On 2026-09-02 three `watch_completion` intents land:
 *
 *     0645f40c-…-2026-09-02#0919   @10:38   13 phases, 7 work   ← his run
 *     sim-recovery-live#1101       @11:25    3 phases, 1 work
 *     sim-recovery-live#1038       @11:25    3 phases, 1 work   ← taken
 *
 * ONE wrong row, SIX wrong quantities, because the recap derives all six from
 * the same array. Measured in SQL against those rows:
 *
 *     repCount            1        for 7
 *     workDistanceMi      0.09     for 5.33
 *     workPaceSPerMi      5:44     for 8:26
 *     frozenTargetSPerMi  391      for 401
 *     repPaces            [344]    for seven reps
 *     finishPaceSPerMi    —        (no finish segment either side)
 *
 * `frozenTargetSPerMi` is the worst of the six: it becomes
 * `evalPlannedPaceSPerMi`, which is the target the WHOLE recap verdict is
 * judged against, is handed to `deriveRecap` AND `deriveWin`, and is returned
 * on the wire as `prescribed_pace_s_per_mi` / `evaluated_pace_s_per_mi`.
 *
 * ── WHAT THIS FILE ASSERTS ──────────────────────────────────────────────────
 *
 *   A · all six readings come from the row matching the RUN, not from a decoy
 *       with a later timestamp;
 *   B · with nothing matching the run, the readings are ABSENT — never
 *       borrowed (Rule 11: a refusal is a correct answer, a confident number
 *       off a stranger's payload is not);
 *   C · all six come from ONE array, so a mixed reading is impossible by
 *       construction (Rule 16);
 *   D · the route still CALLS the shared resolver, and carries no
 *       watch-completion lookup of its own. A behavioural test cannot catch a
 *       surface that stops calling the owner;
 *   E · the ONE case the shared resolver does NOT yet refuse is pinned here,
 *       named, and will fail loudly when it is fixed.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It cannot fail on `deriveRecap` composing a bad SENTENCE from good numbers —
 * it stops at the readings, and `lib/coach/_run_recap*` owns the prose. It
 * cannot fail on the distance-weighting arithmetic being wrong, only on it
 * being fed the wrong array. It cannot fail on the phone rendering these
 * fields under the wrong label. And guard D is scoped to this one route,
 * because that is the file the defect was found in — a fourth surface growing
 * its own copy of the lookup is invisible to it.
 *
 * ── FALSIFIED ───────────────────────────────────────────────────────────────
 *
 * `OLD_LOOKUP` below reproduces the removed query and is asserted to pick the
 * DECOY on the same fixtures the live path resolves correctly, producing
 * exactly the six numbers above. A test that cannot tell the broken
 * implementation from the fixed one is not evidence of anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn(async () => '2026-09-02'),
  runnerTimezone: vi.fn(async () => 'America/Los_Angeles'),
  runnerTimezoneOrPacific: vi.fn(async () => 'America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import { resolveStoredPhases } from '@/lib/postrun/load';
import { recapPhaseReadings } from '@/lib/coach/recap-phase-readings';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DATE = '2026-09-02';
const REAL_REF = `${USER}-${DATE}#0919`;

/* ══════════════════════════════════════════════════════════════════════════
 * THE FIXTURES · the owner's own rows, read out of production, with only the
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
 *  later. One 31-second work phase. This is what the recap was describing. */
const DECOY_SIM_PHASES = [
  { type: 'warmup', index: 0, label: 'Warm-up', avgHr: 166, maxHr: 166, completed: true, avgCadence: 183, actualDistanceMi: 0.18, actualPaceSPerMi: 178, actualDurationSec: 32 },
  { type: 'work', index: 1, label: 'Work', avgHr: 167, maxHr: 167, verdict: 'missed', completed: true, avgCadence: 184, actualDistanceMi: 0.09, actualPaceSPerMi: 344, targetPaceSPerMi: 391, actualDurationSec: 31 },
  { type: 'recovery', index: 2, label: 'Recovery', completed: false, actualDurationSec: 378 },
];

/** The same decoy under a field carrying NO `sim-` marker — the real
 *  2026-06-01 shape, where the stranger is another treadmill session of the
 *  runner's own. `sim-%` exclusion alone does not save these. */
const DECOY_TRD_FIELD = 'trd_7270DAA9-A398-449E-AF6D-02862980CB58';

/** The truth, computed by hand off `REAL_PHASES` and confirmed by a SQL
 *  rollup over the same rows:
 *    work phases with a pace   7   (the 5 mi easy leg + 6 strides)
 *    work seconds  2577 + 20×6 = 2697
 *    work miles    5 + .05+.06+.06+.05+.06+.05 = 5.33
 *    weighted pace 2697.61 / 5.33 = 506.1 s/mi
 *    frozen target mode(522, 401×6) = 401 */
const TRUTH = {
  repCount: 7,
  workDistanceMi: 5.33,
  workPaceSPerMi: 506.1,
  frozenTargetSPerMi: 401,
  repPaces: [515, 401, 347, 349, 365, 350, 431],
  finishPaceSPerMi: null,
};
/** What the decoy produces — the six numbers the runner was actually shown. */
const DECOY_READING = {
  repCount: 1,
  workDistanceMi: 0.09,
  workPaceSPerMi: 344,
  frozenTargetSPerMi: 391,
  repPaces: [344],
  finishPaceSPerMi: null,
};

/** The six quantities under test, off one readings object. */
function six(r: ReturnType<typeof recapPhaseReadings>) {
  return {
    repCount: r.repCount,
    workDistanceMi: r.workDistanceMi == null ? null : Number(r.workDistanceMi.toFixed(2)),
    workPaceSPerMi: r.workPaceSPerMi == null ? null : Number(r.workPaceSPerMi.toFixed(1)),
    frozenTargetSPerMi: r.frozenTargetSPerMi,
    repPaces: r.repPaces,
    finishPaceSPerMi: r.finishPaceSPerMi,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE MOCK DATABASE
 *
 * Rows, not canned answers. `pool.query` is routed by what the SQL asks for,
 * so the OLD lookup and the NEW resolver both run against ONE seeded table and
 * their disagreement is a property of the code, not of two different stubs.
 * ═══════════════════════════════════════════════════════════════════════ */

interface IntentRow { id: number; field: string; ts: string; phases: unknown[] }

let INTENTS: IntentRow[] = [];

/** The removed query, reproduced. A `field` carrying no `-YYYY-MM-DD` suffix
 *  falls through to the timestamp compare, which is the same for every payload
 *  posted that day, so the tie is broken by `ts DESC` and nothing else. This
 *  is the whole defect in four lines — and note there is no `sim-%` bound,
 *  because the recap route never had one. */
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

/** What the recap route does, through the two functions it actually calls. */
async function recapReadingsFor(runData: Record<string, unknown>) {
  return recapPhaseReadings(await resolveStoredPhases(USER, DATE, runData));
}

/* ══════════════════════════════════════════════════════════════════════════ */

describe('SIMROW-1 · RECAP — the recap describes the run it was asked about', () => {
  it('the FIXTURES reproduce the defect: the old lookup takes the decoy', () => {
    seedRealDay();
    const picked = OLD_LOOKUP(DATE);
    // Rule 18 · falsify the check. If this stops selecting the simulator row,
    // the fixtures no longer express the bug and everything below passes free.
    expect(picked?.field).toBe('sim-recovery-live#1038');
    expect(six(recapPhaseReadings(picked!.phases))).toEqual(DECOY_READING);
    // …and the same fixtures do hold his real run, so the two are genuinely
    // distinguishable rather than accidentally equal.
    expect(six(recapPhaseReadings(REAL_PHASES))).toEqual(TRUTH);
  });

  it('A · resolves the run\'s OWN completion, not the later decoy', async () => {
    seedRealDay();
    const r = await recapReadingsFor({ date: DATE, watchCompletionRef: REAL_REF });
    expect(six(r)).toEqual(TRUTH);
    // The one that decides the verdict, called out on its own.
    expect(r.frozenTargetSPerMi).toBe(401);
    expect(r.frozenTargetSPerMi).not.toBe(DECOY_READING.frozenTargetSPerMi);
  });

  it('A2 · a decoy with NO `sim-` marker loses just the same', async () => {
    // 2026-06-01 in production: the stranger is another treadmill payload of
    // the runner's own, which no `sim-%` exclusion sees. The recap route never
    // had that bound at all, so this is the case its own fix had to cover.
    seedRealDay({ decoyField: DECOY_TRD_FIELD });
    expect(OLD_LOOKUP(DATE)?.field).toBe(DECOY_TRD_FIELD);
    expect(six(await recapReadingsFor({ date: DATE, watchCompletionRef: REAL_REF }))).toEqual(TRUTH);
  });

  it('A3 · the run row\'s own `data.phases` answers when the intent is gone', async () => {
    // Rung 2. Still THIS RUN'S array — written verbatim by the same request —
    // so it is not a fallback to a stranger, it is the same fact from the
    // other copy.
    INTENTS = [
      { id: 921, field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
    ];
    expect(six(await recapReadingsFor({ date: DATE, phases: REAL_PHASES }))).toEqual(TRUTH);
  });

  it('B · REFUSES rather than borrowing when nothing matches this run', async () => {
    // The decoys are the only things on the date. The run names no completion
    // and carries no phases of its own. The honest answer is "we do not have
    // this" — Rule 11 — and specifically NOT the decoy's six numbers.
    INTENTS = [
      { id: 921, field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
      { id: 920, field: 'sim-recovery-live#1101', ts: '2026-09-02T11:25:53', phases: DECOY_SIM_PHASES },
    ];
    const r = await recapReadingsFor({ date: DATE });
    expect(r.phases).toEqual([]);
    expect(six(r)).toEqual({
      repCount: null, workDistanceMi: null, workPaceSPerMi: null,
      frozenTargetSPerMi: null, repPaces: [], finishPaceSPerMi: null,
    });
    // A null `frozenTargetSPerMi` is what lets `evalPlannedPaceSPerMi` fall
    // back to the LIVE plan row — an honest second-best. The decoy's 391 was
    // neither.
    expect(r.frozenTargetSPerMi).not.toBe(DECOY_READING.frozenTargetSPerMi);
    // The old lookup, on the same seed, would have shown the simulator.
    expect(six(recapPhaseReadings(OLD_LOOKUP(DATE)!.phases))).toEqual(DECOY_READING);
  });

  it('B2 · a run that named a completion which no longer exists refuses too', async () => {
    INTENTS = [
      { id: 921, field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
    ];
    const r = await recapReadingsFor({ date: DATE, watchCompletionRef: `${USER}-${DATE}#9999` });
    expect(r.phases).toEqual([]);
    expect(r.repCount).toBeNull();
  });

  it('C · all six come from ONE array — never a mix', async () => {
    // The structural guarantee is stronger than any single value: whatever the
    // matched row holds, the six are exactly what that ONE array produces, and
    // nothing is topped up from elsewhere.
    seedRealDay();
    const runData = { date: DATE, watchCompletionRef: REAL_REF };
    expect(six(await recapReadingsFor(runData))).toEqual(six(recapPhaseReadings(REAL_PHASES)));

    // And with a matched payload that carries no TARGETS at all: the frozen
    // target goes null while the paces — which WERE measured — survive. Rule
    // 11 cuts both ways. Borrowing the decoy's 391 to fill the hole is the
    // defect itself.
    const untargeted = REAL_PHASES.map(({ targetPaceSPerMi, ...rest }) => rest);
    INTENTS = [
      { id: 919, field: REAL_REF, ts: '2026-09-02T10:38:54', phases: untargeted },
      { id: 921, field: 'sim-recovery-live#1038', ts: '2026-09-02T11:25:54', phases: DECOY_SIM_PHASES },
    ];
    const bare = await recapReadingsFor(runData);
    expect(bare.frozenTargetSPerMi).toBeNull();
    expect(bare.repCount).toBe(TRUTH.repCount);
    expect(Number(bare.workPaceSPerMi!.toFixed(1))).toBe(TRUTH.workPaceSPerMi);
  });

  it('the work HEART RATE also follows the run, not the day', async () => {
    // `avgHr` rides the same array and gates the recap's threshold-band
    // sentences (Rule 16). His work phases average 137-152; the simulator's
    // single rep is 167.
    seedRealDay();
    const mine = await recapReadingsFor({ date: DATE, watchCompletionRef: REAL_REF });
    const workHr = mine.phases.filter((p) => p.type === 'work').map((p) => p.avgHr);
    expect(workHr).toEqual([137, 147, 147, 149, 152, 142, 152]);
    expect(workHr).not.toContain(167);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E · THE ONE CASE THE OWNER DOES NOT YET REFUSE — pinned, not blessed.
 *
 * `resolveStoredPhases`' rung 3 is a LEGACY date match for rows written before
 * `watchCompletionRef` existed, bounded only against `sim-%`. So a run that
 * NAMES a completion which does not resolve still falls through to the day,
 * and can still inherit a stranger's payload when that stranger's field is not
 * `sim-`-prefixed.
 *
 * This is not hypothetical. Measured across the owner's 62 runs that have any
 * completion in play, exactly ONE is affected, and it is the 2026-09-03
 * apple_watch run: 4.48 mi at 12:25, `client_workout_id`
 * FB9BDB32-558C-4E3C-B1D3-C62F31748035, which names no intent and carries no
 * phases of its own. Rung 3 hands it the 21-phase hill session recorded on the
 * TREADMILL at 17:25 the same evening — five hours later and a different
 * workout. (It is the same run EXECID-SCAN-1 already names, whose date
 * coincidence once made it render as `INTERVALS · done`.)
 *
 * The fix is one clause in the OWNER — rung 3 does not run when the run named
 * a ref — and it changes behaviour for `/api/v5/today`, run detail and the
 * post-run experience as well as this route, so it belongs to whoever owns
 * that resolver rather than to this branch. It is pinned here so that:
 *
 *   · nobody reads the tests above as covering it, and
 *   · the day it IS fixed, this test fails and has to be deleted (Rule 18's
 *     stale-exemption ratchet, applied to a known gap rather than an
 *     allowlist).
 * ═══════════════════════════════════════════════════════════════════════ */
describe('SIMROW-1 · RECAP — known gap: rung 3 still answers by date', () => {
  it('a run naming an unresolvable ref still inherits a non-`sim-` day payload', async () => {
    const DAY = '2026-09-03';
    INTENTS = [
      // The evening treadmill session, filed under a DATED field.
      { id: 940, field: `${USER}-${DAY}`, ts: '2026-09-03T17:25:00', phases: REAL_PHASES },
    ];
    const r = recapPhaseReadings(await resolveStoredPhases(
      USER, DAY, { date: DAY, client_workout_id: 'FB9BDB32-558C-4E3C-B1D3-C62F31748035' },
    ));
    // TODAY'S BEHAVIOUR, stated plainly rather than asserted to be right.
    expect(r.repCount).toBe(TRUTH.repCount);
    // WHEN THIS FAILS, the owner has been tightened: delete this test and
    // assert the refusal (`r.phases` empty, `r.repCount` null) instead.
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D · THE ROUTE STILL CALLS THE OWNER
 *
 * Rule 16: a behavioural test cannot catch a surface that stops calling the
 * shared resolver, because the surface's own copy passes every behavioural
 * assertion right up until the day two payloads land on one date.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('SIMROW-1 · RECAP — no second answer inside the route', () => {
  const ROUTE = path.join(process.cwd(), 'app/api/runs/[id]/recap/route.ts');
  const SRC = fs.readFileSync(ROUTE, 'utf8');

  it('the scanner read a real file (Rule 18 · liveness)', () => {
    expect(SRC.length).toBeGreaterThan(10_000);
    expect(SRC).toContain('const winPhases');
  });

  it('resolves phases through `resolveStoredPhases`', () => {
    expect(SRC).toMatch(/recapPhaseReadings\(await resolveStoredPhases\(/);
  });

  it('derives all six readings through `recapPhaseReadings`', () => {
    // Destructured off the ONE readings object, not recomputed per quantity.
    expect(SRC).toMatch(/frozenTargetSPerMi, workPaceSPerMi, workDistanceMi, repCount, repPaces,\s*\}\s*=\s*phaseReadings;/);
    expect(SRC).toContain('phaseReadings.finishPaceSPerMi');
    // The removed local derivations, each of which was a place a seventh read
    // of a different array could grow back.
    expect(SRC).not.toContain('const frozenWorkTargets');
    expect(SRC).not.toContain('const weightablePhases');
    expect(SRC).not.toContain('const finishPhase');
  });

  it('carries NO watch-completion lookup of its own', () => {
    expect(SRC).not.toMatch(/reason = 'watch_completion'/);
    expect(SRC).not.toMatch(/FROM coach_intents[\s\S]{0,400}ORDER BY ts DESC LIMIT 1/);
  });
});
