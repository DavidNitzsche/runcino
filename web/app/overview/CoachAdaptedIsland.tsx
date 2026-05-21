'use client';

/**
 * "Coach updated your plan" — a dismissible card pinned at the top of
 * /overview that surfaces recent plan adaptations (grouped by reason, with
 * the day(s) touched + the research citation) so a change never happens
 * silently. Client island: the parent page is a server component.
 *
 * Seen-tracking is local (localStorage): the card shows only when the latest
 * adaptation is newer than what this browser last dismissed.
 */

import { useEffect, useState, type CSSProperties } from 'react';

interface Mutation { id: string; reason: string; citation: string | null; ts: string; workoutDateISO: string; status?: 'applied' | 'proposed' | 'declined' }
interface Group { reason: string; citation: string | null; days: string[]; ts: string }
interface PendingGroup extends Group { ids: string[] }

const SEEN_KEY = 'faff.coach.adaptSeenTs';

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
  const [latestTs, setLatestTs] = useState<string>('');
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
          const g = byPending.get(m.reason) ?? { reason: m.reason, citation: m.citation, days: [], ts: m.ts, ids: [] };
          g.ids.push(m.id);
          if (!g.days.includes(m.workoutDateISO)) g.days.push(m.workoutDateISO);
          if (m.ts > g.ts) g.ts = m.ts;
          byPending.set(m.reason, g);
        }
        setPending([...byPending.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1)));

        // APPLIED → informational "Coach updated your plan" card (dismissible).
        const applied = muts.filter((m) => (m.status ?? 'applied') === 'applied');
        if (!applied.length) { setGroups([]); return; }
        const byReason = new Map<string, Group>();
        let latest = applied[0].ts;
        for (const m of applied) {
          if (m.ts > latest) latest = m.ts;
          const g = byReason.get(m.reason) ?? { reason: m.reason, citation: m.citation, days: [], ts: m.ts };
          if (!g.days.includes(m.workoutDateISO)) g.days.push(m.workoutDateISO);
          if (m.ts > g.ts) g.ts = m.ts;
          byReason.set(m.reason, g);
        }
        const seen = typeof window !== 'undefined' ? window.localStorage.getItem(SEEN_KEY) : null;
        if (seen === latest) { setGroups([]); return; }
        setGroups([...byReason.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1)));
        setLatestTs(latest);
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

  const dismiss = () => {
    try { window.localStorage.setItem(SEEN_KEY, latestTs); } catch { /* ignore */ }
    setGroups([]);
    if (pending.length === 0) setDismissed(true);
  };

  if ((dismissed || groups.length === 0) && pending.length === 0) return null;

  const btn = (kind: 'accept' | 'decline'): CSSProperties => ({
    flex: 1, padding: '8px 0', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
    cursor: 'pointer', border: kind === 'accept' ? 'none' : '1px solid rgba(13,15,18,.15)',
    background: kind === 'accept' ? '#E85D26' : '#fff',
    color: kind === 'accept' ? '#fff' : 'rgba(13,15,18,.7)',
  });

  return (
    <>
      {pending.map((g) => (
        <div key={`p-${g.reason}`} style={{
          background: '#fff', borderRadius: 16, padding: '16px 18px', marginBottom: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)',
          border: '1px solid rgba(232,93,38,.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ color: '#E85D26', fontWeight: 700 }}>✦</span>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(13,15,18,.45)' }}>
              Coach suggests a change
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: '#0D0F12', lineHeight: 1.45 }}>{g.reason}</div>
          <div style={{ fontSize: 11, marginTop: 2, marginBottom: 12 }}>
            <span style={{ color: '#E85D26', fontWeight: 600 }}>{dayList(g.days)}</span>
            {g.citation ? <span style={{ color: 'rgba(13,15,18,.45)' }}> · {g.citation}</span> : null}
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
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(13,15,18,.45)' }}>
              Coach updated your plan
            </span>
            <button onClick={dismiss} aria-label="Dismiss" style={{
              marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer',
              color: 'rgba(13,15,18,.45)', fontSize: 15, lineHeight: 1, padding: 2,
            }}>✕</button>
          </div>
          {groups.map((g) => (
            <div key={g.reason} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 13.5, color: '#0D0F12', lineHeight: 1.45 }}>{g.reason}</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>
                <span style={{ color: '#E85D26', fontWeight: 600 }}>{dayList(g.days)}</span>
                {g.citation ? <span style={{ color: 'rgba(13,15,18,.45)' }}> · {g.citation}</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
