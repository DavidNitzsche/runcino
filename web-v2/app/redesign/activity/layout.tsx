import type { ReactNode } from 'react';
import '../styles.css';
import { Rail } from '@/components/redesign/nav/Rail';

/**
 * app/redesign/activity/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/activity. Mirrors app/redesign/today/
 * layout.tsx — scoped by Next's per-route CSS loading, does not touch the
 * live app's globals.css or any route outside /redesign/**.
 *
 * 2026-08-18 · Renders the shared Rail (Level 1 nav) above the page's own
 * content, wrapped in its own .redesign-root so Rail's tokens resolve —
 * see app/redesign/today/layout.tsx for the full rationale.
 */
export default function RedesignActivityLayout({ children }: { children: ReactNode }) {
  return (
    <div className="redesign-root" data-theme="light">
      <Rail />
      {children}
    </div>
  );
}
