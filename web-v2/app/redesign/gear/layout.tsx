import type { ReactNode } from 'react';
import '../styles.css';

/**
 * app/redesign/gear/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/gear. Scoped by Next's per-route CSS
 * loading — importing it here does not touch the live app's globals.css
 * or any route outside /redesign/**. Mirrors app/redesign/today/layout.tsx.
 */
export default function RedesignGearLayout({ children }: { children: ReactNode }) {
  return children;
}
