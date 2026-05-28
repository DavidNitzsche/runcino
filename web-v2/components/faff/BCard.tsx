'use client';

/**
 * BCard · the standard content card used inside BodyGrid.
 * Spec: design/components/BCard.md
 *
 * Container only · content is composed by the page. Header (label +
 * optional small value) + content area + optional footnote.
 */

import type { ReactNode } from 'react';
import type { ValueColor } from '@/lib/faff/types';
import styles from './BCard.module.css';

export interface BCardProps {
  header: {
    label: string;
    value?: string;
    valueColor?: ValueColor;
  };
  children: ReactNode;
  padding?: 'standard' | 'tight';
  footnote?: string;
}

const VALUE_COLOR_CLASS: Record<NonNullable<ValueColor>, string> = {
  default: styles.valueDefault,
  amber: styles.valueAmber,
  green: styles.valueGreen,
  over: styles.valueOver,
  race: styles.valueRace,
  dist: styles.valueDist,
};

export function BCard({
  header,
  children,
  padding = 'standard',
  footnote,
}: BCardProps) {
  return (
    <div
      className={[styles.card, padding === 'tight' ? styles.tight : ''].filter(Boolean).join(' ')}
    >
      <div className={styles.header}>
        <span className={styles.label}>{header.label}</span>
        {header.value && (
          <span
            className={[styles.value, 'tabular', VALUE_COLOR_CLASS[header.valueColor ?? 'default']].join(' ')}
          >
            {header.value}
          </span>
        )}
      </div>
      <div className={styles.content}>{children}</div>
      {footnote && <div className={styles.footnote}>{footnote}</div>}
    </div>
  );
}
