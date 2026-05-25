import { TopNav } from '@/components/layout/TopNav';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { loadSettings } from '@/lib/coach/settings';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function SettingsPage() {
  const settings = await loadSettings(DAVID_USER_ID);

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
          Settings.
        </h1>
        <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 14 }}>
          Notifications, units, integrations, account.
        </p>
        <SettingsForm initial={settings} />
      </div>
    </main>
  );
}
