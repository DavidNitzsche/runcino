import type { CSSProperties } from 'react';

/**
 * components/redesign/graphics/WeekShape.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/WeekShape.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same bar-height-is-load logic.
 *
 * A training week is a shape, not seven equal cells. Bar height is load; the
 * tallest bar is the week's biggest day. Quality days are white, the current
 * day is signal, rest is absent.
 *
 * Real call sites (WebWeekDetail.jsx, WebRaceWeek.jsx) pass day objects with
 * extra fields beyond the .d.ts contract (`dow`, `date`, `state`, `status`,
 * `done`) for their own bookkeeping — WeekShape itself only reads `load`,
 * `quality`, `today`, `future`, `label`, matching the .d.ts exactly. Passing
 * the wider shape through is safe: TS excess-property checks don't apply to
 * an array assembled from a separate `const`.
 *
 * `hue` is a real, working prop in the .jsx (drives `--g-{hue}` on the
 * "today" bar) that the .d.ts simply omits — kept it, same precedent as
 * Badge.tsx keeping TONES entries the .d.ts's union didn't document.
 */

export interface WeekShapeDay {
  /** Miles or minutes; 0 renders nothing (rest). */
  load: number;
  quality?: boolean;
  today?: boolean;
  future?: boolean;
  label?: string;
}

export interface WeekShapeProps {
  /** Seven entries, Monday first. */
  days: WeekShapeDay[];
  height?: number;
  hue?: string;
  labels?: string[];
  style?: CSSProperties;
}

/** Seven days drawn as load, not as seven equal date cells. */
export function WeekShape({
  days, height = 96, hue = 'quality', labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'], style,
}: WeekShapeProps) {
  const max = Math.max(...days.map((d) => d.load || 0), 1);
  return (
    <div style={style}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 'var(--sp-3)',
        alignItems: 'end', height,
      }}>
        {days.map((d, i) => {
          const bg = d.today ? undefined : d.quality ? 'var(--plot-ink)' : 'var(--plot-quiet)';
          const h = d.load ? Math.max(6, (d.load / max) * height) : 0;
          return (
            <div
              key={i}
              style={{
                height: h,
                background: bg,
                backgroundImage: d.today ? `var(--g-${hue})` : undefined,
                borderRadius: '8px 8px 4px 4px',
                opacity: d.future ? 0.45 : 1,
              }}
              title={d.label || ''}
            />
          );
        })}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 'var(--sp-3)', textAlign: 'center',
        marginTop: 'var(--sp-4)', fontSize: 'var(--type-meta)', color: 'var(--text-quiet)',
      }}>
        {labels.map((l, i) => (
          <span
            key={i}
            style={{
              color: days[i] && days[i].today ? 'var(--text-primary)' : 'var(--text-quiet)',
              fontWeight: days[i] && days[i].today ? 'var(--weight-semibold)' : 'var(--weight-regular)',
            }}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
