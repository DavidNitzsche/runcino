/**
 * FAFF graphic primitives · the technical spec-sheet visual language.
 * Paper-overhaul 2026-05-29 (docs/DESIGN_OVERHAUL_2026-05-29.md §9).
 *
 * These are the industrial-graphic DNA used across every rebuilt surface:
 * registration marks, brackets, barcodes, crop frames, die-cut ticket
 * panels, EKG activity traces, ticket-stub numbers, mono stamps, tick rules.
 *
 * All token-driven (var(--ink) / var(--line) / semantic palette) so they
 * track the active skin. Pure presentational — no data fetching, no state.
 */
import type { CSSProperties, ReactNode } from 'react';

// ──────────────────────────────────────────────────────────────────────
// Shared label recipe — the instrument-readout caps label used everywhere.
// ──────────────────────────────────────────────────────────────────────
export const SPEC_LABEL: CSSProperties = {
  fontFamily: 'var(--f-label)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '1.6px',
  textTransform: 'uppercase',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--mute)',
};

export type StatusTone = 'green' | 'amber' | 'over' | 'dist' | 'rest' | 'race' | 'learn' | 'mute' | 'none';

const TONE_VAR: Record<Exclude<StatusTone, 'none' | 'mute'>, string> = {
  green: 'var(--green)',
  amber: 'var(--goal)',
  over: 'var(--over)',
  dist: 'var(--dist)',
  rest: 'var(--rest)',
  race: 'var(--race)',
  learn: 'var(--learn)',
};

export function toneColor(tone: StatusTone): string {
  if (tone === 'none') return 'transparent';
  if (tone === 'mute') return 'var(--mute)';
  return TONE_VAR[tone];
}

// ──────────────────────────────────────────────────────────────────────
// RegistrationDot — the status ● mark. Filled disc, optional crosshair ring.
// ──────────────────────────────────────────────────────────────────────
export function RegistrationDot({
  tone = 'green',
  size = 9,
  ring = false,
  style,
}: {
  tone?: StatusTone;
  size?: number;
  /** Draw a thin concentric ring (crosshair registration feel). */
  ring?: boolean;
  style?: CSSProperties;
}) {
  const color = toneColor(tone);
  if (ring) {
    return (
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: size + 6,
          height: size + 6,
          borderRadius: '50%',
          border: `1px solid ${color}`,
          position: 'relative',
          flexShrink: 0,
          ...style,
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 3,
            borderRadius: '50%',
            background: color,
          }}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────
// Bracket — the [ EASY ] motif. Brackets are tone-colored; label is ink.
// ──────────────────────────────────────────────────────────────────────
export function Bracket({
  children,
  tone = 'mute',
  size = 11,
  weight = 700,
  gap = 6,
  style,
}: {
  children: ReactNode;
  tone?: StatusTone;
  size?: number;
  weight?: number;
  gap?: number;
  style?: CSSProperties;
}) {
  const color = toneColor(tone);
  const bracket: CSSProperties = {
    fontFamily: 'var(--f-label)',
    fontWeight: 400,
    color,
    fontSize: size + 3,
    lineHeight: 1,
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        ...style,
      }}
    >
      <span style={bracket}>[</span>
      <span
        style={{
          fontFamily: 'var(--f-label)',
          fontSize: size,
          fontWeight: weight,
          letterSpacing: '1.4px',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {children}
      </span>
      <span style={bracket}>]</span>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Barcode — variable-width bars. Doubles as a progress bar: `fill` (0..1)
// colors the leading fraction with `tone`, the remainder is faint ink.
// Deterministic widths from a seed so the "code" is stable across renders.
// ──────────────────────────────────────────────────────────────────────
export function Barcode({
  bars = 34,
  fill = 1,
  tone = 'mute',
  height = 26,
  seed = 7,
  gap = 2,
  style,
}: {
  bars?: number;
  fill?: number;
  tone?: StatusTone;
  height?: number;
  seed?: number;
  gap?: number;
  style?: CSSProperties;
}) {
  const color = toneColor(tone);
  // Deterministic pseudo-random bar widths (1–3 weight units).
  const widths: number[] = [];
  let s = seed * 9301 + 49297;
  for (let i = 0; i < bars; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    widths.push(r < 0.5 ? 1 : r < 0.82 ? 2 : 3);
  }
  const filledCount = Math.round(Math.max(0, Math.min(1, fill)) * bars);
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap,
        height,
        width: '100%',
        ...style,
      }}
    >
      {widths.map((w, i) => (
        <span
          key={i}
          style={{
            flexGrow: w,
            flexBasis: 0,
            background: i < filledCount ? color : 'var(--ink-12)',
            borderRadius: 0.5,
          }}
        />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// CropFrame — corner registration marks (L brackets) around a region.
// Wraps children; marks float at the four corners.
// ──────────────────────────────────────────────────────────────────────
export function CropFrame({
  children,
  inset = 0,
  arm = 11,
  tone = 'mute',
  thickness = 1.5,
  style,
}: {
  children: ReactNode;
  inset?: number;
  arm?: number;
  tone?: StatusTone;
  thickness?: number;
  style?: CSSProperties;
}) {
  const color = tone === 'mute' ? 'var(--ink-24)' : toneColor(tone);
  const corner = (pos: { top?: number; bottom?: number; left?: number; right?: number }, borders: CSSProperties) => (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        width: arm,
        height: arm,
        ...pos,
        ...borders,
      }}
    />
  );
  const off = -inset;
  return (
    <div style={{ position: 'relative', ...style }}>
      {corner({ top: off, left: off }, { borderTop: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` })}
      {corner({ top: off, right: off }, { borderTop: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` })}
      {corner({ bottom: off, left: off }, { borderBottom: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` })}
      {corner({ bottom: off, right: off }, { borderBottom: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` })}
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// LayeredPanel — die-cut ticket stack. Offset paper layers behind a card,
// so the panel reads as physically stacked tickets.
// ──────────────────────────────────────────────────────────────────────
export function LayeredPanel({
  children,
  layers = 2,
  tone = 'none',
  radius = 14,
  style,
}: {
  children: ReactNode;
  /** How many ghost layers peek out behind the top card. */
  layers?: number;
  /** Optional accent edge on the top card's left rule. */
  tone?: StatusTone;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <div style={{ position: 'relative', ...style }}>
      {Array.from({ length: layers }).map((_, i) => {
        const depth = (layers - i) * 5;
        return (
          <div
            key={i}
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translate(${depth}px, ${depth}px)`,
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: radius,
              boxShadow: 'var(--shadow-card)',
              zIndex: 0,
            }}
          />
        );
      })}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          background: 'var(--card-2)',
          border: '1px solid var(--line)',
          borderLeft: tone === 'none' ? '1px solid var(--line)' : `3px solid ${toneColor(tone)}`,
          borderRadius: radius,
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ActivityTrace — EKG-style polyline (HR / pace / elevation / sparkline).
// Accepts raw numbers; auto-scales to the box. Optional area fill + baseline.
// ──────────────────────────────────────────────────────────────────────
export function ActivityTrace({
  points,
  tone = 'mute',
  height = 36,
  width = 120,
  strokeWidth = 1.5,
  fillArea = false,
  baseline = false,
  style,
}: {
  points: number[];
  tone?: StatusTone;
  height?: number;
  width?: number;
  strokeWidth?: number;
  fillArea?: boolean;
  baseline?: boolean;
  style?: CSSProperties;
}) {
  const color = toneColor(tone);
  const pad = strokeWidth + 1;
  if (!points || points.length < 2) {
    // Degenerate — render a flat baseline so the slot keeps its footprint.
    return (
      <svg aria-hidden viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={style} preserveAspectRatio="none">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--ink-12)" strokeWidth={1} />
      </svg>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const ys = points.map((p) => pad + (1 - (p - min) / span) * (height - pad * 2));
  const path = ys.map((y, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const areaPath = `${path} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg aria-hidden viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={style} preserveAspectRatio="none">
      {baseline && <line x1={0} y1={height - pad} x2={width} y2={height - pad} stroke="var(--ink-12)" strokeWidth={1} />}
      {fillArea && <path d={areaPath} fill={color} opacity={0.12} />}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────
// VerticalStripNumber — big ticket-stub number with a stacked caps label.
// ──────────────────────────────────────────────────────────────────────
export function VerticalStripNumber({
  value,
  label,
  tone = 'mute',
  size = 64,
  style,
}: {
  value: ReactNode;
  label?: string;
  tone?: StatusTone;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, ...style }}>
      <span
        className="tabular"
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: size,
          lineHeight: 0.86,
          letterSpacing: '-0.015em',
          color: tone === 'mute' || tone === 'none' ? 'var(--ink)' : toneColor(tone),
        }}
      >
        {value}
      </span>
      {label && <span style={{ ...SPEC_LABEL, fontSize: 9 }}>{label}</span>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Stamp — mono caps micro-stamp (version / page / T-N). Outlined chip.
// ──────────────────────────────────────────────────────────────────────
export function Stamp({
  children,
  tone = 'mute',
  filled = false,
  style,
}: {
  children: ReactNode;
  tone?: StatusTone;
  filled?: boolean;
  style?: CSSProperties;
}) {
  const color = toneColor(tone);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--f-label)',
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        fontVariantNumeric: 'tabular-nums',
        padding: '3px 7px',
        borderRadius: 3,
        border: `1px solid ${filled ? 'transparent' : tone === 'mute' ? 'var(--line)' : color}`,
        color: filled ? 'var(--bg-page)' : tone === 'mute' ? 'var(--mute)' : color,
        background: filled ? color : 'transparent',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────
// TickRule — a horizontal ruler hairline with periodic ticks. Section divider.
// ──────────────────────────────────────────────────────────────────────
export function TickRule({
  ticks = 24,
  height = 7,
  style,
}: {
  ticks?: number;
  height?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        height,
        borderBottom: '1px solid var(--line)',
        ...style,
      }}
    >
      {Array.from({ length: ticks }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 1,
            height: i % 4 === 0 ? height : height / 2,
            background: 'var(--ink-24)',
          }}
        />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SpecLabel — convenience wrapper for the instrument caps label.
// ──────────────────────────────────────────────────────────────────────
export function SpecLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ ...SPEC_LABEL, ...style }}>{children}</span>;
}

// ──────────────────────────────────────────────────────────────────────
// IntensityBar — proportional weighted effort segments. Each segment's
// flex-grow is its share of the total weight; `emphatic` segments paint
// full-tone, the rest sit faint (warm-up / cool-down vs. the actual work).
// The phone's structure band, in one hairline strip.
// ──────────────────────────────────────────────────────────────────────
export interface IntensitySegment {
  weight: number;
  tone: StatusTone;
  /** Full opacity (the work) vs. faint (warm-up / recovery). */
  emphatic?: boolean;
}

export function IntensityBar({
  segments,
  height = 8,
  gap = 2,
  style,
}: {
  segments: IntensitySegment[];
  height?: number;
  gap?: number;
  style?: CSSProperties;
}) {
  if (!segments.length) return null;
  const total = Math.max(1, segments.reduce((a, s) => a + Math.max(0, s.weight), 0));
  return (
    <div aria-hidden style={{ display: 'flex', gap, height, width: '100%', ...style }}>
      {segments.map((seg, i) => (
        <span
          key={i}
          style={{
            flexGrow: Math.max(0.0001, seg.weight) / total,
            flexBasis: 0,
            background: toneColor(seg.tone),
            opacity: seg.emphatic ? 1 : 0.4,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SpecRow — the hairline-ruled data row. The workhorse of every spec
// sheet: caps label (left, optional status dot) · optional mono meta
// (center) · Oswald display value + unit (right). Color rides the dot;
// the value stays ink unless an explicit tone is passed ("color as
// registration marks, not fills").
// ──────────────────────────────────────────────────────────────────────
export function SpecRow({
  label,
  value,
  unit,
  meta,
  tone = 'mute',
  dot,
  valueSize = 22,
  showRule = true,
  onClick,
  trailing,
  style,
}: {
  label: string;
  value?: ReactNode;
  unit?: string;
  meta?: string;
  tone?: StatusTone;
  dot?: StatusTone;
  valueSize?: number;
  showRule?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  style?: CSSProperties;
}) {
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    width: '100%',
    padding: '11px 0',
    background: 'transparent',
    border: 'none',
    borderTop: showRule ? '1px solid var(--line)' : 'none',
    textAlign: 'left',
    font: 'inherit',
    color: 'inherit',
    cursor: onClick ? 'pointer' : 'default',
    ...style,
  };
  const inner = (
    <>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 92, flexShrink: 0 }}>
        {dot && <RegistrationDot tone={dot} size={7} />}
        <span style={{ ...SPEC_LABEL, fontSize: 11, letterSpacing: '1.2px' }}>{label}</span>
      </span>
      {meta ? (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'var(--f-label)',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.4px',
            color: 'var(--dim)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {meta}
        </span>
      ) : (
        <span style={{ flex: 1 }} />
      )}
      {value !== undefined && value !== null && (
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexShrink: 0 }}>
          <span
            className="tabular"
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: valueSize,
              lineHeight: 1,
              letterSpacing: '-0.01em',
              color: tone === 'mute' || tone === 'none' ? 'var(--ink)' : toneColor(tone),
            }}
          >
            {value}
          </span>
          {unit && <span style={{ ...SPEC_LABEL, fontSize: 10, letterSpacing: '1px' }}>{unit}</span>}
          {trailing}
        </span>
      )}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} style={rowStyle}>
      {inner}
    </button>
  ) : (
    <div style={rowStyle}>{inner}</div>
  );
}
