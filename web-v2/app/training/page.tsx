import { buildSeed } from '@/components/faff-app/seed';
import { BlockClient } from '@/components/redesign/block/BlockClient';

export const dynamic = 'force-dynamic';

/**
 * app/training/page.tsx
 *
 * 2026-08-18 · Live cutover — this route now renders the redesigned
 * Block screen directly (previously mounted the old Shell + TrainView).
 * Same real buildSeed() data load; the old Shell-based Train view is
 * preserved in git history and in components/faff-app/views/TrainView.tsx,
 * just no longer routed here. Mirrors app/redesign/block/page.tsx exactly.
 */
export default async function TrainingPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <BlockClient seed={seed} />
    </div>
  );
}
