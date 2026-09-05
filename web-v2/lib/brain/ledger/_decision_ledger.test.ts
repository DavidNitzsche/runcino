/**
 * lib/brain/ledger/_decision_ledger.test.ts · THE LEDGER'S ARITHMETIC AND ITS
 * VOCABULARY, PROVEN WITHOUT A DATABASE.
 *
 * Two halves, and neither can stand in for the other:
 *
 *   · `ledger-entry.ts`'s measurement of WHICH WAY the plan moved, which is the
 *     one thing in this feature that is a judgement rather than a column.
 *   · that the TypeScript vocabularies and the migration's own CHECK
 *     constraints still say the same words. Read OUT OF THE SQL FILE at run
 *     time, never hardcoded on both sides — a check that hardcodes both only
 *     proves the test agrees with itself (Rule 18).
 *
 * Durability is proven separately, against a real table, in
 * `_decision_ledger.db.test.ts`, which SKIPS LOUDLY when no scratch database is
 * reachable rather than reporting clean.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER A DECISION EVER REACHES THE LEDGER. Everything here is pure. A
 *   `mutatePlan` exit that returns without landing a row is invisible to every
 *   assertion below; `scripts/check-decision-ledger.sh` guard 1 is the half
 *   that walks those exits, and it is a source scan rather than a behaviour
 *   test because a behaviour test cannot see an exit it does not happen to
 *   drive.
 * · DURABILITY. Nothing here writes anything. A green run says the arithmetic
 *   is right and says nothing whatsoever about a decision surviving a deploy.
 * · WHETHER THE DIRECTION IS THE RIGHT COACHING ANSWER. It measures which way
 *   the prescription moved. It has no opinion on whether it should have.
 * · A MUTATION THAT CHANGES TRAINING WITHOUT MOVING DISTANCE OR PACE. A phase
 *   relabel reads NEUTRAL, correctly; something that changes the runner's week
 *   by some other means would read NEUTRAL too, wrongly, and nothing here
 *   could tell.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  demandDelta,
  directionOfDelta,
  leverOfDelta,
  scopeOfChange,
  DEMAND_NOISE_MI,
  DEMAND_NOISE_SEC_PER_MI,
  LEDGER_DECISIONS,
  LEDGER_DIRECTIONS,
  LEDGER_LEVERS,
  LEDGER_SCOPES,
  PLAN_MUTATION_BOUNDARY_MODEL_VERSION,
  type DemandRow,
} from './ledger-entry';

const MIGRATION = path.join(__dirname, '../../../db/migrations/166_plan_decision_ledger.sql');

/**
 * Pull `CHECK (<column> IN ('A', 'B', …))` out of the migration itself.
 *
 * Rule 18 · read the numbers out of the cited source at run time. If this
 * returns an empty list the assertion below fails on the emptiness rather than
 * passing vacuously, which is the whole point of parsing rather than copying.
 */
function checkVocabulary(sql: string, column: string): string[] {
  const re = new RegExp(
    `CHECK\\s*\\(\\s*(?:${column}\\s+IS\\s+NULL\\s+OR\\s*)?${column}\\s+IN\\s*\\(([^)]*)\\)`,
    'i',
  );
  const m = sql.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const row = (over: Partial<DemandRow> & { id: string }): DemandRow => ({
  week_id: 'wk-1',
  date_iso: '2026-09-07',
  distance_mi: 5,
  pace_target_s_per_mi: 540,
  ...over,
});

describe('liveness · the migration was actually read', () => {
  it('the file exists and carries the table', () => {
    expect(existsSync(MIGRATION), `${MIGRATION} is missing`).toBe(true);
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS plan_decision_ledger');
    expect(sql.length).toBeGreaterThan(2000);
  });
});

describe('the TypeScript vocabulary and the migration say the same words', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('lever', () => {
    const fromSql = checkVocabulary(sql, 'lever');
    expect(fromSql.length, 'the lever CHECK could not be parsed out of the migration').toBeGreaterThan(0);
    expect([...fromSql].sort()).toEqual([...LEDGER_LEVERS].sort());
  });

  it('direction', () => {
    const fromSql = checkVocabulary(sql, 'direction');
    expect(fromSql.length, 'the direction CHECK could not be parsed').toBeGreaterThan(0);
    expect([...fromSql].sort()).toEqual([...LEDGER_DIRECTIONS].sort());
  });

  it('decision', () => {
    const fromSql = checkVocabulary(sql, 'decision');
    expect(fromSql.length, 'the decision CHECK could not be parsed').toBeGreaterThan(0);
    expect([...fromSql].sort()).toEqual([...LEDGER_DECISIONS].sort());
  });

  it('scope', () => {
    const fromSql = checkVocabulary(sql, 'scope');
    expect(fromSql.length, 'the scope CHECK could not be parsed').toBeGreaterThan(0);
    expect([...fromSql].sort()).toEqual([...LEDGER_SCOPES].sort());
  });

  it('ORACLE · the parser is not vacuously permissive', () => {
    // A parser that returns [] for everything would make every assertion above
    // pass by comparing nothing. Falsified here: a column with no CHECK returns
    // empty, and a real one does not.
    expect(checkVocabulary(sql, 'provenance')).toEqual([]);
    expect(checkVocabulary(sql, 'lever').length).toBeGreaterThan(3);
  });

  it('the ledger carries a model version, and it is not a timestamp', () => {
    expect(PLAN_MUTATION_BOUNDARY_MODEL_VERSION).toMatch(/^plan-mutation-boundary\/\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the migration is additive only', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const statements = sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

  it('no ALTER, no DROP, no RENAME, no TRUNCATE, no DELETE', () => {
    for (const forbidden of [/\bALTER\s+TABLE\b/i, /\bDROP\s+/i, /\bRENAME\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i]) {
      expect(forbidden.test(statements), `${forbidden} appears in executable SQL`).toBe(false);
    }
  });

  it('every CREATE is IF NOT EXISTS, so re-running it is a no-op', () => {
    const creates = [...statements.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(IF NOT EXISTS)?/gi)];
    expect(creates.length).toBeGreaterThan(3);
    for (const c of creates) {
      expect(c[3], `a CREATE without IF NOT EXISTS: ${c[0]}`).toBeTruthy();
    }
  });

  it('ORACLE · the additive scan would catch a planted ALTER', () => {
    expect(/\bALTER\s+TABLE\b/i.test('ALTER TABLE training_plans ADD COLUMN x int')).toBe(true);
  });
});

describe('direction is MEASURED · volume', () => {
  const before = [row({ id: 'a' }), row({ id: 'b' })];

  it('more prescribed distance reads UP', () => {
    const after = [row({ id: 'a', distance_mi: 7 }), row({ id: 'b' })];
    const d = demandDelta(before, after);
    expect(d.distanceMi).toBe(2);
    expect(directionOfDelta(d)).toBe('UP');
    expect(leverOfDelta(d)).toBe('VOLUME');
  });

  it('less prescribed distance reads DOWN', () => {
    const after = [row({ id: 'a', distance_mi: 3 }), row({ id: 'b' })];
    expect(directionOfDelta(demandDelta(before, after))).toBe('DOWN');
  });

  it('an unchanged plan reads NEUTRAL, and NEUTRAL is not UNKNOWN', () => {
    const d = demandDelta(before, before);
    expect(directionOfDelta(d)).toBe('NEUTRAL');
    expect(d.comparable).toBe(true);
  });

  it('RULE 22 · the two directions are symmetric, and the module is not one-sided', () => {
    // A gate that only ever asks "did you correctly refuse?" will pass an
    // engine that can only refuse. So the SAME magnitude in each direction is
    // asserted to produce mirrored answers, rather than only testing the cut.
    const up = demandDelta(before, [row({ id: 'a', distance_mi: 9 }), row({ id: 'b' })]);
    const down = demandDelta(before, [row({ id: 'a', distance_mi: 1 }), row({ id: 'b' })]);
    expect(up.distanceMi).toBe(4);
    expect(down.distanceMi).toBe(-4);
    expect(directionOfDelta(up)).toBe('UP');
    expect(directionOfDelta(down)).toBe('DOWN');
  });
});

describe('direction is MEASURED · pace, which is the axis a re-anchor moves', () => {
  const before = [row({ id: 'a' }), row({ id: 'b' })];

  it('a FASTER prescription with no distance change reads UP', () => {
    // "with pace but also with volume." A re-anchor moves every pace and no
    // distance; reading that as NEUTRAL would answer half the question.
    const after = [row({ id: 'a', pace_target_s_per_mi: 520 }), row({ id: 'b', pace_target_s_per_mi: 520 })];
    const d = demandDelta(before, after);
    expect(d.distanceMi).toBe(0);
    expect(d.paceSecPerMi).toBe(20);
    expect(directionOfDelta(d)).toBe('UP');
    expect(leverOfDelta(d)).toBe('PACE');
  });

  it('a SLOWER prescription reads DOWN', () => {
    const after = [row({ id: 'a', pace_target_s_per_mi: 560 }), row({ id: 'b', pace_target_s_per_mi: 560 })];
    expect(directionOfDelta(demandDelta(before, after))).toBe('DOWN');
  });

  it('volume leads: a distance move decides even when pace moved the other way', () => {
    const after = [
      row({ id: 'a', distance_mi: 9, pace_target_s_per_mi: 600 }),
      row({ id: 'b', pace_target_s_per_mi: 600 }),
    ];
    expect(directionOfDelta(demandDelta(before, after))).toBe('UP');
  });

  it('a pace appearing where there was none is NOT read as a direction', () => {
    // Rule 9's sharpest form: a threshold standing in for a question it cannot
    // ask. "Some days now carry a pace" is a DATA-PRESENCE fact, not a coaching
    // direction, and scoring it as one is how `scheduledMi >= 5` became a
    // 40-mile cliff.
    const noPace = [row({ id: 'a', pace_target_s_per_mi: null }), row({ id: 'b', pace_target_s_per_mi: null })];
    const d = demandDelta(noPace, before);
    expect(d.paceSecPerMi).toBe(0);
    expect(directionOfDelta(d)).toBe('NEUTRAL');
  });
});

describe('RULE 11 · UNKNOWN is a fourth answer and it is not NEUTRAL', () => {
  it('no before-state gives UNKNOWN, never NEUTRAL', () => {
    const d = demandDelta([], [row({ id: 'a' })]);
    expect(d.comparable).toBe(false);
    expect(directionOfDelta(d)).toBe('UNKNOWN');
  });

  it('an emptied plan is DOWN, not UNKNOWN — the after-side being empty is a measurement', () => {
    const d = demandDelta([row({ id: 'a' }), row({ id: 'b' })], []);
    expect(d.comparable).toBe(true);
    expect(directionOfDelta(d)).toBe('DOWN');
  });
});

describe('RULE 9 · the noise floor is a label, not a cliff', () => {
  it('the direction label moves monotonically across the floor and never inverts', () => {
    const before = [row({ id: 'a', distance_mi: 10, pace_target_s_per_mi: null })];
    const seen: string[] = [];
    for (let delta = -0.5; delta <= 0.5001; delta += 0.01) {
      const after = [row({ id: 'a', distance_mi: 10 + delta, pace_target_s_per_mi: null })];
      seen.push(directionOfDelta(demandDelta(before, after)));
    }
    // Exactly three runs, in this order. A fourth run would mean the label
    // oscillates somewhere across the walk, which is the non-monotone shape
    // Rule 9 exists to catch.
    const runs = seen.filter((v, i) => i === 0 || v !== seen[i - 1]);
    expect(runs).toEqual(['DOWN', 'NEUTRAL', 'UP']);
  });

  it('the quantities themselves are recorded exactly, so nothing is lost to the floor', () => {
    const before = [row({ id: 'a', distance_mi: 10 })];
    const after = [row({ id: 'a', distance_mi: 10 + DEMAND_NOISE_MI / 2 })];
    const d = demandDelta(before, after);
    expect(directionOfDelta(d)).toBe('NEUTRAL');
    expect(d.distanceMi).toBeCloseTo(0.03, 2);
  });

  it('the floors are smaller than the smallest unit any writer produces', () => {
    // distance_mi is stored to one decimal and pace to whole seconds, so
    // neither floor can mask a real change.
    expect(DEMAND_NOISE_MI).toBeLessThan(0.1);
    expect(DEMAND_NOISE_SEC_PER_MI).toBeLessThan(1);
  });
});

describe('scope · how far a decision reached', () => {
  const after = [
    row({ id: 'a', week_id: 'w1' }),
    row({ id: 'b', week_id: 'w1' }),
    row({ id: 'c', week_id: 'w2' }),
  ];

  it('nothing changed is NONE', () => {
    expect(scopeOfChange(after, []).scope).toBe('NONE');
  });

  it('one row is WORKOUT', () => {
    const s = scopeOfChange(after, ['a']);
    expect(s.scope).toBe('WORKOUT');
    expect(s.fromISO).toBe('2026-09-07');
  });

  it('two rows in ONE week is WEEK', () => {
    expect(scopeOfChange(after, ['a', 'b']).scope).toBe('WEEK');
  });

  it('two rows across TWO weeks is PLAN, not WEEK', () => {
    // A reader asking "what did this week's coaching do" must never be handed a
    // row that also moved next week.
    expect(scopeOfChange(after, ['a', 'c']).scope).toBe('PLAN');
  });

  it('a DELETED row makes it PLAN rather than scoring the survivors', () => {
    expect(scopeOfChange(after, ['a', 'b', 'gone']).scope).toBe('PLAN');
  });
});

describe('changed-row detection', () => {
  it('names the rows whose distance or pace moved, and no others', () => {
    const before = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
    const after = [
      row({ id: 'a', distance_mi: 6 }),
      row({ id: 'b' }),
      row({ id: 'c', pace_target_s_per_mi: 500 }),
    ];
    expect(demandDelta(before, after).changedWorkoutIds).toEqual(['a', 'c']);
  });

  it('a row that disappeared counts as changed', () => {
    const before = [row({ id: 'a' }), row({ id: 'b' })];
    const after = [row({ id: 'a' })];
    expect(demandDelta(before, after).changedWorkoutIds).toEqual(['b']);
  });
});
