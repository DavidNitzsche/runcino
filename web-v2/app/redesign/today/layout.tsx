import type { ReactNode } from 'react';
import '../styles.css';
import { Rail } from '@/components/redesign/nav/Rail';

/**
 * app/redesign/today/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/today. Scoped by Next's per-route CSS
 * loading — importing it here does not touch the live app's globals.css
 * or any route outside /redesign/**.
 *
 * 2026-08-18 · Renders the shared Rail (Level 1 nav — Today/Activity/
 * Block/Season/Log a run/Settings) above the page's own content. Today
 * is one of the design brief's four Level-1 surfaces, so it gets the
 * persistent rail; Level-2 detail routes (runs/[id], races/[slug],
 * race-week) do not, per the brief's own surface/detail/sheet hierarchy.
 *
 * Wrapped in its own .redesign-root here (not just left to page.tsx's
 * own wrapper) so Rail's CSS custom properties resolve — Rail renders
 * above where page.tsx's .redesign-root div starts. The nested
 * .redesign-root class on page.tsx's own wrapper is harmless (a static
 * CSS custom-property scope re-applied to a descendant, not a conflict).
 */
export default function RedesignTodayLayout({ children }: { children: ReactNode }) {
  return (
    <div className="redesign-root" data-theme="light">
      <Rail />
      {children}
    </div>
  );
}
