import { TopNav } from '@/components/layout/TopNav';
import { pool } from '@/lib/db/pool';
import { SEED, type Article } from './seed';

export const dynamic = 'force-dynamic';

export default async function LearnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let article: Article | null = null;

  // Try DB first; fall back to seed.
  try {
    const r = (await pool.query(
      `SELECT slug, title, eyebrow, body_md, citations_json, related_slugs
         FROM learn_articles WHERE slug = $1`,
      [slug]
    )).rows[0];
    if (r) {
      article = {
        slug: r.slug, title: r.title, eyebrow: r.eyebrow, body_md: r.body_md,
        citations_json: r.citations_json ?? [],
        related_slugs: r.related_slugs ?? [],
      };
    }
  } catch { /* table may be empty — fall through to seed */ }

  if (!article) article = SEED[slug] ?? null;

  if (!article) {
    return (
      <main>
        <TopNav />
        <div style={{ padding: '40px 40px', maxWidth: 880, margin: '0 auto' }}>
          <a href="/health" style={{ color: 'var(--mute)', fontFamily: 'var(--f-display)', fontSize: 14 }}>← BACK</a>
          <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, marginTop: 20 }}>Article not found</h1>
          <p style={{ color: 'var(--mute)' }}>Slug: {slug}</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 720, margin: '0 auto' }}>
        <a href="/health" style={{ color: 'var(--mute)', fontFamily: 'var(--f-display)', fontSize: 14, letterSpacing: '1.2px' }}>← BACK</a>
        <div style={{ color: 'var(--learn)', fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', fontWeight: 700, marginTop: 20 }}>
          LEARN{article.eyebrow ? ` · ${article.eyebrow}` : ''}
        </div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, letterSpacing: '0.5px', margin: '8px 0 24px', lineHeight: 1.05 }}>
          {article.title}
        </h1>
        {article.body_md.split('\n\n').map((p, i) => (
          <p key={i} style={{ fontFamily: 'var(--f-body)', fontSize: 16, lineHeight: 1.7, color: 'rgba(246,247,248,0.86)', margin: '0 0 14px' }}>
            {p}
          </p>
        ))}

        {article.citations_json.length > 0 && (
          <>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700, marginTop: 24, marginBottom: 10 }}>
              WHAT THE RESEARCH SAYS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {article.citations_json.map((c, i) => (
                <div key={i} style={{ borderLeft: '2px solid var(--learn)', paddingLeft: 12, fontSize: 13, lineHeight: 1.55, color: 'rgba(246,247,248,0.85)' }}>
                  <span style={{ color: 'var(--learn)', fontWeight: 600 }}>{c.author}, {c.year} →</span>{' '}
                  {c.title}
                  {c.journal ? <span style={{ color: 'var(--mute)' }}>{' '}({c.journal})</span> : null}
                </div>
              ))}
            </div>
          </>
        )}

        {article.related_slugs.length > 0 && (
          <>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700, marginTop: 32, marginBottom: 10 }}>
              RELATED
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {article.related_slugs.map((s) => (
                <a key={s} href={`/learn/${s}`} className="card" style={{ padding: '10px 16px', fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1px', color: 'var(--learn)' }}>
                  {s.replace(/-/g, ' ').toUpperCase()} →
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
