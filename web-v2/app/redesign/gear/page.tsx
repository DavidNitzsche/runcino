import { buildSeed } from '@/components/faff-app/seed';
import { GearClient } from '@/components/redesign/gear/GearClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/gear/page.tsx
 *
 * The redesigned Gear (shoe garage) screen. Same server-side seed load as
 * every other redesign route — buildSeed() (components/faff-app/seed.ts) is
 * the one real data loader for this surface. seed.shoes gives GearClient an
 * instant, real first paint of the runner's active pairs; GearClient then
 * fetches GET /api/shoe itself on mount to pick up retired pairs too (see
 * the doc comment on GearClient for why: adaptShoes() in seed.ts filters
 * retired shoes out of the seed entirely, but the Gear screen's design has
 * a dedicated "Retired" section that needs them).
 */
export default async function RedesignGearPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <GearClient seed={seed} />
    </div>
  );
}
