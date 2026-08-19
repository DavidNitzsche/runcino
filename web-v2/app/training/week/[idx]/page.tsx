import { buildSeed } from '@/components/faff-app/seed';
import { WeekDetailClient } from '@/components/redesign/block/WeekDetailClient';

export const dynamic = 'force-dynamic';

/**
 * app/training/week/[idx]/page.tsx
 *
 * 2026-08-18 · Live cutover — canonical route for Week Detail (Level 2 of
 * Block), replacing the /redesign/block/week/[idx] address BlockClient's
 * WeekRow used to link to. Nested under /training so it inherits the Rail
 * from app/training/layout.tsx, same as /redesign/block/week/[idx]
 * inherited it from app/redesign/block/layout.tsx. Mirrors
 * app/redesign/block/week/[idx]/page.tsx exactly — same buildSeed() load,
 * same out-of-range handling delegated to WeekDetailClient.
 */
export default async function WeekDetailPage({ params }: { params: Promise<{ idx: string }> }) {
  const { idx: rawIdx } = await params;
  const idx = Number(rawIdx);
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <WeekDetailClient seed={seed} idx={Number.isFinite(idx) ? Math.trunc(idx) : -1} />
    </div>
  );
}
