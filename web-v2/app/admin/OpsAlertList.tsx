'use client';

/**
 * Unacked ops alerts, grouped by kind, with a per-kind acknowledge.
 *
 * This is the reader `raiseAlert()` never had. See
 * app/api/admin/ops-alerts/route.ts for why it exists — the short
 * version is that 68 webhook_failure alerts announced a dead Strava
 * sync for eleven weeks into a table with no consumer.
 *
 * Grouped, not flat: one fault repeated 68 times is one problem, and a
 * flat list of 68 identical rows is how a surface teaches you to stop
 * reading it.
 */
import { useEffect, useState } from 'react';

interface KindRow {
  kind: string;
  count: number;
  severity: string;
  latest: string;
  message: string;
}

export function OpsAlertList() {
  const [kinds, setKinds] = useState<KindRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/admin/ops-alerts');
      const j = await r.json();
      if (r.ok) { setKinds(j.kinds ?? []); setTotal(j.total_unacked ?? 0); }
      else setError(j.error ?? `load failed (${r.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    }
  }
  useEffect(() => { void load(); }, []);

  async function ack(kind: string) {
    setBusy(kind); setError(null);
    try {
      const r = await fetch('/api/admin/ops-alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ack_kind: kind }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError((j as { error?: string }).error ?? `failed (${r.status})`);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="empty">Alerts unavailable · {error}</div>;
  if (kinds == null) return <div className="empty">Loading alerts</div>;
  if (kinds.length === 0) return <div className="empty">No unacked alerts.</div>;

  return (
    <>
      <div className="meta" style={{ marginBottom: 10 }}>
        {total} unacked {total === 1 ? 'alert' : 'alerts'} · {kinds.length} {kinds.length === 1 ? 'kind' : 'kinds'}
      </div>
      {kinds.map((k) => (
        <div className="row" key={k.kind}>
          <div className="who">
            <div className="nm">
              <span className={`sev sev-${k.severity}`} />
              {k.kind} · {k.count}
            </div>
            <div className="em">{k.message}</div>
            <div className="meta" style={{ marginTop: 4 }}>latest {k.latest.slice(0, 16).replace('T', ' ')}</div>
          </div>
          <button
            className="btn deny"
            disabled={busy === k.kind}
            onClick={() => void ack(k.kind)}
          >
            {busy === k.kind ? 'Acking' : 'Acknowledge'}
          </button>
        </div>
      ))}
    </>
  );
}
