/**
 * E2 · Post-race awareness card · /overview
 *
 * "Yesterday: Big Sur Marathon. Today is day N of the reverse-taper
 * recovery window. Here's what your body is doing and what you do."
 *
 * Renders above the hero TodayCard when the user is within the
 * distance-appropriate recovery window from their most recent
 * completed race. Same warm-but-direct voice as the V5 Z2 surface.
 */

import type { PostRaceFinding } from '@/lib/post-race-awareness';
import { fmtDateAgo, fmtTime } from '@/lib/post-race-awareness';

interface Props {
  finding: PostRaceFinding;
}

function stageLabel(stage: PostRaceFinding['stage']): string {
  switch (stage) {
    case 'rest':  return 'Rest';
    case 'light': return 'Light recovery';
    case 'easy':  return 'Easy aerobic';
    default:      return '—';
  }
}

function stageColor(stage: PostRaceFinding['stage']): { accent: string; bg: string; border: string } {
  switch (stage) {
    case 'rest':
      return { accent: '#1E3A5F', bg: 'rgba(30,58,95,.06)', border: 'rgba(30,58,95,.28)' };
    case 'light':
      return { accent: '#2A6F2D', bg: 'rgba(42,111,45,.05)', border: 'rgba(42,111,45,.28)' };
    case 'easy':
      return { accent: '#0D6E8F', bg: 'rgba(13,110,143,.05)', border: 'rgba(13,110,143,.28)' };
    default:
      return { accent: '#080808', bg: 'rgba(8,8,8,.04)', border: 'rgba(8,8,8,.18)' };
  }
}

export function PostRaceCard({ finding }: Props) {
  if (!finding.shouldRender || !finding.race) return null;

  const { race, stage, daysSinceRace, stageBounds, todayGuidance, whatsNext } = finding;
  const colors = stageColor(stage);
  const isRaceDay = daysSinceRace === 0;

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
          display: 'flex',
          gap: 10,
          alignItems: 'baseline',
          flexWrap: 'wrap',
        }}
      >
        <span>{isRaceDay ? 'Race day' : 'Post-race recovery'}</span>
        {!isRaceDay && stageBounds && (
          <>
            <span style={{ color: 'rgba(8,8,8,.45)' }}>·</span>
            <span>Day {daysSinceRace} · {stageLabel(stage)}</span>
            <span style={{ color: 'rgba(8,8,8,.45)', fontWeight: 500 }}>
              · stage ends day {stage === 'rest' ? stageBounds.restEndDay : stage === 'light' ? stageBounds.lightEndDay : stageBounds.easyEndDay}
            </span>
          </>
        )}
      </div>

      {/* Race headline */}
      <div style={{ marginBottom: 10 }}>
        <strong style={{ color: '#080808' }}>{fmtDateAgo(daysSinceRace)}: {race.name}</strong>
        {race.finishS && (
          <span style={{ color: 'rgba(8,8,8,.62)' }}>
            {' '}· {race.distanceMi >= 22 ? 'Marathon' : race.distanceMi >= 11 ? 'Half marathon' : `${race.distanceMi.toFixed(1)} mi`}
            {' '}· finished {fmtTime(race.finishS)}
          </span>
        )}
      </div>

      {/* Today's guidance */}
      <div style={{ marginBottom: 10 }}>
        {todayGuidance}
      </div>

      {/* What's next */}
      {whatsNext && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: 'rgba(8,8,8,.04)',
            borderRadius: 6,
            fontSize: 12,
            color: 'rgba(8,8,8,.72)',
          }}
        >
          <strong style={{ color: '#080808' }}>What's next: </strong>
          {whatsNext}
        </div>
      )}
    </div>
  );
}
