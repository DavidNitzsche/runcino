import { buildSeed } from '@/components/faff-app/seed';
import { RunActionClient } from '@/components/redesign/run-action/RunActionClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/today/run-action/page.tsx
 *
 * The redesigned Run Action screen — "skip or move today's run". Nested
 * under /redesign/today (rather than a top-level /redesign/run-action)
 * because it IS Today's action sheet: the shared Sheet shell doc
 * (components/redesign/feedback/Sheet.tsx) describes RunAction as one of
 * the level-3 sheets that mounts "over whatever surface was showing" —
 * for Today, that surface is Today itself. TodayClient.tsx currently has
 * no skip/move wiring of its own (verified by reading it in full before
 * this port), so this ships as a standalone, directly-navigable route
 * rather than a client-side overlay state on TodayClient — wiring an
 * open/close trigger into TodayClient is out of scope for this pass.
 *
 * Same server-side seed load as /redesign/today (buildSeed()) — no new
 * data path. Closing the sheet (X, scrim click, or after a successful
 * skip/move) navigates back to /redesign/today.
 */
export default async function RedesignRunActionPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <RunActionClient seed={seed} />
    </div>
  );
}
