import { TopNav } from '@/components/layout/TopNav';

// Run detail drill-down (Phase 4 closed-loop §8.4). Same surface used for past-day click-through.
export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px', maxWidth: 1440 }}>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 64, letterSpacing: '0.5px', margin: 0, lineHeight: 1 }}>
          RUN · {id}
        </h1>
        <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 12, letterSpacing: '1.6px', textTransform: 'uppercase' }}>
          Scaffold · Phase 4 wires per-mile splits + route + HR zones
        </p>
      </div>
    </main>
  );
}
