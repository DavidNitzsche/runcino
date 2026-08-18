import type { ReactNode } from 'react';
import '../styles.css';

/**
 * app/redesign/log/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/log. Mirrors app/redesign/today/
 * layout.tsx, app/redesign/block/layout.tsx and app/redesign/runs/[id]/
 * layout.tsx — scoped by Next's per-route CSS loading, does not touch the
 * live app's globals.css or any route outside /redesign/**.
 */
export default function RedesignLogLayout({ children }: { children: ReactNode }) {
  return children;
}
