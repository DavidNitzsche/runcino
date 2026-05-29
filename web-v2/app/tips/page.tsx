/**
 * /tips — browse all form-metric tips. Each is the same content that
 * surfaces in the FormTipModal off a run-detail tile, but presented in
 * one place for reading without a specific run open.
 *
 * Future: filter by "currently flagged" using the runner's recent data.
 */
import { TopNav } from '@/components/layout/TopNav';
import { loadProfileState } from '@/lib/coach/profile-state';
import { TipsList } from '@/components/tips/TipsList';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function TipsPage() {
  // Pull the latest form values so each tip can render YOUR current band.
  const profile = await loadProfileState(DAVID_USER_ID);
  void profile;

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 880, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, lineHeight: 1, margin: 0, letterSpacing: '0.5px' }}>
          Tips.
        </h1>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 10, marginBottom: 28 }}>
          FORM · WHAT IT MEANS · WHAT TO DO
        </div>
        <p style={{ fontFamily: 'var(--f-body)', fontSize: 15, lineHeight: 1.6, color: 'var(--mute)', marginBottom: 28 }}>
          Every form metric the watch tracks, with target ranges and what to actually do when something flags. Tap a card.
        </p>
        <TipsList />
      </div>
    </main>
  );
}
