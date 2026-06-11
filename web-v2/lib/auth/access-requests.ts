/**
 * Invite-only access flow (David's directive, 2026-06-10):
 * faff.run is a login page — "either you have one or you don't."
 * Open signup is OFF. Strangers hit REQUEST ACCESS; David approves on
 * /admin; the runner gets a temp password and must set their own on
 * first sign-in.
 *
 * Zero DDL — the legacy signup-gate columns carry the whole flow:
 *   users.status            'pending' | 'active' | 'denied' (existing CHECK)
 *   users.approved_at/_by   stamped on approval
 *   users.email_verified_at the "runner chose their own credentials"
 *                           marker · NULL after approval (temp password)
 *                           → login responds must_change_password until
 *                           POST /api/auth/set-password stamps it.
 *                           (/api/auth/signup used to stamp it at
 *                           creation — same semantics, runner-chosen.)
 *
 * Login already rejects status !== 'active' ("account not active"), so
 * pending/denied rows can't sign in. The admin-only first-login
 * bootstrap branch in /api/auth/email is unaffected (it requires
 * is_admin; approved runners are never admins).
 */
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { pool } from '@/lib/db/pool';
import { sendEmail, emailConfigured } from '@/lib/email/send';
import { raiseAlert } from '@/lib/ops/alerts';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'dnitch85@me.com';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.faff.run';

/** users.password_hash is NOT NULL — rows that can't sign in by password
 *  yet (pending requests, Apple-only accounts) carry a hash of 32 random
 *  bytes nobody ever saw. bcrypt.compare can never succeed against it,
 *  and pending/denied rows are status-blocked before compare anyway.
 *  Cost 4: it guards nothing, it just satisfies the column. */
export async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString('hex'), 4);
}

export interface AccessRequestRow {
  id: string;
  email: string;
  name: string;
  status: string;
  created_at: string;
}

/** Public entry: record the request as a pending users row + tell David.
 *  Response is deliberately uniform — callers show "request received"
 *  whether the email was new, already pending, or already active (no
 *  account enumeration from the login page). */
export async function createAccessRequest(name: string, email: string): Promise<{ ok: true }> {
  const existing = (await pool.query<{ id: string; status: string }>(
    `SELECT id::text AS id, status FROM users WHERE email = $1 LIMIT 1`,
    [email],
  )).rows[0];

  if (!existing) {
    await pool.query(
      `INSERT INTO users (email, name, status, onboarding_complete, password_hash)
       VALUES ($1, $2, 'pending', FALSE, $3)`,
      [email, name, await unusablePasswordHash()],
    );
  }
  // Existing row (any status): no-op on the data, still notify David —
  // a re-request after a denial or a forgotten account is signal.

  const note = `Access request: ${name} <${email}>${existing ? ` (existing · status ${existing.status})` : ''}`;
  await raiseAlert({
    kind: 'unknown',
    severity: 'info',
    message: note,
    metadata: { name, email, existing: existing?.status ?? null },
    source: 'access-request',
  }).catch(() => {});
  const mail = await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Faff access request · ${name}`,
    text: `${note}\n\nApprove or deny at ${BASE_URL}/admin`,
  });
  if (!mail.ok) {
    // Expected until RESEND_API_KEY lands · the request is already
    // visible on /admin, so nothing is lost.
    console.warn('[access-request] admin email not sent:', mail.error);
  }
  return { ok: true };
}

export async function listAccessRequests(): Promise<AccessRequestRow[]> {
  // to_char AT TIME ZONE · David's wall clock, not UTC (his 17:16 PT
  // request rendered as "2026-06-11 00:16" — the node-pg timestamp
  // trap, see reference_pg_timestamp_tz_parsing). Admin page is his.
  const r = await pool.query<AccessRequestRow>(
    `SELECT id::text AS id, email::text AS email, COALESCE(name,'') AS name, status,
            to_char(created_at AT TIME ZONE 'America/Los_Angeles', 'Mon DD · HH24:MI') AS created_at
       FROM users
      WHERE status IN ('pending','denied')
      ORDER BY created_at DESC
      LIMIT 100`,
  );
  return r.rows;
}

/** Readable one-time password: faff-xxxx-xxxx (hex · 16^8 space · fine
 *  for a temp credential that must be replaced on first login). */
function tempPassword(): string {
  const hex = randomBytes(4).toString('hex');
  return `faff-${hex.slice(0, 4)}-${hex.slice(4)}`;
}

export async function approveAccessRequest(targetUserId: string, adminId: string): Promise<
  { ok: true; email: string; tempPassword: string; emailed: boolean } | { ok: false; error: string }
> {
  const row = (await pool.query<{ id: string; email: string; name: string; status: string }>(
    `SELECT id::text AS id, email::text AS email, COALESCE(name,'') AS name, status
       FROM users WHERE id = $1 LIMIT 1`,
    [targetUserId],
  )).rows[0];
  if (!row) return { ok: false, error: 'no such request' };
  if (row.status === 'active') return { ok: false, error: 'already active' };

  const temp = tempPassword();
  const hash = await bcrypt.hash(temp, 12);
  await pool.query(
    `UPDATE users SET
        status = 'active',
        password_hash = $2,
        email_verified_at = NULL,   -- temp credential · forces set-password on first login
        approved_at = NOW(),
        approved_by = $3,
        updated_at = NOW()
      WHERE id = $1`,
    [targetUserId, hash, adminId],
  );
  // Profile row now so the account behaves like a signup-created one
  // (legacy text user_id PK · uuid-as-text per the 2026-06-10 pattern).
  await pool.query(
    `INSERT INTO profile (user_id, user_uuid, full_name)
     VALUES ($1::text, $1::uuid, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [targetUserId, row.name],
  );

  let emailed = false;
  if (emailConfigured()) {
    const mail = await sendEmail({
      to: row.email,
      subject: 'Your Faff access is ready',
      text: [
        `You're in.`,
        ``,
        `Sign in at ${BASE_URL}/login`,
        `Email: ${row.email}`,
        `Temporary password: ${temp}`,
        ``,
        `You'll set your own password on first sign-in.`,
      ].join('\n'),
    });
    emailed = mail.ok;
    if (!mail.ok) console.warn('[access-approve] temp-password email failed:', mail.error);
  }
  return { ok: true, email: row.email, tempPassword: temp, emailed };
}

export async function denyAccessRequest(targetUserId: string): Promise<{ ok: boolean; error?: string }> {
  const r = await pool.query(
    `UPDATE users SET status = 'denied', updated_at = NOW()
      WHERE id = $1 AND status = 'pending'`,
    [targetUserId],
  );
  return r.rowCount === 1 ? { ok: true } : { ok: false, error: 'not a pending request' };
}
