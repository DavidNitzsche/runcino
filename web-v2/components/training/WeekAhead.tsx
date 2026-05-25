/**
 * Week-ahead grid — 7 days w/ DOW, miles, type, and bottom-anchored
 * target line (pace + HR/intent). Mirrors deck §3.
 */
import type { PlanWeek } from '@/lib/coach/training-state';

const DOW_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const QUALITY = new Set(['threshold', 'tempo', 'intervals']);

interface Target { pace: string; secondary: string }

function targetFor(type: string, mi: number, label: string | null): Target {
  switch (type) {
    case 'easy':       return { pace: '9:00 /mi', secondary: 'HR < 140' };
    case 'long':       return { pace: '8:50 /mi', secondary: 'HR < 145 · fuel @45\'' };
    case 'threshold':  return { pace: '6:48 /mi', secondary: label ?? 'T pace' };
    case 'tempo':      return { pace: '6:35 /mi', secondary: label ?? 'tempo' };
    case 'intervals':  return { pace: '3:45 /K',   secondary: label ?? 'intervals' };
    case 'race':       return { pace: 'race effort', secondary: label ?? 'race day' };
    case 'rest':       return { pace: 'sleep +1h', secondary: 'recovery day' };
    default:           return { pace: '—', secondary: '' };
  }
}

export function WeekAhead({ week, today }: { week: PlanWeek; today: string }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16,
      padding: '22px 24px',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.5px' }}>WEEK AHEAD</div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--mute)', letterSpacing: '0.5px' }}>
          {week.plannedMi} MI
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, flex: 1 }}>
        {week.days.map((d) => {
          const isToday = d.date === today;
          const isRest = d.type === 'rest' || d.mi === 0;
          const isQuality = QUALITY.has(d.type);
          const isLong = d.type === 'long';
          const isRace = d.type === 'race';
          const tgt = targetFor(d.type, d.mi, d.label);

          const typLabel = isRest ? 'REST'
            : (d.label ? d.label.toUpperCase() : d.type.toUpperCase());

          const dowName = DOW_NAMES[d.dow] ?? '';
          const typColor = isToday ? 'var(--green)'
            : isQuality ? 'var(--goal)'
            : isLong    ? 'var(--dist)'
            : isRace    ? 'var(--race)'
                        : 'var(--mute)';

          return (
            <div key={d.date} style={{
              background: isToday ? 'rgba(62,189,65,0.10)' : 'rgba(255,255,255,0.025)',
              border: isToday ? '1px solid rgba(62,189,65,0.30)' : '1px solid transparent',
              borderRadius: 10, padding: '14px 11px',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: isToday ? 'var(--green)' : 'var(--mute)', letterSpacing: '1.4px' }}>
                {dowName}
              </div>
              <div style={{ fontFamily: 'var(--f-display)', fontSize: 26, color: isRest ? 'var(--dim)' : 'var(--ink)', lineHeight: 1, marginTop: 4 }}>
                {isRest ? '—' : d.mi.toFixed(d.mi % 1 === 0 ? 0 : 1)}
              </div>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: typColor, letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 4 }}>
                {typLabel}{isToday ? ' · TODAY' : ''}
              </div>
              {/* Bottom-anchored target line */}
              <div style={{
                marginTop: 'auto', paddingTop: 12,
                borderTop: '1px solid var(--line-2)',
                fontFamily: 'var(--f-body)', fontSize: 11, color: isRest ? 'var(--dim)' : 'var(--ink)',
                fontWeight: 600, letterSpacing: '0.3px', lineHeight: 1.4,
              }}>
                {tgt.pace}
                <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: 'var(--mute)', letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 3 }}>
                  {tgt.secondary}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
