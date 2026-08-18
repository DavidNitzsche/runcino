import { buildSeed } from '@/components/faff-app/seed';
import { SettingsClient } from '@/components/redesign/settings/SettingsClient';

export const dynamic = 'force-dynamic';

/**
 * app/redesign/settings/page.tsx
 *
 * The redesigned Settings screen. Same server-side seed load as every
 * other redesign route — buildSeed() (components/faff-app/seed.ts) is the
 * one real data loader for this surface. seed.connections carries the
 * real Strava / Apple Health / Apple Watch / FinalSurge connection state
 * (adaptConnections() off lib/coach/profile-state.ts#loadProfileState via
 * loadProfile()), the same source the live /profile route's CONNECTIONS
 * band reads.
 *
 * Everything else Settings needs — profile fields, plan-shaping day
 * prefs, notification categories — is NOT on FaffSeed (it's a Today/
 * Train/Activity-shaped object, not a settings one) and is instead
 * client-fetched by SettingsClient from /api/profile, /api/settings and
 * /api/profile/notifications, exactly the three endpoints the live,
 * already-shipping settings surface (components/faff-app/views/
 * SettingsPanel.tsx + toolkit/Settings.tsx's NotificationPrefsList) reads
 * from today. No new data path invented for this port.
 */
export default async function RedesignSettingsPage() {
  const seed = await buildSeed();
  return (
    <div className="redesign-root" data-theme="light">
      <SettingsClient connections={seed.connections} userHint={seed.user} />
    </div>
  );
}
