/**
 * /learn — index of doctrine articles. Closed-loop §8.5.
 *
 * Lists every learn_articles row grouped by eyebrow (RECOVERY,
 * PHYSIOLOGY, TRAINING, RACING, etc.) so the runner can browse the
 * coach's underlying methodology end-to-end, not just follow "Read more"
 * links from fun_fact cards. Each row links to /learn/[slug] which
 * renders the full coach-voice prose + related-slug links.
 *
 * Falls back to the seed catalog at /learn/[slug]/seed.ts when the DB
 * has no rows yet (so a fresh deploy or migration-pending state still
 * renders a useful browse list instead of an empty page).
 */
import { TopNav } from '@/components/layout/TopNav';
import { pool } from '@/lib/db/pool';
import { SEED } from './[slug]/seed';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface ArticleListItem {
  slug: string;
  title: string;
  eyebrow: string | null;
}

async function loadArticles(): Promise<ArticleListItem[]> {
  try {
    const r = await pool.query<ArticleListItem>(
      `SELECT slug, title, eyebrow
         FROM learn_articles
        ORDER BY eyebrow NULLS LAST, title ASC`,
    );
    if (r.rows.length > 0) return r.rows;
  } catch { /* fall through to seed */ }
  return Object.values(SEED).map((a) => ({
    slug: a.slug, title: a.title, eyebrow: a.eyebrow ?? null,
  })).sort((a, b) => {
    const ae = a.eyebrow ?? 'zzz';
    const be = b.eyebrow ?? 'zzz';
    if (ae !== be) return ae.localeCompare(be);
    return a.title.localeCompare(b.title);
  });
}

export default async function LearnIndexPage() {
  const articles = await loadArticles();

  // Group by eyebrow. Articles with no eyebrow land in MORE.
  const groups = new Map<string, ArticleListItem[]>();
  for (const a of articles) {
    const key = (a.eyebrow ?? 'MORE').toUpperCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  const orderedGroups = Array.from(groups.entries());

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{
          color: 'var(--learn, #5b8def)',
          fontSize: 11, letterSpacing: '1.6px',
          textTransform: 'uppercase', fontWeight: 700,
        }}>
          LEARN
        </div>
        <h1 style={{
          fontFamily: 'var(--f-display)',
          fontSize: 56, letterSpacing: '0.5px',
          margin: '8px 0 12px', lineHeight: 1.05,
        }}>
          The doctrine behind the coach
        </h1>
        <p style={{
          fontFamily: 'var(--f-body)',
          fontSize: 15, lineHeight: 1.55,
          color: 'var(--mute)',
          maxWidth: 600,
          margin: '0 0 36px',
        }}>
          Every recommendation in this app traces back to research. Browse
          the methodology end-to-end, or follow a fun-fact link straight to
          the relevant article.
        </p>

        {articles.length === 0 ? (
          <div style={{
            padding: 40, textAlign: 'center',
            color: 'var(--mute)',
            background: 'var(--surface-1, #161A22)',
            border: '1px solid var(--border-low, #222630)',
            borderRadius: 12,
          }}>
            No articles loaded yet. The doctrine library is being curated.
          </div>
        ) : (
          orderedGroups.map(([eyebrow, items]) => (
            <section key={eyebrow} style={{ marginBottom: 36 }}>
              <div style={{
                fontFamily: 'var(--f-label)',
                fontSize: 11, letterSpacing: '1.6px', fontWeight: 700,
                color: 'var(--learn, #5b8def)',
                marginBottom: 14,
              }}>
                {eyebrow}
                <span style={{ color: 'var(--mute)', marginLeft: 8 }}>
                  · {items.length} article{items.length === 1 ? '' : 's'}
                </span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 12,
              }}>
                {items.map((a) => (
                  <Link
                    key={a.slug}
                    href={`/learn/${a.slug}`}
                    style={{
                      display: 'block',
                      padding: '16px 18px',
                      background: 'var(--surface-1, #161A22)',
                      border: '1px solid var(--border-low, #222630)',
                      borderRadius: 12,
                      transition: 'border-color .15s, transform .15s',
                      textDecoration: 'none',
                    }}
                  >
                    <div style={{
                      fontFamily: 'var(--f-body)',
                      fontSize: 16, fontWeight: 600,
                      color: 'var(--ink)',
                      lineHeight: 1.3,
                      marginBottom: 6,
                    }}>
                      {a.title}
                    </div>
                    <div style={{
                      fontFamily: 'var(--f-label)',
                      fontSize: 10, letterSpacing: '1.2px',
                      color: 'var(--learn, #5b8def)',
                      fontWeight: 700,
                    }}>
                      READ →
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
