'use client';

import { useState } from 'react';
import { Nav, Footer } from '../../components/nav';
import type { CourseFacts, SourceCitation } from '../../lib/course-facts';

type ResearchResult = {
  slug: string;
  facts: CourseFacts;
  reasoning: string;
  unresolvedQuestions: string[];
  stub: boolean;
};

export default function ResearchPage() {
  const [raceName, setRaceName] = useState('California International Marathon');
  const [officialUrl, setOfficialUrl] = useState('https://www.runsra.org/california-international-marathon');
  const [distanceMi, setDistanceMi] = useState('26.22');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ phases: Set<number>; landmarks: Set<number> }>({
    phases: new Set(),
    landmarks: new Set(),
  });

  async function runResearch() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raceName,
          officialUrl: officialUrl || undefined,
          expectedDistanceMi: distanceMi ? Number(distanceMi) : undefined,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const data: ResearchResult = await res.json();
      setResult(data);
      setAccepted({ phases: new Set(), landmarks: new Set() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function toggle(set: 'phases' | 'landmarks', idx: number) {
    setAccepted(prev => {
      const next = { ...prev, [set]: new Set(prev[set]) };
      if (next[set].has(idx)) next[set].delete(idx);
      else next[set].add(idx);
      return next;
    });
  }

  function promote() {
    if (!result) return;
    const facts: CourseFacts = {
      ...result.facts,
      phases: result.facts.phases.filter((_, i) => accepted.phases.has(i)),
      landmarks: result.facts.landmarks.filter((_, i) => accepted.landmarks.has(i)),
    };
    const blob = new Blob([JSON.stringify(facts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.slug}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const acceptedPhaseCount = accepted.phases.size;
  const acceptedLandmarkCount = accepted.landmarks.size;
  const totalClaims = (result?.facts.phases.length ?? 0) + (result?.facts.landmarks.length ?? 0);

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
      <Nav active="research" />

      <section style={{ padding: '48px 0 16px' }}>
        <div className="runcino-pill runcino-pill-accent" style={{ marginBottom: 16, display: 'inline-flex' }}>
          <span className="runcino-pill-dot" /> Course facts · citation-required
        </div>
        <h1 style={{ fontSize: 52, maxWidth: '24ch', margin: '0 0 12px' }}>
          Any race in the world.<br />
          <span className="serif-italic">Every claim with a source.</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--color-ink-3)', maxWidth: '62ch', lineHeight: 1.5 }}>
          Give Claude a race name. It searches the official site first, then reputable secondary sources, and proposes a full CourseFacts JSON with citations. You accept each claim line-by-line.
        </p>
      </section>

      <section style={{ padding: '32px 0 32px' }}>
        <div className="runcino-card" style={{ padding: 32 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Step 1</div>
          <h3 style={{ fontSize: 22, marginBottom: 20 }}>Tell Claude about the race</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 0.8fr auto', gap: 12, alignItems: 'end' }}>
            <div>
              <label className="runcino-label">Race name</label>
              <input className="runcino-input" value={raceName} onChange={e => setRaceName(e.target.value)} />
            </div>
            <div>
              <label className="runcino-label">Official URL <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--color-ink-4)', fontWeight: 400 }}>(optional)</span></label>
              <input className="runcino-input font-mono" style={{ fontSize: 13 }} value={officialUrl} onChange={e => setOfficialUrl(e.target.value)} />
            </div>
            <div>
              <label className="runcino-label">Distance hint</label>
              <input className="runcino-input font-mono" value={distanceMi} onChange={e => setDistanceMi(e.target.value)} />
            </div>
            <button className="btn btn-accent btn-lg" onClick={runResearch} disabled={loading || !raceName.trim()}>
              {loading ? 'Researching…' : 'Research'}
            </button>
          </div>

          <div className="hint" style={{ marginTop: 12 }}>
            If the official URL is known, Claude reads it first. Otherwise it searches and flags domain authenticity.
          </div>
          {error && (
            <div style={{ marginTop: 12, padding: 12, background: '#FCDBD7', color: 'var(--color-danger)', borderRadius: 8, fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>
      </section>

      {result && (
        <>
          <section style={{ padding: '0 0 32px' }}>
            <div className="runcino-card" style={{ padding: 32, background: 'var(--color-ink)', color: 'var(--color-paper)', borderColor: 'var(--color-ink)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--color-terracotta)', color: 'var(--color-paper)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 600, fontSize: 12 }}>C</div>
                <div className="eyebrow" style={{ color: 'var(--color-terracotta-2)' }}>
                  Research trace{result.stub && ' · stubbed'}
                </div>
              </div>
              <h3 style={{ color: 'var(--color-paper)', marginBottom: 20, fontSize: 24 }}>
                Found {totalClaims} facts across {countUniqueSources(result.facts)} sources.
              </h3>
              <p style={{ color: 'var(--color-paper-3)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: 'var(--color-paper)' }}>Reasoning:</strong> {result.reasoning}
              </p>
              {result.unresolvedQuestions.length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <strong style={{ color: 'var(--color-paper)', fontSize: 13 }}>Flagged for human review:</strong>
                  <ul style={{ margin: '8px 0 0', color: 'var(--color-paper-3)', fontSize: 13, paddingLeft: 20 }}>
                    {result.unresolvedQuestions.map((q, i) => <li key={i} style={{ marginBottom: 4 }}>{q}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <section style={{ padding: '0 0 48px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Step 2 · Review every claim</div>
                <h3 style={{ fontSize: 22 }}>Accept, adjust, or reject.</h3>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--color-ink-3)' }}>
                  {acceptedPhaseCount + acceptedLandmarkCount} of {totalClaims} accepted
                </span>
                <button className="btn btn-accent" onClick={promote} disabled={acceptedPhaseCount + acceptedLandmarkCount === 0}>
                  Download {result.slug}.json
                </button>
              </div>
            </div>

            <div className="runcino-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ padding: '16px 24px', background: 'var(--color-paper-2)', borderBottom: '1px solid var(--color-line)' }}>
                <strong style={{ fontSize: 13 }}>Phases · {result.facts.phases.length} proposed</strong>
              </div>
              {result.facts.phases.map((phase, i) => (
                <ClaimRow
                  key={i}
                  selected={accepted.phases.has(i)}
                  onToggle={() => toggle('phases', i)}
                  primary={`${phase.start_mi}–${phase.end_mi} mi`}
                  label={phase.label}
                  note={phase.note}
                  sources={phase.sources}
                />
              ))}
            </div>

            <div className="runcino-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 24px', background: 'var(--color-paper-2)', borderBottom: '1px solid var(--color-line)' }}>
                <strong style={{ fontSize: 13 }}>Landmarks · {result.facts.landmarks.length} proposed</strong>
              </div>
              {result.facts.landmarks.map((l, i) => (
                <ClaimRow
                  key={i}
                  selected={accepted.landmarks.has(i)}
                  onToggle={() => toggle('landmarks', i)}
                  primary={`mile ${l.at_mi}`}
                  label={l.label}
                  note={l.note}
                  sources={l.sources}
                />
              ))}
            </div>
          </section>
        </>
      )}

      <Footer tag="research workflow" />
    </main>
  );
}

function ClaimRow({
  selected, onToggle, primary, label, note, sources,
}: {
  selected: boolean;
  onToggle: () => void;
  primary: string;
  label: string;
  note: string;
  sources: SourceCitation[];
}) {
  const topSource = sources[0];
  const isPrimary = topSource?.confidence === 'primary_source_verified';
  const confidenceColor =
    topSource?.confidence === 'primary_source_verified' ? 'var(--color-terracotta)' :
    topSource?.confidence === 'secondary_source' ? 'var(--color-sage)' :
                                                   'var(--color-danger)';
  return (
    <div style={{
      padding: '18px 24px',
      display: 'grid',
      gridTemplateColumns: '150px 1fr auto auto',
      gap: 16,
      alignItems: 'center',
      borderBottom: '1px solid var(--color-line)',
      background: selected ? '#F5FAF0' : 'var(--color-paper)',
    }}>
      <span className="font-mono" style={{ fontWeight: 500, fontSize: 14 }}>{primary}</span>
      <div>
        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--color-ink-3)', marginBottom: 6 }}>{note}</div>
        {topSource && (
          <div style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>
            Source: <a href={topSource.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-terracotta)' }}>{short(topSource.url)}</a>
            {topSource.verified_quote && <span style={{ fontStyle: 'italic' }}> — "{topSource.verified_quote}"</span>}
          </div>
        )}
      </div>
      <span className="runcino-pill" style={{ background: isPrimary ? 'var(--color-terracotta-3)' : 'var(--color-paper-2)', color: confidenceColor, borderColor: 'transparent' }}>
        <span className="runcino-pill-dot" style={{ background: confidenceColor }} />
        {topSource?.confidence.replace(/_/g, ' ') ?? 'unknown'}
      </span>
      <button
        onClick={onToggle}
        className={selected ? 'btn btn-accent' : 'btn btn-ghost'}
        style={{ padding: '8px 16px', fontSize: 12 }}
      >
        {selected ? '✓ Accepted' : 'Accept'}
      </button>
    </div>
  );
}

function short(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 30 ? u.pathname.slice(0, 30) + '…' : u.pathname);
  } catch {
    return url;
  }
}

function countUniqueSources(facts: CourseFacts): number {
  const set = new Set<string>();
  for (const s of facts.race.sources) set.add(s.url);
  for (const p of facts.phases) for (const s of p.sources) set.add(s.url);
  for (const l of facts.landmarks) for (const s of l.sources) set.add(s.url);
  return set.size;
}
