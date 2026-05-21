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

import { useEffect, useState } from 'react';

interface Mutation { reason: string; citation: string | null; ts: string; workoutDateISO: string }
interface Group { reason: string; citation: string | null; days: string[]; ts: string }

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
  const [latestTs, setLatestTs] = useState<string>('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/api/plan/active?mutationsLastDays=7')
      .then((r) => r.json())
      .then((j) => {
        const muts: Mutation[] = j?.recentMutations ?? [];
        if (!muts.length) return;
        const byReason = new Map<string, Group>();
        let latest = muts[0].ts;
        for (const m of muts) {
          if (m.ts > latest) latest = m.ts;
          const g = byReason.get(m.reason) ?? { reason: m.reason, citation: m.citation, days: [], ts: m.ts };
          if (!g.days.includes(m.workoutDateISO)) g.days.push(m.workoutDateISO);
          if (m.ts > g.ts) g.ts = m.ts;
          byReason.set(m.reason, g);
        }
        const seen = typeof window !== 'undefined' ? window.localStorage.getItem(SEEN_KEY) : null;
        if (seen === latest) { setDismissed(true); return; }
        setGroups([...byReason.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1)));
        setLatestTs(latest);
      })
      .catch(() => {});
  }, []);

  if (dismissed || groups.length === 0) return null;

  const dismiss = () => {
    try { window.localStorage.setItem(SEEN_KEY, latestTs); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
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
  );
}
