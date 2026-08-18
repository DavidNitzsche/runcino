import { buildSeed } from '@/components/faff-app/seed';
import { ActivityClient } from '@/components/redesign/activity/ActivityClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/activity/page.tsx
 *
 * The redesigned Activity screen. Same server-side seed load as the live
 * Activity view (mounted inside components/faff-app/Shell.tsx's ActivityView,
 * fed by the same buildSeed()) — buildSeed() is the one real data loader for
 * this surface; this route renders seed.activity through the new design
 * system instead of standing up a second data path.
 */
export default async function RedesignActivityPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <ActivityClient seed={seed} />
    </div>
  );
}
