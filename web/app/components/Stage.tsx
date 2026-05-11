/**
 * Stage — max-width page container.
 *
 * Wraps the entire page. Matches the canonical `.stage` from the May 2026
 * mockups (max-width: 1500px, centered, padding 24px 26px 60px). One Stage
 * per page; everything inside is grid + card composition.
 */

import type { ReactNode, HTMLAttributes } from 'react';

export interface StageProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Stage({ children, className, ...rest }: StageProps) {
  return (
    <div className={`rc-stage${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}
