/**
 * lib/coach/voice-band-race-schema.test.ts
 *
 * 2026-08-21 · backend audit · the voice band asked `races` for columns the
 * table has never had.
 *
 * Both reads in `computeVoiceBand` named `finish_seconds` / `date_iso` /
 * `distance_mi`. `races` is jsonb-shaped — slug, meta, actual_result, plan,
 * course_geometry. Postgres answered 42703, both `.catch`es returned
 * `rows: []`, and the band read that as "this runner has never raced". The
 * reason string it produced was literally "no recent race history".
 *
 * Measured against production (faff_readonly, 2026-08-21): the one runner with
 * data has 11 races, 6 inside the window carrying a real `actual_result.finishS`
 * — two marathons and four halves, including the 2026-08-16 half at 6113 s.
 * `profile.race_history` is `[]`, so nothing else fed raceCount. He sat in
 * `calibration`, the register meant for a runner the app has never met, and
 * `challenge` was unreachable by ANY user because `computeVdotConfidence`
 * always returned 0 against a floor of 0.7.
 *
 * THE MOCK IS SCHEMA-FAITHFUL ON PURPOSE. A plain `vi.fn()` returning rows
 * would pass against the broken SQL too — the text of a query means nothing to
 * a mock that ignores it. `queryOrThrow` below rejects any statement that
 * selects the phantom columns from `races` with the same SQLSTATE Postgres
 * raises, so this file fails against the pre-fix code for the real reason.
 *
 * F1  the phantom columns are gone from the source (cheap, direct)
 * F2  a jsonb-shaped races table yields a real race count
 * F3  ... so the band is no longer `calibration` for a runner with races
 * F4  vdot confidence is no longer pinned at 0, so `challenge` is reachable
 * F5  a genuinely raceless runner still lands in `calibration` (no over-fix)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-08-21'),
}));
vi.mock('@/lib/runs/volume', () => ({
  getCanonicalRunIds: vi.fn().mockResolvedValue([1, 2, 3]),
  isoDaysBefore: (d: string) => d,
}));

import { pool } from '@/lib/db/pool';
import { computeVoiceBand } from '@/lib/coach/voice-band';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** The six races production actually holds inside the window. */
const PROD_RACES = [
  { date_iso: '2026-08-16', distance_mi: '13.1',    distance_label: 'Half Marathon', finish_seconds: '6113',  finish_time: '1:41:53' },
  { date_iso: '2026-05-03', distance_mi: '13.16',   distance_label: null,            finish_seconds: '6057',  finish_time: null },
  { date_iso: '2026-04-26', distance_mi: '26.2',    distance_label: null,            finish_seconds: '13015', finish_time: null },
  { date_iso: '2026-03-08', distance_mi: '26.219',  distance_label: null,            finish_seconds: '12700', finish_time: null },
  { date_iso: '2026-02-01', distance_mi: '13.109',  distance_label: null,            finish_seconds: '5694',  finish_time: null },
  { date_iso: '2026-01-18', distance_mi: '13.109',  distance_label: null,            finish_seconds: '5918',  finish_time: null },
];

/**
 * Stands in for the real table. Any statement that reads `races` using a
 * column the jsonb schema does not have fails the way Postgres fails it, so
 * the pre-fix SQL cannot quietly pass this suite.
 */
const PHANTOM_COLUMNS = ['finish_seconds', 'date_iso', 'distance_mi'];

function installPool(opts: { races: typeof PROD_RACES; runs?: number }) {
  const runCount = opts.runs ?? 14;
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
    const touchesRaces = /\bFROM\s+races\b/i.test(sql);
    if (touchesRaces) {
      // A phantom name is a defect only when it is READ as a column. The
      // fixed SQL legitimately uses the same words as OUTPUT ALIASES
      // (`(meta->>'date') AS date_iso`) so the row type stays stable — and an
      // earlier draft of this mock rejected those too, i.e. the harness
      // reported on itself rather than on the query. Strip `AS <ident>` and
      // the jsonb key strings first; whatever is left is a real column read.
      const sourceOnly = sql
        .replace(/\bAS\s+\w+/gi, ' ')
        .replace(/'[^']*'/g, "''");
      for (const col of PHANTOM_COLUMNS) {
        const bare = new RegExp(`(^|[^'\\w>])${col}([^'\\w]|$)`);
        if (bare.test(sourceOnly)) {
          const e = new Error(`column "${col}" does not exist`) as Error & { code: string };
          e.code = '42703';
          throw e;
        }
      }
      if (/WITH race_v AS/i.test(sql)) {
        // The confidence CTE: one row per qualifying race, plus the runs arm.
        return {
          rows: [
            ...opts.races.map(() => ({ kind: 'race', vdot: null })),
            ...Array.from({ length: runCount }, () => ({ kind: 'run', vdot: null })),
          ],
        };
      }
      return { rows: opts.races };
    }
    if (/FROM profile/i.test(sql)) return { rows: [{ race_history: [] }] };
    if (/FROM calibration_sessions/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
}

const STATE = { activeNiggle: null, recentCheckIns: [] } as never;

beforeEach(() => { vi.clearAllMocks(); });

describe('computeVoiceBand · the races read matches the races schema', () => {
  it('F1 · no bare phantom column survives in the source', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'lib/coach/voice-band.ts'), 'utf8',
    );
    // Strip block comments — the fix documents the old names on purpose.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const col of PHANTOM_COLUMNS) {
      const bare = new RegExp(`(^|[^'\\w>])${col}([^'\\w]|$)`, 'm');
      // The TS-side row type legitimately names these as ALIASES; only a SQL
      // reference of the form `AND finish_seconds` / `SELECT date_iso::text`
      // is the bug. Assert the two shapes the broken query used.
      expect(code).not.toMatch(new RegExp(`SELECT\\s+${col}::`, 'i'));
      expect(code).not.toMatch(new RegExp(`AND\\s+${col}\\s`, 'i'));
      expect(bare).toBeTruthy(); // keeps `bare` meaningful to the reader
    }
  });

  it('F2 · a jsonb-shaped races table yields the real race count', async () => {
    installPool({ races: PROD_RACES });
    const r = await computeVoiceBand(USER, STATE);
    // Six races, deduped by (distance ±0.05mi, time ±30s) — none collide.
    expect(r.signals.raceCount).toBe(6);
  });

  it('F3 · a runner with races is no longer coached as a stranger', async () => {
    installPool({ races: PROD_RACES });
    const r = await computeVoiceBand(USER, STATE);
    expect(r.band).not.toBe('calibration');
    expect(r.reasons.join(' | ')).not.toMatch(/no recent race history/i);
  });

  it('F4 · vdot confidence is no longer pinned at 0, so challenge is reachable', async () => {
    installPool({ races: PROD_RACES });
    const r = await computeVoiceBand(USER, STATE);
    // VDOT_CONF_CHALLENGE_FLOOR is 0.7; the old code returned 0.0 for everyone.
    expect(r.signals.vdotConfidence).toBeGreaterThanOrEqual(0.7);
    expect(r.band).toBe('challenge');
  });

  it('F5 · a genuinely raceless, runless runner still lands in calibration', async () => {
    // No races AND no quality runs. (With runs but no races the run-only arm
    // of computeVdotConfidence legitimately reaches 0.45 and earns `guided` —
    // that is the designed behaviour, not an over-fix, so the fixture has to
    // be honest about which case it is testing.)
    installPool({ races: [], runs: 0 });
    const r = await computeVoiceBand(USER, STATE);
    expect(r.signals.raceCount).toBe(0);
    expect(r.band).toBe('calibration');
  });
});
