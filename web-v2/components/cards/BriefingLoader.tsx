'use client';

/**
 * BriefingLoader — async-fetches /api/briefing and renders the coach voice +
 * topics + readiness once ready. The page shell renders instantly without it.
 *
 * Solves two problems at once:
 *   1. The LLM call (~15-20s) shouldn't block the page render
 *   2. Railway proxy 502s when the page render took too long
 *
 * Loading state cycles through coach-flavored progress lines so the runner
 * sees the system actually doing work.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Topic } from '@/lib/topics/types';
import type { ReadinessBreakdown } from '@/lib/coach/readiness';
import { CoachBlock } from './CoachBlock';
import { TopicRenderer } from './TopicRenderer';

// Module-level in-flight cache. When /today mounts two <BriefingLoader />
// instances (left for coach voice, right for cards rail), both share the
// same promise → ONE network call, both render the same payload.
// TTL is short (60s) — busted by router.refresh() on check-in / profile edit.
const INFLIGHT = new Map<string, { promise: Promise<LoadedBriefing>; at: number }>();
function fetchBriefing(surface: string, raceSlug?: string): Promise<LoadedBriefing> {
  const key = `${surface}|${raceSlug ?? ''}`;
  const cached = INFLIGHT.get(key);
  if (cached && Date.now() - cached.at < 60000) return cached.promise;
  const url = new URL('/api/briefing', window.location.origin);
  url.searchParams.set('surface', surface);
  if (raceSlug) url.searchParams.set('race', raceSlug);
  const promise = fetch(url.toString()).then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  INFLIGHT.set(key, { promise, at: Date.now() });
  return promise;
}

export interface LoadedBriefing {
  surface: string;
  mode: string;
  lead: string;
  voice: string[];
  topics: Topic[];
  _state?: {
    user_id: string;
    today: string;
    candidateKinds: string[];
    eligibleKinds: string[];
    readiness?: ReadinessBreakdown;
  };
}

// Faff-themed loading copy. The brand IS "faff" — every loading state
// should sound like the brand voice talking, not a generic spinner.
const LOADING_MESSAGES = [
  "Having a faff...",
  "Just a quick faff...",
  "Faffing on...",
  "One sec, faffing...",
  "Crunching the faff...",
  "Bit of a faff...",
  "Sorting your faff...",
  "Faffing the numbers...",
];

export function BriefingLoader({
  surface,
  raceSlug,
  onLoad,
  renderCoach = true,
  renderCards = true,
  askPrompt,
}: {
  surface: string;
  raceSlug?: string;
  onLoad?: (b: LoadedBriefing) => void;
  renderCoach?: boolean;
  renderCards?: boolean;
  askPrompt?: string;
}) {
  const [briefing, setBriefing] = useState<LoadedBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const calledOnLoad = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setBriefing(null);
    fetchBriefing(surface, raceSlug)
      .then((b) => {
        if (cancelled) return;
        setBriefing(b);
        setLoading(false);
        if (onLoad && !calledOnLoad.current) {
          calledOnLoad.current = true;
          onLoad(b);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [surface, raceSlug]);

  // Loading + error states only show on the coach side; cards stay quiet.
  if (loading) return renderCoach ? <CoachLoading /> : null;
  if (error)   return renderCoach ? <CoachError error={error} /> : null;
  if (!briefing) return null;

  return (
    <>
      {renderCoach && (
        <CoachBlock
          lead={briefing.lead}
          voice={briefing.voice}
          briefingId={`${briefing._state?.user_id ?? ''}|${briefing._state?.today ?? ''}|${briefing.surface}`}
          askPrompt={askPrompt ?? askPromptFor(briefing.mode)}
          // Check-in chips ONLY on /today, and only in modes where it makes
          // sense as a check-in moment. Other surfaces are read-only voice.
          showCheckin={surface === 'today' && CHECKIN_MODES.has(briefing.mode)}
        />
      )}
      {renderCards && briefing.topics.length > 0 && (
        <div style={{ padding: renderCoach ? '4px 24px 24px' : '0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {briefing.topics.map((t, i) => <TopicRenderer key={i} topic={t} />)}
        </div>
      )}
    </>
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
        The numbers are all still here. The voice will catch up. Refresh in a moment, or it'll show up on its own next time.
      </p>
      {process.env.NODE_ENV !== 'production' && (
        <pre style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--dim)', marginTop: 14, whiteSpace: 'pre-wrap' }}>
          {error}
        </pre>
      )}
      <button onClick={() => router.refresh()} style={{
        marginTop: 14, background: 'transparent', border: '1px solid var(--line)', color: 'var(--mute)',
        padding: '8px 14px', borderRadius: 8,
        fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1.2px', cursor: 'pointer',
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

// Modes where a check-in prompt makes sense on /today.
const CHECKIN_MODES = new Set(['post-run', 'pre-run', 'rest-day']);

function askPromptFor(mode: string): string {
  switch (mode) {
    case 'post-run':  return 'How did the run feel?';
    case 'pre-run':   return 'How are the legs this morning?';
    case 'rest-day':  return 'How are you feeling today?';
    case 'race-day':  return 'Ready for race day?';
    default:          return 'How are you feeling?';
  }
}
