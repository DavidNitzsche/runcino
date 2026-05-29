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
//
// 2026-05-28 graceful-degrade pass: rejected promises are evicted from
// the cache immediately so a transient endpoint hiccup doesn't poison
// every subsequent mount for 60s. Only RESOLVED blocks get the cache TTL.
const INFLIGHT = new Map<string, { promise: Promise<CoachFactBlock>; at: number }>();

// Hard ceiling on how long we'll wait for /api/coach/facts before the
// loader gives up and renders the deterministic fallback block. Per
// Cardinal Rule #1 + the 2026-05-28 hang audit ("Coach card stuck on
// 'Having a faff' on 9/9 states"): /today must NEVER block its visible
// render on the briefing endpoint. 3s is generous against the observed
// <1s cold-cache latencies on every surface.
const FETCH_TIMEOUT_MS = 3000;

function fetchFacts(surface: string, raceSlug?: string): Promise<CoachFactBlock> {
  const key = `${surface}|${raceSlug ?? ''}`;
  const cached = INFLIGHT.get(key);
  if (cached && Date.now() - cached.at < 60000) return cached.promise;
  const url = new URL('/api/coach/facts', window.location.origin);
  url.searchParams.set('surface', surface);
  if (raceSlug) url.searchParams.set('race', raceSlug);

  // AbortController bounds the network leg of the fetch; a top-level
  // Promise.race against a sleep timer bounds the WHOLE pipeline so a
  // hanging json-parse or a slow body stream also surfaces as a timeout.
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => { try { ac?.abort(); } catch { /* noop */ } }, FETCH_TIMEOUT_MS);

  const fetchP = fetch(url.toString(), ac ? { signal: ac.signal } : undefined)
    .then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as FactsResponse;
      if (!j?.block) throw new Error('malformed /api/coach/facts response');
      return j.block;
    });

  const timeoutP = new Promise<CoachFactBlock>((_, reject) => {
    setTimeout(() => reject(new Error(`timeout after ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS + 50);
  });

  const promise = Promise.race([fetchP, timeoutP]).finally(() => {
    clearTimeout(timer);
  });

  // Cache the in-flight promise so concurrent loaders share it, but
  // evict on rejection so the next mount gets a fresh try.
  INFLIGHT.set(key, { promise, at: Date.now() });
  promise.catch(() => { INFLIGHT.delete(key); });
  return promise;
}

/**
 * Deterministic fallback block — used when /api/coach/facts errors out,
 * times out, or returns a malformed body. The runner sees the surface
 * label + a single "Coach voice loading…" fact so the card has CONTENT
 * (never a forever-skeleton) and /today's hero never gets blocked on
 * the briefing layer. Cardinal Rule #1: zero LLM, and the surface still
 * recites a fact even when the pipeline is silent.
 */
function fallbackBlock(surface: string): CoachFactBlock {
  const surfaceKey =
    surface === 'race-detail' ? 'race_detail' :
    (surface as CoachFactBlock['surface']);
  return {
    surface: surfaceKey,
    state: 'fallback',
    facts: [
      {
        label: `${surface.replace(/[-_]/g, ' ').toUpperCase()} · COACH`,
        value: 'Coach voice loading',
        meta: 'showing facts in a moment',
      },
    ],
  };
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
  // Debug-only flag — when the fetch failed and we're showing the
  // fallback block, surface a tiny "(offline)" stamp in dev so the
  // failure mode is visible without breaking the runner's render.
  const [didFail, setDidFail] = useState(false);
  const calledOnLoad = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setDidFail(false); setBlock(null);
    // Belt-and-braces: even if fetchFacts() somehow never settles
    // (browser bug, dropped microtask), force a fallback render at
    // FETCH_TIMEOUT_MS so the card NEVER stays in the skeleton state
    // longer than the contract allows. This is the 2026-05-28 hang
    // audit's deliverable: /today must never wait > 3s on a coach
    // voice fetch.
    const safetyTimer = setTimeout(() => {
      if (cancelled) return;
      setBlock((current) => current ?? fallbackBlock(surface));
      setLoading(false);
      setDidFail(true);
    }, FETCH_TIMEOUT_MS + 100);
    fetchFacts(surface, raceSlug)
      .then((b) => {
        if (cancelled) return;
        clearTimeout(safetyTimer);
        setBlock(b);
        setLoading(false);
        if (onLoad && !calledOnLoad.current) {
          calledOnLoad.current = true;
          onLoad(toLoaded(b));
        }
      })
      .catch((e) => {
        if (cancelled) return;
        clearTimeout(safetyTimer);
        // Graceful degrade: synthesize a minimal fact block instead of
        // showing the "OFFLINE / Bit of a faff" error UI. The runner
        // sees the surface name + a single fact line, the page renders
        // its primary content, and a tiny dev-mode error stamp makes
        // the failure visible to us. Per the hang audit, error UI here
        // is worse UX than a fact stub.
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[BriefingLoader] /api/coach/facts fetch failed →', e?.message ?? e);
        }
        const fb = fallbackBlock(surface);
        setBlock(fb);
        setLoading(false);
        setDidFail(true);
        if (onLoad && !calledOnLoad.current) {
          calledOnLoad.current = true;
          onLoad(toLoaded(fb));
        }
      });
    return () => { cancelled = true; clearTimeout(safetyTimer); };
  }, [surface, raceSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading shows on coach side only; cards stay quiet.
  if (loading) return renderCoach ? <CoachLoading /> : null;
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
      {renderCoach && <FactBlock block={block} didFail={didFail} />}
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

function FactBlock({ block, didFail = false }: { block: CoachFactBlock; didFail?: boolean }) {
  // Option A v2 (2026-05-29) · drop the redundant COACH · FACTS eyebrow
  // (card header already says "COACH · WHY THIS WORKOUT"), drop the meta
  // sub-captions, constrain to a narrow left column so the right side
  // breathes. Per user direction: "just a long left justified list with a
  // ton of room on the right." If we ever go offline, the offline pill
  // returns in-row (not as a stacked eyebrow).
  const showDevStamp = didFail && process.env.NODE_ENV !== 'production';
  return (
    <section style={{ padding: '8px 24px 22px' }}>
      {didFail && (
        <div style={{
          fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700,
          color: 'var(--mute)', letterSpacing: '1.6px',
          textTransform: 'uppercase', marginBottom: 18,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--mute)',
          }} />
          OFFLINE FALLBACK
          {showDevStamp && (
            <span style={{
              marginLeft: 8, fontSize: 9, opacity: 0.6, letterSpacing: '0.6px',
            }}>
              (facts endpoint failed · see console)
            </span>
          )}
        </div>
      )}
      <ul style={{
        listStyle: 'none', padding: 0, margin: 0,
        display: 'flex', flexDirection: 'column', gap: 22,
        maxWidth: 360,
      }}>
        {block.facts.map((f, i) => (
          <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
              fontSize: 28,
              fontWeight: 700,
              color: colorVar(f.valueColor),
              letterSpacing: '-0.015em',
              lineHeight: 1.05,
            }}>
              {f.value}
            </div>
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

// 2026-05-28 hang audit — CoachError() (the "OFFLINE / Bit of a faff /
// TRY AGAIN" panel) was removed. The fact-reciter contract is "facts
// always recite even when silent," so the loader now renders a fallback
// CoachFactBlock through the normal FactBlock path on error rather than
// swapping to an error UI. This keeps the surface visually consistent
// and avoids the failure-mode-as-skeleton bug the audit caught.

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
