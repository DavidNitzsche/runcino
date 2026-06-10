/**
 * FAFF logomark · SVG recreation of the brand asset David supplied
 * 2026-06-10 (blocky rounded letterforms, slot counters). Drawn from
 * the reference image — if a pixel-exact vector of the original
 * exists, drop it at public/faff-logo.svg and swap this component's
 * internals; every consumer takes it via this one component.
 *
 * fill = currentColor → set `color` on the wrapper for white-on-dark.
 */
export function FaffLogo({ height = 34 }: { height?: number }) {
  // One letter cell is 100×100 with a 14-unit gap. F stem + bars; A is a
  // block with a top slot + bottom notch. Slots are mask cutouts so the
  // mark sits on any background.
  const F = (x: number, i: number) => (
    <g key={i} transform={`translate(${x} 0)`}>
      <path d="
        M 16 0  H 84 Q 100 0 100 16 V 26 Q 100 38 84 38 H 46 V 38
        H 100 V 38
        M 0 16 Q 0 0 16 0
      " fill="none" />
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
      viewBox="0 0 442 100"
      height={height}
      role="img"
      aria-label="FAFF"
      style={{ display: 'block' }}
      fill="currentColor"
    >
      <defs>
        <mask id="faff-a-slots">
          <rect x="0" y="0" width="100" height="100" fill="#fff" />
          {/* top slot counter */}
          <rect x="44" y="0" width="12" height="58" rx="6" fill="#000" />
          {/* bottom notch counter */}
          <rect x="44" y="76" width="12" height="24" rx="6" fill="#000" />
        </mask>
      </defs>
      {F(0, 0)}
      {/* A · solid block with slot counters */}
      <g transform="translate(114 0)">
        <rect x="0" y="0" width="100" height="100" rx="16" mask="url(#faff-a-slots)" />
      </g>
      {F(228, 1)}
      {F(342, 2)}
    </svg>
  );
}
