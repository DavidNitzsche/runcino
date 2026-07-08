/**
 * FK-order enumeration tests for the account-deletion planner
 * (App Store Guideline 5.1.1(v) work, audit finding P2 2026-07-06).
 *
 * The endpoint itself needs a scratch DB to integration-test, so the
 * ordering/predicate logic lives in a pure function and is exercised here
 * against fixtures — including a fixture mirroring the REAL prod schema
 * shape verified by read-only probe on 2026-07-06 (56 FKs via
 * pg_constraint; runs->shoes is the one NO ACTION edge among user-keyed
 * tables).
 */
import { describe, it, expect } from 'vitest';
import {
  buildDeletionPlan,
  buildWhereSql,
  assertSafeIdent,
  assertSufficientTableCount,
  MIN_USER_KEYED_TABLES,
  type UserKeyedTable,
  type FkEdge,
} from './deletion-plan';

const t = (table: string, ...userCols: string[]): UserKeyedTable => ({
  table,
  userCols: userCols.length ? userCols : ['user_uuid'],
});
const e = (child: string, parent: string): FkEdge => ({ child, parent });

const order = (plan: ReturnType<typeof buildDeletionPlan>) =>
  plan.steps.map((s) => s.table);

describe('buildWhereSql', () => {
  it('user_uuid only', () => {
    expect(buildWhereSql(['user_uuid'])).toBe('user_uuid = $1::uuid');
  });
  it('user_id only (legacy text columns still match by ::text)', () => {
    expect(buildWhereSql(['user_id'])).toBe('user_id::text = $1::text');
  });
  it('both columns ORed so legacy rows with either key are caught', () => {
    expect(buildWhereSql(['user_id', 'user_uuid'])).toBe(
      'user_uuid = $1::uuid OR user_id::text = $1::text',
    );
  });
  it('throws on a table with neither column', () => {
    expect(() => buildWhereSql([])).toThrow(/no user_uuid/);
  });
});

describe('assertSafeIdent', () => {
  it('accepts plain lowercase identifiers', () => {
    expect(() => assertSafeIdent('plan_workouts')).not.toThrow();
  });
  it.each(['Runs', 'runs; DROP TABLE users', 'runs"', '1abc', ''])(
    'rejects %j',
    (bad) => {
      expect(() => assertSafeIdent(bad as string)).toThrow(/unsafe table identifier/);
    },
  );
});

describe('assertSufficientTableCount', () => {
  // Regression coverage for the review finding on this branch: an empty
  // or transient-truncated pg_catalog enumeration doesn't throw on its
  // own — it just produces a small `tables` array — and
  // buildDeletionPlan([], []) happily returns a VALID, ACYCLIC one-step
  // plan containing only `users`. The route's OTHER integrity check
  // (`counts['users'] === 1`) is satisfied by that degenerate plan, so
  // without this floor the transaction would commit having deleted only
  // the users row while every other user-keyed table is silently
  // orphaned. This assertion is the route's only defense against that
  // failure mode and MUST run before buildDeletionPlan is called.

  it('throws on a zero-table enumeration (the degenerate-plan failure mode)', () => {
    expect(() => assertSufficientTableCount(0)).toThrow(/expected at least/);
  });

  it('throws on a small-but-nonzero enumeration (partial pg_catalog result)', () => {
    expect(() => assertSufficientTableCount(3)).toThrow(/expected at least/);
  });

  it('throws exactly at one below the floor', () => {
    expect(() => assertSufficientTableCount(MIN_USER_KEYED_TABLES - 1)).toThrow();
  });

  it('passes at exactly the floor', () => {
    expect(() => assertSufficientTableCount(MIN_USER_KEYED_TABLES)).not.toThrow();
  });

  it('passes at the real prod count (49, verified 2026-07-06)', () => {
    expect(() => assertSufficientTableCount(49)).not.toThrow();
  });

  it('confirms buildDeletionPlan([], []) is itself silently "valid" — the exact shape assertSufficientTableCount exists to intercept', () => {
    // This is not a bug in buildDeletionPlan: given no tables, a
    // single-step "users" plan IS the correct pure-function output.
    // The bug only exists if the route trusts this plan without first
    // checking where the empty input came from — which is precisely
    // what assertSufficientTableCount(tables.length) does, called
    // before buildDeletionPlan in the route.
    const plan = buildDeletionPlan([], []);
    expect(plan.cyclic).toBe(false);
    expect(plan.steps).toEqual([{ table: 'users', whereSql: 'id = $1::uuid' }]);
  });
});

describe('buildDeletionPlan · ordering', () => {
  it('deletes children before parents (runs -> shoes is NO ACTION in prod)', () => {
    const plan = buildDeletionPlan(
      [t('shoes'), t('runs')],
      [e('runs', 'shoes'), e('runs', 'users'), e('shoes', 'users')],
    );
    const o = order(plan);
    expect(o.indexOf('runs')).toBeLessThan(o.indexOf('shoes'));
    expect(plan.cyclic).toBe(false);
  });

  it('handles multi-level chains: mutations -> workouts -> weeks -> phases -> plans', () => {
    const plan = buildDeletionPlan(
      [
        t('training_plans', 'user_id', 'user_uuid'),
        t('plan_phases'),
        t('plan_weeks'),
        t('plan_workouts'),
        t('plan_mutations'),
      ],
      [
        e('plan_mutations', 'plan_workouts'),
        e('plan_workouts', 'plan_weeks'),
        e('plan_workouts', 'training_plans'),
        e('plan_weeks', 'plan_phases'),
        e('plan_weeks', 'training_plans'),
        e('plan_phases', 'training_plans'),
      ],
    );
    const o = order(plan);
    expect(o.indexOf('plan_mutations')).toBeLessThan(o.indexOf('plan_workouts'));
    expect(o.indexOf('plan_workouts')).toBeLessThan(o.indexOf('plan_weeks'));
    expect(o.indexOf('plan_weeks')).toBeLessThan(o.indexOf('plan_phases'));
    expect(o.indexOf('plan_phases')).toBeLessThan(o.indexOf('training_plans'));
  });

  it('pins sessions second-to-last and users last', () => {
    const plan = buildDeletionPlan(
      [t('sessions', 'user_id', 'user_uuid'), t('aardvark'), t('zebra')],
      [],
    );
    expect(order(plan)).toEqual(['aardvark', 'zebra', 'sessions', 'users']);
  });

  it('appends users with an id predicate even when not in the input set', () => {
    const plan = buildDeletionPlan([t('runs')], []);
    const last = plan.steps[plan.steps.length - 1];
    expect(last.table).toBe('users');
    expect(last.whereSql).toBe('id = $1::uuid');
  });

  it('never emits a users step from the input set (no duplicate users delete)', () => {
    const plan = buildDeletionPlan([t('runs'), t('users', 'user_id')], []);
    expect(order(plan).filter((n) => n === 'users')).toEqual(['users']);
  });

  it('is deterministic: alphabetical among unconstrained tables', () => {
    const plan = buildDeletionPlan([t('c'), t('a'), t('b')], []);
    expect(order(plan)).toEqual(['a', 'b', 'c', 'users']);
  });

  it('ignores self-referencing edges (users -> users approved_by shape)', () => {
    const plan = buildDeletionPlan([t('a'), t('b')], [e('a', 'a')]);
    expect(order(plan)).toEqual(['a', 'b', 'users']);
    expect(plan.cyclic).toBe(false);
  });

  it('counts duplicate/composite FKs between the same pair once', () => {
    // sessions/workout_completions in prod have TWO FKs to users
    // (user_id and user_uuid). Same pair twice must not deadlock.
    const plan = buildDeletionPlan(
      [t('a'), t('b')],
      [e('a', 'b'), e('a', 'b')],
    );
    expect(order(plan)).toEqual(['a', 'b', 'users']);
    expect(plan.cyclic).toBe(false);
  });

  it('surfaces out-of-set children (niggle_recovery/sick_recovery shape) without ordering impact', () => {
    const plan = buildDeletionPlan(
      [t('niggles'), t('sick_episodes')],
      [e('niggle_recovery', 'niggles'), e('sick_recovery', 'sick_episodes')],
    );
    expect(order(plan)).toEqual(['niggles', 'sick_episodes', 'users']);
    expect(plan.externalChildEdges).toEqual([
      e('niggle_recovery', 'niggles'),
      e('sick_recovery', 'sick_episodes'),
    ]);
  });

  it('ignores edges whose parent is outside the set (recovery_sessions -> races SET NULL shape)', () => {
    const plan = buildDeletionPlan(
      [t('recovery_sessions')],
      [e('recovery_sessions', 'races')],
    );
    expect(order(plan)).toEqual(['recovery_sessions', 'users']);
    expect(plan.externalChildEdges).toEqual([]);
  });

  it('flags a genuine cycle and still returns every table, sessions last', () => {
    const plan = buildDeletionPlan(
      [t('a'), t('b'), t('sessions', 'user_id', 'user_uuid')],
      [e('a', 'b'), e('b', 'a')],
    );
    expect(plan.cyclic).toBe(true);
    const o = order(plan);
    expect(new Set(o)).toEqual(new Set(['a', 'b', 'sessions', 'users']));
    expect(o[o.length - 1]).toBe('users');
    expect(o[o.length - 2]).toBe('sessions');
  });

  it('emits sessions early ONLY if an in-set parent is FK-blocked behind it', () => {
    // Hypothetical: audit_trail references sessions. FK safety must beat
    // the sessions-last preference.
    const plan = buildDeletionPlan(
      [t('sessions', 'user_id', 'user_uuid'), t('audit_trail')],
      [e('sessions', 'audit_trail')],
    );
    expect(order(plan)).toEqual(['sessions', 'audit_trail', 'users']);
    expect(plan.cyclic).toBe(false);
  });

  it('rejects unsafe table names in the input', () => {
    expect(() => buildDeletionPlan([t('runs; --')], [])).toThrow(/unsafe/);
  });
});

describe('buildDeletionPlan · prod-schema fixture (verified 2026-07-06)', () => {
  // The 49 user-keyed base tables enumerated from prod pg_catalog.
  const both = ['user_id', 'user_uuid'];
  const uuidOnly = ['user_uuid'];
  const prodTables: UserKeyedTable[] = [
    ['briefings', both], ['calibration_sessions', uuidOnly], ['check_ins', both],
    ['coach_actions', both], ['coach_intent', both], ['coach_intents', both],
    ['coach_proposals', both], ['coach_reads_cache', both], ['coach_usage', both],
    ['connector_tokens', both], ['cross_training_sessions', both], ['daily_checkin', both],
    ['day_actions', both], ['deleted_activity_ids', uuidOnly], ['device_tokens', both],
    ['health_samples', both], ['niggles', both], ['notifications_log', both],
    ['notifications_pending', both], ['personal_goals', both], ['plan_mutations', uuidOnly],
    ['plan_phases', uuidOnly], ['plan_proposals', uuidOnly], ['plan_weeks', uuidOnly],
    ['plan_workout_proposals', uuidOnly], ['plan_workouts', uuidOnly], ['post_run_rpe', both],
    ['profile', both], ['projection_snapshots', uuidOnly], ['races', uuidOnly],
    ['readiness_snapshots', uuidOnly], ['recovery_sessions', uuidOnly],
    ['run_merge_overrides', uuidOnly], ['runner_calibration', uuidOnly],
    ['runner_illnesses', both], ['runner_injuries', both], ['runner_notes', both],
    ['runs', uuidOnly], ['sessions', both], ['shoes', uuidOnly], ['sick_episodes', both],
    ['skipped_workouts', both], ['strava_pushes', uuidOnly], ['strength_sessions', both],
    ['subjective_checkins', uuidOnly], ['training_plans', both], ['user_prefs', both],
    ['workout_completions', both], ['workout_routes', both],
  ].map(([table, userCols]) => ({ table: table as string, userCols: userCols as string[] }));

  // Non-users FK edges among public tables (users edges elided — they
  // never constrain ordering because users is always last).
  const prodEdges: FkEdge[] = [
    e('niggle_recovery', 'niggles'),
    e('plan_mutations', 'plan_workouts'),
    e('plan_phases', 'training_plans'),
    e('plan_weeks', 'plan_phases'),
    e('plan_weeks', 'training_plans'),
    e('plan_workouts', 'training_plans'),
    e('plan_workouts', 'plan_weeks'),
    e('recovery_sessions', 'races'),
    e('runs', 'shoes'), // ON DELETE NO ACTION — the edge that makes order real
    e('sick_recovery', 'sick_episodes'),
    e('users', 'users'),
    // every user-keyed table also references users; representative sample:
    e('runs', 'users'), e('shoes', 'users'), e('sessions', 'users'),
    e('profile', 'users'), e('training_plans', 'users'),
  ];

  const plan = buildDeletionPlan(prodTables, prodEdges);
  const o = order(plan);

  it('covers every user-keyed table exactly once, plus users', () => {
    expect(o.length).toBe(prodTables.length + 1);
    expect(new Set(o).size).toBe(o.length);
    for (const { table } of prodTables) expect(o).toContain(table);
  });

  it('is acyclic on the real schema', () => {
    expect(plan.cyclic).toBe(false);
  });

  it('orders runs before shoes (the NO ACTION edge)', () => {
    expect(o.indexOf('runs')).toBeLessThan(o.indexOf('shoes'));
  });

  it('orders the plan_* chain child-first', () => {
    expect(o.indexOf('plan_mutations')).toBeLessThan(o.indexOf('plan_workouts'));
    expect(o.indexOf('plan_workouts')).toBeLessThan(o.indexOf('plan_weeks'));
    expect(o.indexOf('plan_weeks')).toBeLessThan(o.indexOf('plan_phases'));
    expect(o.indexOf('plan_phases')).toBeLessThan(o.indexOf('training_plans'));
  });

  it('finishes with sessions then users', () => {
    expect(o[o.length - 2]).toBe('sessions');
    expect(o[o.length - 1]).toBe('users');
  });

  it('records the cascade-reliant out-of-set children', () => {
    expect(plan.externalChildEdges).toContainEqual(e('niggle_recovery', 'niggles'));
    expect(plan.externalChildEdges).toContainEqual(e('sick_recovery', 'sick_episodes'));
  });

  it('every step keys on the user with explicit casts', () => {
    for (const s of plan.steps) {
      if (s.table === 'users') continue;
      expect(s.whereSql).toMatch(/user_uuid = \$1::uuid|user_id::text = \$1::text/);
    }
  });
});
