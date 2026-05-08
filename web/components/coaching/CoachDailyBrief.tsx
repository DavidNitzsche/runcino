/**
 * CoachDailyBrief — voice paragraph + collapsible "why?" rationale.
 *
 * Renders coach.briefDailyTraining output. Used by:
 *   - dashboard's CoachTodayCard
 *   - /training daily-briefing
 *   - /today radically simple view
 *   - /workout/[date] when viewing today
 */

'use client';

import { useState } from 'react';

export interface CoachDailyBriefData {
  answer: string;
  rationale?: string;
  citations?: Array<{ doc: string; section: string; snippet?: string }>;
  brain?: 'deterministic' | 'llm';
}

export function CoachDailyBrief({ brief, engineRationale }: {
  brief: CoachDailyBriefData;
  engineRationale: string;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const isStub = brief.brain === 'deterministic';

  return (
    <div style={{
      padding: '14px 16px', background: 'var(--color-l2)', borderRadius: 8,
      borderLeft: '3px solid var(--color-corporate)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px', color: 'var(--color-corporate)' }}>
          COACH SAYS
        </span>
        {isStub && (
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
            padding: '2px 7px', borderRadius: 3,
            background: 'rgba(255,255,255,.06)', color: 'var(--color-t3)',
          }}>FALLBACK · NO API KEY</span>
        )}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--color-t0)', whiteSpace: 'pre-wrap' }}>
        {brief.answer}
      </div>
      <button
        type="button"
        onClick={() => setShowWhy(s => !s)}
        style={{
          alignSelf: 'flex-start',
          padding: '4px 10px',
          fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.4px',
          background: 'transparent',
          color: 'var(--color-t3)',
          border: '1px solid var(--color-l4)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {showWhy ? '▾ HIDE WHY' : '▸ WHY?'}
      </button>
      {showWhy && (
        <div style={{
          fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.55,
          padding: '10px 12px', background: 'var(--color-l3)', borderRadius: 6,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)', display: 'block', marginBottom: 3 }}>ENGINE RATIONALE</span>
            {engineRationale}
          </div>
          {brief.rationale && brief.rationale !== engineRationale && (
            <div>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)', display: 'block', marginBottom: 3 }}>VOICE RATIONALE</span>
              {brief.rationale}
            </div>
          )}
          {brief.citations && brief.citations.length > 0 && (
            <div>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)', display: 'block', marginBottom: 3 }}>CITATIONS</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {brief.citations.map((c, i) => (
                  <div key={i} style={{ fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.45 }}>
                    <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, color: 'var(--color-corporate)' }}>{c.doc}</span>
                    {c.section && <span style={{ color: 'var(--color-t3)' }}> · {c.section}</span>}
                    {c.snippet && <span style={{ color: 'var(--color-t3)' }}> — &ldquo;{c.snippet}&rdquo;</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
