'use client';

/**
 * NextPushCard · Wave G-3
 *
 * The "NEXT PUSH" card surfaces 1–3 prioritized pushes the coach is
 * actively making this week. Each push is grounded in a real signal
 * off CoachState (long-run erosion, missing threshold, easy-share
 * drift, stale check-in, volume cliff) and cites the doctrine that
 * fired it.
 *
 * Source data: `coach.nextPushes()` → `NextPushesReport`.
 * No file in this component edits data.ts, page.tsx, TodayCard, or the
 * plan-adapted card — Wave F owns those.
 */

import { Card, CardHeader, CardLabel, CardPin, CardFoot } from '@/app/components';
import type { CoachDecision } from '@/coach/types';
import type { NextPushesReport, CoachPush } from '@/coach/coach';

export interface NextPushCardProps {
  decision: CoachDecision<NextPushesReport>;
}

const URGENCY_STYLES: Record<
  CoachPush['urgency'],
  { label: string; bg: string; border: string; color: string }
> = {
  high: {
    label: 'NOW',
    bg: 'rgba(252,77,100,.10)',
    border: 'rgba(252,77,100,.32)',
    color: '#FC4D64',
  },
  med: {
    label: 'THIS WEEK',
    bg: 'rgba(243,173,56,.10)',
    border: 'rgba(243,173,56,.32)',
    color: '#F3AD38',
  },
  low: {
    label: 'WATCH',
    bg: 'rgba(39,180,224,.08)',
    border: 'rgba(39,180,224,.24)',
    color: '#27B4E0',
  },
};

export function NextPushCard({ decision }: NextPushCardProps) {
  const r = decision.answer;
  const pushes = r.pushes;

  return (
    <Card wash="coach" span={12} padding="26px 32px">
      <CardHeader>
        <CardLabel color="#27B4E0">NEXT PUSH</CardLabel>
        <CardPin variant={pushes.length === 0 ? 'green' : pushes[0]!.urgency === 'high' ? 'warn' : 'coach'}>
          {pushes.length === 0
            ? 'PLAN STEADY'
            : `${pushes.length} PUSH${pushes.length === 1 ? '' : 'ES'}`}
        </CardPin>
      </CardHeader>

      {pushes.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginTop: 18,
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--t1)',
              lineHeight: 1.25,
            }}
          >
            Plan steady — keep executing this week.
          </p>
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--f-body)',
              fontSize: 14,
              color: 'var(--t2)',
              maxWidth: 520,
            }}
          >
            No signals firing on volume, intensity, recovery, or check-in.
            The coach is reading the picture clean.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {pushes.map((p) => {
            const u = URGENCY_STYLES[p.urgency];
            return (
              <div
                key={p.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: 14,
                  padding: '14px 16px',
                  background: u.bg,
                  border: `1px solid ${u.border}`,
                  borderRadius: 10,
                }}
              >
                {/* Urgency chip */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-start',
                    alignItems: 'center',
                    padding: '6px 10px',
                    background: u.color,
                    color: '#0A0E12',
                    fontFamily: 'var(--f-data)',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '1.4px',
                    borderRadius: 6,
                    height: 'fit-content',
                    minWidth: 68,
                    textAlign: 'center',
                  }}
                >
                  {u.label}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* The action — what the coach wants you to do. */}
                  <p
                    style={{
                      margin: 0,
                      fontFamily: 'var(--f-display)',
                      fontSize: 16,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      color: 'var(--t1)',
                    }}
                  >
                    Coach wants you to: {p.action}
                  </p>

                  {/* The signal — what fired the push. */}
                  <p
                    style={{
                      margin: 0,
                      fontFamily: 'var(--f-data)',
                      fontSize: 11,
                      fontWeight: 600,
                      color: u.color,
                      letterSpacing: '0.5px',
                    }}
                  >
                    SIGNAL · {p.signal}
                  </p>

                  {/* Citation strip — the doctrine line that backs it. */}
                  {p.citations.length > 0 && (
                    <p
                      style={{
                        margin: 0,
                        fontFamily: 'var(--f-data)',
                        fontSize: 10,
                        fontWeight: 500,
                        color: 'var(--t2)',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {p.citations.map((c) => c.section).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CardFoot
        left={pushes.length === 0
          ? 'All signals nominal'
          : `${pushes.length} prioritized · doctrine-grounded`}
        right="Coach engine · live"
      />
    </Card>
  );
}
