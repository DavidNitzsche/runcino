'use client';

/**
 * LearnModal — opens a research article (HRV / RHR / VO2 / heart-rate-zones)
 * as a modal overlay instead of navigating to /learn/[slug]. Same pattern as
 * RunDetailModal — never leave the page.
 *
 * Two-step: <LearnCardTrigger> is the inline card with the term + summary;
 * tapping opens the modal. Hovering pre-fetches the article so the click
 * feels instant. The article body lives in a module-scope cache shared by
 * every card on the page — open one HRV card, then open it again on a
 * different page, no second fetch.
 */
import { useEffect, useState } from 'react';

interface Article {
  slug: string;
  title: string;
  eyebrow: string | null;
  body_md: string;
  citations_json: Array<{ author: string; year: number; title: string; journal?: string; url?: string }>;
  related_slugs: string[];
}

// Module-scope shared cache. Survives unmounts and route changes for the
// session. Each entry is either an in-flight Promise or a resolved Article.
const articleCache = new Map<string, Article | Promise<Article | null>>();

function prefetchArticle(slug: string): Promise<Article | null> {
  const hit = articleCache.get(slug);
  if (hit && !(hit instanceof Promise)) return Promise.resolve(hit);
  if (hit instanceof Promise) return hit;
  const p: Promise<Article | null> = fetch(`/api/learn/${encodeURIComponent(slug)}`)
    .then((r) => r.ok ? r.json() : null)
    .then((d) => { if (d) articleCache.set(slug, d); return d; })
    .catch(() => null);
  articleCache.set(slug, p);
  return p;
}

export function LearnCardTrigger({ term, body, slug }: { term: string; body: string; slug: string }) {
  const [open, setOpen] = useState(false);
  // Best-effort: prefetch on mount so visible cards are warm by tap time.
  // The mount-time prefetch is bounded to /health's 3-4 cards so it's cheap.
  useEffect(() => { prefetchArticle(slug); }, [slug]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        onMouseEnter={() => prefetchArticle(slug)}
        onFocus={() => prefetchArticle(slug)}
        className="card"
        style={{
          display: 'block', textAlign: 'left', padding: '18px 20px', width: '100%',
          background: 'rgba(176,132,255,0.04)', border: '1px solid rgba(176,132,255,0.18)',
          cursor: 'pointer',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{
            width: 18, height: 18, borderRadius: '50%', background: 'var(--learn)', color: '#1a0f33',
            fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>ⓘ</span>
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--learn)', letterSpacing: '1.2px' }}>{term}</span>
        </div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 12.5, color: 'rgba(246,247,248,0.85)', lineHeight: 1.55, margin: '4px 0 8px' }}>
          {body}
        </div>
        <span style={{ fontFamily: 'var(--f-body)', fontSize: 10.5, fontWeight: 600, color: 'var(--learn)', letterSpacing: '0.5px' }}>Read the research →</span>
      </button>
      {open && <LearnModal slug={slug} onClose={() => setOpen(false)} />}
    </>
  );
}

function LearnModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  // Pull from the shared cache synchronously when warm — that's the
  // mount-time prefetch path. If cold (cache miss), the article fetch is
  // kicked off but we still pop the modal frame immediately with a skeleton.
  const cached = articleCache.get(slug);
  const initial = cached && !(cached instanceof Promise) ? cached : null;
  const [data, setData] = useState<Article | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial == null);

  useEffect(() => {
    if (initial) return; // already populated from cache
    let mounted = true;
    prefetchArticle(slug)
      .then((d) => {
        if (!mounted) return;
        if (d) { setData(d); setLoading(false); }
        else   { setError('not found'); setLoading(false); }
      });
    return () => { mounted = false; };
  }, [slug, initial]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.78)', backdropFilter: 'blur(10px)',
        zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#181a1d', border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)', borderRadius: 20,
          padding: '28px 32px', maxWidth: 760, width: '100%', maxHeight: '85vh', overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: 'var(--learn)', letterSpacing: '1.6px', textTransform: 'uppercase' }}>
            LEARN{data?.eyebrow ? ` · ${data.eyebrow}` : ''}
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--mute)', fontSize: 22, cursor: 'pointer', lineHeight: 1,
          }} aria-label="Close">×</button>
        </div>

        {loading && <Skeleton />}
        {error && (
          <div style={{ padding: '14px 0', color: 'var(--mute)', fontSize: 13 }}>
            Couldn't load the article — {error}.
          </div>
        )}
        {data && <ArticleBody d={data} />}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div>
      <style>{`@keyframes shim { 0%{opacity:.35}50%{opacity:.7}100%{opacity:.35} }`}</style>
      <div style={{ height: 36, width: '60%', background: 'var(--ink)', borderRadius: 4, margin: '8px 0 18px', animation: 'shim 1.4s ease-in-out infinite' }} />
      {[88, 94, 76, 90, 68].map((w, i) => (
        <div key={i} style={{ height: 14, width: `${w}%`, background: 'var(--ink)', borderRadius: 4, marginBottom: 8, animation: 'shim 1.4s ease-in-out infinite' }} />
      ))}
    </div>
  );
}

function ArticleBody({ d }: { d: Article }) {
  return (
    <>
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 38, letterSpacing: '0.5px', margin: '4px 0 18px', lineHeight: 1.05, color: 'var(--ink)' }}>
        {d.title}
      </h2>
      {d.body_md.split('\n\n').map((p, i) => (
        <p key={i} style={{ fontFamily: 'var(--f-body)', fontSize: 15, lineHeight: 1.7, color: 'rgba(246,247,248,0.88)', margin: '0 0 12px' }}>
          {p}
        </p>
      ))}
      {/* Citations intentionally not displayed — see seed.ts for source list */}
    </>
  );
}
