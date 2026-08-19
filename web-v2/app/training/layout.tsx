import type { ReactNode } from 'react';
import '../redesign/styles.css';
import { Rail } from '@/components/redesign/nav/Rail';

/**
 * app/training/layout.tsx
 *
 * 2026-08-18 · Live cutover. Loads the redesign design-system stylesheet
 * and renders the shared Rail for the live /training (Block) route,
 * mirroring app/redesign/block/layout.tsx and app/today/layout.tsx.
 */
export default function TrainingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="redesign-root" data-theme="light">
      <Rail />
      {children}
    </div>
  );
}
