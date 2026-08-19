import { Shell } from '@/components/faff-app/Shell';
import { buildSeed } from '@/components/faff-app/seed';

export const dynamic = 'force-dynamic';

/**
 * /runs/[id] — single run detail mounted as a Faff Shell view. Reuses
 * the RunDetailModal renderer in full-page form by routing the runId
 * via the URL into the overlay's lazy-fetch loop.
 */
export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seed = await buildSeed();
  return <Shell seed={seed} initial="activity" autoOpenRunId={id} />;
}
