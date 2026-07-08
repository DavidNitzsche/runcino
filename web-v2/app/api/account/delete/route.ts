/**
 * POST /api/account/delete
 *
 * In-app account deletion (App Store Guideline 5.1.1(v): apps that offer
 * account creation must offer account deletion — REAL deletion, not
 * deactivation). Audit finding P2, 2026-07-06: no deletion path existed.
 *
 * Contract:
 *   Auth:   session (Bearer or faff_session cookie) — identifies WHO.
 *   Body:   { password } — fresh re-auth proof, verified with
 *           bcrypt.compare against users.password_hash exactly like
 *           /api/auth/email. A stolen session token alone cannot wipe an
 *           account.
 *   200:    { ok: true, deleted: true, user_uuid, tables_cleared,
 *             rows_deleted } + faff_session cookie cleared. All sessions
 *           are gone, so any subsequent request with the old token 401s.
 *   401:    bad password (generic 'invalid credentials', mirrors sign-in).
 *   403:    account has no password set (invite flow interrupted) — the
 *           user must set one via /set-password first; we never delete on
 *           session-only proof.
 *   429:    per-IP auth rate limit (same brake as sign-in — this endpoint
 *           accepts password guesses).
 *
 * Deletion semantics:
 *   - Every user-keyed table (columns user_uuid/user_id) is enumerated
 *     from pg_catalog AT RUNTIME — no hardcoded table list to go stale.
 *     (pg_catalog, not information_schema: information_schema is
 *     privilege-filtered and showed 0 of the 56 real FKs under the RO
 *     role during the 2026-07-06 probe.)
 *   - FK edges are enumerated the same way and the pure planner
 *     (lib/account/deletion-plan.ts) orders children before parents —
 *     required because runs.shoe_id -> shoes.id is NO ACTION.
 *   - One transaction: all user rows, then sessions, then the users row.
 *     Any failure rolls back everything — no partial wipe.
 *   - Child tables without a user column (niggle_recovery, sick_recovery)
 *     are cleared by their parents' ON DELETE CASCADE.
 *   - Strava: if a token is on file, best-effort POST
 *     https://www.strava.com/oauth/deauthorize first (same as the
 *     disconnect path in /api/auth/strava) — failure never blocks
 *     deletion.
 *   - Tombstone: one row in the EXISTING ops_alerts table (append-only
 *     ops log) recording user_uuid + row counts. No email, no new tables.
 *   - No special-casing by account: admins and the App Review demo
 *     account delete through the identical path.
 */
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { authRateLimited } from '@/lib/auth/rate-limit';
import { raiseAlert } from '@/lib/ops/alerts';
import {
  buildDeletionPlan,
  assertSafeIdent,
  type UserKeyedTable,
  type FkEdge,
} from '@/lib/account/deletion-plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SuccessBody {
  ok: true;
  deleted: true;
  user_uuid: string;
  tables_cleared: number;
  rows_deleted: number;
}
interface ErrorBody { ok: false; error: string; }

export async function POST(req: NextRequest): Promise<NextResponse<SuccessBody | ErrorBody>> {
  // Same per-IP brake as /api/auth/email — this endpoint verifies
  // passwords, so it is a credential-guessing surface.
  if (authRateLimited(req)) {
    return NextResponse.json<ErrorBody>(
      { ok: false, error: 'too many attempts — try again in a few minutes' },
      { status: 429 },
    );
  }

  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth as NextResponse<ErrorBody>;
  const userId = auth;

  let body: { password?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json<ErrorBody>({ ok: false, error: 'invalid JSON' }, { status: 400 }); }

  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return NextResponse.json<ErrorBody>(
      { ok: false, error: 'password required to delete the account' },
      { status: 400 },
    );
  }

  // ── Fresh re-auth proof · mirrors /api/auth/email ────────────────
  const userRow = (await pool.query(
    `SELECT id::text AS user_uuid, password_hash FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  )).rows[0];
  if (!userRow) {
    // Session resolved but the user row is already gone — treat as 401.
    return NextResponse.json<ErrorBody>({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (!userRow.password_hash) {
    // No bcrypt hash on file (interrupted invite flow). Never delete on
    // session-only proof — Apple's rule is about deletion existing, not
    // about deletion skipping authentication.
    return NextResponse.json<ErrorBody>(
      { ok: false, error: 'no password set on this account — set a password first, then delete' },
      { status: 403 },
    );
  }
  let matches = false;
  try { matches = await bcrypt.compare(password, userRow.password_hash); } catch {}
  if (!matches) {
    return NextResponse.json<ErrorBody>({ ok: false, error: 'invalid credentials' }, { status: 401 });
  }

  // ── Strava · best-effort token revoke BEFORE credentials vanish ──
  await revokeStravaBestEffort(userId);

  // ── Enumerate schema + build the plan ─────────────────────────────
  let plan;
  try {
    const [tables, edges] = await Promise.all([enumerateUserTables(), enumerateFkEdges()]);
    plan = buildDeletionPlan(tables, edges);
  } catch (e: any) {
    console.error('[account/delete] plan build failed:', e?.message);
    return NextResponse.json<ErrorBody>(
      { ok: false, error: 'deletion plan failed — nothing was deleted' },
      { status: 500 },
    );
  }
  if (plan.cyclic) {
    // Should never happen (no FK cycles in this schema). Refuse rather
    // than run a best-guess order that a NO ACTION edge could abort
    // mid-flight (the transaction would still roll back, but loudly fail
    // instead with a clear reason).
    console.error('[account/delete] FK cycle detected — refusing');
    return NextResponse.json<ErrorBody>(
      { ok: false, error: 'deletion plan failed — nothing was deleted' },
      { status: 500 },
    );
  }

  // ── One transaction · children → parents → sessions → users ───────
  const counts: Record<string, number> = {};
  let rowsDeleted = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const step of plan.steps) {
      assertSafeIdent(step.table);
      const r = await client.query(
        `DELETE FROM "${step.table}" WHERE ${step.whereSql}`,
        [userId],
      );
      if ((r.rowCount ?? 0) > 0) {
        counts[step.table] = r.rowCount ?? 0;
        rowsDeleted += r.rowCount ?? 0;
      }
    }
    if ((counts['users'] ?? 0) !== 1) {
      throw new Error(`users delete affected ${counts['users'] ?? 0} rows, expected 1`);
    }
    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[account/delete] transaction failed (rolled back):', e?.message);
    return NextResponse.json<ErrorBody>(
      { ok: false, error: 'deletion failed — nothing was deleted' },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  // ── Tombstone · existing ops_alerts table only, best-effort ──────
  // raiseAlert already swallows insert failures; no email or name is
  // recorded — the account is gone, the ops row is a non-PII receipt.
  await raiseAlert({
    kind: 'account_deleted',
    severity: 'info',
    message: `account ${userId} deleted via /api/account/delete`,
    metadata: { user_uuid: userId, rows_deleted: rowsDeleted, tables: counts },
    source: 'api/account/delete',
  }).catch(() => {});

  const res = NextResponse.json<SuccessBody>({
    ok: true,
    deleted: true,
    user_uuid: userId,
    tables_cleared: Object.keys(counts).length,
    rows_deleted: rowsDeleted,
  });
  // Clear the web cookie; the sessions rows are already gone, so any
  // retained Bearer token 401s on its next use.
  res.cookies.set('faff_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}

/**
 * All public-schema base tables carrying a user_uuid or user_id column.
 * pg_catalog (not information_schema) so results don't depend on the
 * role's column privileges.
 */
async function enumerateUserTables(): Promise<UserKeyedTable[]> {
  const r = await pool.query(
    `SELECT c.relname AS table_name,
            array_agg(DISTINCT a.attname ORDER BY a.attname) AS user_cols
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname IN ('user_uuid', 'user_id')
        AND a.attnum > 0
        AND NOT a.attisdropped
      GROUP BY c.relname
      ORDER BY c.relname`,
  );
  return r.rows.map((row: any) => ({ table: row.table_name, userCols: row.user_cols }));
}

/** All FK edges between public-schema tables (child references parent). */
async function enumerateFkEdges(): Promise<FkEdge[]> {
  const r = await pool.query(
    `SELECT child.relname AS child_table, parent.relname AS parent_table
       FROM pg_constraint con
       JOIN pg_class child  ON child.oid  = con.conrelid
       JOIN pg_class parent ON parent.oid = con.confrelid
       JOIN pg_namespace n  ON n.oid = child.relnamespace
      WHERE con.contype = 'f' AND n.nspname = 'public'
      ORDER BY child.relname, parent.relname`,
  );
  return r.rows.map((row: any) => ({ child: row.child_table, parent: row.parent_table }));
}

/**
 * Best-effort Strava OAuth revoke, mirroring the disconnect path in
 * /api/auth/strava: read the freshest active token (connector_tokens
 * first, legacy profile columns second) and POST oauth/deauthorize.
 * Never throws, never blocks deletion.
 */
async function revokeStravaBestEffort(userId: string): Promise<void> {
  try {
    let token: string | null = (await pool.query(
      `SELECT access_token
         FROM connector_tokens
        WHERE COALESCE(user_uuid, user_id) = $1
          AND provider = 'strava'
          AND disconnected_at IS NULL
        ORDER BY connected_at DESC
        LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] as any[] }))).rows[0]?.access_token ?? null;
    if (!token) {
      token = (await pool.query(
        `SELECT strava_access_token AS access_token FROM profile WHERE user_uuid = $1`,
        [userId],
      ).catch(() => ({ rows: [] as any[] }))).rows[0]?.access_token ?? null;
    }
    if (!token) return;
    await fetch('https://www.strava.com/oauth/deauthorize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch (e: any) {
    console.error('[account/delete] strava deauthorize skipped:', e?.message);
  }
}
