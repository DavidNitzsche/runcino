import { TopNav } from '@/components/layout/TopNav';

export default function HealthPage() {
  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px', maxWidth: 1440 }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, letterSpacing: '0.5px', margin: 0, lineHeight: 1 }}>
          HEALTH
        </h1>
        <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 12, letterSpacing: '1.6px', textTransform: 'uppercase' }}>
          Scaffold · phased rollout per docs/coach/mockups/deck-v1-2026-05-25.html
        </p>
      </div>
    </main>
  );
}
