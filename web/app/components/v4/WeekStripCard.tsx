'use client';

/**
 * v4 week strip card — the bottom-most surface on /overview.
 *
 * Header row:                                           [View Full Schedule →]
 *   [THIS WEEK]   15.3 / 38.5 mi · 3 / 6 workouts · +0.9 over plan
 *   [Base Week 3]
 *   [progress bar — 40% green fill]
 *
 * Day grid: 7 equal columns Mon → Sun.
 *   Each column shows: day name, date, workout name, distance,
 *   status pill ("Done" / "Today" / planned / "—" for rest).
 *
 * The today column gets an amber top border + amber-wash background.
 */

import type { ReactNode } from 'react';

export type DayStatus = 'done' | 'today' | 'planned' | 'rest';

export interface WeekDay {
  /** Day-of-week label (Mon / Tue / …). */
  dow: string;
  /** Day-of-month, e.g. "15". */
  dateNum: string;
  /** Workout name (e.g. "Easy Run", "Tempo", "Long Run", "Rest"). */
  workoutName: string;
  /** Distance display ("5.5 mi"). Empty string when rest day. */
  distance: string;
  status: DayStatus;
  /** True when this day also has a strength session scheduled. Shown
   *  as a small 💪 marker in the corner of the day cell. */
  hasStrength?: boolean;
}

export interface WeekStripCardProps {
  /** Eyebrow above the title (e.g. "This Week"). */
  eyebrow: string;
  /** Bold title (e.g. "Base Week 3"). */
  title: string;
  /** Logged miles vs planned. Pass null when no plan. */
  loggedMi: number | null;
  plannedMi: number | null;
  /** Workouts completed / planned. */
  loggedWorkouts: number | null;
  totalWorkouts: number | null;
  /** Plan-vs-actual delta line (e.g. "+0.9 over plan", "On plan",
   *  "-1.2 under"). Empty string suppresses. */
  deltaLabel: string;
  deltaTone: 'green' | 'amber' | 'warn' | 'dim';
  /** Progress 0..100. */
  progressPct: number;
  /** The 7-day strip. Must have exactly 7 entries Mon → Sun. */
  days: WeekDay[];
  /** Click handler for the "View Full Schedule →" link. */
  onViewFullSchedule?: () => void;
}

export function WeekStripCard(props: WeekStripCardProps) {
  const {
    eyebrow,
    title,
    loggedMi,
    plannedMi,
    loggedWorkouts,
    totalWorkouts,
    deltaLabel,
    deltaTone,
    progressPct,
    days,
    onViewFullSchedule,
  } = props;

  return (
    <div
      style={{
        background: 'var(--surface, #FFFFFF)',
        borderRadius: '16px',
        boxShadow: '0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04)',
        marginTop: '16px',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '28px 40px 20px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '40px',
            marginBottom: '14px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '2px',
                color: 'rgba(13,15,18,.35)',
                textTransform: 'uppercase',
              }}
            >
              {eyebrow}
            </span>
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontWeight: 700,
                fontSize: '15px',
                color: 'var(--ink, #0D0F12)',
              }}
            >
              {title}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
            <Stat>
              {loggedMi != null && plannedMi != null ? (
                <>
                  <strong>{loggedMi.toFixed(1)}</strong> / {plannedMi.toFixed(1)} mi
                </>
              ) : (
                <span style={{ color: 'rgba(13,15,18,.35)' }}>—</span>
              )}
            </Stat>
            <Dot />
            <Stat>
              {loggedWorkouts != null && totalWorkouts != null ? (
                <>
                  {loggedWorkouts} / {totalWorkouts} workouts
                </>
              ) : (
                <span style={{ color: 'rgba(13,15,18,.35)' }}>—</span>
              )}
            </Stat>
            {deltaLabel && (
              <>
                <Dot />
                <Stat tone={deltaTone}>{deltaLabel}</Stat>
              </>
            )}
          </div>

          {onViewFullSchedule && (
            <span
              onClick={onViewFullSchedule}
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: '12px',
                fontWeight: 600,
                letterSpacing: '1px',
                color: 'var(--recovery, #2CA82F)',
                textTransform: 'uppercase',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              View Full Schedule →
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div
          style={{
            width: '100%',
            height: '5px',
            background: 'rgba(13,15,18,.08)',
            borderRadius: '3px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.max(0, Math.min(100, progressPct))}%`,
              background: 'var(--recovery, #2CA82F)',
              borderRadius: '3px',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {days.slice(0, 7).map((d, i) => (
          <DayColumn key={`${d.dow}-${i}`} day={d} isFirst={i === 0} isLast={i === 6} />
        ))}
      </div>
    </div>
  );
}

function Stat({ children, tone }: { children: ReactNode; tone?: 'green' | 'amber' | 'warn' | 'dim' }) {
  const color =
    tone === 'green' ? 'var(--recovery, #2CA82F)' :
    tone === 'amber' ? 'var(--milestone, #D4900A)' :
    tone === 'warn'  ? 'var(--warn, #F43F5E)' :
    tone === 'dim'   ? 'rgba(13,15,18,.35)' :
    'rgba(13,15,18,.55)';
  return (
    <span
      style={{
        fontFamily: 'Inter, sans-serif',
        fontSize: '13px',
        color,
        fontWeight: tone === 'green' || tone === 'amber' ? 600 : 400,
      }}
    >
      {children}
    </span>
  );
}

function Dot() {
  return <span style={{ fontSize: '13px', color: 'rgba(13,15,18,.35)' }}>·</span>;
}

function DayColumn({
  day,
  isFirst,
  isLast,
}: {
  day: WeekDay;
  isFirst: boolean;
  isLast: boolean;
}) {
  const isToday = day.status === 'today';
  return (
    <div
      style={{
        padding: '24px',
        paddingLeft: isFirst ? '40px' : '24px',
        paddingRight: isLast ? '40px' : '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        background: isToday ? 'rgba(232,93,38,.04)' : 'transparent',
        borderTop: isToday ? '2px solid var(--milestone, #D4900A)' : 'none',
        position: 'relative',
      }}
    >
      {day.hasStrength && (
        <span
          title="Strength training scheduled"
          style={{
            position: 'absolute',
            top: '8px',
            right: '10px',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: 'rgba(212,144,10,.14)',
            color: 'var(--milestone, #D4900A)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="2.5" cy="7" r="2" />
            <rect x="4.5" y="6.25" width="5" height="1.5" rx="0.4" />
            <circle cx="11.5" cy="7" r="2" />
          </svg>
        </span>
      )}
      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: '12px',
          letterSpacing: '1.5px',
          color: 'rgba(13,15,18,.35)',
          textTransform: 'uppercase',
        }}
      >
        {day.dow}
      </div>
      <div
        style={{
          fontFamily: 'Bebas Neue, sans-serif',
          fontSize: '28px',
          lineHeight: 1,
          color: isToday ? 'var(--milestone, #D4900A)' : 'var(--ink, #0D0F12)',
        }}
      >
        {day.dateNum}
      </div>
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontWeight: 600,
          fontSize: '13px',
          letterSpacing: '0.5px',
          color:
            day.status === 'rest' ? 'rgba(13,15,18,.35)' : 'var(--ink, #0D0F12)',
          textTransform: 'uppercase',
          marginTop: '4px',
        }}
      >
        {day.workoutName}
      </div>
      {day.distance ? (
        <div
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '12px',
            color: 'rgba(13,15,18,.55)',
          }}
        >
          {day.distance}
        </div>
      ) : day.status === 'rest' ? (
        <div
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '14px',
            color: 'rgba(13,15,18,.2)',
            marginTop: '4px',
          }}
        >
          —
        </div>
      ) : null}
      {day.status === 'done' && (
        <div
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '12px',
            letterSpacing: '1px',
            color: 'var(--recovery, #2CA82F)',
            textTransform: 'uppercase',
            marginTop: '4px',
          }}
        >
          ✓ Done
        </div>
      )}
      {day.status === 'today' && (
        <div
          style={{
            display: 'inline-block',
            fontFamily: 'Oswald, sans-serif',
            fontWeight: 600,
            fontSize: '12px',
            letterSpacing: '1px',
            color: 'var(--milestone, #D4900A)',
            background: 'rgba(212,144,10,.12)',
            padding: '3px 9px',
            borderRadius: '20px',
            textTransform: 'uppercase',
            marginTop: '4px',
            alignSelf: 'flex-start',
          }}
        >
          Today
        </div>
      )}
    </div>
  );
}
