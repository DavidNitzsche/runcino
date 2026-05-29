/**
 * FaffPageShell · the shared chrome wrapper that gives every secondary
 * surface (training / races / health / log / profile) the same display-
 * recipe title + caps-tracked eyebrow + optional right-side accent slot.
 *
 * Locally adapted from the canonical Faff v3 shell at
 *   /Volumes/WP/06 Claude Code/Faff/apps/web/src/components/FaffPageShell.tsx
 *   /Volumes/WP/06 Claude Code/Runcino/web-v2/components/faff/FaffPageShell.tsx
 *
 * This worktree's `web/` app is the active build line (per session feedback
 * — the dev branch `web-v2` is parallel work). It uses Runcino's existing
 * Stage + Topbar primitives + the canonical CSS tokens from globals.css.
 * The Faff v3 contract is preserved: title row + eyebrow + optional accent.
 *
 * Mirror: Faff/apps/web/src/components/races/FaffPageShell.tsx (a thin
 * re-export so the v3 contract stays single-source).
 */

import type { ReactNode } from 'react';
import { Stage } from './Stage';
import { Topbar, type TopbarTab } from './Topbar';
import { TopbarClock } from './TopbarClock';
import { Caption } from '../../components/nav';

export interface FaffPageShellProps {
  /** Main page title — uppercased display-recipe headline. */
  title: string;
  /** Optional caps-tracked eyebrow rendered above the title. */
  eyebrow?: string;
  /** Optional right-side affordance (chip, button, link) next to the title. */
  accent?: ReactNode;
  /** Override the title color. Defaults to `var(--ink)`. */
  titleColor?: string;
  /** Active topbar tab. Defaults to 'races' on this page. */
  activeTab?: TopbarTab | null;
  /** Optional caption left/right strip (small uppercase line above the topbar). */
  captionLeft?: string;
  captionRight?: string;
  children: ReactNode;
}

export function FaffPageShell({
  title,
  eyebrow,
  accent,
  titleColor,
  activeTab = 'races',
  captionLeft,
  captionRight,
  children,
}: FaffPageShellProps) {
  return (
    <>
      {(captionLeft != null || captionRight != null) && (
        <Caption left={captionLeft ?? ''} right={captionRight ?? ''} />
      )}
      <Stage>
        <Topbar activeTab={activeTab} clock={<TopbarClock />} />
        <div className="body">
          <header className="faff-band">
            {eyebrow && <div className="faff-eyebrow">{eyebrow}</div>}
            <div className="faff-title-row">
              <h1 className="faff-title" style={titleColor ? { color: titleColor } : undefined}>
                {title}
              </h1>
              {accent && <div className="faff-accent">{accent}</div>}
            </div>
          </header>
          <div className="faff-content">{children}</div>
        </div>
      </Stage>
    </>
  );
}
