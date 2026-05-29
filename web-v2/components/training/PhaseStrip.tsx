/**
 * Phase strip — compact two-row band showing all phases with current ringed,
 * plus a stats row underneath (total weeks, current week, days to race,
 * peak volume). Mirrors §3 deck spec for TRAINING.
 *
 * Row 1: phase pills (BASE · BUILD · PEAK · TAPER · RACE) — every pill is
 *        filled with its phase accent (matching the volume-arc bars below),
 *        current phase is ringed. Pill widths are proportional to week count
 *        so the BASE→BUILD→PEAK→TAPER→RACE color transitions line up with
 *        where bar colors change in the volume arc directly underneath.
 * Row 2: "13 WEEKS · BUILDING TO {race}" left, "83D LEFT" right
 *
 * The inner pill row is inset 24px left/right to match the volume-arc card's
 * internal padding — keeps the phase boundaries pixel-aligned with the bar
 * grid below, so you can read the strip + arc as one coordinated widget.
 */
import type { PlanPhase } from '@/lib/coach/training-state';

const PHASE_ORDER = ['BASE', 'BUILD', 'PEAK', 'TAPER', 'RACE'] as const;

// Pill fills — matched to PlanArc's PHASE_FILL palette so the top strip
// and the bars below read as one continuous color story. Slightly higher
// opacity than the bars because the pills are smaller and need to read.
const PHASE_FILL: Record<string, string> = {
  BASE:  'rgba(39,180,224,0.55)',
  BUILD: 'rgba(243,173,56,0.55)',
  PEAK:  'rgba(252,77,100,0.55)',
  TAPER: 'rgba(176,132,255,0.60)',
  RACE:  'rgba(255,136,71,0.85)',
};

export function PhaseStrip({
  phases, currentPhase, totalWeeks, currentWeekIdx,
  raceName, daysToRace, peakMi,
}: {
  phases: PlanPhase[];
  currentPhase: string | null;
  totalWeeks?: number;
  currentWeekIdx?: number | null;
  raceName?: string | null;
  daysToRace?: number | null;
  peakMi?: number | null;
}) {
  const byLabel = new Map(phases.map((p) => [p.label.toUpperCase(), p]));
  const current = currentPhase?.toUpperCase();

  // Width-proportional segments so a 4-week BASE looks bigger than a 1-week RACE.
  const segWidths = PHASE_ORDER.map((label) => {
    const phase = byLabel.get(label);
    if (!phase) return 1; // placeholder, rendered dim
    return Math.max(1, phase.endWeekIdx - phase.startWeekIdx + 1);
  });
  const totalSegWeight = segWidths.reduce((s, w) => s + w, 0);

  return (
    <div style={{ marginBottom: 18 }}>
      {/* Row 1: secondary info — total weeks · building to RACE / days left.
          Inset to match the volume-arc card padding so the labels and the
          phase pills sit over the same horizontal extent as the bars below. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700,
        letterSpacing: '1.6px', textTransform: 'uppercase',
        marginBottom: 8,
        padding: '0 24px',
      }}>
        <span style={{ color: 'var(--mute)' }}>
          {totalWeeks ? `${totalWeeks} WEEKS` : ''}
          {raceName ? <> · <span style={{ color: 'var(--mute)' }}>BUILDING TO {raceName}</span></> : null}
        </span>
        <span style={{ color: daysToRace != null && daysToRace <= 14 ? 'var(--race)' : 'var(--mute)' }}>
          {daysToRace != null ? `${daysToRace}D LEFT` : ''}
        </span>
      </div>

      {/* Row 2: phase pills — width-proportional to phase week counts so
          the segment boundaries line up with where bar colors change in the
          volume-arc grid below. Every phase is filled with its accent (not
          just current) so the runner sees the full BASE→BUILD→PEAK→TAPER→
          RACE color story at a glance. Inset 24px to match volume-arc
          card padding. */}
      <div style={{
        display: 'flex', gap: 4,
        background: 'var(--card-2)',
        borderRadius: 10, padding: '4px 24px',
      }}>
        {PHASE_ORDER.map((label, i) => {
          const phase = byLabel.get(label);
          const isCurrent = label === current;
          const isPast = current
            ? PHASE_ORDER.indexOf(label) < PHASE_ORDER.indexOf(current as typeof PHASE_ORDER[number])
            : false;

          const weeks = phase ? phase.endWeekIdx - phase.startWeekIdx + 1 : 0;
          const weekInPhase = isCurrent && phase && currentWeekIdx != null
            ? currentWeekIdx - phase.startWeekIdx + 1
            : null;

          // Fill: every phase gets its accent color (matches the volume-arc
          // bars below). Past phases dim slightly to read as "done"; current
          // gets a light outline + tighter ink. Future phases sit at the
          // standard fill — same as the future bars in the arc below.
          const fill = PHASE_FILL[label] ?? PHASE_FILL.BASE;
          const opacity = isPast ? 0.45 : 1;
          // Ink color reads cleanly on every accent — they're all saturated
          // mid-tones. Taper's purple needs a slightly different ink.
          const ink = label === 'TAPER' ? '#1a0f33' : '#0e1014';

          return (
            <div key={label} style={{
              flex: segWidths[i] / totalSegWeight,
              padding: '8px 10px',
              borderRadius: 7,
              background: fill,
              opacity,
              outline: isCurrent ? '2px solid var(--ink)' : 'none',
              outlineOffset: isCurrent ? '-1px' : undefined,
              minHeight: 46,
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              <div style={{
                fontFamily: 'var(--f-label)', fontSize: 12, color: ink,
                letterSpacing: '1.4px', lineHeight: 1, fontWeight: 700,
              }}>
                {label}
              </div>
              <div style={{
                fontFamily: 'var(--f-body)', fontSize: 9.5, letterSpacing: '0.5px',
                color: ink, opacity: 0.78,
                marginTop: 4, lineHeight: 1, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {weeks > 0 ? `${weeks} WK` : '—'}
                {weekInPhase != null && weeks > 0 ? ` · ${weekInPhase}/${weeks}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

