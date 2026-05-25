import { TopNav } from '@/components/layout/TopNav';

// Reader (Phase 4 closed-loop §8.5). Coach-voice explainer + citations.
export default async function LearnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px', maxWidth: 880 }}>
        <p style={{ color: 'var(--learn)', fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', fontWeight: 700 }}>
          LEARN
        </p>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, letterSpacing: '0.5px', margin: '8px 0 0', lineHeight: 1.05 }}>
          {slug.replace(/-/g, ' ')}
        </h1>
        <p style={{ color: 'var(--mute)', fontSize: 14, marginTop: 16, lineHeight: 1.6 }}>
          Scaffold · Phase 4 wires the curated article body + citations.
        </p>
      </div>
    </main>
  );
}
