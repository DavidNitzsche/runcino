/**
 * /tips — browse all form-metric tips. Each is the same content that
 * surfaces in the FormTipModal off a run-detail tile, but presented in
 * one place for reading without a specific run open.
 *
 * Future: filter by "currently flagged" using the runner's recent data.
 *
 * 2026-05-27 POC: when loaded with ?embed=ios (or any embed= param),
 * the page hides TopNav, drops outer padding, and renders for a phone
 * width so the iPhone app can host this page inside a WKWebView and
 * inherit every web change for free. See native-v2/.../TipsWebView.swift.
 */
import { TopNav } from '@/components/layout/TopNav';
import { loadProfileState } from '@/lib/coach/profile-state';
import { TipsList } from '@/components/tips/TipsList';

export const dynamic = 'force-dynamic';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

export default async function TipsPage({
  searchParams,
}: {
  searchParams: Promise<{ embed?: string }>;
}) {
  const { embed } = await searchParams;
  const isEmbedded = Boolean(embed);

  // Pull the latest form values so each tip can render YOUR current band.
  const profile = await loadProfileState(DAVID_USER_ID);
  void profile;

  return (
    <main>
      {!isEmbedded && <TopNav />}
      <div style={{
        // Tight padding + phone-width max in embed mode; full desktop layout otherwise.
        padding: isEmbedded ? '20px 16px 60px' : '40px 40px 80px',
        maxWidth: isEmbedded ? '100%' : 880,
        margin: '0 auto',
      }}>
        <h1 style={{
          fontFamily: 'var(--f-display)',
          fontSize: isEmbedded ? 40 : 64,
          lineHeight: 1, margin: 0, letterSpacing: '0.5px',
        }}>
          Tips.
        </h1>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: isEmbedded ? 11 : 13, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginTop: 10, marginBottom: isEmbedded ? 18 : 28 }}>
          FORM · WHAT IT MEANS · WHAT TO DO
        </div>
        <p style={{ fontFamily: 'var(--f-body)', fontSize: isEmbedded ? 14 : 15, lineHeight: 1.6, color: 'rgba(246,247,248,0.78)', marginBottom: isEmbedded ? 20 : 28 }}>
          Every form metric the watch tracks, with target ranges and what to actually do when something flags. Tap a card.
        </p>
        <TipsList />
      </div>
    </main>
  );
}
