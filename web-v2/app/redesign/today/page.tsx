import { buildSeed } from '@/components/faff-app/seed';
import { EASY_HRMAX_CEILING_PCT, EASY_HRMAX_FLOOR_PCT } from '@/lib/coach/easy-discipline';
import { TodayClient } from '@/components/redesign/today/TodayClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/today/page.tsx
 *
 * The redesigned Today screen. Same server-side seed load as the live
 * /today route (app/today/page.tsx) — buildSeed() is the one real data
 * loader for this surface; this route renders it through the new design
 * system instead of standing up a second data path.
 *
 * EASY_HRMAX_CEILING_PCT / EASY_HRMAX_FLOOR_PCT are read here (server-side)
 * and passed down as plain numbers — lib/coach/easy-discipline.ts also
 * exports loadEasyDiscipline, which imports the pg pool, and importing the
 * module from the 'use client' TodayClient bundled 'pg' into client JS.
 */
export default async function RedesignTodayPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <TodayClient seed={seed} easyCeilingPct={EASY_HRMAX_CEILING_PCT} easyFloorPct={EASY_HRMAX_FLOOR_PCT} />
    </div>
  );
}
