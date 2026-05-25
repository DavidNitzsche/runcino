import { TopNav } from '@/components/layout/TopNav';

// Race detail — proximity-adaptive surface (Phase 3). 4 states keyed off days_to_race.
export default async function RaceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px', maxWidth: 1440 }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, letterSpacing: '0.5px', margin: 0, lineHeight: 1 }}>
          {slug.replace(/-/g, ' ').toUpperCase()}
        </h1>
        <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 12, letterSpacing: '1.6px', textTransform: 'uppercase' }}>
          Scaffold · Phase 3 wires proximity-adaptive race detail
        </p>
      </div>
    </main>
  );
}
