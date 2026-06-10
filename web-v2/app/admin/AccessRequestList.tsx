'use client';

/**
 * Access-request list + approve/deny actions. On approve, the temp
 * password is shown ONCE here (only its bcrypt hash is stored) so David
 * can share it manually while outbound email is unconfigured; when
 * RESEND_API_KEY is live the runner gets it by email too and the chip
 * says so.
 */
import { useEffect, useState } from 'react';

interface Row { id: string; email: string; name: string; status: string; created_at: string }
interface Approved { email: string; temp: string; emailed: boolean }

export function AccessRequestList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approved, setApproved] = useState<Record<string, Approved>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/admin/access-requests');
      const j = await r.json();
      if (r.ok) setRows(j.requests ?? []);
      else setError(j.error ?? `load failed (${r.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    }
  }
  useEffect(() => { void load(); }, []);

  async function act(id: string, action: 'approve' | 'deny') {
    setBusyId(id); setError(null);
    try {
      const r = await fetch('/api/admin/access-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: id, action }),
      });
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (!r.ok) { setError((j as { error?: string }).error ?? `failed (${r.status})`); return; }
      if (action === 'approve') {
        setApproved((p) => ({ ...p, [id]: {
          email: String((j as { email?: string }).email ?? ''),
          temp: String((j as { temp_password?: string }).temp_password ?? ''),
          emailed: Boolean((j as { emailed?: boolean }).emailed),
        }}));
        setRows((p) => (p ?? []).filter((row) => row.id !== id || approvedKeeps(row)));
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setBusyId(null);
    }
  }
  // Keep an approved row on screen so the temp-password chip has a home.
  const approvedKeeps = (_row: Row) => true;

  if (rows === null && !error) return <div className="empty">Loading…</div>;

  return (
    <div>
      {error && <div className="err" role="alert">{error}</div>}
      {rows && rows.length === 0 && Object.keys(approved).length === 0 && (
        <div className="empty">No access requests. Quiet out there.</div>
      )}
      {(rows ?? []).map((r) => {
        const ap = approved[r.id];
        return (
          <div key={r.id} className={`row${r.status === 'denied' ? ' denied' : ''}`}>
            <div className="who">
              <div className="nm">{r.name || '(no name)'}</div>
              <div className="em">{r.email}</div>
            </div>
            <div className="meta">{r.status} · {r.created_at}</div>
            {!ap && r.status === 'pending' && (
              <>
                <button type="button" className="btn approve" disabled={busyId === r.id} onClick={() => { void act(r.id, 'approve'); }}>
                  {busyId === r.id ? '…' : 'APPROVE'}
                </button>
                <button type="button" className="btn deny" disabled={busyId === r.id} onClick={() => { void act(r.id, 'deny'); }}>
                  DENY
                </button>
              </>
            )}
            {!ap && r.status === 'denied' && (
              <button type="button" className="btn approve" disabled={busyId === r.id} onClick={() => { void act(r.id, 'approve'); }}>
                {busyId === r.id ? '…' : 'APPROVE ANYWAY'}
              </button>
            )}
            {ap && (
              <div className="temp">
                Approved. Temp password: <code>{ap.temp}</code>
                <br />
                {ap.emailed
                  ? `Emailed to ${ap.email}.`
                  : `Email isn't configured — share it with ${ap.email} yourself. They'll set their own on first sign-in.`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
