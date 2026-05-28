'use client';

/**
 * BodyGrid · the two-column body layout below Poster + Sibling.
 * Spec: design/components/BodyGrid.md
 *
 * Container only · cards inside vary by page + state. Mobile stacks
 * to one column with left column first.
 */

import type { ReactNode } from 'react';
import styles from './BodyGrid.module.css';

export interface BodyGridProps {
  sectionHeading?: string;
  sectionSuffix?: string;
  left: ReactNode;
  right: ReactNode;
}

export function BodyGrid({ sectionHeading, sectionSuffix, left, right }: BodyGridProps) {
  return (
    <section className={styles.section}>
      {sectionHeading && (
        <h3 className={styles.heading}>
          <span className={styles.headingLabel}>{sectionHeading}</span>
          {sectionSuffix && <span className={styles.headingSuffix}>{sectionSuffix}</span>}
        </h3>
      )}
      <div className={styles.grid}>
        <div className={styles.col}>{left}</div>
        <div className={styles.col}>{right}</div>
      </div>
    </section>
  );
}
