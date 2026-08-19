import '../redesign/styles.css';
import { buildSeed } from '@/components/faff-app/seed';
import { SettingsClient } from '@/components/redesign/settings/SettingsClient';

export const dynamic = 'force-dynamic';

/**
 * app/me/page.tsx
 *
 * 2026-08-18 · Live cutover — this route now renders the redesigned
 * Settings screen directly (previously mounted the old Shell + ProfileView).
 * Same real buildSeed() data load; the old Shell-based Profile view is
 * preserved in git history and in components/faff-app/views/ProfileView.tsx,
 * just no longer routed here. Mirrors app/redesign/settings/page.tsx
 * exactly. No Rail — Settings is a Level-3 sheet per the design brief,
 * same posture as its /redesign/settings counterpart.
 */
export default async function MePage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <SettingsClient connections={seed.connections} userHint={seed.user} />
    </div>
  );
}
