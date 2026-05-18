'use client';

/**
 * Client island that renders the row-level action buttons on /admin
 * (Approve / Deny / Promote / Demote / Re-approve). Each button POSTs
 * to the matching admin API route and then refreshes the page so the
 * server-rendered list re-fetches.
 *
 * The server-side requireAdmin() check is the actual gate — these
 * buttons are just convenience UI; nothing they do is authoritative
 * client-side.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  userId: string;
  kind: 'pending' | 'active' | 'denied';
  isAdmin: boolean;
  isSelf?: boolean;
}

export function AdminActions({ userId, kind, isAdmin, isSelf }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: 'approve' | 'deny' | 'promote' | 'demote' | 'reapprove') {
    if (busy) return;
    setBusy(action);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data?.error || `${action} failed`);
        setBusy(null);
        return;
      }
      router.refresh();
    } catch {
      setErr('Network error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-actions">
      {kind === 'pending' && (
        <>
          <button
            type="button"
            className="admin-btn admin-btn-approve"
            disabled={!!busy}
            onClick={() => act('approve')}
          >
            {busy === 'approve' ? '…' : 'Approve'}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn-deny"
            disabled={!!busy}
            onClick={() => act('deny')}
          >
            {busy === 'deny' ? '…' : 'Deny'}
          </button>
        </>
      )}

      {kind === 'active' && (
        <>
          {!isAdmin && (
            <button
              type="button"
              className="admin-btn admin-btn-ghost"
              disabled={!!busy}
              onClick={() => act('promote')}
              title="Grant admin access"
            >
              {busy === 'promote' ? '…' : 'Make admin'}
            </button>
          )}
          {isAdmin && !isSelf && (
            <button
              type="button"
              className="admin-btn admin-btn-ghost"
              disabled={!!busy}
              onClick={() => act('demote')}
              title="Remove admin access (still active)"
            >
              {busy === 'demote' ? '…' : 'Remove admin'}
            </button>
          )}
          {!isSelf && (
            <button
              type="button"
              className="admin-btn admin-btn-deny"
              disabled={!!busy}
              onClick={() => act('deny')}
              title="Revoke access"
            >
              {busy === 'deny' ? '…' : 'Revoke'}
            </button>
          )}
        </>
      )}

      {kind === 'denied' && (
        <button
          type="button"
          className="admin-btn admin-btn-approve"
          disabled={!!busy}
          onClick={() => act('reapprove')}
        >
          {busy === 'reapprove' ? '…' : 'Reapprove'}
        </button>
      )}

      {err && <span className="admin-err">{err}</span>}
    </div>
  );
}
