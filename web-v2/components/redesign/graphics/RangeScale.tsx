import type { CSSProperties } from 'react';

/**
 * components/redesign/graphics/RangeScale.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/graphics/RangeScale.jsx + .d.ts),
 * 2026-08-18. Faithful port: same tokens, same HUES/HALO tables, same clamp
 * math. The single graphic vocabulary for every ranged quantity in the
 * product — pace band, HR ceiling, effort, shoe mileage.
 */

export type RangeScaleMode = 'band' | 'ceiling' | 'progress' | 'window';
export type RangeScaleSize = 'm' | 's';
export type RangeScaleSurface = 'tile' | 'raised' | 'page' | 'control';
export type RangeScaleState = 'ready' | 'loading' | 'fault';
export type RangeScaleTone = 'auto' | 'in' | 'attention';
export type RangeScaleHue =
  | 'easy' | 'quality' | 'long' | 'rest' | 'race' | 'phase' | 'alarm' | 'done' | 'missed' | 'sick' | 'skip' | 'neutral'
  | 'load' | 'pace' | 'heart' | 'effort' | 'readiness' | 'sleep' | 'terrain' | 'evidence';

export interface RangeScaleProps {
  min: number;
  max: number;
  band?: { low: number; high: number } | null;
  target?: number | null;
  value?: number | null;
  mode?: RangeScaleMode;
  endpoints?: [string, string] | null;
  centerLabel?: string | null;
  size?: RangeScaleSize;
  surface?: RangeScaleSurface;
  state?: RangeScaleState;
  tone?: RangeScaleTone;
  hue?: RangeScaleHue;
  showEnds?: boolean;
  style?: CSSProperties;
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const pct = (v: number, min: number, max: number) => clamp(((v - min) / (max - min)) * 100, 0, 100);

const HALO: Record<RangeScaleSurface, string> = {
  tile: 'var(--surface-tile)', raised: 'var(--surface-tile-raised)',
  page: 'var(--surface-page)', control: 'var(--surface-control)',
};
const HUES: Record<RangeScaleHue, string | null> = {
  easy: 'easy', quality: 'quality', long: 'long', rest: 'rest', race: 'race', phase: 'phase',
  alarm: 'alarm', done: 'done', missed: 'missed', sick: 'sick', skip: 'skip', neutral: null,
  load: 'quality', pace: 'long', heart: 'easy', effort: 'quality', readiness: 'long', sleep: 'rest',
  terrain: 'skip', evidence: 'phase',
};

/**
 * Value in a range: the flat graphic for every ranged quantity in the product.
 * The band carries the day state's gradient. The mark is ink, because where the runner
 * actually is is a fact rather than a state, and it stays legible on every band.
 */
export function RangeScale({
  min, max, band = null, target = null, value = null, mode = 'band', hue = 'quality',
  endpoints = null, centerLabel = null, size = 'm', surface = 'tile',
  state = 'ready', tone = 'auto', showEnds = true, style,
}: RangeScaleProps) {
  const h = size === 's' ? 'var(--track-height-s)' : 'var(--track-height)';
  const px = size === 's' ? 8 : 12;
  const markSize = size === 's' ? 14 : 18;
  const halo = HALO[surface] || HALO.tile;
  const key = HUES[hue] === undefined ? 'quality' : HUES[hue];
  const fill = key ? `var(--g-${key})` : 'var(--range-band)';
  const out = tone === 'attention' || (tone === 'auto' && !!band && value != null && (value < band.low || value > band.high));
  const markColor = state === 'fault' ? 'var(--fault)' : out ? 'var(--mark-out-of-range)' : 'var(--mark-actual)';

  const bandLeft = band ? pct(band.low, min, max) : 0;
  const bandRight = band ? 100 - pct(band.high, min, max) : 0;

  let region = null;
  if (state === 'loading') {
    region = <div style={{ position: 'absolute', inset: 0, borderRadius: 'var(--radius-pill)', background: 'var(--surface-3)' }} />;
  } else if (mode === 'progress' && value != null) {
    region = <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(value, min, max)}%`,
      borderRadius: 'var(--radius-pill)', backgroundImage: fill,
    }} />;
  } else if (mode === 'ceiling' && band) {
    region = <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0, right: `${bandRight}%`,
      borderRadius: 'var(--radius-pill)', backgroundImage: fill,
    }} />;
  } else if (band) {
    region = <div style={{
      position: 'absolute', left: `${bandLeft}%`, top: 0, bottom: 0, right: `${bandRight}%`,
      borderRadius: 'var(--radius-pill)', backgroundImage: fill,
    }} />;
  }

  return (
    <div style={{ marginTop: 'var(--sp-7)', ...style }}>
      <div style={{
        position: 'relative', height: h, borderRadius: 'var(--radius-pill)',
        background: 'var(--material-track)', boxShadow: 'var(--elevation-recess)',
      }}>
        {region}
        {target != null && state === 'ready' && (
          <div style={{
            position: 'absolute', top: -3, bottom: -3, width: 2, borderRadius: 1,
            background: 'var(--range-target)', left: `calc(${pct(target, min, max)}% - 1px)`,
          }} />
        )}
        {value != null && state === 'ready' && (
          <div style={{
            position: 'absolute', top: (px - markSize) / 2,
            width: markSize, height: markSize, borderRadius: '50%', background: markColor,
            boxShadow: `0 0 0 var(--mark-halo) ${halo},var(--mark-glow)`,
            left: `calc(${pct(value, min, max)}% - ${markSize / 2}px)`,
            transition: 'left var(--dur-4) var(--ease-out)',
          }} />
        )}
      </div>
      {showEnds && (endpoints || centerLabel) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-5)',
          marginTop: 'var(--sp-6)', fontSize: 'var(--type-meta)', color: 'var(--text-quiet)',
        }}>
          <span>{endpoints ? endpoints[0] : ''}</span>
          {centerLabel && <span style={{ color: out ? 'var(--attention)' : 'var(--text-quiet)' }}>{centerLabel}</span>}
          <span>{endpoints ? endpoints[1] : ''}</span>
        </div>
      )}
    </div>
  );
}
