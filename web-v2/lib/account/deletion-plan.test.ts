/**
 * FK-order enumeration tests for the account-deletion planner
 * (App Store Guideline 5.1.1(v) work, audit finding P2 2026-07-06).
 *
 * The endpoint itself needs a scratch DB to integration-test, so the
 * ordering/predicate logic lives in a pure function and is exercised here
 * against fixtures — including a fixture mirroring the REAL prod schema
 * shape, re-captured by read-only probe on 2026-08-24 (44 user-keyed
 * base tables; 49 FK constraints collapsing to 44 distinct child->parent
 * edges; runs->shoes is still the one NO ACTION edge among them).
 *
 * The fixture is a STATIC INPUT to a pure planner — the live route
 * enumerates pg_catalog itself, so a stale fixture never mis-deletes
 * anything. What a stale fixture does do is stop describing the schema
 * the planner will actually meet, and let MIN_USER_KEYED_TABLES drift
 * away from the count it was sized against. The 2026-07-06 capture had
 * rotted exactly that way: it still listed six tables prod no longer has
 * (briefings, coach_intent, daily_checkin, recovery_sessions,
 * runner_notes, skipped_workouts), and its "49" had become 44 without
 * anyone noticing the refusal floor's headroom shrinking from 9 to 4.
 *
 * scripts/check-deletion-plan-fixture.sh re-runs the probe and fails
 * loudly on any divergence, so the next drift announces itself.
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

/**
 * ─────────────────────────────────────────────────────────────────────
 * PROD-SCHEMA FIXTURE · captured 2026-08-24 from prod pg_catalog under
 * the faff_readonly role, with the same two queries the route runs
 * (enumerateUserTables / enumerateFkEdges in
 * app/api/account/delete/route.ts).
 *
 * FORMAT CONTRACT — the two lists below are read by
 * scripts/check-deletion-plan-fixture.sh with sed/grep, no TypeScript
 * toolchain, exactly as check-doctrine.sh reads its claim registry:
 *
 *   · Everything between the >>> and <<< markers is fixture data.
 *   · Each table is ONE line: `['<name>', <both|uuidOnly|idOnly>],`
 *   · Each edge  is ONE line: `e('<child>', '<parent>'),`
 *
 * Break the shape and the script's extractor floor fails rather than
 * quietly reading fewer rows. To regenerate both lists against live
 * prod: `bash scripts/check-deletion-plan-fixture.sh --print`.
 *
 * `users` is deliberately absent from the table list: it is keyed by
 * `id`, not user_uuid/user_id, so the route's enumeration never returns
 * it and the planner appends it itself.
 * ─────────────────────────────────────────────────────────────────────
 */
const both = ['user_id', 'user_uuid'];
const uuidOnly = ['user_uuid'];
const idOnly = ['user_id'];
void idOnly; // no prod table is user_id-only today; kept so the contract's third form parses

const prodTables: UserKeyedTable[] = ([
  // >>> PROD-TABLES
  ['calibration_sessions', uuidOnly],
  ['check_ins', both],
  ['coach_actions', both],
  ['coach_intents', both],
  ['coach_proposals', both],
  ['coach_reads_cache', both],
  ['coach_usage', both],
  ['connector_tokens', both],
  ['cross_training_sessions', both],
  ['day_actions', both],
  ['deleted_activity_ids', uuidOnly],
  ['device_tokens', both],
  ['health_samples', both],
  ['niggles', both],
  ['notifications_log', both],
  ['notifications_pending', both],
  ['personal_goals', uuidOnly],
  ['plan_mutation_rejections', uuidOnly],
  ['plan_mutations', uuidOnly],
  ['plan_phases', uuidOnly],
  ['plan_proposals', uuidOnly],
  ['plan_weeks', uuidOnly],
  ['plan_workout_proposals', uuidOnly],
  ['plan_workouts', uuidOnly],
  ['post_run_rpe', both],
  ['profile', both],
  ['projection_snapshots', uuidOnly],
  ['races', uuidOnly],
  ['readiness_snapshots', uuidOnly],
  ['run_merge_overrides', uuidOnly],
  ['runner_calibration', uuidOnly],
  ['runner_illnesses', both],
  ['runner_injuries', both],
  ['runs', uuidOnly],
  ['sessions', both],
  ['shoes', uuidOnly],
  ['sick_episodes', both],
  ['strava_pushes', uuidOnly],
  ['strength_sessions', both],
  ['subjective_checkins', uuidOnly],
  ['training_plans', both],
  ['user_prefs', both],
  ['workout_completions', both],
  ['workout_routes', both],
  // <<< PROD-TABLES
] as [string, string[]][]).map(([table, userCols]) => ({ table, userCols }));

/**
 * Every FK edge between public-schema tables, deduplicated to distinct
 * child->parent pairs (prod holds 49 FK constraints; sessions,
 * workout_completions and their siblings carry TWO to `users` — one per
 * owner column — which is why the planner counts a pair once).
 *
 * The users edges are NOT elided here as they were in the 2026-07-06
 * fixture: they cost four lines apiece to keep and their absence is one
 * more thing that can silently stop matching prod.
 */
const prodEdges: FkEdge[] = [
  // >>> PROD-EDGES
  e('check_ins', 'users'),
  e('coach_actions', 'users'),
  e('coach_intents', 'users'),
  e('coach_proposals', 'users'),
  e('coach_reads_cache', 'users'),
  e('coach_usage', 'users'),
  e('connector_tokens', 'users'),
  e('cross_training_sessions', 'users'),
  e('day_actions', 'users'),
  e('device_tokens', 'users'),
  e('health_samples', 'users'),
  e('niggle_recovery', 'niggles'),
  e('niggles', 'users'),
  e('notifications_log', 'users'),
  e('notifications_pending', 'users'),
  e('personal_goals', 'users'),
  e('plan_mutations', 'plan_workouts'),
  e('plan_mutations', 'users'),
  e('plan_phases', 'training_plans'),
  e('plan_phases', 'users'),
  e('plan_weeks', 'plan_phases'),
  e('plan_weeks', 'training_plans'),
  e('plan_weeks', 'users'),
  e('plan_workouts', 'plan_weeks'),
  e('plan_workouts', 'training_plans'),
  e('plan_workouts', 'users'),
  e('post_run_rpe', 'users'),
  e('profile', 'users'),
  e('projection_snapshots', 'users'),
  e('races', 'users'),
  e('runner_illnesses', 'users'),
  e('runner_injuries', 'users'),
  e('runs', 'shoes'),
  e('runs', 'users'),
  e('sessions', 'users'),
  e('shoes', 'users'),
  e('sick_episodes', 'users'),
  e('sick_recovery', 'sick_episodes'),
  e('strength_sessions', 'users'),
  e('training_plans', 'users'),
  e('user_prefs', 'users'),
  e('users', 'users'),
  e('workout_completions', 'users'),
  e('workout_routes', 'users'),
  // <<< PROD-EDGES
];
// Non-CASCADE edges above, and why they matter:
//   runs -> shoes    ON DELETE NO ACTION — the edge that makes order real.
//   users -> users   ON DELETE SET NULL  — self-reference, planner ignores it.
// Every other edge is ON DELETE CASCADE.

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

  it('passes at the real prod count (re-captured 2026-08-24)', () => {
    // Read off the fixture rather than a literal, so a re-capture cannot
    // leave this test asserting a count prod no longer has — which is
    // exactly what happened to the 2026-07-06 "49".
    expect(prodTables.length).toBe(44);
    expect(() => assertSufficientTableCount(prodTables.length)).not.toThrow();
  });

  it('keeps a real margin between the floor and the captured prod count', () => {
    // The floor is only useful if it sits meaningfully below reality: too
    // close and ordinary schema shrinkage trips it; at or above and the
    // route refuses every legitimate deletion. FLOOR_MARGIN in
    // deletion-plan.ts states the intended gap — assert it survived.
    expect(MIN_USER_KEYED_TABLES).toBeLessThan(prodTables.length);
    expect(prodTables.length - MIN_USER_KEYED_TABLES).toBe(9);
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

  it('ignores edges whose parent is outside the set', () => {
    // Shape test, not a prod row: the table that used to illustrate it
    // (recovery_sessions -> races) no longer exists in prod. The shape
    // still needs covering — a child in the set pointing at a parent
    // that is not must neither order nor surface anything.
    const plan = buildDeletionPlan(
      [t('some_child')],
      [e('some_child', 'some_absent_parent')],
    );
    expect(order(plan)).toEqual(['some_child', 'users']);
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

describe('buildDeletionPlan · prod-schema fixture (re-captured 2026-08-24)', () => {
  const plan = buildDeletionPlan(prodTables, prodEdges);
  const o = order(plan);

  it('covers every user-keyed table exactly once, plus users', () => {
    expect(o.length).toBe(prodTables.length + 1);
    expect(new Set(o).size).toBe(o.length);
    for (const { table } of prodTables) expect(o).toContain(table);
  });

  it('the fixture itself is well-formed: no duplicates, no users row', () => {
    const names = prodTables.map((x) => x.table);
    expect(new Set(names).size).toBe(names.length);
    // `users` is keyed by `id`, so the route's enumeration never returns
    // it; the planner appends it. A `users` row here would be fiction.
    expect(names).not.toContain('users');
    // Sorted, so a hand-added row lands where the regenerator would put it.
    expect(names).toEqual([...names].sort());
  });

  it('records the owner columns prod actually has, not the ones assumed', () => {
    // personal_goals was created 2026-08-24 (migration 152) with
    // user_uuid only; the 2026-07-06 fixture had guessed `both`. Getting
    // this wrong changes the WHERE clause the planner emits.
    const cols = (name: string) =>
      prodTables.find((x) => x.table === name)?.userCols;
    expect(cols('personal_goals')).toEqual(['user_uuid']);
    expect(cols('coach_reads_cache')).toEqual(['user_id', 'user_uuid']);
    expect(cols('plan_mutation_rejections')).toEqual(['user_uuid']);
  });

  it('lists no table that prod has since dropped', () => {
    // The six the 2026-07-06 capture still carried. Nothing in web-v2
    // reads them; they were dead fixture rows, and a dead fixture row is
    // an ordering claim about a table the planner will never see.
    for (const gone of [
      'briefings', 'coach_intent', 'daily_checkin',
      'recovery_sessions', 'runner_notes', 'skipped_workouts',
    ]) {
      expect(prodTables.map((x) => x.table)).not.toContain(gone);
    }
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
