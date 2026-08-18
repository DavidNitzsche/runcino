import type { ReactNode } from 'react';
import '../styles.css';

/**
 * app/redesign/race-week/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/race-week. Mirrors app/redesign/today/
 * layout.tsx and app/redesign/block/layout.tsx — scoped by Next's
 * per-route CSS loading, does not touch the live app's globals.css or any
 * route outside /redesign/**.
 */
export default function RedesignRaceWeekLayout({ children }: { children: ReactNode }) {
  return children;
}
