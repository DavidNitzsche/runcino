/**
 * Pre-workout briefing card · V1 · TodayCard
 *
 * Renders the "coach's morning note" on /overview between the
 * pace-guidance helper and the hero action buttons. Three rows max:
 * weather, shoe, last similar session. Skips rows with no data
 * (e.g. no coords from any past activity → no weather row).
 *
 * Voice: coach, not system alert. The L7 / max-HR adaptive banners
 * are alert-shaped (warning eyebrow, urgency framing) because they
 * surface findings that need a decision. This is a daily-touch
 * surface — the runner sees it every morning, so it leans informational.
 *
 * Server component (data prefetched in /overview SSR). No client
 * interactivity required — purely read-only context for the workout.
 */

import type { PreWorkoutBriefing } from '@/lib/pre-workout-briefing';

function fmtPace(s: number): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}/mi`;
}

interface Props {
  briefing: PreWorkoutBriefing;
  /** Today's pace target as already formatted by the caller ("8:18-8:48/mi" etc).
   *  Echoed in the briefing's opening line for context. */
  todayPaceLabel: string;
  /** Today's workout type — used for the opening line's tone ("threshold
   *  session" vs "easy effort"). */
  workoutType: string;
}

function workoutEyebrow(workoutType: string): string {
  switch (workoutType) {
    case 'race':            return 'race day';
    case 'long':            return "today's long run";
    case 'tempo':
    case 'threshold':
    case 'sub_threshold':
    case 'threshold_intervals': return "today's threshold session";
    case 'intervals':       return "today's intervals";
    case 'recovery':
    case 'shakeout':        return "today's recovery";
    case 'easy':
    case 'general_aerobic':
    default:                return "today's easy effort";
  }
}

/** Plain-language temperature commentary. Anchors to the L7 heat
 *  ceiling so the runner sees the same threshold the signal uses. */
function tempCommentary(tempF: number, workoutType: string): string {
  if (tempF > 82) return ` · ${tempF}°F is hot — slow start, hydrate ahead.`;
  if (tempF > 78) {
    if (workoutType === 'threshold' || workoutType === 'tempo' || workoutType === 'intervals') {
      return ` · ${tempF}°F is at the heat ceiling — expect pace to drift; HR is the truer gauge today.`;
    }
    return ` · ${tempF}°F is warm; ease into it.`;
  }
  if (tempF < 35) return ` · ${tempF}°F is cold — warm up indoors first, dress in layers.`;
  if (tempF < 50) return ` · ${tempF}°F is cool — first mile will feel stiff, that's normal.`;
  return ` · ${tempF}°F is good running weather.`;
}

export function PreWorkoutBriefingCard({ briefing, todayPaceLabel, workoutType }: Props) {
  if (!briefing.hasContent) return null;

  const eyebrow = workoutEyebrow(workoutType);

  return (
    <div
      style={{
        marginTop: 12,
        maxWidth: 540,
        padding: '14px 16px',
        background: '#FFFFFF',
        border: '1px solid rgba(13,15,18,.10)',
        borderRadius: 10,
        fontFamily: 'Inter, sans-serif',
        fontSize: 13,
        lineHeight: 1.55,
        color: 'rgba(13,15,18,.78)',
        boxShadow: '0 1px 2px rgba(13,15,18,.02)',
      }}
    >
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontSize: 10,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          color: 'rgba(13,15,18,.55)',
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Briefing · {eyebrow}
      </div>

      {/* Weather */}
      {briefing.weather && (
        <div style={{ marginBottom: 8 }}>
          <strong style={{ color: '#0D0F12' }}>{briefing.weather.label}:</strong>{' '}
          {briefing.weather.shortForecast.toLowerCase()}, {briefing.weather.temperatureF}°F
          {briefing.weather.windMph >= 8 && <>, wind {briefing.weather.windMph} mph</>}
          {tempCommentary(briefing.weather.temperatureF, workoutType)}
        </div>
      )}

      {/* Shoe */}
      {briefing.shoe && (
        <div style={{ marginBottom: 8 }}>
          <strong style={{ color: '#0D0F12' }}>Shoes:</strong>{' '}
          {briefing.shoe.brand} {briefing.shoe.model}
          {briefing.shoe.color && <span style={{ color: 'rgba(13,15,18,.55)' }}> · {briefing.shoe.color}</span>}
          {briefing.shoe.wearPct != null && briefing.shoe.wearPct >= 80 && (
            <span style={{ color: '#b3450a' }}>
              {' '}· {briefing.shoe.wearPct}% of cap ({briefing.shoe.mileage}/{briefing.shoe.mileageCap} mi) — start eyeing a replacement
            </span>
          )}
          {briefing.shoe.wearPct != null && briefing.shoe.wearPct < 80 && briefing.shoe.mileageCap && (
            <span style={{ color: 'rgba(13,15,18,.55)' }}>
              {' '}· {briefing.shoe.mileage}/{briefing.shoe.mileageCap} mi
            </span>
          )}
        </div>
      )}

      {/* Last similar */}
      {briefing.lastSimilar && (
        <div>
          <strong style={{ color: '#0D0F12' }}>Last similar:</strong>{' '}
          {briefing.lastSimilar.ageLabel} — {briefing.lastSimilar.distanceMi} mi @ {fmtPace(briefing.lastSimilar.paceSPerMi)}
          {briefing.lastSimilar.avgHr != null && <>, HR {briefing.lastSimilar.avgHr}</>}
          {todayPaceLabel && (
            <span style={{ color: 'rgba(13,15,18,.55)' }}> · today targets {todayPaceLabel}/mi</span>
          )}
        </div>
      )}
    </div>
  );
}
