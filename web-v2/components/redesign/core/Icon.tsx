import type { CSSProperties } from 'react';

/**
 * components/redesign/core/Icon.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/core/Icon.jsx + .d.ts), 2026-08-18.
 * Not one of this batch's 11 named deliverables — added as the scaffolding
 * IconButton (item 5) cannot render without: IconButton masks a glyph via
 * Icon in the source, and there was no ported Icon primitive yet.
 *
 * Faithful adaptation, not a faithful copy, in exactly one respect: the
 * source resolves its icon set relative to `document.currentScript.src`
 * (a standalone-bundle trick for a component library loaded via <script>).
 * This app is a Next.js app with a fixed, known public-asset path, so the
 * glyph resolves to `/redesign/icons/${name}.svg` instead — same
 * mask-image-to-currentColor technique, same vendored Lucide SVG shape,
 * different (simpler, correct-for-this-app) URL resolution.
 *
 * Vendored icon SVGs live in web-v2/public/redesign/icons/. Only the names
 * this batch's components actually reference are vendored so far: x
 * (IconButton's Sheet close), chevron-down (Select), minus/plus (Stepper),
 * check (Checkbox). x and plus were already present in the design handoff's
 * icon set (designs/design-review-0818/icons/); chevron-down, minus and
 * check were not vendored there and were added here as standard Lucide
 * glyphs, matching the existing files' exact viewBox/stroke conventions.
 * A future consumer that needs an icon name not in that set gets an empty
 * (but non-crashing) glyph until its SVG is added — same failure mode the
 * source's own dynamic resolution has for an unvendored name.
 */

export interface IconProps {
  /** Lucide icon name, e.g. "x", "chevron-down". */
  name: string;
  size?: number;
  /** Override the fill. Defaults to currentColor. */
  strokeColor?: string;
  style?: CSSProperties;
}

/** Lucide, vendored in /public/redesign/icons and masked so the glyph takes currentColor. */
export function Icon({ name, size = 20, strokeColor, style }: IconProps) {
  const url = `/redesign/icons/${name}.svg`;
  const s: CSSProperties = {
    display: 'inline-block',
    width: size,
    height: size,
    flex: '0 0 auto',
    background: strokeColor || 'currentColor',
    WebkitMaskImage: `url("${url}")`,
    maskImage: `url("${url}")`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    ...style,
  };
  return <i style={s} role="img" aria-label={name} />;
}
