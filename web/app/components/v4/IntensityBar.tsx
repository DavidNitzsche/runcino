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
  /** Rest day — hide the gradient bar entirely + swap copy.
   *  Source spec: designs/overview-v4.html §intensity-section.rest. */
  isRest?: boolean;
}

export function IntensityBar({ effortPct, zoneName, note, compact = false, isRest = false }: IntensityBarProps) {
  const clamped = Math.max(0, Math.min(100, effortPct));
  const barHeight = compact ? 12 : 20;
  const radius = compact ? 6 : 10;
  const tickTop = compact ? -4 : -5;

  // Rest day: skip the gradient bar entirely, render just the labels.
  if (isRest) {
    return (
      <div>
        <div
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: compact ? '14px' : '15px',
            fontWeight: 600,
            color: 'rgba(8,8,8,.55)',
            letterSpacing: '0.3px',
          }}
        >
          Rest day · No intensity
        </div>
        {note && (
          <p
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              fontStyle: 'italic',
              color: 'rgba(8,8,8,.35)',
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
            background: 'linear-gradient(to right, #3EBD41 0%, #F3AD38 60%, #E85D26 100%)',
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
            background: 'var(--ink, #080808)',
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
          color: 'var(--recovery, #3EBD41)',
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
            color: 'rgba(8,8,8,.35)',
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
