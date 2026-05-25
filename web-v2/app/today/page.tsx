import { TopNav } from '@/components/layout/TopNav';

// TODAY — home surface. Phase 1 will replace this scaffold with the
// full briefing-driven view (coach voice + cards lane + reply chips).
// For now: scaffold renders so routing works end-to-end.
export default function TodayPage() {
  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px', maxWidth: 1440 }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, letterSpacing: '0.5px', margin: 0, lineHeight: 1 }}>
          TODAY
        </h1>
        <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 12, letterSpacing: '1.6px', textTransform: 'uppercase' }}>
          Scaffold · Phase 1 will wire the briefing endpoint
        </p>
        <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 24, maxWidth: 720, lineHeight: 1.6 }}>
          Canonical design lives at <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4 }}>docs/coach/mockups/deck-v1-2026-05-25.html</code>.
          This scaffold renders so routing works. Phase 1 replaces it with the post-run state end-to-end,
          backed by the coach engine.
        </p>
      </div>
    </main>
  );
}
