/**
 * lib/coach/_no_silent_refire.test.ts · nothing writes a coaching record twice.
 *
 * Two shipped defects, both confirmed against production on 2026-08-25, both
 * of the same shape: a code path that mints a coaching record every time it is
 * reached, with a guard that looked like it stopped that and did not.
 *
 *   H · `recordHeatEasing` (lib/watch/heat.ts) is reached from the body of
 *       GET /api/watch/today. Its dedupe compared the whole stored value,
 *       which carried `observedAgeMin` (the age of the weather observation, in
 *       minutes) so it could essentially never match, and it had no date guard
 *       at all while the conditions it prices are always CURRENT. The owner's
 *       account carried 40 `watch_heat_easing` rows written between 00:56 and
 *       18:19 UTC on ONE day, across nine `field` keys from `heat-2026-08-18`
 *       to `heat-2026-08-30`. Past dates and future dates. One key had 11 rows.
 *
 *   C · `completeCalibrationSession` (lib/coach/calibration.ts) documented
 *       itself as idempotent and was not. Its session lookup asked for rows
 *       that were neither completed nor skipped, so an already-calibrated
 *       runner and a runner who had explicitly refused both read as "nothing
 *       here", and the next line minted a fresh session. It is called on every
 *       run write. The owner had 31 sessions, all 31 completed, 0 skipped.
 *       `lib/coach/voice-band.ts` hard-overrides the coaching voice band off
 *       the most recent completed session, so the voice was being re-set from
 *       evidence the runner never volunteered.
 *
 * ── WHY THIS FILE HAS A FLOOR AND A PLANTED DEFECT ───────────────────────────
 *
 * Both bugs were guards that passed without checking anything. A gate against
 * that class has to prove it is not the same thing one level up, so:
 *
 *   · `SCENARIOS.length` is asserted. A case that quietly stops being
 *     exercised is this bug again, in the test.
 *   · The OLD dedupe is reproduced inline and the oracle is asserted to FAIL
 *     it. A test that cannot tell the broken implementation from the fixed one
 *     is not evidence of anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('@/lib/runtime/runner-tz', () => ({ runnerToday: vi.fn() }));

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { recordHeatEasing, type WatchHeatOutcome } from '@/lib/watch/heat';
import { completeCalibrationSession } from '@/lib/coach/calibration';

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';
const TODAY = '2026-08-25';
const SATURDAY = '2026-08-29';
const RUN_ID = 'run-1';

/* ══════════════════════════════════════════════════════════════════════════
 * THE ORACLE
 *
 * One decision, one record. Used by the live assertions below AND run against
 * the planted defect, which is the only way to know it discriminates.
 * ═══════════════════════════════════════════════════════════════════════ */

const oneRecordPerDecision = (writes: number) => writes === 1;

/* ══════════════════════════════════════════════════════════════════════════
 * A FAKE DATABASE, DISPATCHED ON QUERY TEXT
 * ═══════════════════════════════════════════════════════════════════════ */

interface IntentRow { reason: string; field: string; value: string; ts: number }
interface SessionRow {
  id: string;
  started_at: number;
  was_start_tapped: boolean;
  completed_at: string | null;
  skipped_at: string | null;
  calibrated_easy_pace_s_per_mi: number | null;
  confidence: string | null;
  pillars: unknown;
}

let intents: IntentRow[] = [];
let sessions: SessionRow[] = [];
let runs: Record<string, unknown> = {};
let clock = 0;
let nextSessionId = 1;

const heatRows = () => intents.filter((i) => i.reason === 'watch_heat_easing');
const calibrationRows = () => intents.filter((i) => i.reason === 'calibration_completed');

/** Newest first, the way both production reads order. */
const sessionsNewestFirst = () => [...sessions].sort((a, b) => b.started_at - a.started_at);

function sessionShape(s: SessionRow) {
  return {
    id: s.id,
    was_start_tapped: s.was_start_tapped,
    completed_at: s.completed_at,
    skipped_at: s.skipped_at,
    calibrated_easy_pace_s_per_mi: s.calibrated_easy_pace_s_per_mi,
    confidence: s.confidence,
    pillars: s.pillars,
  };
}

function run(sql: string, params: unknown[] = []): { rows: any[]; rowCount: number } {
  const q = String(sql);

  if (q.includes('INSERT INTO coach_intents')) {
    const reason = q.includes('watch_heat_easing') ? 'watch_heat_easing' : 'calibration_completed';
    const field = reason === 'watch_heat_easing' ? String(params[1]) : 'easyPaceSPerMi';
    const value = reason === 'watch_heat_easing' ? String(params[2]) : String(params[1]);
    intents.push({ reason, field, value, ts: ++clock });
    return { rows: [], rowCount: 1 };
  }

  if (q.includes('FROM coach_intents')) {
    const field = String(params[1]);
    const hit = [...intents]
      .filter((i) => i.reason === 'watch_heat_easing' && i.field === field)
      .sort((a, b) => b.ts - a.ts)[0];
    return { rows: hit ? [{ value: hit.value }] : [], rowCount: hit ? 1 : 0 };
  }

  if (q.includes('INSERT INTO calibration_sessions')) {
    const s: SessionRow = {
      id: String(nextSessionId++),
      started_at: ++clock,
      was_start_tapped: false,
      completed_at: null,
      skipped_at: q.includes('skipped_at') ? new Date().toISOString() : null,
      calibrated_easy_pace_s_per_mi: null,
      confidence: null,
      pillars: null,
    };
    sessions.push(s);
    return { rows: [sessionShape(s)], rowCount: 1 };
  }

  if (q.includes('UPDATE calibration_sessions')) {
    // Both live UPDATEs carry `completed_at IS NULL AND skipped_at IS NULL`.
    const byId = q.includes('WHERE id =');
    const target = byId
      ? sessions.filter((s) => s.id === String(params[0]))
      : sessions.slice();
    const eligible = target.filter((s) => s.completed_at === null && s.skipped_at === null);
    if (eligible.length === 0) return { rows: [], rowCount: 0 };
    for (const s of eligible) {
      if (q.includes('SET skipped_at')) {
        s.skipped_at = new Date().toISOString();
      } else {
        s.completed_at = new Date().toISOString();
        s.calibrated_easy_pace_s_per_mi = Number(params[2]);
        s.confidence = String(params[3]);
        s.pillars = JSON.parse(String(params[4]));
      }
    }
    return { rows: [], rowCount: eligible.length };
  }

  if (q.includes('FROM calibration_sessions')) {
    // The predicates are honoured, not assumed away. The whole defect was a
    // SELECT that filtered out completed and skipped rows, so a fake that
    // ignored the WHERE would pass the broken lookup and the fixed one alike.
    const activeOnly = q.includes('completed_at IS NULL');
    const s = sessionsNewestFirst().filter(
      (r) => !activeOnly || (r.completed_at === null && r.skipped_at === null),
    )[0];
    return { rows: s ? [sessionShape(s)] : [], rowCount: s ? 1 : 0 };
  }

  if (q.includes('FROM runs')) {
    const data = runs[String(params[1])];
    return { rows: data ? [{ data }] : [], rowCount: data ? 1 : 0 };
  }

  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(q)) return { rows: [], rowCount: 0 };

  throw new Error(`fake db · unhandled query: ${q.slice(0, 80)}`);
}

/** A qualifying easy run · 4 miles, steady splits, flat HR. */
const easyRun = {
  id: RUN_ID,
  distanceMi: 4,
  splits: [
    { paceSPerMi: 540, hr: 138 },
    { paceSPerMi: 545, hr: 140 },
    { paceSPerMi: 543, hr: 141 },
    { paceSPerMi: 547, hr: 142 },
  ],
};

const heatOutcome = (observedAgeMin: number, slowdownPct = 4.2): WatchHeatOutcome => ({
  applied: true,
  slowdownPct,
  tempF: 88,
  dewpointF: 62,
  observedAgeMin,
  reason: null,
});

beforeEach(() => {
  intents = [];
  sessions = [];
  runs = { [RUN_ID]: easyRun };
  clock = 0;
  nextSessionId = 1;
  vi.mocked(pool.query).mockImplementation(((sql: string, params: unknown[]) =>
    Promise.resolve(run(sql, params))) as never);
  vi.mocked(pool.connect).mockImplementation((() =>
    Promise.resolve({
      query: (sql: string, params: unknown[]) => Promise.resolve(run(sql, params)),
      release: () => {},
    })) as never);
  vi.mocked(runnerToday).mockResolvedValue(TODAY);
});

/* ══════════════════════════════════════════════════════════════════════════
 * SCENARIOS
 * ═══════════════════════════════════════════════════════════════════════ */

const SCENARIOS: Array<{ id: string; what: string; check: () => Promise<void> }> = [
  {
    id: 'H1',
    what: 'the same easing recorded twice with a different observedAgeMin writes once',
    check: async () => {
      await recordHeatEasing(USER, TODAY, heatOutcome(3));
      await recordHeatEasing(USER, TODAY, heatOutcome(41));

      expect(
        oneRecordPerDecision(heatRows().length),
        `${heatRows().length} rows for one easing. The observation's freshness is ` +
        'provenance, not a decision · this is how 40 rows landed in a day.',
      ).toBe(true);

      // Provenance still stored, it just no longer decides.
      expect(JSON.parse(heatRows()[0].value)).toMatchObject({
        pct: 4.2, tempF: 88, dewpointF: 62, observedAgeMin: 3,
      });

      // And a decision that genuinely CHANGED still gets its own row · the
      // guard is "one per decision", not "one ever".
      await recordHeatEasing(USER, TODAY, heatOutcome(2, 6.9));
      expect(heatRows()).toHaveLength(2);
      expect(JSON.parse(heatRows()[1].value).pct).toBe(6.9);
    },
  },
  {
    id: 'H2',
    what: 'a build for a date that is not the runner\'s today records nothing',
    check: async () => {
      // The phone passes ?date= to preview any day. The conditions priced above
      // are always CURRENT, so a Saturday preview taken on Wednesday would
      // stamp a heat-<Saturday> easing computed from Wednesday's weather.
      await recordHeatEasing(USER, SATURDAY, heatOutcome(3));
      expect(heatRows(), 'a preview left a coaching record behind').toHaveLength(0);

      // Same outcome, same call, today's date · records.
      await recordHeatEasing(USER, TODAY, heatOutcome(3));
      expect(heatRows()).toHaveLength(1);
      expect(heatRows()[0].field).toBe(`heat-${TODAY}`);

      // A date we cannot establish is not today.
      intents = [];
      vi.mocked(runnerToday).mockRejectedValueOnce(new Error('tz read failed'));
      await recordHeatEasing(USER, TODAY, heatOutcome(3));
      expect(heatRows()).toHaveLength(0);
    },
  },
  {
    id: 'C1',
    what: 'completing twice returns the same session and inserts once',
    check: async () => {
      sessions.push({
        id: '1', started_at: ++clock, was_start_tapped: true,
        completed_at: null, skipped_at: null,
        calibrated_easy_pace_s_per_mi: null, confidence: null, pillars: null,
      });

      const first = await completeCalibrationSession(USER, RUN_ID);
      const second = await completeCalibrationSession(USER, RUN_ID);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.alreadyCompleted).toBe(false);
      expect(second!.alreadyCompleted).toBe(true);
      expect(second!.sessionId).toBe(first!.sessionId);
      expect(second!.calibratedEasyPaceSPerMi).toBe(first!.calibratedEasyPaceSPerMi);
      expect(second!.confidence).toBeCloseTo(first!.confidence, 6);
      expect(second!.bandSPerMi).toBe(first!.bandSPerMi);
      expect(second!.qualified).toBe(first!.qualified);

      expect(
        sessions.length,
        `${sessions.length} sessions after two run writes. Production reached 31.`,
      ).toBe(1);
      expect(
        oneRecordPerDecision(calibrationRows().length),
        'a second calibration_completed intent re-sets the coaching voice band',
      ).toBe(true);
    },
  },
  {
    id: 'C2',
    what: 'a skipped session is not re-created by a subsequent run write',
    check: async () => {
      sessions.push({
        id: '7', started_at: ++clock, was_start_tapped: true,
        completed_at: null, skipped_at: new Date().toISOString(),
        calibrated_easy_pace_s_per_mi: null, confidence: null, pillars: null,
      });

      const result = await completeCalibrationSession(USER, RUN_ID);

      expect(result, 'a refusal is an answer · it must not produce a result').toBeNull();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].completed_at).toBeNull();
      expect(
        calibrationRows(),
        'the runner tapped skip and was silently calibrated anyway',
      ).toHaveLength(0);
    },
  },
];

describe('no silent re-fire · heat easing + calibration', () => {
  for (const s of SCENARIOS) {
    it(`${s.id} · ${s.what}`, async () => { await s.check(); });
  }

  /* ── THE FLOOR ─────────────────────────────────────────────────────────── */
  it('exercises every scenario this gate was built for', () => {
    expect(
      SCENARIOS.length,
      'a scenario stopped being exercised. Both defects this file exists for were ' +
      'guards that had quietly stopped checking anything · a shrinking gate is the ' +
      'same failure one level up.',
    ).toBe(4);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(4);
  });

  /* ── THE PLANTED DEFECT ────────────────────────────────────────────────── */
  it('the oracle FAILS the old dedupe · proof it is not passing vacuously', () => {
    // The shipped behaviour, reproduced: dedupe on the whole value blob, which
    // carried `observedAgeMin`. Two calls minutes apart carry different ages,
    // so the blobs differ, so the guard never matches.
    const legacyWrites = (ages: number[]): number => {
      const seen: string[] = [];
      for (const observedAgeMin of ages) {
        const value = JSON.stringify({ pct: 4.2, tempF: 88, dewpointF: 62, observedAgeMin });
        if (!seen.includes(value)) seen.push(value);
      }
      return seen.length;
    };

    expect(legacyWrites([3, 41])).toBe(2);
    expect(
      oneRecordPerDecision(legacyWrites([3, 41])),
      'the oracle passed the OLD dedupe. It cannot tell the defect from the fix, ' +
      'so scenario H1 proves nothing.',
    ).toBe(false);

    // And it accepts the fixed shape, so it is not simply always false.
    expect(oneRecordPerDecision(1)).toBe(true);
  });
});
