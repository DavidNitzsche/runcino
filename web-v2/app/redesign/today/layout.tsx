import type { ReactNode } from 'react';
import '../styles.css';

/**
 * app/redesign/today/layout.tsx
 *
 * Loads the redesign design-system stylesheet (app/redesign/styles.css)
 * for every route under /redesign/today. Scoped by Next's per-route CSS
 * loading — importing it here does not touch the live app's globals.css
 * or any route outside /redesign/**.
 */
export default function RedesignTodayLayout({ children }: { children: ReactNode }) {
  return children;
}
