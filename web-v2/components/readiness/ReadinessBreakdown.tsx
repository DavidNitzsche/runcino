/**
 * ReadinessBreakdown — §8.3 surface. Same component on /today chip
 * tap-through AND on /health as a permanent section.
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 56, color, lineHeight: 1, letterSpacing: '0.5px' }}>
            {breakdown.score}
          </span>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 16, color, letterSpacing: '1.4px' }}>
            {breakdown.label}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {breakdown.inputs.map((inp) => (
          <InputRow key={inp.key} input={inp} />
        ))}
      </div>

      <div style={{
        marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line-2)',
        fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', lineHeight: 1.55,
      }}>
        Base 70 {breakdown.inputs.map((i) => `${i.weight >= 0 ? '+' : ''}${i.weight}`).join(' ')}{' '}={' '}
        <span style={{ color, fontWeight: 700 }}>{breakdown.score}</span>
      </div>
    </div>
  );
}

function InputRow({ input }: { input: import('@/lib/coach/readiness').ReadinessInput }) {
  const bg = input.weight > 0  ? 'rgba(62,189,65,0.06)'
    : input.weight < 0          ? 'rgba(252,77,100,0.06)'
                                 : 'rgba(255,255,255,0.025)';
  const wColor = input.weight > 0 ? 'var(--green)'
    : input.weight < 0           ? 'var(--over)'
                                  : 'var(--mute)';
  return (
    <div style={{ background: bg, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase' }}>
        <span>{input.label}</span>
        <span style={{ color: wColor }}>{input.weight >= 0 ? `+${input.weight}` : input.weight}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: 'var(--f-body)', fontSize: 12 }}>
        <span style={{ color: 'var(--ink)' }}>{input.observedV}</span>
        <span style={{ color: 'var(--mute)' }}>{input.observedSub}</span>
      </div>
    </div>
  );
}
