import { buildSeed } from '@/components/faff-app/seed';
import { WeekDetailClient } from '@/components/redesign/block/WeekDetailClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/block/week/[idx]/page.tsx
 *
 * The redesigned Week Detail screen — Level 2 of Block, reached by clicking
 * a row in Block's "Every week" table. Same server-side seed load as every
 * other redesign route — buildSeed() (components/faff-app/seed.ts) is the
 * one real data loader; nothing here stands up a second data path.
 *
 * `idx` is the 0-based week index into seed.season.miles / weekDays — the
 * same index BlockClient's WeeksTable / BetweenBlocksWeeksTable rows use.
 * Out-of-range or non-numeric idx isn't redirected or 404'd here — it's
 * handled inside WeekDetailClient (same "not found" honesty as the
 * redesigned Run Detail route uses for an unmatched run id), so the page
 * still renders the shell rather than triggering Next's generic not-found.
 */
export default async function RedesignWeekDetailPage({ params }: { params: Promise<{ idx: string }> }) {
  const { idx: rawIdx } = await params;
  const idx = Number(rawIdx);
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <WeekDetailClient seed={seed} idx={Number.isFinite(idx) ? Math.trunc(idx) : -1} />
    </div>
  );
}
