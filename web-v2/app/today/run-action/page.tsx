import { buildSeed } from '@/components/faff-app/seed';
import { RunActionClient } from '@/components/redesign/run-action/RunActionClient';

export const dynamic = 'force-dynamic';

/**
 * app/today/run-action/page.tsx
 *
 * 2026-08-18 · Live cutover — canonical route for the Run Action
 * (skip/move today's run) sheet, replacing the /redesign/today/run-action
 * address GearClient/RunActionClient/BackToTodayButton used to push back
 * to. Mirrors app/redesign/today/run-action/page.tsx exactly — same
 * buildSeed() load, same "no client-side overlay trigger yet, standalone
 * route" scope. Nested under /today so it inherits the Rail from
 * app/today/layout.tsx, matching the /redesign copy's existing behavior
 * (that route also inherits the Rail from app/redesign/today/layout.tsx).
 */
export default async function TodayRunActionPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <RunActionClient seed={seed} />
    </div>
  );
}
