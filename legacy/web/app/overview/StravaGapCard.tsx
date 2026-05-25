'use client';

/**
 * E1 + E4 · Strava activity gap card · /overview
 *
 * Five states from lib/strava-gap.ts:
 *   silent           · no surface
 *   e4-3to4          · "Three days off, planned or unexpected?"
 *   e4-5to7          · "It's been N days. Worth checking if the plan
 *                       needs adjusting."
 *   e1-8to14         · "It's been N days since your last run.
 *                       Everything OK?"
 *   e1-15plus        · "It's been N days. If you're injured or taking
 *                       a planned break, mark it so the plan adjusts."
 *
 * All states surface the same three affordances:
 *   Planned · 7-day silence, normal training prompts resume after
 *   Injured · suspends L7 signals + V5 until activity resumes
 *   Unexpected · no mark, just acknowledges, back to normal prompts next run
 *
 * Voice: warm but not alarmist. The runner knows whether they're ok;
 * the system shouldn't pretend to know either way.
 */

import { useState } from 'react';
import type { GapState } from '@/lib/strava-gap';

interface Props {
  state: GapState;
  daysSinceLastRun: number;
  lastRunDate: string | null;
}

function headerCopy(state: GapState, days: number): string {
  switch (state) {
    case 'e4-3to4':
      return `${days} days off, planned recovery or unexpected?`;
    case 'e4-5to7':
      return `It's been ${days} days. Worth checking if the plan needs adjusting.`;
    case 'e1-8to14':
      return `It's been ${days} days since your last run. Everything OK?`;
    case 'e1-15plus':
      return `It's been ${days} days. If you're injured or taking a planned break, mark it so the plan adjusts.`;
    default:
      return '';
  }
}

function detailCopy(state: GapState): string {
  switch (state) {
    case 'e4-3to4':
      return "Three days isn't a problem, sometimes life gets busy or your body asks for rest. Pick a label below if it helps the plan stay honest.";
    case 'e4-5to7':
      return "A week off changes the next session's prescription. If this was planned cutback, mark it so the plan absorbs it. If unexpected, no judgment, pick the right label and the system adjusts.";
    case 'e1-8to14':
      return "Longer gaps deserve acknowledgment. The plan can absorb a planned break or pause adaptive signals during recovery from injury. Or this is just life and you're fine, let me know what's going on.";
    case 'e1-15plus':
      return "Two-plus weeks off is a real interruption. Marking it as injury suspends signal evaluation (so the system doesn't read missed workouts as fitness regression). Marking it as planned holds normal prompts for a week. Or do nothing, the plan resumes naturally once you run again.";
    default:
      return '';
  }
}

function stateColor(state: GapState): { accent: string; bg: string; border: string } {
  switch (state) {
    case 'e4-3to4':
      return { accent: '#0D6E8F', bg: 'rgba(13,110,143,.04)', border: 'rgba(13,110,143,.25)' };
    case 'e4-5to7':
      return { accent: '#B3450A', bg: 'rgba(232,128,33,.05)', border: 'rgba(232,128,33,.28)' };
    case 'e1-8to14':
      return { accent: '#B3450A', bg: 'rgba(232,128,33,.06)', border: 'rgba(232,128,33,.32)' };
    case 'e1-15plus':
      return { accent: '#FC4D64', bg: 'rgba(252,77,100,.05)', border: 'rgba(252,77,100,.28)' };
    default:
      return { accent: '#080808', bg: 'transparent', border: 'rgba(8,8,8,.10)' };
  }
}

export function StravaGapCard({ state, daysSinceLastRun, lastRunDate }: Props) {
  const [busy, setBusy] = useState<null | 'planned' | 'injured' | 'unexpected'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  if (state === 'silent' || hidden) return null;

  const colors = stateColor(state);
  const header = headerCopy(state, daysSinceLastRun);
  const detail = detailCopy(state);

  async function mark(action: 'planned' | 'injured' | 'unexpected') {
    setBusy(action);
    setErr(null);
    try {
      const body = action === 'unexpected'
        ? { mark: null }
        : { mark: action };
      const res = await fetch('/api/profile/activity-gap/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      setHidden(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '16px 18px',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        fontFamily: 'Inter, sans-serif',
        fontSize: 13,
        lineHeight: 1.55,
        color: 'rgba(8,8,8,.85)',
        maxWidth: 640,
      }}
    >
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontSize: 10.5,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: colors.accent,
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Activity gap
        {lastRunDate && (
          <span style={{ color: 'rgba(8,8,8,.45)', fontWeight: 500, marginLeft: 8 }}>
            · last run {lastRunDate}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 8, color: '#080808', fontWeight: 600, fontSize: 14 }}>
        {header}
      </div>

      <div style={{ marginBottom: 12, color: 'rgba(8,8,8,.72)' }}>
        {detail}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => mark('planned')}
          disabled={busy !== null}
          style={{
            fontFamily: 'Oswald, sans-serif', fontWeight: 600,
            fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase',
            padding: '8px 13px', borderRadius: 6, cursor: 'pointer',
            background: '#080808', color: '#fff', border: '1px solid #080808',
            opacity: busy !== null ? 0.5 : 1,
          }}
        >
          {busy === 'planned' ? 'Marking…' : 'Planned break'}
        </button>
        <button
          type="button"
          onClick={() => mark('injured')}
          disabled={busy !== null}
          style={{
            fontFamily: 'Oswald, sans-serif', fontWeight: 600,
            fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase',
            padding: '8px 13px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', color: '#FC4D64',
            border: '1px solid rgba(252,77,100,.42)',
            opacity: busy !== null ? 0.5 : 1,
          }}
        >
          {busy === 'injured' ? 'Marking…' : 'Injured · pause signals'}
        </button>
        <button
          type="button"
          onClick={() => mark('unexpected')}
          disabled={busy !== null}
          style={{
            fontFamily: 'Oswald, sans-serif', fontWeight: 600,
            fontSize: 10.5, letterSpacing: 1.5, textTransform: 'uppercase',
            padding: '8px 13px', borderRadius: 6, cursor: 'pointer',
            background: 'transparent', color: 'rgba(8,8,8,.55)',
            border: '1px solid rgba(8,8,8,.18)',
            opacity: busy !== null ? 0.5 : 1,
          }}
        >
          {busy === 'unexpected' ? 'Dismissing…' : 'Unexpected · keep prompts'}
        </button>
        {err && <span style={{ fontSize: 11, color: '#FC4D64' }}>{err}</span>}
      </div>
    </div>
  );
}
