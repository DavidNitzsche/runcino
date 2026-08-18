import type { ReactNode } from 'react';
import '../../styles.css';

/**
 * app/redesign/runs/[id]/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/runs/[id]. Mirrors app/redesign/today/
 * layout.tsx — scoped by Next's per-route CSS loading, does not touch the
 * live app's globals.css or any route outside /redesign/**.
 */
export default function RedesignRunDetailLayout({ children }: { children: ReactNode }) {
  return children;
}
