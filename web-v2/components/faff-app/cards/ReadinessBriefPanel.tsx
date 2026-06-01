'use client';

/**
 * ReadinessBriefPanel · the morning brief rendered as a single block.
 *
 * Backend source: seed.readinessBrief (ReadinessBriefSeed), composed by
 * web-v2/lib/coach/readiness-brief.ts. Per the catch-up brief
 * (designs/briefs/backend-state-2026-06-01-landed.md §"New seed fields")
 * the panel surfaces 5 pillars + sparkline + streaks + movers + watch-
 * tomorrow callouts. The top readiness score lives in the Today header
 * gauge already · this panel adds the layers below that the runner
 * needs to interpret WHY today's score landed where it did.
 *
 * Doctrine guardrails (locked, do not violate):
 *   1. No prescription on this panel · readings only. The coach voice
 *      prescribes via separate surfaces (coach intents, proposals).
 *      Otherwise contradictions surface.
 *   2. State both numbers, no derived deltas. "7.2h sleep · 7-night avg
 *      target 7.5h" YES. "Sleep -0.3h short" NO. Source brief readiness-
 *      brief-backend-landed.md §"UI rules".
 *   3. Subjective override beats objective (UI not shipped per David
 *      default 2026-06-01 · slot rendered as null-safe pass-through).
 *
 * Visual order (locked per David Q4 default 2026-06-01 · lead with score,
 * sparkline below):
 *   · Band tag + headline + oneLineMover
 *   · 14-day score sparkline
 *   · 5 pillar tiles grid
 *   · Active streaks (3+ days · the persistence story)
 *   · Biggest movers (the day-vs-day story)
 *   · Watch tomorrow (0-3 forward callouts)
 */

import type { FaffSeed } from '../types';

type Brief = NonNullable<FaffSeed['readinessBrief']>;
type Pillar = Brief['pillars'][number];

const BAND_COLOR: Record<Brief['band'], string> = {
  sharp:       '#3EBD41',
  ready:       '#48B3B5',
  moderate:    '#FFCE8A',
  'pull-back': '#FC4D64',
  'no-data':   '#8A90A0',
};

const BAND_BG: Record<Brief['band'], string> = {
  sharp:       'rgba(62,189,65,0.10)',
  ready:       'rgba(72,179,181,0.10)',
  moderate:    'rgba(255,206,138,0.10)',
  'pull-back': 'rgba(252,77,100,0.10)',
  'no-data':   'rgba(138,144,160,0.10)',
};

export function ReadinessBriefPanel({ brief }: { brief: Brief | null }) {
  if (!brief || brief.band === 'no-data') return null;

  return (
    <section
      aria-label="Morning readiness brief"
      style={{
        marginTop: 12,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: '14px 16px',
      }}
    >
      {/* Eyebrow + band tag */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 8,
      }}>
        <span style={{
          fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
          color: 'var(--mute, #8B95A7)',
        }}>
          MORNING BRIEF
        </span>
        <span style={{
          fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 999,
          background: BAND_BG[brief.band],
          color: BAND_COLOR[brief.band],
          border: `1px solid ${BAND_COLOR[brief.band]}55`,
        }}>
          {brief.label}
        </span>
      </div>

      {/* Headline + one-line mover */}
      <div style={{
        fontSize: 16, lineHeight: 1.4, fontWeight: 600,
        color: 'var(--ink, #fff)', marginBottom: brief.oneLineMover ? 4 : 10,
      }}>
        {brief.headline}
      </div>
      {brief.oneLineMover ? (
        <div style={{
          fontSize: 12, lineHeight: 1.4,
          color: 'var(--mute, #8B95A7)', marginBottom: 14,
        }}>
          {brief.oneLineMover}
        </div>
      ) : null}

      {/* 14-day sparkline */}
      {brief.scoreTrend.length > 1 ? (
        <ScoreSparkline trend={brief.scoreTrend} accent={BAND_COLOR[brief.band]} />
      ) : null}

      {/* Pillar grid · 5 tiles */}
      {brief.pillars.length > 0 ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          marginTop: 14,
        }}>
          {brief.pillars.map((p) => <PillarTile key={p.key} pillar={p} />)}
        </div>
      ) : null}

      {/* Streaks · the persistence story */}
      {brief.streaks.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
            color: 'var(--mute, #8B95A7)', marginBottom: 6,
          }}>
            STREAKS
          </div>
          {brief.streaks.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 0',
              fontSize: 12, color: 'var(--ink, #fff)',
            }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8,
                borderRadius: 999,
                background: s.direction === 'below' ? '#FC4D64' : '#3EBD41',
                flexShrink: 0,
              }} />
              <span>
                <b>{s.pillar.toUpperCase()}</b>
                <span style={{ color: 'var(--mute, #8B95A7)' }}> · {s.days} days {s.direction} baseline · </span>
                {s.meaning}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Movers · biggest day-vs-day deltas */}
      {brief.movers.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
            color: 'var(--mute, #8B95A7)', marginBottom: 6,
          }}>
            MOVERS VS YESTERDAY
          </div>
          {brief.movers.map((m, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 0',
              fontSize: 12, color: 'var(--ink, #fff)',
            }}>
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: m.deltaPts >= 0 ? '#3EBD41' : '#FC4D64',
                minWidth: 36,
                textAlign: 'right',
              }}>
                {m.deltaPts >= 0 ? '+' : ''}{m.deltaPts}
              </span>
              <span style={{ color: 'var(--mute, #8B95A7)' }}>{m.pillar.toUpperCase()}</span>
              <span>· {m.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Watch tomorrow · forward callouts (0-3) */}
      {brief.watchTomorrow.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
            color: 'var(--mute, #8B95A7)', marginBottom: 6,
          }}>
            WATCH TOMORROW
          </div>
          {brief.watchTomorrow.map((line, i) => (
            <div key={i} style={{
              fontSize: 12, lineHeight: 1.4,
              color: 'var(--ink, #fff)',
              padding: '4px 0',
            }}>
              · {line}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PillarTile({ pillar }: { pillar: Pillar }) {
  const bandColor = BAND_COLOR[pillar.band];
  return (
    <div
      title={pillar.meaning}
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: `1px solid ${bandColor}33`,
        borderLeft: `3px solid ${bandColor}`,
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 6,
      }}>
        <span style={{
          fontSize: 9, letterSpacing: '1.4px', fontWeight: 700,
          color: bandColor,
        }}>
          {pillar.label.toUpperCase()}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700,
          color: 'var(--mute, #8B95A7)',
        }}>
          {Math.round(pillar.weightPct)}%
        </span>
      </div>
      <div style={{
        fontFamily: 'var(--f-display, "Oswald", Inter, sans-serif)',
        fontSize: 22, fontWeight: 600, lineHeight: 1.1,
        color: 'var(--ink, #fff)',
        marginTop: 4,
      }}>
        {pillar.observedValue}
      </div>
      {pillar.observedSub ? (
        <div style={{
          fontSize: 11, color: 'var(--mute, #8B95A7)',
          marginTop: 2,
        }}>
          {pillar.observedSub}
        </div>
      ) : null}
      {pillar.baseline ? (
        <div style={{
          fontSize: 10, color: 'var(--mute, #8B95A7)',
          marginTop: 6,
          opacity: 0.85,
        }}>
          baseline · {pillar.baseline}
        </div>
      ) : null}
    </div>
  );
}

function ScoreSparkline({
  trend, accent,
}: {
  trend: Brief['scoreTrend'];
  accent: string;
}) {
  if (trend.length < 2) return null;
  const width = 280;
  const height = 36;
  const padX = 2;
  const minS = Math.min(...trend.map((p) => p.score));
  const maxS = Math.max(...trend.map((p) => p.score));
  const span = Math.max(1, maxS - minS);
  const points = trend.map((p, i) => {
    const x = padX + (i / (trend.length - 1)) * (width - padX * 2);
    const y = height - ((p.score - minS) / span) * (height - 4) - 2;
    return [x, y] as const;
  });
  const linePath = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  const lastIdx = points.length - 1;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      marginTop: 4,
    }}>
      <span style={{
        fontSize: 10, color: 'var(--mute, #8B95A7)',
        letterSpacing: '1px', fontWeight: 700,
      }}>
        14D
      </span>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <path d={areaPath} fill={accent} opacity="0.14" />
        <path d={linePath} fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={points[lastIdx][0]} cy={points[lastIdx][1]} r="2.4" fill={accent} />
      </svg>
    </div>
  );
}
