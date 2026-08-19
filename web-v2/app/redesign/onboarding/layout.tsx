import type { ReactNode } from 'react';
import '../styles.css';

/**
 * app/redesign/onboarding/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/onboarding. Mirrors app/redesign/block/
 * layout.tsx, app/redesign/log/layout.tsx, etc. — scoped by Next's
 * per-route CSS loading, does not touch the live app's globals.css or any
 * route outside /redesign/**.
 */
export default function RedesignOnboardingLayout({ children }: { children: ReactNode }) {
  return children;
}
