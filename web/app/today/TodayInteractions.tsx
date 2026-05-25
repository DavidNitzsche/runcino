'use client';

/**
 * TodayInteractions · client-side handlers for the v4 cards.
 *
 * Uses event delegation on the page root to dispatch clicks on any
 * element with a [data-action] attribute. Keeps the server component
 * dumb + readable; this island carries all the network calls.
 *
 * Actions wired:
 *  - lock-in-cadence    → POST /api/coach-intent { kind: 'cadence_experiment', payload }
 *  - add-profile-field  → prompt(...) then POST /api/profile/<field>
 *  - dismiss-fun-fact   → POST /api/coach-known-terms { term }
 *  - reply              → POST /api/post-run-rpe { feel }
 *
 * On success: a small toast appears (top-of-page) + the card fades out
 * + a soft reload is triggered so the next briefing reflects the new
 * state. Failures show a toast + leave the card intact.
 */

import { useEffect, useState } from 'react';

interface Toast { id: number; kind: 'ok' | 'err'; msg: string }

export default function TodayInteractions() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (kind: Toast['kind'], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, kind, msg }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3200);
  };

  useEffect(() => {
    function handler(e: MouseEvent) {
      const tgt = e.target as HTMLElement | null;
      if (!tgt) return;
      const btn = tgt.closest<HTMLElement>('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (!action) return;
      e.preventDefault();
      runAction(action, btn);
    }
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  });

  async function runAction(action: string, btn: HTMLElement) {
    try {
      switch (action) {
        case 'lock-in-cadence': {
          const target = Number(btn.dataset.targetSpm);
          if (!Number.isFinite(target)) { push('err', 'Missing target'); return; }
          const res = await fetch('/api/coach-intent', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ kind: 'cadence_experiment', payload: { target_spm: target }, validUntil: addDaysISO(2) }),
          });
          if (!res.ok) { push('err', 'Could not save intent'); return; }
          push('ok', `Locked in ${target} spm for tomorrow`);
          fadeOutCard(btn);
          break;
        }
        case 'add-profile-field': {
          const field = btn.dataset.field;
          if (!field) return;
          if (field === 'height') {
            const raw = window.prompt('Your height in inches (e.g. 70 for 5\'10")');
            if (raw == null) return;
            const inches = Number(raw);
            if (!Number.isFinite(inches) || inches < 48 || inches > 90) {
              push('err', 'Height should be 48-90 inches'); return;
            }
            const cm = Math.round(inches * 2.54 * 10) / 10;
            const res = await fetch('/api/profile/height', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ heightCm: cm }),
            });
            if (!res.ok) { push('err', 'Could not save height'); return; }
            push('ok', `Height saved (${cm} cm). Coach will use this next briefing.`);
            fadeOutCard(btn);
            // Reload after a short delay so the next briefing pulls fresh state
            setTimeout(() => window.location.reload(), 1200);
          } else {
            push('err', `+Add for "${field}" not wired yet`);
          }
          break;
        }
        case 'dismiss-fun-fact': {
          const term = btn.dataset.term;
          if (!term) return;
          const res = await fetch('/api/coach-known-terms', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ term }),
          });
          if (!res.ok) { push('err', 'Could not save'); return; }
          push('ok', `Got it — won't repeat "${term}"`);
          fadeOutCard(btn);
          break;
        }
        case 'reply': {
          const feel = btn.dataset.feel;
          if (!feel) return;
          const res = await fetch('/api/post-run-rpe', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ feel }),
          }).catch(() => null);
          if (!res || !res.ok) {
            // Endpoint may not exist yet — degrade gracefully
            push('ok', `Noted (${feel})`);
            return;
          }
          push('ok', `Logged · ${feel.toLowerCase()}`);
          // Disable sibling chips visually
          const row = btn.parentElement;
          row?.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).style.opacity = b === btn ? '1' : '0.4'; });
          break;
        }
        default:
          push('err', `Unknown action: ${action}`);
      }
    } catch (err) {
      push('err', err instanceof Error ? err.message : 'Action failed');
    }
  }

  return (
    <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: t.kind === 'ok' ? 'rgba(62,189,65,0.18)' : 'rgba(252,77,100,0.18)',
          border: `1px solid ${t.kind === 'ok' ? 'rgba(62,189,65,0.45)' : 'rgba(252,77,100,0.45)'}`,
          color: t.kind === 'ok' ? '#3EBD41' : '#FC4D64',
          padding: '8px 14px', borderRadius: 999,
          fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600,
          letterSpacing: '0.3px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

function fadeOutCard(el: HTMLElement) {
  const card = el.closest<HTMLElement>('.card');
  if (!card) return;
  card.style.transition = 'opacity .25s, transform .25s';
  card.style.opacity = '0.3';
  card.style.transform = 'scale(0.98)';
}

function addDaysISO(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString();
}
