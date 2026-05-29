'use client';

/**
 * GPX finder UI — sits next to the manual GPX upload button on
 * /races/[slug]. Opens a modal that:
 *   1. searches the user's Strava routes for the race name
 *   2. shows ranked candidates with source + distance + confidence
 *   3. user picks one → POST /api/gpx/import → router.refresh
 *
 * No LLM, no scraping — deterministic Strava Routes API lookup.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Candidate {
  source: 'strava_route' | 'strava_starred';
  sourceId: string;
  name: string;
  distanceMi: number;
  elevationGainFt: number | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  confidence: number;
}

export function GpxFinderButton({
  slug, raceName, distanceMi,
}: {
  slug: string;
  raceName: string;
  distanceMi: number | null | undefined;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-block',
          background: 'transparent',
          border: '1px solid var(--green)',
          color: 'var(--green)',
          padding: '8px 14px',
          borderRadius: 10,
          fontFamily: 'var(--f-label)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          cursor: 'pointer',
          marginRight: 8,
        }}
      >
        ⌕ FIND COURSE
      </button>
      {open && (
        <FinderModal
          slug={slug}
          raceName={raceName}
          distanceMi={distanceMi}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FinderModal({
  slug, raceName, distanceMi, onClose,
}: {
  slug: string;
  raceName: string;
  distanceMi: number | null | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState(raceName);
  const [searching, setSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  async function search() {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    setReason(null);
    setCandidates(null);
    try {
      const url = new URL('/api/gpx/search', window.location.origin);
      url.searchParams.set('q', q.trim());
      if (distanceMi) url.searchParams.set('distanceMi', String(distanceMi));
      const r = await fetch(url.toString());
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setCandidates(data.candidates ?? []);
      if (data.reason) setReason(data.reason);
    } catch (e: any) {
      setError(e?.message ?? 'search failed');
    } finally {
      setSearching(false);
    }
  }

  async function importOne(c: Candidate) {
    setImportingId(c.sourceId);
    setError(null);
    try {
      const r = await fetch('/api/gpx/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raceSlug: slug, source: c.source, sourceId: c.sourceId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      onClose();
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? 'import failed');
      setImportingId(null);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,17,13,0.55)', backdropFilter: 'blur(10px)',
        zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)', border: '1px solid var(--line)',
          boxShadow: '0 24px 60px rgba(20,17,13,0.22)', borderRadius: 4,
          padding: '24px 28px', maxWidth: 640, width: '100%', maxHeight: '85vh', overflow: 'auto',
        }}
      >
        <div className="card-eyebrow" style={{ color: 'var(--green)' }}>FIND COURSE · GPX</div>
        <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 30, margin: '6px 0 4px', letterSpacing: '0.5px' }}>
          Search your Strava routes.
        </h2>
        <p style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', lineHeight: 1.6, marginBottom: 16 }}>
          Searches the routes in your connected Strava account — both your own and
          routes you've starred. Pick a match and we'll import the course GPS line
          + elevation profile. No course file? Use the manual upload button next
          to "FIND COURSE."
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Race name"
            style={{
              flex: 1,
              background: 'var(--card-2)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '10px 14px',
              color: 'var(--ink)',
              fontFamily: 'var(--f-body)',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button
            onClick={search}
            disabled={searching || !q.trim()}
            style={{
              background: 'var(--green)',
              color: '#0e1014',
              border: 'none',
              borderRadius: 10,
              padding: '10px 18px',
              fontFamily: 'var(--f-label)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '1.2px',
              textTransform: 'uppercase',
              cursor: searching ? 'wait' : 'pointer',
              opacity: searching ? 0.6 : 1,
            }}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(252,77,100,0.08)', border: '1px solid rgba(252,77,100,0.22)',
            color: 'var(--over)', fontFamily: 'var(--f-body)', fontSize: 12, marginBottom: 12,
          }}>
            {error}
          </div>
        )}

        {reason && (
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(243,173,56,0.08)', border: '1px solid rgba(243,173,56,0.22)',
            color: 'var(--goal)', fontFamily: 'var(--f-body)', fontSize: 12, marginBottom: 12,
          }}>
            {reason}
          </div>
        )}

        {candidates && candidates.length === 0 && !reason && (
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', padding: '12px 0' }}>
            No matches in your Strava routes. Try a different name, or use the manual upload button.
          </div>
        )}

        {candidates && candidates.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {candidates.map((c) => {
              const isImporting = importingId === c.sourceId;
              const distOff = distanceMi ? Math.abs(c.distanceMi - distanceMi) : null;
              return (
                <button
                  key={c.sourceId}
                  onClick={() => importOne(c)}
                  disabled={importingId != null}
                  type="button"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'var(--card-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    cursor: importingId ? 'wait' : 'pointer',
                    opacity: importingId && !isImporting ? 0.4 : 1,
                    textAlign: 'left',
                    font: 'inherit', color: 'inherit', width: '100%',
                  }}
                  onMouseEnter={(e) => { if (!importingId) e.currentTarget.style.background = 'rgba(62,189,65,0.06)'; }}
                  onMouseLeave={(e) => { if (!importingId) e.currentTarget.style.background = 'var(--card-2)'; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--f-label)', fontSize: 16, color: 'var(--ink)', letterSpacing: '0.3px', lineHeight: 1.2 }}>
                      {c.name}
                    </div>
                    <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 4 }}>
                      {c.distanceMi.toFixed(2)} mi
                      {c.elevationGainFt != null ? ` · ${c.elevationGainFt}ft gain` : ''}
                      {distOff != null && distOff > 0.05 ? ` · ${distOff > 0 ? '+' : ''}${distOff.toFixed(2)}mi vs race` : ''}
                    </div>
                    <div style={{ fontFamily: 'var(--f-label)', fontSize: 9, color: 'var(--dim)', marginTop: 4, letterSpacing: '0.8px' }}>
                      {c.source === 'strava_route' ? 'YOUR STRAVA ROUTE' : 'STARRED ROUTE'}
                      {c.uploadedBy ? ` · ${c.uploadedBy.toUpperCase()}` : ''}
                    </div>
                  </div>
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
                  }}>
                    <span style={{
                      fontFamily: 'var(--f-label)', fontSize: 10, letterSpacing: '1px', fontWeight: 700,
                      color: c.confidence >= 0.7 ? 'var(--green)' : c.confidence >= 0.4 ? 'var(--goal)' : 'var(--mute)',
                    }}>
                      {Math.round(c.confidence * 100)}% MATCH
                    </span>
                    <span style={{
                      fontFamily: 'var(--f-label)', fontSize: 10, letterSpacing: '1.2px', color: 'var(--green)',
                    }}>
                      {isImporting ? 'IMPORTING…' : 'IMPORT →'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--line)',
              color: 'var(--mute)', borderRadius: 8, padding: '8px 14px',
              fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1.2px', cursor: 'pointer',
            }}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
