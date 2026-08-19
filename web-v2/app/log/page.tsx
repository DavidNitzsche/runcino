import { buildSeed } from '@/components/faff-app/seed';
import { ActivityClient } from '@/components/redesign/activity/ActivityClient';

export const dynamic = 'force-dynamic';

/**
 * app/log/page.tsx
 *
 * 2026-08-18 · Live cutover — this route now renders the redesigned
 * Activity screen directly (previously mounted the old Shell + ActivityView).
 * Same real buildSeed() data load; the old Shell-based Activity view is
 * preserved in git history and in components/faff-app/views/ActivityView.tsx,
 * just no longer routed here. Mirrors app/redesign/activity/page.tsx exactly.
 */
export default async function LogPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <ActivityClient seed={seed} />
    </div>
  );
}
