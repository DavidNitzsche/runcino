import type { ReactNode } from 'react';
import '../redesign/styles.css';
import { Rail } from '@/components/redesign/nav/Rail';

/**
 * app/today/layout.tsx
 *
 * 2026-08-18 · Live cutover. Loads the redesign design-system stylesheet
 * and renders the shared Rail (Level 1 nav) for the live /today route,
 * mirroring app/redesign/today/layout.tsx exactly — see that file for
 * the full rationale on the .redesign-root wrapping. globals.css (the
 * old app's styles) still loads app-wide via the root app/layout.tsx;
 * this has coexisted safely with .redesign-root-scoped styles across
 * every /redesign/* route shipped this session with no visual bleed.
 */
export default function TodayLayout({ children }: { children: ReactNode }) {
  return (
    <div className="redesign-root" data-theme="light">
      <Rail />
      {children}
    </div>
  );
}
