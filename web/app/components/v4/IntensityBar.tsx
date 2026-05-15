/**
 * v4 intensity bar — linear gradient green→amber→orange with a black
 * tick marking today's effort and a white fade over the unused portion.
 *
 * Below the bar: zone name + an italic coach note explaining the zone
 * in plain English.
 *
 * effortPct = 0..100; lower = easier (left), higher = harder (right).
 */

export interface IntensityBarProps {
  /** Position of the tick mark, 0..100. */
  effortPct: number;
  /** Zone name displayed below the bar (e.g. "Easy · Zone 2"). */
  zoneName: string;
  /** Italic plain-English note about the zone. */
  note?: string;
  /** Compact mode for inside modals (smaller bar height). */
  compact?: boolean;
}

export function IntensityBar({ effortPct, zoneName, note, compact = false }: IntensityBarProps) {
  const clamped = Math.max(0, Math.min(100, effortPct));
  const barHeight = compact ? 12 : 20;
  const radius = compact ? 6 : 10;
  const tickTop = compact ? -4 : -5;

  return (
    <div>
      <div
        style={{
          position: 'relative',
          height: `${barHeight}px`,
          marginBottom: compact ? '8px' : '12px',
        }}
      >
        {/* Gradient bar */}
        <div
          style={{
            width: '100%',
            height: `${barHeight}px`,
            borderRadius: `${radius}px`,
            background: 'linear-gradient(to right, #2CA82F 0%, #F3AD38 60%, #E85D26 100%)',
          }}
        />
        {/* Tick */}
        <div
          style={{
            position: 'absolute',
            top: `${tickTop}px`,
            bottom: `${tickTop}px`,
            left: `${clamped}%`,
            width: compact ? '2px' : '3px',
            background: 'var(--ink, #0D0F12)',
            borderRadius: compact ? '1px' : '2px',
            transform: 'translateX(-50%)',
          }}
        />
        {/* Fade over unused (right of tick) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${clamped}%`,
            right: 0,
            bottom: 0,
            borderRadius: `0 ${radius}px ${radius}px 0`,
            background: 'rgba(255,255,255,.52)',
          }}
        />
      </div>

      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: compact ? '14px' : '15px',
          fontWeight: 600,
          color: 'var(--recovery, #2CA82F)',
          letterSpacing: '0.3px',
        }}
      >
        {zoneName}
      </div>

      {note && (
        <p
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: '13px',
            fontStyle: 'italic',
            color: 'rgba(13,15,18,.35)',
            lineHeight: 1.55,
            marginTop: '14px',
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}
