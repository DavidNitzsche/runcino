/**
 * Account-deletion plan builder (App Store Guideline 5.1.1(v)).
 *
 * Pure, testable core of POST /api/account/delete. The route enumerates
 * the live schema (user-keyed tables + FK edges) at runtime and hands the
 * result to `buildDeletionPlan`, which returns an ordered list of DELETE
 * steps that is FK-safe: children before parents, `sessions` pinned
 * second-to-last, `users` last. The route executes the steps inside one
 * transaction.
 *
 * Why runtime enumeration instead of a hardcoded table list: the schema
 * gains user-keyed tables regularly (49 at the time of writing) and a
 * stale hardcoded list silently leaves orphaned PII behind — the exact
 * failure Apple's real-deletion requirement forbids.
 *
 * Why ordering matters even though most FKs here are ON DELETE CASCADE:
 * verified against prod via pg_constraint (2026-07-06 read-only probe),
 * `runs.shoe_id -> shoes.id` is NO ACTION — deleting `shoes` before
 * `runs` aborts the transaction. The planner does a children-first
 * topological sort over the FK edges so any future NO ACTION edge is
 * handled the same way.
 *
 * Tables that hold user data but carry no user_uuid/user_id column
 * (currently `niggle_recovery` -> niggles, `sick_recovery` ->
 * sick_episodes) are cleared by their parents' ON DELETE CASCADE. If a
 * future such child has a NO ACTION FK, the DELETE on its parent fails
 * and the whole transaction rolls back — a safe, loud failure rather
 * than a partial wipe. These show up in `externalChildEdges` so the
 * route can log them.
 */

export interface UserKeyedTable {
  /** Table name as reported by pg_catalog (public schema, relkind 'r'). */
  table: string;
  /** Which of the two owner columns the table has: 'user_uuid' | 'user_id'. */
  userCols: string[];
}

export interface FkEdge {
  /** Referencing table (holds the FK). Must be deleted before `parent`. */
  child: string;
  /** Referenced table. */
  parent: string;
}

export interface DeletionStep {
  table: string;
  /** WHERE clause referencing exactly one parameter, $1 = user uuid as text. */
  whereSql: string;
}

export interface DeletionPlan {
  /** Ordered DELETE steps, children first, sessions second-to-last, users last. */
  steps: DeletionStep[];
  /** True when the FK graph had a cycle (remaining tables appended alphabetically). */
  cyclic: boolean;
  /**
   * FK edges whose child is OUTSIDE the user-keyed set but whose parent is
   * inside it. Cleared by ON DELETE CASCADE (or they abort the transaction
   * if NO ACTION) — surfaced so the route can log what it relied on.
   */
  externalChildEdges: FkEdge[];
}

/**
 * Sanity floor on the runtime table enumeration, checked by the route
 * BEFORE buildDeletionPlan is even called.
 *
 * Why this exists: buildDeletionPlan([], []) is not a bug in the planner
 * — it is *correctly* a valid, acyclic, single-step plan containing only
 * `users` (see the "appends users even when not in the input set" test
 * below). That is the right behavior for a planner given an empty input.
 * The bug lives one level up: if `enumerateUserTables()` ever returns an
 * empty or near-empty array — a transient pg_catalog hiccup, a wrong
 * search_path, privilege drift, anything short of a thrown error — the
 * route's only other integrity check (`counts['users'] === 1`) is
 * satisfied by that degenerate plan, so it commits happily, deleting the
 * users row while every other user-keyed table is silently orphaned.
 * That is the exact "stale hardcoded list leaves orphaned PII behind"
 * failure this module's runtime-enumeration approach was built to avoid
 * — reached through the enumeration itself going empty instead of a list
 * going stale.
 *
 * Prod carries 49 user-keyed tables (2026-07-06 probe); the floor is set
 * comfortably below that so ordinary schema growth/shrinkage never
 * false-positives, while zero/near-zero always does.
 */
export const MIN_USER_KEYED_TABLES = 40;

/**
 * Throws if `tableCount` is below the sanity floor. Call this on the
 * route's enumerateUserTables() result BEFORE building or executing a
 * deletion plan — never after, and never rely on `counts['users'] === 1`
 * alone to catch this class of failure.
 */
export function assertSufficientTableCount(tableCount: number): void {
  if (tableCount < MIN_USER_KEYED_TABLES) {
    throw new Error(
      `enumerateUserTables() returned ${tableCount} tables, expected at ` +
      `least ${MIN_USER_KEYED_TABLES} — refusing to delete anything`,
    );
  }
}

/** Strict identifier gate. Table names come from pg_catalog, but never
 *  interpolate anything that doesn't look like a plain lowercase
 *  Postgres identifier. */
const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

export function assertSafeIdent(name: string): void {
  if (!IDENT_RE.test(name)) {
    throw new Error(`unsafe table identifier: ${JSON.stringify(name)}`);
  }
}

/**
 * WHERE clause for one user-keyed table. $1 is always passed as the user's
 * uuid in text form; explicit casts keep the parameter type unambiguous
 * whether the column is uuid (most tables) or text (legacy user_id columns
 * like profile.user_id).
 */
export function buildWhereSql(userCols: string[]): string {
  const parts: string[] = [];
  if (userCols.includes('user_uuid')) parts.push('user_uuid = $1::uuid');
  if (userCols.includes('user_id')) parts.push('user_id::text = $1::text');
  if (parts.length === 0) {
    throw new Error('table has no user_uuid/user_id column — not deletable by owner predicate');
  }
  return parts.join(' OR ');
}

/**
 * Children-first topological order over the user-keyed tables.
 *
 * A table is safe to delete once every in-set table that REFERENCES it
 * (its children) has already been deleted. Ties are broken
 * alphabetically so the plan is deterministic. `sessions` is deferred to
 * the very end of the user-keyed steps (the re-auth session should be
 * the last thing to die), then `users` is appended with `id = $1::uuid`.
 *
 * Cycles cannot occur in the current schema (verified: only
 * `users -> users` self-reference, which is ignored). If one ever
 * appears, the remaining tables are appended alphabetically and
 * `cyclic: true` is returned — the transaction will then either succeed
 * (all CASCADE) or roll back atomically (NO ACTION), never partially
 * delete.
 */
export function buildDeletionPlan(
  tables: UserKeyedTable[],
  fkEdges: FkEdge[],
): DeletionPlan {
  const byName = new Map<string, UserKeyedTable>();
  for (const t of tables) {
    assertSafeIdent(t.table);
    if (t.table === 'users') continue; // users handled explicitly last
    byName.set(t.table, t);
  }

  const inSet = (n: string) => byName.has(n);

  // Edges relevant to ordering: both endpoints in the user-keyed set,
  // not self-referencing. Everything else is either handled by CASCADE
  // (child outside set), or by users-last (parent === 'users').
  const orderingEdges: FkEdge[] = [];
  const externalChildEdges: FkEdge[] = [];
  for (const e of fkEdges) {
    if (e.child === e.parent) continue;
    if (inSet(e.child) && inSet(e.parent)) {
      orderingEdges.push(e);
    } else if (!inSet(e.child) && e.child !== 'users' && inSet(e.parent)) {
      externalChildEdges.push(e);
    }
  }

  // remainingChildren[T] = number of not-yet-emitted in-set tables that
  // reference T. T becomes ready when it reaches 0.
  const remainingChildren = new Map<string, number>();
  const parentsOf = new Map<string, Set<string>>(); // child -> parents it references
  for (const name of byName.keys()) remainingChildren.set(name, 0);
  const seenEdge = new Set<string>();
  for (const e of orderingEdges) {
    const key = `${e.child}→${e.parent}`;
    if (seenEdge.has(key)) continue; // composite/duplicate FKs count once
    seenEdge.add(key);
    remainingChildren.set(e.parent, (remainingChildren.get(e.parent) ?? 0) + 1);
    if (!parentsOf.has(e.child)) parentsOf.set(e.child, new Set());
    parentsOf.get(e.child)!.add(e.parent);
  }

  const emitted: string[] = [];
  const pending = new Set(byName.keys());
  let cyclic = false;

  while (pending.size > 0) {
    const ready = [...pending]
      .filter((n) => (remainingChildren.get(n) ?? 0) === 0)
      .sort();
    // Defer sessions as long as anything else can make progress — the
    // re-auth session dies last among user-keyed tables. Emit sessions
    // early only when FK safety demands it: it is the sole ready table
    // AND some pending table is waiting on it (sessions references an
    // in-set parent), or it is the last table standing.
    let pick: string | undefined = ready.find((n) => n !== 'sessions');
    if (pick === undefined && ready.includes('sessions')) {
      const sessionsUnblocks = [...(parentsOf.get('sessions') ?? [])]
        .some((p) => pending.has(p));
      if (sessionsUnblocks || pending.size === 1) pick = 'sessions';
    }
    if (pick === undefined) {
      // Genuine cycle in the FK graph (none exists today). Append the
      // rest alphabetically, sessions still last; the transaction then
      // either succeeds (CASCADE) or rolls back atomically (NO ACTION).
      cyclic = true;
      const rest = [...pending].sort((a, b) => {
        if (a === 'sessions') return 1;
        if (b === 'sessions') return -1;
        return a < b ? -1 : 1;
      });
      for (const n of rest) emitted.push(n);
      pending.clear();
      break;
    }
    emitted.push(pick);
    pending.delete(pick);
    for (const parent of parentsOf.get(pick) ?? []) {
      remainingChildren.set(parent, (remainingChildren.get(parent) ?? 1) - 1);
    }
  }

  const steps: DeletionStep[] = emitted.map((name) => ({
    table: name,
    whereSql: buildWhereSql(byName.get(name)!.userCols),
  }));
  steps.push({ table: 'users', whereSql: 'id = $1::uuid' });

  return { steps, cyclic, externalChildEdges };
}
