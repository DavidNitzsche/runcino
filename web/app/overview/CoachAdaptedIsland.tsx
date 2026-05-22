'use client';

/**
 * "Coach updated your plan", a dismissible card pinned at the top of
 * /overview that surfaces recent plan adaptations (grouped by reason, with
 * the day(s) touched) so a change never happens
 * silently. Client island: the parent page is a server component.
 *
 * Dismissal is persisted server-side: tapping ✕ flips the applied changes to
 * 'seen' so the card never re-surfaces on any device (web or iPhone).
 */

import { useEffect, useState, type CSSProperties } from 'react';

interface Mutation { id: string; reason: string; citation: string | null; ts: string; workoutDateISO: string; status?: 'applied' | 'proposed' | 'declined' | 'seen' }
interface Group { reason: string; days: string[]; ts: string; ids: string[] }
type PendingGroup = Group;

function dayList(days: string[]): string {
  const names = days
    .map((d) => {
      const dt = new Date(d.slice(0, 10) + 'T12:00:00Z');
      return isNaN(dt.getTime()) ? null : dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    })
    .filter(Boolean) as string[];
  return names.length > 4 ? `${names.length} days` : names.join(', ');
}

export function CoachAdaptedIsland() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [pending, setPending] = useState<PendingGroup[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    fetch('/api/plan/active?mutationsLastDays=7')
      .then((r) => r.json())
      .then((j) => {
        const muts: Mutation[] = j?.recentMutations ?? [];
        if (!muts.length) { setGroups([]); setPending([]); return; }

        // PROPOSED → approve/skip card (always shown, never dismissed).
        const proposed = muts.filter((m) => m.status === 'proposed');
        const byPending = new Map<string, PendingGroup>();
        for (const m of proposed) {
          const g = byPending.get(m.reason) ?? { reason: m.reason, days: [], ts: m.ts, ids: [] };
          g.ids.push(m.id);
          if (!g.days.includes(m.workoutDateISO)) g.days.push(m.workoutDateISO);
          if (m.ts > g.ts) g.ts = m.ts;
          byPending.set(m.reason, g);
        }
        setPending([...byPending.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1)));

        // APPLIED → informational "Coach updated your plan" card. Dismissing it
        // marks these 'seen' server-side, so 'seen' rows never reach here again.
        const applied = muts.filter((m) => (m.status ?? 'applied') === 'applied');
        if (!applied.length) { setGroups([]); return; }
        const byReason = new Map<string, Group>();
        for (const m of applied) {
          const g = byReason.get(m.reason) ?? { reason: m.reason, days: [], ts: m.ts, ids: [] };
          g.ids.push(m.id);
          if (!g.days.includes(m.workoutDateISO)) g.days.push(m.workoutDateISO);
          if (m.ts > g.ts) g.ts = m.ts;
          byReason.set(m.reason, g);
        }
        setGroups([...byReason.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1)));
      })
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const act = async (g: PendingGroup, action: 'accept' | 'decline') => {
    setBusy(g.reason);
    try {
      await fetch('/api/plan/adaptations/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: g.ids, action }),
      });
      load();
    } catch { /* ignore */ } finally { setBusy(null); }
  };

  const dismiss = async () => {
    const ids = groups.flatMap((g) => g.ids);
    setGroups([]);
    if (pending.length === 0) setDismissed(true);
    if (ids.length === 0) return;
    try {
      await fetch('/api/plan/adaptations/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'dismiss' }),
      });
    } catch { /* ignore, UI already cleared; server retry on next dismiss */ }
  };

  if ((dismissed || groups.length === 0) && pending.length === 0) return null;

  const btn = (kind: 'accept' | 'decline'): CSSProperties => ({
    flex: 1, padding: '8px 0', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
    cursor: 'pointer', border: kind === 'accept' ? 'none' : '1px solid rgba(8,8,8,.15)',
    background: kind === 'accept' ? '#E85D26' : '#fff',
    color: kind === 'accept' ? '#fff' : 'rgba(8,8,8,.7)',
  });

  return (
    <>
      {pending.map((g) => (
        <div key={`p-${g.reason}`} style={{
          background: '#fff', borderRadius: 16, padding: '16px 18px', marginBottom: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)',
          border: '1px solid rgba(232,128,33,.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ color: '#E85D26', fontWeight: 700 }}>✦</span>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(8,8,8,.45)' }}>
              Coach suggests a change
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: '#080808', lineHeight: 1.45 }}>{g.reason}</div>
          <div style={{ fontSize: 11, marginTop: 2, marginBottom: 12 }}>
            <span style={{ color: '#E85D26', fontWeight: 600 }}>{dayList(g.days)}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, opacity: busy === g.reason ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
            <button onClick={() => act(g, 'accept')} style={btn('accept')}>Approve</button>
            <button onClick={() => act(g, 'decline')} style={btn('decline')}>Skip</button>
          </div>
        </div>
      ))}
      {!dismissed && groups.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: 16, padding: '16px 18px', marginBottom: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ color: '#E85D26', fontWeight: 700 }}>✦</span>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(8,8,8,.45)' }}>
              Coach updated your plan
            </span>
            <button onClick={dismiss} aria-label="Dismiss" style={{
              marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer',
              color: 'rgba(8,8,8,.45)', fontSize: 15, lineHeight: 1, padding: 2,
            }}>✕</button>
          </div>
          {groups.map((g) => (
            <div key={g.reason} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, color: '#080808', lineHeight: 1.45 }}>{g.reason}</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>
                <span style={{ color: '#E85D26', fontWeight: 600 }}>{dayList(g.days)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
