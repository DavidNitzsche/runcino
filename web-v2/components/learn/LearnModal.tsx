'use client';

/**
 * LearnModal — opens a research article (HRV / RHR / VO2 / heart-rate-zones)
 * as a modal overlay instead of navigating to /learn/[slug]. Same pattern as
 * RunDetailModal — never leave the page.
 *
 * Two-step: <LearnCardTrigger> is the inline card with the term + summary;
 * tapping opens the modal which lazy-fetches /api/learn/[slug].
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

export function LearnCardTrigger({ term, body, slug }: { term: string; body: string; slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
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
  const [data, setData] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/learn/${encodeURIComponent(slug)}`)
      .then((r) => r.ok ? r.json() : r.json().then((e) => { throw new Error(e.error ?? 'not found'); }))
      .then((d) => { if (mounted) { setData(d); setLoading(false); } })
      .catch((e) => { if (mounted) { setError(e.message ?? String(e)); setLoading(false); } });
    return () => { mounted = false; };
  }, [slug]);

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
      {d.citations_json?.length > 0 && (
        <>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'rgba(246,247,248,0.55)', letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700, marginTop: 22, marginBottom: 10 }}>
            WHAT THE RESEARCH SAYS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.citations_json.map((c, i) => (
              <div key={i} style={{ borderLeft: '2px solid var(--learn)', paddingLeft: 12, fontSize: 13, lineHeight: 1.55, color: 'rgba(246,247,248,0.85)' }}>
                <span style={{ color: 'var(--learn)', fontWeight: 600 }}>{c.author}, {c.year} →</span>{' '}
                {c.title}
                {c.journal ? <span style={{ color: 'var(--mute)' }}>{' '}({c.journal})</span> : null}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
