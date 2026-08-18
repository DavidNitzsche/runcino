import { buildSeed } from '@/components/faff-app/seed';
import { SeasonClient } from '@/components/redesign/season/SeasonClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/season/page.tsx
 *
 * The redesigned Season screen. Same server-side seed load as every other
 * redesign route — buildSeed() (components/faff-app/seed.ts) is the one
 * real data loader for this surface; nothing here stands up a second data
 * path. Everything Season needs (goalRace / projectionTrend / planProposals /
 * coachLog / races / health.vdotAnchor) already rides on the seed the live
 * /today, /train and /goal routes consume.
 */
export default async function RedesignSeasonPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <SeasonClient seed={seed} />
    </div>
  );
}
