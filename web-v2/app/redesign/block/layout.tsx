import type { ReactNode } from 'react';
import '../styles.css';
import { Rail } from '@/components/redesign/nav/Rail';

/**
 * app/redesign/block/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/block. Mirrors app/redesign/today/
 * layout.tsx and app/redesign/runs/[id]/layout.tsx — scoped by Next's
 * per-route CSS loading, does not touch the live app's globals.css or any
 * route outside /redesign/**.
 *
 * 2026-08-18 · Renders the shared Rail (Level 1 nav) above the page's own
 * content, wrapped in its own .redesign-root so Rail's tokens resolve —
 * see app/redesign/today/layout.tsx for the full rationale. This layout
 * covers Week Detail (app/redesign/block/week/[idx]) too, since that
 * route nests under this one — the design brief's Level-2 detail pages
 * keeping the same persistent rail as their parent surface is a
 * deliberate consistency choice, not an oversight.
 */
export default function RedesignBlockLayout({ children }: { children: ReactNode }) {
  return (
    <div className="redesign-root" data-theme="light">
      <Rail />
      {children}
    </div>
  );
}
