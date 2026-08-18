import type { ReactNode } from 'react';
import '../styles.css';

/**
 * app/redesign/block/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/block. Mirrors app/redesign/today/
 * layout.tsx and app/redesign/runs/[id]/layout.tsx — scoped by Next's
 * per-route CSS loading, does not touch the live app's globals.css or any
 * route outside /redesign/**.
 */
export default function RedesignBlockLayout({ children }: { children: ReactNode }) {
  return children;
}
