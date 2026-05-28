/**
 * FaffPageShell · the shared chrome wrapper that gives every secondary
 * surface (training / races / health / log / profile) the same display-
 * recipe title + caps-tracked eyebrow + optional accent slot.
 *
 * Why this exists: each of those pages historically inlined its own
 * <TopNav /> + <h1 style={...}> + eyebrow markup with slightly off-spec
 * values (letterSpacing 0.5px instead of -0.015em, lineHeight 1 instead
 * of 0.86). The Faff display recipe is locked in design/tokens/typography.css
 * — the shell mirrors it (Oswald 700, -0.015em tracking, 0.86 line-height)
 * so the same header lands consistently across surfaces.
 *
 * Mirror: /Volumes/WP/06 Claude Code/Faff/apps/web/src/components/FaffPageShell.tsx
 * (Faff is the canonical source-of-truth; this file is kept in sync.)
 */
'use client';

import type { ReactNode } from 'react';
import { TopNav } from '@/components/layout/TopNav';
import styles from './FaffPageShell.module.css';

export interface FaffPageShellProps {
  title: string;
  eyebrow?: string;
  subhead?: string;
  /** Override the title colour (e.g. var(--over) for the WATCH-RED Health headline). */
  titleColor?: string;
  /** Optional right-side affordance — chip, button, avatar block. */
  accent?: ReactNode;
  /** Page container max-width. Defaults to 1440 to match prior inline styles. */
  maxWidth?: number;
  children: ReactNode;
}

export function FaffPageShell({
  title,
  eyebrow,
  subhead,
  titleColor,
  accent,
  maxWidth = 1440,
  children,
}: FaffPageShellProps) {
  return (
    <main>
      <TopNav />
      <div className={styles.shell} style={{ maxWidth }}>
        <header className={styles.band}>
          <div className={styles.titleRow}>
            <h1 className={styles.title} style={titleColor ? { color: titleColor } : undefined}>
              {title}
            </h1>
            {accent && <div className={styles.accent}>{accent}</div>}
          </div>
          {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
          {subhead && <div className={styles.subhead}>{subhead}</div>}
        </header>
        <div className={styles.content}>{children}</div>
      </div>
    </main>
  );
}
