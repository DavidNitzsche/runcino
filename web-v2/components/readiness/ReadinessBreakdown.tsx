/**
 * ReadinessBreakdown — §8.3 surface. Same component on /today chip
 * tap-through AND on /health as a permanent section.
 *
 * #155 redesign — table → story rows.
 *
 * Old: 3-column table (INPUT · YOUR VALUE · EFFECT). Spreadsheet feel.
 *   - INPUT column dimmest in row (should be loudest)
 *   - VALUE column stacked three competing pieces (number / delta / sentence)
 *   - EFFECT pill isolated on right — couldn't scan top-down
 *
 * New: 5 vertical story rows, each one self-contained:
 *   - 3px accent strip on the LEFT colored by effect (red drag / green lift / grey neutral)
 *   - eyebrow with input name + weight share ("SLEEP · 25%")
 *   - headline ("6.7h — about 6h short for the week")
 *   - narrative sentence (the actual insight, large + bright)
 *   - +/- chip in the top-right corner as secondary precision
 *
 * Scan the left edge → see the shape of why the readiness number is what
 * it is. Read each row → understand each input in plain English.
 */
import type { ReadinessBreakdown as RB, ReadinessInput } from '@/lib/coach/readiness';

export function ReadinessBreakdownView({ breakdown, compact = false }: { breakdown: RB; compact?: boolean }) {
  const color = breakdown.band === 'sharp'      ? 'var(--green)'
    : breakdown.band === 'ready'     ? 'var(--green)'
    : breakdown.band === 'moderate'  ? 'var(--goal)'
                                     : 'var(--over)';

  return (
    <div>
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 56, color, lineHeight: 1, letterSpacing: '0.5px' }}>
            {breakdown.score}
          </span>
          <span style={{ fontFamily: 'var(--f-label)', fontSize: 16, color, letterSpacing: '1.4px' }}>
            {breakdown.label}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {breakdown.inputs.map((inp) => <StoryRow key={inp.key} input={inp} />)}
      </div>
    </div>
  );
}

function StoryRow({ input }: { input: ReadinessInput }) {
  // Accent strip colors by effect — scan vertically to see the shape.
  const stripColor = input.weight > 0 ? 'var(--green)'
    : input.weight < 0 ? 'var(--over)'
                       : 'rgba(255,255,255,0.08)';
  const chipBg = input.weight > 0 ? 'rgba(62,189,65,0.16)'
    : input.weight < 0 ? 'rgba(252,77,100,0.16)'
                       : 'rgba(255,255,255,0.08)';
  const chipColor = input.weight > 0 ? 'var(--green)'
    : input.weight < 0 ? 'var(--over)'
                       : 'var(--mute)';

  // Label may be "SLEEP · 25%" — split for cleaner formatting.
  const [labelPart, sharePart] = input.label.split(' · ');

  // Decide what the headline is. Prefer the rich "value — sub" pattern when
  // both pieces exist; otherwise the observed value is the headline.
  const headline = input.observedSub
    ? `${input.observedV} — ${input.observedSub.replace(/^[+-]?[\d.]+\s*\w+\s*/, '')}`.trim()
    : String(input.observedV);

  return (
    <div style={{
      display: 'flex',
      background: 'rgba(255,255,255,0.025)',
      borderRadius: 10,
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      {/* Left accent strip */}
      <div style={{
        width: 4, background: stripColor, flexShrink: 0,
      }} />

      {/* Content */}
      <div style={{
        flex: 1, minWidth: 0,
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {/* Eyebrow: input name + weight share */}
        <div style={{
          fontFamily: 'var(--f-label)', fontSize: 10, fontWeight: 700,
          letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--mute)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>
            {labelPart}
            {sharePart && (
              <span style={{ marginLeft: 8, color: 'var(--dim)' }}>· {sharePart}</span>
            )}
          </span>
          {/* Effect chip */}
          <span style={{
            background: chipBg, color: chipColor,
            padding: '3px 10px', borderRadius: 999,
            fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '0.8px', fontWeight: 700,
          }}>
            {input.weight > 0 ? `+${input.weight}` : input.weight === 0 ? '0' : input.weight}
          </span>
        </div>

        {/* Headline: value + delta in one line */}
        <div style={{
          fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600,
          color: 'var(--ink)', lineHeight: 1.3,
        }}>
          {headline}
        </div>

        {/* Narrative — the actual insight, the largest typographic element */}
        {input.meaning && (
          <div style={{
            fontFamily: 'var(--f-body)', fontSize: 14,
            color: 'rgba(246,247,248,0.85)', lineHeight: 1.5,
            marginTop: 2,
          }}>
            {input.meaning}
          </div>
        )}
      </div>
    </div>
  );
}
