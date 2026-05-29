'use client';

/**
 * BriefingLoader — async-fetches /api/coach/facts and renders a
 * structured list of CAPS-tracked facts.
 *
 * 2026-05-28 · Cardinal Rule #1 (PROJECT.md, locked 2026-05-28): "Zero
 * LLM · anywhere · ever." This component used to fetch /api/briefing
 * (an Anthropic tool-use loop ~15-20s tail) and render the LLM
 * paragraphs. It now fetches /api/coach/facts (pure DB reads,
 * <300 ms) and renders a fact list.
 *
 * Prop contract preserved: callers pass surface / raceSlug /
 * renderCards / renderCoach and the component remains opaque to the
 * page.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// ── Types (mirror of lib/coach/fact-reciter.ts shape) ─────────────

type CoachFactColor = 'default' | 'green' | 'amber' | 'over' | 'race';

interface CoachFact {
  label: string;
  value: string;
  valueColor?: CoachFactColor;
  meta?: string;
}

interface CoachFactBlock {
  surface: 'today' | 'plan' | 'races' | 'race_detail' | 'health' | 'me';
  state?: string;
  facts: CoachFact[];
}

interface FactsResponse {
  block: CoachFactBlock;
}

// ── In-flight cache (same shape as the old loader) ────────────────

// Module-level in-flight cache. When two <BriefingLoader /> mount in
// the same render, both share the same fetch → one network call.
const INFLIGHT = new Map<string, { promise: Promise<CoachFactBlock>; at: number }>();

function fetchFacts(surface: string, raceSlug?: string): Promise<CoachFactBlock> {
  const key = `${surface}|${raceSlug ?? ''}`;
  const cached = INFLIGHT.get(key);
  if (cached && Date.now() - cached.at < 60000) return cached.promise;
  const url = new URL('/api/coach/facts', window.location.origin);
  url.searchParams.set('surface', surface);
  if (raceSlug) url.searchParams.set('race', raceSlug);
  const promise = fetch(url.toString())
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as FactsResponse;
      if (!j?.block) throw new Error('malformed /api/coach/facts response');
      return j.block;
    });
  INFLIGHT.set(key, { promise, at: Date.now() });
  return promise;
}

// Faff-themed loading copy (preserved from the old loader so the
// visual cadence stays familiar even though latency is now <300 ms).
const LOADING_MESSAGES = [
  'Having a faff...',
  'Just a quick faff...',
  'Faffing on...',
  'One sec, faffing...',
  'Crunching the faff...',
  'Bit of a faff...',
  'Sorting your faff...',
  'Faffing the numbers...',
];

// ── Public component ─────────────────────────────────────────────

export interface LoadedBriefing {
  // Preserved-shape envelope so any external code that reads
  // `briefing.lead` / `briefing.voice` (e.g. snapshot tests) still
  // works. The block is the new source of truth.
  surface: string;
  mode: string;
  lead: string;
  voice: string[];
  topics: never[];
  block: CoachFactBlock;
  _state?: { user_id: string; today: string };
}

export function BriefingLoader({
  surface,
  raceSlug,
  onLoad,
  renderCoach = true,
  renderCards = true,
}: {
  surface: string;
  raceSlug?: string;
  onLoad?: (b: LoadedBriefing) => void;
  renderCoach?: boolean;
  renderCards?: boolean;
  /** Preserved for prop-shape compatibility with the old loader. The
   *  fact-reciter has no concept of an ask prompt; the prop is
   *  accepted and ignored. */
  askPrompt?: string;
}) {
  const [block, setBlock] = useState<CoachFactBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const calledOnLoad = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setBlock(null);
    fetchFacts(surface, raceSlug)
      .then((b) => {
        if (cancelled) return;
        setBlock(b);
        setLoading(false);
        if (onLoad && !calledOnLoad.current) {
          calledOnLoad.current = true;
          onLoad(toLoaded(b));
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [surface, raceSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading + error states only show on the coach side; cards stay quiet.
  if (loading) return renderCoach ? <CoachLoading /> : null;
  if (error)   return renderCoach ? <CoachError error={error} /> : null;
  if (!block)  return null;

  // The fact-reciter currently emits one consolidated block per
  // surface — the renderer treats every fact as a left-rail entry.
  // `renderCards` from the old loader (right-rail topic cards) is
  // honored as a flag: when false we only render the left rail, when
  // true we render the same fact list there too (mirrored). The right
  // rail's structured cards are owned by other components on the
  // page directly.
  return (
    <>
      {renderCoach && <FactBlock block={block} />}
      {!renderCoach && renderCards && <FactBlockCompact block={block} />}
    </>
  );
}

function toLoaded(block: CoachFactBlock): LoadedBriefing {
  const fmt = (f: CoachFact) => `${f.label} · ${f.value}${f.meta ? ' · ' + f.meta : ''}`;
  const [first, ...rest] = block.facts;
  return {
    surface: block.surface,
    mode: block.state ?? 'facts',
    lead: first ? fmt(first) : '',
    voice: rest.map(fmt),
    topics: [],
    block,
  };
}

// ── Render: full fact block on the coach side ───────────────────

function colorVar(c: CoachFactColor | undefined): string {
  switch (c) {
    case 'green':  return 'var(--green)';
    case 'amber':  return 'var(--goal)';
    case 'over':   return 'var(--over)';
    case 'race':   return 'var(--race, var(--goal))';
    case 'default':
    default:       return 'var(--ink)';
  }
}

function FactBlock({ block }: { block: CoachFactBlock }) {
  return (
    <section style={{ padding: '8px 24px 22px' }}>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700,
        color: 'var(--green)', letterSpacing: '1.6px',
        textTransform: 'uppercase', marginBottom: 18,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: '50%', background: 'var(--green)',
          boxShadow: '0 0 12px rgba(62,189,65,0.6)',
        }} />
        COACH · FACTS
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {block.facts.map((f, i) => (
          <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{
              fontFamily: 'var(--f-body)',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--mute)',
              letterSpacing: '1.6px',
              textTransform: 'uppercase',
            }}>
              {f.label}
            </div>
            <div style={{
              fontFamily: 'var(--f-display)',
              fontSize: 22,
              fontWeight: 700,
              color: colorVar(f.valueColor),
              letterSpacing: '0.3px',
              lineHeight: 1.15,
            }}>
              {f.value}
            </div>
            {f.meta && (
              <div style={{
                fontFamily: 'var(--f-body)',
                fontSize: 12,
                color: 'rgba(246,247,248,0.66)',
                lineHeight: 1.4,
              }}>
                {f.meta}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Compact variant for the right-rail cards slot. Used when the caller
// asked for cards only (renderCoach=false, renderCards=true).
function FactBlockCompact({ block }: { block: CoachFactBlock }) {
  return (
    <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {block.facts.map((f, i) => (
        <div key={i} className="card" style={{ padding: 14 }}>
          <div className="card-eyebrow">{f.label}</div>
          <div style={{
            fontFamily: 'var(--f-display)',
            fontSize: 18,
            fontWeight: 700,
            color: colorVar(f.valueColor),
            marginTop: 4,
          }}>
            {f.value}
          </div>
          {f.meta && (
            <div style={{
              fontFamily: 'var(--f-body)',
              fontSize: 12,
              color: 'var(--mute)',
              marginTop: 4,
            }}>
              {f.meta}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CoachLoading() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % LOADING_MESSAGES.length), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <section style={{ padding: '32px 24px 22px' }}>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700,
        color: 'var(--green)', letterSpacing: '1.6px', textTransform: 'uppercase',
        marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <PulseDot />
        COACH · HAVING A FAFF
      </div>
      <h2 style={{
        fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)',
        lineHeight: 1.05, letterSpacing: '0.5px', margin: '0 0 14px',
      }}>
        One sec.
      </h2>
      <p style={{
        fontFamily: 'var(--f-body)', fontSize: 14, lineHeight: 1.6,
        color: 'rgba(246,247,248,0.66)', minHeight: '3em',
        transition: 'opacity .2s',
      }}>
        {LOADING_MESSAGES[phase]}
      </p>
      <SkeletonBars />
    </section>
  );
}

function CoachError({ error }: { error: string }) {
  const router = useRouter();
  return (
    <section style={{ padding: '32px 24px 22px' }}>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700,
        color: 'var(--over)', letterSpacing: '1.6px', textTransform: 'uppercase',
        marginBottom: 14,
      }}>
        COACH · OFFLINE
      </div>
      <h2 style={{
        fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)',
        lineHeight: 1.05, letterSpacing: '0.5px', margin: '0 0 10px',
      }}>
        Bit of a faff right now.
      </h2>
      <p style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', lineHeight: 1.6 }}>
        The numbers are still here. Refresh in a moment.
      </p>
      {process.env.NODE_ENV !== 'production' && (
        <pre style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--dim)', marginTop: 14, whiteSpace: 'pre-wrap' }}>
          {error}
        </pre>
      )}
      <button onClick={() => router.refresh()} style={{
        marginTop: 14, background: 'transparent', border: '1px solid var(--line)', color: 'var(--mute)',
        padding: '8px 14px', borderRadius: 8,
        fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1.2px', cursor: 'pointer',
      }}>
        TRY AGAIN
      </button>
    </section>
  );
}

function PulseDot() {
  return (
    <>
      <style>{`
        @keyframes pulse-dot { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.7); } }
      `}</style>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: 'var(--green)',
        boxShadow: '0 0 12px rgba(62,189,65,0.6)',
        animation: 'pulse-dot 1.4s ease-in-out infinite',
      }} />
    </>
  );
}

function SkeletonBars() {
  return (
    <>
      <style>{`
        @keyframes skeleton-shimmer { 0% { opacity: .14; } 50% { opacity: .28; } 100% { opacity: .14; } }
        .skel-bar { background: var(--ink); border-radius: 4px; animation: skeleton-shimmer 1.6s ease-in-out infinite; }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
        <div className="skel-bar" style={{ height: 14, width: '88%' }} />
        <div className="skel-bar" style={{ height: 14, width: '94%' }} />
        <div className="skel-bar" style={{ height: 14, width: '76%' }} />
      </div>
    </>
  );
}
