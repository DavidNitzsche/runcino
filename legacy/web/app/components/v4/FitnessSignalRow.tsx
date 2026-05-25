/**
 * v4 fitness signal row, Effort / Load / Mileage / Easy Pace / Strain.
 *
 * Each row: label on the left, ±value on the right (color-coded), bar
 * below with a fill colored to match. Lives in the hero-right column
 * under the readiness ring.
 *
 *   EFFORT             +0.25 (green)
 *   [████████░░░░░░░░░]  ← 65% filled, green
 *
 * The signals all come from the coach's read of state; this component
 * is presentational only.
 */

export type SignalTone = 'green' | 'amber' | 'warn' | 'dim';

export interface FitnessSignal {
  /** Display label, e.g. "Effort", "Load", "Mileage", "Easy Pace", "Strain". */
  label: string;
  /** Display value, e.g. "+0.25", "1.01", "−0.25", "0.00". */
  value: string;
  /** Bar fill percent, 0..100. */
  fillPct: number;
  /** Color tone, green = positive, amber = neutral, warn = negative,
   *  dim = no signal. */
  tone: SignalTone;
}

export interface FitnessSignalRowProps {
  signals: FitnessSignal[];
  /** Optional override for the wrapper. */
  style?: React.CSSProperties;
}

function colorFor(tone: SignalTone): string {
  switch (tone) {
    case 'green': return 'var(--recovery, #3EBD41)';
    case 'amber': return 'var(--milestone, #F3AD38)';
    case 'warn':  return 'var(--warn, #FC4D64)';
    case 'dim':   return 'rgba(8,8,8,.25)';
  }
}

export function FitnessSignalRow({ signals, style }: FitnessSignalRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        ...style,
      }}
    >
      {signals.map((s, i) => (
        <Row key={`${s.label}-${i}`} signal={s} />
      ))}
    </div>
  );
}

function Row({ signal }: { signal: FitnessSignal }) {
  const color = colorFor(signal.tone);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '12px',
            fontWeight: 500,
            letterSpacing: '1px',
            color: 'rgba(8,8,8,.35)',
            textTransform: 'uppercase',
          }}
        >
          {signal.label}
        </span>
        <span
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '14px',
            fontWeight: 700,
            color,
          }}
        >
          {signal.value}
        </span>
      </div>
      <div
        style={{
          width: '100%',
          height: '10px',
          background: 'rgba(8,8,8,.07)',
          borderRadius: '5px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.max(0, Math.min(100, signal.fillPct))}%`,
            background: color,
            borderRadius: '5px',
            position: 'absolute',
            left: 0,
            top: 0,
          }}
        />
      </div>
    </div>
  );
}
