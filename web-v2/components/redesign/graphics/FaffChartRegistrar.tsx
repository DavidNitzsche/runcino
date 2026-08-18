'use client';

import { useEffect } from 'react';
import { registerFaffChart } from './chart';

/**
 * components/redesign/graphics/FaffChartRegistrar.tsx
 *
 * Registers the <faff-chart> custom element exactly once, client-side,
 * before any <faff-chart> tag needs to paint. registerFaffChart() itself
 * guards on customElements.get('faff-chart') so calling this from every
 * page that uses the element (or remounting under fast refresh) never
 * throws the "already defined" DOMException. Render this once near the
 * top of any client component tree that includes <faff-chart> markup.
 */
export function FaffChartRegistrar() {
  useEffect(() => {
    registerFaffChart();
  }, []);
  return null;
}
