/**
 * Phase strip — segmented bar showing all 5 phases with current ringed.
 * Mirrors the §3 deck spec for TRAINING.
 */
import type { PlanPhase } from '@/lib/coach/training-state';

const PHASE_ORDER = ['BASE', 'BUILD', 'PEAK', 'TAPER', 'RACE'] as const;

export function PhaseStrip({ phases, currentPhase }: { phases: PlanPhase[]; currentPhase: string | null }) {
  // Always render 5 segments. If a phase isn't in the plan, render it dim/empty.
  const byLabel = new Map(phases.map((p) => [p.label.toUpperCase(), p]));
  const current = currentPhase?.toUpperCase();

  return (
    <div style={{
      display: 'flex', gap: 6, marginBottom: 22,
      background: 'rgba(255,255,255,0.02)',
      borderRadius: 12, padding: 10,
    }}>
      {PHASE_ORDER.map((label) => {
        const phase = byLabel.get(label);
        const isCurrent = label === current;
        const isPast = current
          ? PHASE_ORDER.indexOf(label) < PHASE_ORDER.indexOf(current as typeof PHASE_ORDER[number])
          : false;
        const isTaper = label === 'TAPER';
        const isRace  = label === 'RACE';
        const tintBg = isCurrent
          ? (isTaper ? 'rgba(243,173,56,0.10)'
            : isRace ? 'rgba(255,136,71,0.10)'
            : 'rgba(62,189,65,0.10)')
          : 'transparent';
        const tintBorder = isCurrent
          ? (isTaper ? 'rgba(243,173,56,0.35)'
            : isRace ? 'rgba(255,136,71,0.35)'
            : 'rgba(62,189,65,0.35)')
          : 'transparent';
        const labelColor = isCurrent
          ? (isTaper ? 'var(--goal)'
            : isRace ? 'var(--race)'
            : 'var(--green)')
          : isPast ? 'var(--dim)'
                   : 'var(--mute)';
        return (
          <div key={label} style={{
            flex: 1, padding: '12px 14px', borderRadius: 8,
            background: tintBg,
            border: `1px solid ${tintBorder}`,
            textDecoration: isPast ? 'line-through' : 'none',
          }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 14, color: labelColor, letterSpacing: '1.6px' }}>
              {label}
            </div>
            {phase && (
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--dim)', letterSpacing: '0.5px', marginTop: 2, textTransform: 'uppercase' }}>
                WK {phase.startWeekIdx}-{phase.endWeekIdx}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
