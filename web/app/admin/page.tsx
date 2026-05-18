/**
 * /admin — private beta gatekeeper.
 *
 * Server-rendered. Gated by requireAdmin() — non-admins get bounced
 * (active users → /overview, signed-out → /login). Renders three
 * sections: pending requests (with Approve / Deny buttons), active
 * users, and denied users. Actions hit /api/admin/users/[id]/{approve,
 * deny,promote,demote} which all run the same admin check server-side.
 *
 * Intentionally minimal — when there are 5 users you want a list, not
 * a dashboard. Once we grow we can layer search/filtering on top.
 */

import { redirect } from 'next/navigation';
import { Topbar } from '@/app/components';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { AdminActions } from './AdminActions';
import { StravaWebhookPanel } from './StravaWebhookPanel';
import './admin.css';

export const dynamic = 'force-dynamic';

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: 'pending' | 'active' | 'denied';
  is_admin: boolean;
  created_at: string;
  approved_at: string | null;
  last_login_at: string | null;
  location: string | null;
}

function fmt(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function AdminPage() {
  const me = await requireAdmin();

  const users = await query<UserRow>(
    `SELECT id, email, name, status, is_admin, created_at, approved_at, last_login_at, location
     FROM users
     ORDER BY
       CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
       created_at DESC;`,
  );

  const pending = users.filter((u) => u.status === 'pending');
  const active  = users.filter((u) => u.status === 'active');
  const denied  = users.filter((u) => u.status === 'denied');

  return (
    <div className="admin-page">
      <Topbar user={{ name: me.name, email: me.email }} />

      <div className="admin-wrap">
        <header className="admin-header">
          <div className="admin-eyebrow">Admin · Private beta gatekeeper</div>
          <h1 className="admin-title">Users</h1>
          <p className="admin-sub">
            New signups land as <strong>pending</strong>. Approve to grant access, deny to refuse it.
            You can demote yourself out of admin (but at least one admin must always exist).
          </p>
        </header>

        <section className="admin-section">
          <div className="admin-section-head">
            <h2 className="admin-section-title">Pending <span className="admin-count">{pending.length}</span></h2>
          </div>
          {pending.length === 0 ? (
            <div className="admin-empty">No pending requests. Quiet day.</div>
          ) : (
            <div className="admin-table">
              <div className="admin-row admin-row-head">
                <div>Name / Email</div>
                <div>Signed up</div>
                <div>Location</div>
                <div className="admin-row-actions">Action</div>
              </div>
              {pending.map((u) => (
                <div key={u.id} className="admin-row admin-row-pending">
                  <div>
                    <div className="admin-name">{u.name || '—'}</div>
                    <div className="admin-email">{u.email}</div>
                  </div>
                  <div className="admin-meta">{fmt(u.created_at)}</div>
                  <div className="admin-meta">{u.location || '—'}</div>
                  <div className="admin-row-actions">
                    <AdminActions userId={u.id} kind="pending" isAdmin={false} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="admin-section">
          <div className="admin-section-head">
            <h2 className="admin-section-title">Active <span className="admin-count">{active.length}</span></h2>
          </div>
          <div className="admin-table">
            <div className="admin-row admin-row-head">
              <div>Name / Email</div>
              <div>Approved</div>
              <div>Last login</div>
              <div className="admin-row-actions">Action</div>
            </div>
            {active.map((u) => (
              <div key={u.id} className="admin-row">
                <div>
                  <div className="admin-name">
                    {u.name || '—'}
                    {u.is_admin && <span className="admin-badge">Admin</span>}
                    {u.id === me.id && <span className="admin-badge admin-badge-self">You</span>}
                  </div>
                  <div className="admin-email">{u.email}</div>
                </div>
                <div className="admin-meta">{fmt(u.approved_at)}</div>
                <div className="admin-meta">{fmt(u.last_login_at)}</div>
                <div className="admin-row-actions">
                  <AdminActions userId={u.id} kind="active" isAdmin={u.is_admin} isSelf={u.id === me.id} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {denied.length > 0 && (
          <section className="admin-section">
            <div className="admin-section-head">
              <h2 className="admin-section-title">Denied <span className="admin-count">{denied.length}</span></h2>
            </div>
            <div className="admin-table">
              <div className="admin-row admin-row-head">
                <div>Name / Email</div>
                <div>Signed up</div>
                <div>Location</div>
                <div className="admin-row-actions">Action</div>
              </div>
              {denied.map((u) => (
                <div key={u.id} className="admin-row admin-row-denied">
                  <div>
                    <div className="admin-name">{u.name || '—'}</div>
                    <div className="admin-email">{u.email}</div>
                  </div>
                  <div className="admin-meta">{fmt(u.created_at)}</div>
                  <div className="admin-meta">{u.location || '—'}</div>
                  <div className="admin-row-actions">
                    <AdminActions userId={u.id} kind="denied" isAdmin={false} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="admin-section">
          <div className="admin-section-head">
            <h2 className="admin-section-title">Strava Webhook</h2>
          </div>
          <StravaWebhookPanel />
        </section>
      </div>
    </div>
  );
}

// Tell TypeScript redirect is used (for unused-import linting if it ever fires).
void redirect;
