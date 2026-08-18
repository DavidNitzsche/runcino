/**
 * components/redesign/graphics/faff-chart.d.ts
 *
 * JSX intrinsic-element typing for the <faff-chart> custom element
 * (./chart.ts). React renders unknown lowercase-hyphenated tags as literal
 * DOM custom elements, but TypeScript rejects them without a declared
 * shape — this augments JSX.IntrinsicElements so <faff-chart type="bars"
 * values="[...]" domain="[...]" hue="easy" /> type-checks. All attributes
 * are strings because the element parses its own JSON out of them (see
 * chart.ts's observedAttributes / attributeChangedCallback), matching how
 * the design handoff's ui_kits pass them.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type FaffChartProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  /** 'ring' | 'bars' | 'line' */
  type?: 'ring' | 'bars' | 'line';
  /** JSON-encoded number[] (nulls allowed for gaps), e.g. "[61]" or "[28,32,35]". */
  values?: string;
  /** JSON-encoded [lo, hi], e.g. "[0,48]". Omit to auto-scale from values. */
  domain?: string;
  /** JSON-encoded string[] axis labels, e.g. '["mon","sun"]'. */
  labels?: string;
  /** State hue key, e.g. "easy" | "long" | "quality" | "phase" | "rest". */
  hue?: string;
};

// React 19's @types/react no longer declares a global `JSX` namespace — the
// element-type lookup for the automatic JSX runtime resolves through
// `React.JSX.IntrinsicElements` (see node_modules/@types/react/index.d.ts
// and jsx-runtime.d.ts, which re-exports `interface IntrinsicElements
// extends React.JSX.IntrinsicElements {}`). Augmenting the old global
// `declare global { namespace JSX {...} } }` shape silently no-ops under
// this setup — augment the 'react' module's JSX namespace instead so it
// flows through that `extends`.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'faff-chart': FaffChartProps;
    }
  }
}

export {};
