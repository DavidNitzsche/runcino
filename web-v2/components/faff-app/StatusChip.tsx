'use client';

/**
 * StatusChip · the ONE goal-status chip (deck Decision 3b).
 *
 * Tier word plus the gap value, rendered identically wherever goal status
 * appears: AHEAD · ON PACE · WATCHING · BEHIND, each carrying the number
 * the retired StatusPill never did.
 *
 * 2026-08-17 · lifted out of views/TargetsView.tsx during Wave 1
 * integration. Wave 2 exported it from the view so Today could reuse it,
 * but a view importing a component out of another view is how two pages
 * end up coupled through a third. The chip lives here; both Targets and
 * Today's GAP tile import it, and neither owns the other.
 *
 * The wording itself is not this component's business — resolveGoalStatus
 * in lib/faff/goal-status.ts is the single source, and this renders what
 * it returns. Never derive a word here.
 */

import type { GoalStatusRead } from '@/lib/faff/goal-status';

export function StatusChip({ read, compact }: { read: GoalStatusRead; compact?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center',
        fontFamily: "'Inter', sans-serif",
        fontSize: compact ? 10 : 11,
        fontWeight: 800,
        letterSpacing: '1.2px',
        textTransform: 'uppercase',
        color: read.tone,
        border: `1px solid ${read.tone}59`,
        background: `${read.tone}14`,
        borderRadius: 9,
        padding: compact ? '4px 8px' : '6px 11px',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {read.label}
    </span>
  );
}
