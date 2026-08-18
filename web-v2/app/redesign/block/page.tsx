import { buildSeed } from '@/components/faff-app/seed';
import { BlockClient } from '@/components/redesign/block/BlockClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/block/page.tsx
 *
 * The redesigned Block screen. Same server-side seed load as every other
 * redesign route — buildSeed() (components/faff-app/seed.ts) is the one
 * real data loader for this surface; nothing here stands up a second data
 * path. Everything Block needs (season.miles / season.phases /
 * season.weekDays / blockState / goalRace) already rides on the seed the
 * live /today and /train routes consume.
 */
export default async function RedesignBlockPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <BlockClient seed={seed} />
    </div>
  );
}
