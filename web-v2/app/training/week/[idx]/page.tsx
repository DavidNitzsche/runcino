// 2026-08-21 · web audit · THIS IMPORT WAS MISSING and the page shipped
// unreadable. WeekDetailClient paints entirely from the redesign token
// layer, and those tokens live in app/redesign/styles.css. Without it the
// `.redesign-root` wrapper below resolves nothing: every var() fell back to
// its initial value and the whole page rendered as near-black text on
// near-black ground, with no header and no nav. The three sibling routes
// that came through the same 2026-08-18 cutover (/race-week, /runs/new,
// /me/gear) all carry this line; these two did not.
//
// The docblock below also claims the route "inherits the Rail from
// app/training/layout.tsx". There is no app/training/layout.tsx. The
// cutover copied the PAGE out of app/redesign/block/week/[idx] and left
// behind the LAYOUT that supplied both the stylesheet and the Rail, so
// this route has neither. The stylesheet is fixed here; the missing nav is
// part of the standing finding on this whole route cluster — see the
// audit report.
import '../../../redesign/styles.css';
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
