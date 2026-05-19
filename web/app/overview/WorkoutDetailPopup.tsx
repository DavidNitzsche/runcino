'use client';

/**
 * WorkoutDetailPopup — shared modal for workout detail overlays.
 * Used by the overview week strip and the training month calendar.
 */

export interface WorkoutPopupData {
  dateISO: string;
  type: string;
  subLabel?: string | null;
  distanceMi: number;
  isQuality: boolean;
  isLong: boolean;
  paceTargetSPerMi?: number | null;
  notes?: string;
  mutations?: Array<{ reason: string }>;
}

interface WorkoutDetailPopupProps {
  workout: WorkoutPopupData | null; // null = closed
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  easy: 'Easy Run',
  long: 'Long Run',
  threshold: 'Threshold',
  interval: 'Intervals',
  mp: 'Marathon Pace',
  recovery: 'Recovery',
  shakeout: 'Shakeout',
  race: 'Race',
  rest: 'Rest',
  race_week_tuneup: 'Race Week Tune-Up',
};

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function formatPopupDate(dateISO: string): string {
  const d = new Date(dateISO + 'T12:00:00Z');
  const dow = DOW_SHORT[d.getUTCDay()];
  const mon = MONTH_SHORT[d.getUTCMonth()];
  const day = d.getUTCDate();
  return `${dow} · ${mon} ${day}`;
}

function fmtPace(sPerMi: number): string {
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

function tagColor(wo: WorkoutPopupData): string {
  if (wo.type === 'race') return 'var(--race)';
  if (wo.isQuality) return 'var(--corp)';
  if (wo.isLong) return 'var(--good)';
  return 'var(--t3)';
}

export function WorkoutDetailPopup({ workout, onClose }: WorkoutDetailPopupProps) {
  if (!workout) return null;

  const heading = workout.subLabel || TYPE_LABELS[workout.type] || workout.type;
  const dateLabel = formatPopupDate(workout.dateISO);
  const accentColor = tagColor(workout);
  const showPace = (workout.isQuality || workout.isLong || workout.type === 'race' || workout.type === 'threshold' || workout.type === 'mp') && workout.paceTargetSPerMi != null && workout.paceTargetSPerMi > 0;
  const noteParagraphs = workout.notes ? workout.notes.split(/\n\n+/) : [];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.62)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--l1)',
          border: '1px solid var(--l4)',
          borderTop: `3px solid ${accentColor}`,
          borderRadius: 10,
          maxWidth: 520,
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: '24px 26px',
          position: 'relative',
          boxShadow: '0 24px 80px rgba(0,0,0,.55)',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 14,
            right: 16,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 20,
            color: 'var(--t2)',
            lineHeight: 1,
            padding: '2px 6px',
          }}
        >
          ×
        </button>

        {/* Header */}
        <div style={{ paddingRight: 32 }}>
          <div style={{ fontFamily: 'var(--f-data)', fontSize: 10, letterSpacing: '1.4px', color: accentColor, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
            {dateLabel}
          </div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, fontWeight: 700, color: 'var(--t0)', lineHeight: 1.15 }}>
            {heading}
          </div>
        </div>

        {/* Badges row */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {workout.distanceMi > 0 && (
            <span style={{
              fontFamily: 'var(--f-data)', fontSize: 11, fontWeight: 700,
              color: 'var(--t1)', background: 'var(--l3)', borderRadius: 4,
              padding: '3px 8px', letterSpacing: '0.8px',
            }}>
              {workout.distanceMi.toFixed(1)} MI
            </span>
          )}
          {workout.isQuality && (
            <span style={{
              fontFamily: 'var(--f-data)', fontSize: 11, fontWeight: 700,
              color: 'var(--corp)', background: 'rgba(39,180,224,.12)', borderRadius: 4,
              padding: '3px 8px', letterSpacing: '0.8px',
            }}>
              QUALITY
            </span>
          )}
          {workout.isLong && !workout.isQuality && (
            <span style={{
              fontFamily: 'var(--f-data)', fontSize: 11, fontWeight: 700,
              color: 'var(--good)', background: 'rgba(62,189,65,.12)', borderRadius: 4,
              padding: '3px 8px', letterSpacing: '0.8px',
            }}>
              LONG
            </span>
          )}
          {workout.type === 'race' && (
            <span style={{
              fontFamily: 'var(--f-data)', fontSize: 11, fontWeight: 700,
              color: 'var(--race)', background: 'rgba(212,82,60,.12)', borderRadius: 4,
              padding: '3px 8px', letterSpacing: '0.8px',
            }}>
              RACE
            </span>
          )}
          {showPace && (
            <span style={{
              fontFamily: 'var(--f-data)', fontSize: 11, fontWeight: 700,
              color: 'var(--t1)', background: 'var(--l3)', borderRadius: 4,
              padding: '3px 8px', letterSpacing: '0.8px',
            }}>
              {fmtPace(workout.paceTargetSPerMi!)}
            </span>
          )}
        </div>

        {/* Notes */}
        {noteParagraphs.length > 0 && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--l4)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {noteParagraphs.map((para, i) => (
              <p key={i} style={{ fontFamily: 'var(--f-body)', fontSize: 13.5, color: 'var(--t1)', lineHeight: 1.6, margin: 0 }}>
                {para.trim()}
              </p>
            ))}
          </div>
        )}

        {/* Mutations */}
        {workout.mutations && workout.mutations.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--l4)', paddingTop: 12 }}>
            {workout.mutations.map((m, i) => (
              <div key={i} style={{
                fontFamily: 'var(--f-data)', fontSize: 10.5, fontWeight: 700,
                color: 'var(--coach)', letterSpacing: '0.8px', marginTop: i > 0 ? 6 : 0,
              }}>
                ADJUSTED: {m.reason}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
