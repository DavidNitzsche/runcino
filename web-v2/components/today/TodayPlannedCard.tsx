/**
 * TodayPlannedCard — first thing visible on /today, render INSTANTLY from
 * glance state. No LLM, no waiting.
 *
 * CANONICAL RUN-DISPLAY RULES (P15.9):
 *   - Today's COMPLETED run renders here on the left as the small
 *     "DONE · TYPE · X MI" pill. The same data is reachable via the
 *     SPLITS → trigger which opens the run detail modal.
 *   - There is NO duplicate run card on the right rail of /today. The
 *     run_recap topic is server-side suppressed when today's run is
 *     logged (see engine.ts).
 *   - The run detail modal is the SINGLE place all run details live —
 *     reachable from this card, from any /today week-strip day tile,
 *     and from any row on /log.
 *   - The modal skeleton is always the same: stats hero, secondary
 *     stats, HR time-in-zone, splits, form, route. Missing data is
 *     hidden, never shown as a placeholder card.
 *
 * Variants on this card:
 *   - Ran today              → DONE pill with SPLITS → modal trigger
 *   - Plan workout, not run  → "TODAY · TYPE · X MI" hero
 *   - Rest day               → "REST IS THE WORK TODAY"
 *   - Nothing scheduled      → quiet placeholder
 */
import type { GlanceWeekDay } from '@/lib/coach/glance-state';
import { RunDetailTrigger } from '@/components/runs/RunDetailModal';

export function TodayPlannedCard({ today, weekDays }: {
  today: string;
  weekDays: GlanceWeekDay[];
}) {
  const todayDay = weekDays.find((d) => d.date === today);
  if (!todayDay) return null;

  // Real run = at least 0.5mi (filters out trivial walks / GPS noise).
  // We don't require an activityId — runs from the watch w/o Strava sync
  // still have doneMi set in glance.
  const ran = todayDay.doneMi >= 0.5;
  const isRest = todayDay.plannedType === 'rest' || todayDay.plannedMi === 0;

  // 1. Already ran today — collapse: the right-rail "YOUR RUN COMPLETED"
  // card already shows the recap. Here on the left we just acknowledge
  // it's done and point at the run-detail rather than the planned target.
  if (ran) {
    return (
      <div className="card" style={{
        display: 'block',
        background: 'linear-gradient(135deg, rgba(62,189,65,0.08), rgba(62,189,65,0.02))',
        borderColor: 'rgba(62,189,65,0.28)',
        padding: '18px 22px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            background: 'rgba(62,189,65,0.14)', color: 'var(--green)',
            padding: '3px 9px', borderRadius: 999, fontSize: 9, fontWeight: 800, letterSpacing: '1.2px',
          }}>DONE</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1 }}>
            {labelFor(todayDay.plannedType)} · {todayDay.doneMi.toFixed(1)} MI
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <RunDetailTrigger
              // Use real id if we have it, else synthetic "YYYY-MM-DD-mi.mi"
              // — loadRunDetail resolves both.
              activityId={todayDay.activityId ?? `${todayDay.date}-${todayDay.doneMi.toFixed(2)}`}
              label="TAP FOR DETAILS →"
              style={{ marginTop: 0, fontFamily: 'var(--f-display)', fontSize: 12, color: 'var(--green)', letterSpacing: '1.2px' }}
            />
          </div>
        </div>
      </div>
    );
  }

  // 2. Rest day
  if (isRest) {
    return (
      <div className="card" style={{
        padding: '20px 24px',
        background: 'linear-gradient(135deg, rgba(0,143,236,0.06), rgba(0,143,236,0.02))',
        borderColor: 'rgba(0,143,236,0.22)',
      }}>
        <div className="card-eyebrow" style={{ color: 'var(--rest)' }}>TODAY · REST</div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 32, color: 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1, marginTop: 4 }}>
          Rest is the work today.
        </div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', marginTop: 6 }}>
          Sleep, mobility, recovery. The legs earned it.
        </div>
      </div>
    );
  }

  // 3. Plan for today, not yet run
  return (
    <div className="card" style={{
      padding: '20px 24px',
      background: 'linear-gradient(135deg, rgba(0,143,236,0.06), rgba(0,143,236,0.02))',
      borderColor: 'rgba(0,143,236,0.22)',
    }}>
      <div className="card-eyebrow" style={{ color: 'var(--rest)' }}>TODAY · ON THE CALENDAR</div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto', gap: 18, alignItems: 'center', marginTop: 4,
      }}>
        <div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 32, color: 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1 }}>
            {(todayDay.plannedLabel ?? labelFor(todayDay.plannedType)).toUpperCase()}
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 6, letterSpacing: '0.5px' }}>
            {targetFor(todayDay.plannedType)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, color: 'var(--rest)' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 60, lineHeight: 0.95, letterSpacing: '0.5px' }}>
            {todayDay.plannedMi.toFixed(todayDay.plannedMi % 1 === 0 ? 0 : 1)}
          </span>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>MI</span>
        </div>
      </div>
    </div>
  );
}

function labelFor(t: string): string {
  switch (t) {
    case 'easy': return 'Easy';
    case 'long': return 'Long';
    case 'tempo': return 'Tempo';
    case 'threshold': return 'Threshold';
    case 'intervals': return 'Intervals';
    case 'race': return 'Race';
    case 'rest': return 'Rest';
    default: return t.charAt(0).toUpperCase() + t.slice(1);
  }
}

function targetFor(t: string): string {
  switch (t) {
    case 'easy':       return '9:00 /mi · HR < 140 · conversational';
    case 'long':       return '8:50 /mi · HR < 145 · fuel @45\'';
    case 'threshold':  return '6:48 /mi · cruise intervals';
    case 'tempo':      return '6:35 /mi · sustained';
    case 'intervals':  return '3:45 /K · with float';
    case 'race':       return 'race effort';
    default:           return '';
  }
}
