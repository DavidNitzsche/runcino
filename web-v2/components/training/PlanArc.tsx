/**
 * Plan arc — volume curve from week 1 → race day, phase-colored.
 * Current week is outlined; mileage tags above bars.
 */
import type { PlanWeek } from '@/lib/coach/training-state';

// Phase palette is shared with PhaseStrip — same colors top to bottom so the
// pills above and the bars below read as one plan, not two coincidentally-
// stacked widgets.
//   BASE  = var(--dist)  cyan-blue
//   BUILD = var(--goal)  amber
//   PEAK  = var(--over)  red
//   TAPER = var(--learn) purple
//   RACE  = var(--race)  orange
const PHASE_FILL: Record<string, string> = {
  BASE:           'rgba(39,180,224,0.55)',
  BUILD:          'rgba(243,173,56,0.55)',
  'RACE-SPECIFIC':'rgba(243,173,56,0.55)', // legacy generator phase label, treat as BUILD-ish
  PEAK:           'rgba(252,77,100,0.55)',
  TAPER:          'rgba(176,132,255,0.60)',
  RACE:           'rgba(255,136,71,0.85)',
};

export function PlanArc({
  weeks, raceName, raceDate, raceGoal,
}: {
  weeks: PlanWeek[];
  raceName?: string | null;
  raceDate?: string | null;
  raceGoal?: string | null;
}) {
  if (weeks.length === 0) return null;
  const maxMi = Math.max(...weeks.map((w) => w.plannedMi), 1);

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16,
      padding: '22px 24px', marginBottom: 18,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.5px' }}>VOLUME ARC · NOW → RACE DAY</div>
        {raceName && (
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--race)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>
            {raceName}{raceDate ? ` · ${raceDate}` : ''}{raceGoal ? ` · GOAL ${raceGoal}` : ''}
          </div>
        )}
      </div>

      <div style={{
        display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', gap: 4,
        height: 80, alignItems: 'end',
      }}>
        {weeks.map((w) => {
          const heightPct = Math.max(4, (w.plannedMi / maxMi) * 100);
          const fill = PHASE_FILL[w.phase.toUpperCase()] ?? PHASE_FILL.BASE;
          return (
            <div key={w.idx} style={{
              background: fill, borderRadius: '4px 4px 0 0',
              height: `${heightPct}%`, position: 'relative',
              outline: w.isCurrent ? '2px solid var(--ink)' : 'none',
              outlineOffset: w.isCurrent ? '-1px' : undefined,
            }}>
              {w.isCurrent && (
                <span style={{
                  position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                  fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)', marginBottom: 3, whiteSpace: 'nowrap',
                }}>
                  {w.plannedMi}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{
        display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', gap: 4,
        marginTop: 6,
        fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--dim)', letterSpacing: '0.5px',
        textAlign: 'center',
      }}>
        {weeks.map((w) => (
          <span key={w.idx}>W{w.idx}</span>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 18, marginTop: 14,
        fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)',
        letterSpacing: '1.2px', textTransform: 'uppercase',
      }}>
        {(['BASE','BUILD','PEAK','TAPER','RACE'] as const).map((p) => (
          <span key={p}>
            <span style={{
              display: 'inline-block', width: 10, height: 10, borderRadius: 2,
              background: PHASE_FILL[p], marginRight: 6, verticalAlign: 'middle',
            }} />
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}
