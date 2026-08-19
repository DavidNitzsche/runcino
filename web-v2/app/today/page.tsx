import { buildSeed } from '@/components/faff-app/seed';
import { EASY_HRMAX_CEILING_PCT, EASY_HRMAX_FLOOR_PCT } from '@/lib/coach/easy-discipline';
import { TodayClient } from '@/components/redesign/today/TodayClient';

export const dynamic = 'force-dynamic';

/**
 * app/today/page.tsx
 *
 * 2026-08-18 · Live cutover — this route now renders the redesigned Today
 * screen directly (previously mounted the old Shell + TodayView). Same
 * real buildSeed() data load; the old Shell-based Today view is preserved
 * in git history and in components/faff-app/views/TodayView.tsx, just no
 * longer routed here. Mirrors app/redesign/today/page.tsx exactly — see
 * that file's own comments for why EASY_HRMAX_CEILING_PCT/FLOOR_PCT are
 * read server-side here rather than imported client-side.
 */
export default async function TodayPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <TodayClient seed={seed} easyCeilingPct={EASY_HRMAX_CEILING_PCT} easyFloorPct={EASY_HRMAX_FLOOR_PCT} />
    </div>
  );
}
