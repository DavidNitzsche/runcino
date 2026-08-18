import type { ReactNode } from 'react';
import '../../styles.css';

/**
 * app/redesign/races/[slug]/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/races/[slug]. Mirrors
 * app/redesign/runs/[id]/layout.tsx — scoped by Next's per-route CSS
 * loading, does not touch the live app's globals.css or any route outside
 * /redesign/**.
 */
export default function RedesignRaceDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
