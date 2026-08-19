import '../redesign/styles.css';
import { buildSeed } from '@/components/faff-app/seed';
import { SeasonClient } from '@/components/redesign/season/SeasonClient';
import { Rail } from '@/components/redesign/nav/Rail';

export const dynamic = 'force-dynamic';

/**
 * app/goal/page.tsx
 *
 * 2026-08-18 · Live cutover — this route now renders the redesigned
 * Season screen directly (previously mounted the old Shell + TargetsView).
 * Same real buildSeed() data load; the old Shell-based Targets view is
 * preserved in git history and in components/faff-app/views/TargetsView.tsx,
 * just no longer routed here. Mirrors app/redesign/season/page.tsx exactly.
 *
 * No layout.tsx for this route — a layout.tsx at app/goal/ would cascade
 * to app/goal/[slug] (Race Detail) too, and Race Detail is deliberately
 * chrome-free (Level-2 detail per the design brief, same as Run Detail
 * and Race Week). Styles + Rail are imported/rendered directly here
 * instead, scoped to this page only.
 */
export default async function RacesPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <Rail />
      <SeasonClient seed={seed} />
    </div>
  );
}
