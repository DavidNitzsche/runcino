/**
 * ReadinessBreakdown — §8.3 surface. Same component on /today chip
 * tap-through AND on /health as a permanent section.
 *
 * Redesigned: each input row is a 3-column tile (LABEL · VALUE · WEIGHT-CHIP).
 * Weight chip clearly distinguishes "this input's contribution" from "the
 * observed value" — earlier version had both numbers fighting for the same
 * column position which was hard to read.
 */
import type { ReadinessBreakdown as RB } from '@/lib/coach/readiness';

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
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 16, color, letterSpacing: '1.4px' }}>
            {breakdown.label}
          </span>
        </div>
      )}

      <table style={{
        width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px',
        fontFamily: 'var(--f-body)', fontSize: 13,
      }}>
        <thead>
          <tr style={{ fontSize: 10, fontWeight: 700, color: 'rgba(246,247,248,0.50)', letterSpacing: '1.4px', textTransform: 'uppercase' }}>
            <th style={{ textAlign: 'left',   padding: '0 16px 8px 16px' }}>INPUT</th>
            <th style={{ textAlign: 'left',   padding: '0 16px 8px 16px' }}>YOUR VALUE</th>
            <th style={{ textAlign: 'right',  padding: '0 16px 8px 16px' }}>EFFECT</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.inputs.map((inp) => <InputRow key={inp.key} input={inp} />)}
        </tbody>
      </table>

      <div style={{
        marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.10)',
        fontFamily: 'var(--f-body)', fontSize: 12.5, color: 'rgba(246,247,248,0.75)', lineHeight: 1.55,
      }}>
        Base 70 {breakdown.inputs.map((i) => `${i.weight >= 0 ? '+' : ''}${i.weight}`).join(' ')}{' '}={' '}
        <span style={{ color, fontWeight: 700 }}>{breakdown.score}</span>
      </div>
    </div>
  );
}

function InputRow({ input }: { input: import('@/lib/coach/readiness').ReadinessInput }) {
  const wColor = input.weight > 0 ? 'var(--green)' : input.weight < 0 ? 'var(--over)' : 'var(--mute)';
  const wBg    = input.weight > 0 ? 'rgba(62,189,65,0.12)' : input.weight < 0 ? 'rgba(252,77,100,0.12)' : 'rgba(255,255,255,0.04)';

  // Split "SLEEP · 25%" into label + weight-share for cleaner columns.
  const [labelPart, sharePart] = input.label.split(' · ');

  return (
    <tr style={{ background: 'rgba(255,255,255,0.06)' }}>
      <td style={{
        padding: '14px 16px', borderRadius: '8px 0 0 8px',
        color: 'var(--ink)', fontFamily: 'var(--f-display)', fontSize: 15, letterSpacing: '0.5px',
        width: 1, whiteSpace: 'nowrap',
      }}>
        {labelPart}
        {sharePart && (
          <span style={{ marginLeft: 8, color: 'rgba(246,247,248,0.55)', fontFamily: 'var(--f-body)', fontSize: 11, letterSpacing: '1px' }}>
            ({sharePart})
          </span>
        )}
      </td>
      <td style={{ padding: '14px 16px', color: 'var(--ink)' }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: '#ffffff' }}>{input.observedV}</div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'rgba(246,247,248,0.65)', marginTop: 3 }}>
          {input.observedSub}
        </div>
      </td>
      <td style={{
        padding: '14px 16px', textAlign: 'right', borderRadius: '0 8px 8px 0', width: 1, whiteSpace: 'nowrap',
      }}>
        <span style={{
          display: 'inline-block',
          background: input.weight > 0 ? 'rgba(62,189,65,0.22)' : input.weight < 0 ? 'rgba(252,77,100,0.22)' : 'rgba(255,255,255,0.10)',
          color: wColor,
          padding: '5px 12px', borderRadius: 999,
          fontFamily: 'var(--f-display)', fontSize: 15, letterSpacing: '0.5px', fontWeight: 600,
        }}>
          {input.weight > 0 ? `+${input.weight}` : input.weight === 0 ? '0' : input.weight}
        </span>
      </td>
    </tr>
  );
}
