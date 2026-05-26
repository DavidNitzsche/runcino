/**
 * Phase strip — compact two-row band showing all phases with current ringed,
 * plus a stats row underneath (total weeks, current week, days to race,
 * peak volume). Mirrors §3 deck spec for TRAINING.
 *
 * Row 1: phase pills (BASE · BUILD · PEAK · TAPER · RACE)
 * Row 2: "13 WEEKS · BUILDING TO {race}" left, "83D LEFT" right
 *
 * Total height stays under 80px so it doesn't dominate the viewport.
 */
import type { PlanPhase } from '@/lib/coach/training-state';

const PHASE_ORDER = ['BASE', 'BUILD', 'PEAK', 'TAPER', 'RACE'] as const;

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
      {/* Row 1: secondary info — total weeks · building to RACE / days left */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700,
        letterSpacing: '1.6px', textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        <span style={{ color: 'var(--mute)' }}>
          {totalWeeks ? `${totalWeeks} WEEKS` : ''}
          {raceName ? <> · <span style={{ color: 'rgba(246,247,248,0.75)' }}>BUILDING TO {raceName}</span></> : null}
        </span>
        <span style={{ color: daysToRace != null && daysToRace <= 14 ? 'var(--race)' : 'var(--mute)' }}>
          {daysToRace != null ? `${daysToRace}D LEFT` : ''}
        </span>
      </div>

      {/* Row 2: phase pills (width-proportional) */}
      <div style={{
        display: 'flex', gap: 4,
        background: 'rgba(255,255,255,0.02)',
        borderRadius: 10, padding: 4,
      }}>
        {PHASE_ORDER.map((label, i) => {
          const phase = byLabel.get(label);
          const isCurrent = label === current;
          const isPast = current
            ? PHASE_ORDER.indexOf(label) < PHASE_ORDER.indexOf(current as typeof PHASE_ORDER[number])
            : false;
          const isTaper = label === 'TAPER';
          const isRace  = label === 'RACE';

          const accent = isTaper ? 'var(--learn)'
            : isRace  ? 'var(--race)'
            : label === 'BUILD' ? 'var(--goal)'
            : label === 'PEAK'  ? 'var(--over)'
            :                     'var(--dist)'; // BASE

          const weeks = phase ? phase.endWeekIdx - phase.startWeekIdx + 1 : 0;
          const weekInPhase = isCurrent && phase && currentWeekIdx != null
            ? currentWeekIdx - phase.startWeekIdx + 1
            : null;

          // Visual:
          //   - current → solid accent bg, dark ink
          //   - past    → muted accent w/ strikethrough effect (dim line through)
          //   - future  → faint accent border, dim label
          const bg = isCurrent
            ? accent
            : isPast
            ? 'rgba(255,255,255,0.025)'
            : `${rgbaOf(accent)}10`; // very faint tint of accent
          const borderColor = isCurrent
            ? accent
            : isPast
            ? 'rgba(255,255,255,0.06)'
            : `${rgbaOf(accent)}30`;
          const fg = isCurrent
            ? darkInkFor(accent)
            : isPast
            ? 'var(--dim)'
            : accent;

          return (
            <div key={label} style={{
              flex: segWidths[i] / totalSegWeight,
              padding: '8px 10px',
              borderRadius: 7,
              background: bg,
              border: `1px solid ${borderColor}`,
              minHeight: 46,
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              <div style={{
                fontFamily: 'var(--f-display)', fontSize: 12, color: fg,
                letterSpacing: '1.4px', lineHeight: 1, fontWeight: 600,
              }}>
                {label}
              </div>
              <div style={{
                fontFamily: 'var(--f-body)', fontSize: 9.5, letterSpacing: '0.5px',
                color: isCurrent ? darkInkFor(accent) : 'var(--dim)',
                marginTop: 4, lineHeight: 1, opacity: isCurrent ? 0.78 : 1,
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

// Helpers ---------------------------------------------------------------

// Map CSS var color → rgba prefix so we can build "var(--green)10" → "rgba(62,189,65,0.06)"
// fallback. Inline so we don't lift design tokens out of CSS just for this.
function rgbaOf(cssVar: string): string {
  const palette: Record<string, string> = {
    'var(--dist)':  'rgba(39,180,224,',  // BASE blue
    'var(--goal)':  'rgba(243,173,56,',  // BUILD amber
    'var(--over)':  'rgba(252,77,100,',  // PEAK red
    'var(--learn)': 'rgba(176,132,255,', // TAPER purple
    'var(--race)':  'rgba(255,136,71,',  // RACE orange
  };
  return palette[cssVar] ?? 'rgba(255,255,255,';
}

// Choose a dark ink color that reads well on the bright accent background.
function darkInkFor(cssVar: string): string {
  // All our accents are saturated mid-tones; #0e1014 reads cleanly on each.
  return cssVar === 'var(--learn)' ? '#1a0f33' : '#0e1014';
}
