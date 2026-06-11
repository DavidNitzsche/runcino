/**
 * FAFF logomark · SVG recreation of the brand asset David supplied
 * 2026-06-10 (blocky rounded letterforms, slot counters). Drawn from
 * the reference image — if a pixel-exact vector of the original
 * exists, drop it at public/faff-logo.svg and swap this component's
 * internals; every consumer takes it via this one component.
 *
 * fill = currentColor → set `color` on the wrapper for white-on-dark.
 *
 * 2026-06-11 hardening (David: "logo is cut off at the top" on /admin):
 *   - explicit width alongside height — Safari mis-sizes viewBox-only
 *     SVGs inside flex rows, which can shear the drawing;
 *   - 4 units of vertical margin inside the viewBox so the curves
 *     never sit on the raster edge.
 */
const VIEW_W = 442;
const VIEW_H = 108; // glyphs occupy y 4..104

export function FaffLogo({ height = 34 }: { height?: number }) {
  const width = Math.round(height * (VIEW_W / VIEW_H));
  const F = (x: number, i: number) => (
    <g key={i} transform={`translate(${x} 4)`}>
      {/* stem */}
      <rect x="0" y="0" width="42" height="100" rx="14" />
      {/* top bar */}
      <rect x="0" y="0" width="100" height="30" rx="14" />
      {/* mid bar */}
      <rect x="0" y="44" width="88" height="22" rx="11" />
    </g>
  );
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={width}
      height={height}
      role="img"
      aria-label="FAFF"
      style={{ display: 'block', flexShrink: 0 }}
      fill="currentColor"
    >
      <defs>
        <mask id="faff-a-slots">
          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="#fff" />
          {/* top slot counter */}
          <rect x="158" y="4" width="12" height="58" rx="6" fill="#000" />
          {/* bottom notch counter */}
          <rect x="158" y="80" width="12" height="24" rx="6" fill="#000" />
        </mask>
      </defs>
      {F(0, 0)}
      {/* A · solid block with slot counters */}
      <g transform="translate(114 4)">
        <rect x="0" y="0" width="100" height="100" rx="16" mask="url(#faff-a-slots)" />
      </g>
      {F(228, 1)}
      {F(342, 2)}
    </svg>
  );
}
