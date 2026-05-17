'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Caption } from '../../../components/nav';
import { Topbar } from '../../components/Topbar';
import { TopbarClock } from '../../components/TopbarClock';
import { saveRace, listRaces, slugifyRaceName } from '../../../lib/storage';
import { parseGpx } from '../../../lib/gpx';
import { analyzeGpx, type CourseAnalysis } from '../../../lib/gpx-analysis';
import type { FaffPlan } from '../../../lib/types';
import type { ExtractedAidStation, ExtractionResult } from '../../../lib/aid-extraction';
import type { SavedRace } from '../../../lib/storage-types';
import CoursePreview from '../../../components/CoursePreview';

// ── Types ────────────────────────────────────────────────────────────────────

type FormPhase = 'input' | 'processing' | 'review' | 'building';

type AidStationRow = ExtractedAidStation & {
  status: 'approved' | 'rejected';
  editingMi: boolean;
  editedMi: string;
  editedLabel: string;
};

type ProcessResult = {
  analysis: CourseAnalysis;
  extractionResult: ExtractionResult;
  aidRows: AidStationRow[];
};

type BuildResult = {
  planJsonText: string;
  demElevations?: number[];
  summary: {
    raceName: string;
    courseSlug: string;
    goalDisplay: string;
    phases: Array<{
      label: string; startMi: number; endMi: number;
      paceDisplay: string; grade: number; cumulativeDisplay: string;
    }>;
    gelCount: number; totalCarbsG: number;
    landmarkCount: number; intervalCount: number;
    geometryWarnings: string[]; geometryErrors: string[];
  };
};

// ── Constants ─────────────────────────────────────────────────────────────────

const REGISTERED = [
  { slug: 'big-sur-marathon',   label: 'Big Sur International Marathon' },
  { slug: 'sombrero-half',      label: 'Sombrero Half Marathon' },
  { slug: 'americas-finest-city', label: "America's Finest City Half Marathon" },
  { slug: 'cim',                label: 'California International Marathon' },
] as const;

const DISTANCES = [
  { id: 'marathon', label: 'Marathon',      mi: 26.22, defaultGoal: '3:30:00' },
  { id: 'half',     label: 'Half marathon', mi: 13.10, defaultGoal: '1:35:00' },
  { id: '10k',      label: '10K',           mi: 6.21,  defaultGoal: '0:45:00' },
  { id: '5k',       label: '5K',            mi: 3.10,  defaultGoal: '0:22:00' },
  { id: 'custom',   label: 'Other',         mi: 0,     defaultGoal: '1:30:00' },
] as const;
type DistanceId = typeof DISTANCES[number]['id'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseGoalHMS(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NewRacePage() {
  const router = useRouter();

  // — Form fields —
  const [raceName, setRaceName] = useState('');
  const [raceDate, setRaceDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState('07:00');
  const [distanceId, setDistanceId] = useState<DistanceId | null>(null);
  const [goalHMS, setGoalHMS] = useState('1:30:00');
  const [goalDirty, setGoalDirty] = useState(false);
  const [strategy, setStrategy] = useState<'even_effort' | 'even_split' | 'negative_split'>('even_effort');
  const [tolerance, setTolerance] = useState(10);
  const [officialUrl, setOfficialUrl] = useState('');
  const [guideUrl, setGuideUrl] = useState('');
  const [usatfCert, setUsatfCert] = useState('');

  // — GPX —
  const [gpxName, setGpxName] = useState<string | null>(null);
  const [gpxText, setGpxText] = useState<string | null>(null);
  const [manualPaste, setManualPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);

  // — Flow state —
  const [phase, setPhase] = useState<FormPhase>('input');
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);

  // — Misc —
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [takenSlugs, setTakenSlugs] = useState<Set<string>>(new Set());
  useEffect(() => {
    listRaces().then(rs => setTakenSlugs(new Set(rs.map(r => r.slug))));
  }, []);

  function pickDistance(id: DistanceId) {
    setDistanceId(id);
    if (!goalDirty) {
      const d = DISTANCES.find(x => x.id === id);
      if (d) setGoalHMS(d.defaultGoal);
    }
  }

  const goalFinishS = useMemo(() => parseGoalHMS(goalHMS), [goalHMS]);

  const gpxDistanceMi = useMemo(() => {
    if (!gpxText) return null;
    try { return parseGpx(gpxText).totalDistanceM / 1609.344; }
    catch { return null; }
  }, [gpxText]);

  const gpxDistanceMismatch = useMemo(() => {
    if (gpxDistanceMi == null || !distanceId || distanceId === 'custom') return null;
    const expected = DISTANCES.find(d => d.id === distanceId);
    if (!expected || expected.mi <= 0) return null;
    if (Math.abs(gpxDistanceMi - expected.mi) / expected.mi < 0.15) return null;
    return { gpxMi: gpxDistanceMi, expectedLabel: expected.label };
  }, [gpxDistanceMi, distanceId]);

  const courseSlug = useMemo(() => {
    const lower = raceName.trim().toLowerCase();
    const match = REGISTERED.find(r => lower.includes(r.label.toLowerCase().slice(0, 8)));
    if (match) return match.slug;
    if (!raceName.trim()) return '';
    return slugifyRaceName(raceName, takenSlugs);
  }, [raceName, takenSlugs]);

  const courseMi = useMemo(() => {
    if (distanceId && distanceId !== 'custom') {
      return DISTANCES.find(d => d.id === distanceId)?.mi ?? gpxDistanceMi ?? 13.1;
    }
    return gpxDistanceMi ?? 13.1;
  }, [distanceId, gpxDistanceMi]);

  // — File handling —
  function handleFile(file: File) {
    setProcessError(null);
    setProcessResult(null);
    setPhase('input');
    if (!file.name.toLowerCase().match(/\.(gpx|tcx)$/)) {
      setProcessError('Please drop a .gpx or .tcx file.');
      return;
    }
    setGpxName(file.name);
    const reader = new FileReader();
    reader.onload = e => setGpxText(String(e.target?.result ?? ''));
    reader.readAsText(file);
  }

  // — Can we run Process? —
  const canProcess = Boolean(
    raceName.trim() && raceDate && goalFinishS && gpxText && courseSlug &&
    officialUrl && isValidUrl(officialUrl)
  );

  // — Process Race Data —
  // Analyze the GPX in-browser (StravaGPX-calibrated threshold gain/loss)
  // and extract aid stations from the official race URL in parallel.
  async function handleProcess() {
    if (!canProcess || !gpxText) return;
    setProcessError(null);
    setPhase('processing');
    try {
      const analysis = analyzeGpx(gpxText);

      const aidRes = await fetch('/api/extract-aid-stations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          officialUrl,
          athleteGuidePdfUrl: guideUrl || undefined,
          manualPasteText: manualPaste || undefined,
          courseDistanceMi: courseMi,
        }),
      });
      const extractionResult = await aidRes.json() as ExtractionResult;

      // Show manual-paste prompt if fewer than 3 stations extracted
      if (extractionResult.stations.length < 3 && !manualPaste) {
        setShowPaste(true);
      }

      const aidRows: AidStationRow[] = extractionResult.stations.map(s => ({
        ...s,
        status: 'approved',
        editingMi: false,
        editedMi: String(s.at_mi),
        editedLabel: s.label,
      }));

      setProcessResult({ analysis, extractionResult, aidRows });
      setPhase('review');
    } catch (e) {
      setProcessError(e instanceof Error ? e.message : String(e));
      setPhase('input');
    }
  }

  // — Re-run extraction with pasted text —
  async function handleRunPaste() {
    if (!manualPaste.trim() || !processResult) return;
    try {
      const aidRes = await fetch('/api/extract-aid-stations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          officialUrl,
          manualPasteText: manualPaste,
          courseDistanceMi: courseMi,
        }),
      });
      const extractionResult = await aidRes.json() as ExtractionResult;
      const aidRows: AidStationRow[] = extractionResult.stations.map(s => ({
        ...s,
        status: 'approved',
        editingMi: false,
        editedMi: String(s.at_mi),
        editedLabel: s.label,
      }));
      setProcessResult(r => r ? { ...r, extractionResult, aidRows } : r);
      setShowPaste(false);
    } catch { /* keep existing rows */ }
  }

  // — Aid station row mutations —
  function toggleAidStatus(idx: number) {
    setProcessResult(r => {
      if (!r) return r;
      const rows = [...r.aidRows];
      rows[idx] = { ...rows[idx], status: rows[idx].status === 'approved' ? 'rejected' : 'approved' };
      return { ...r, aidRows: rows };
    });
  }
  function commitAidEdit(idx: number) {
    setProcessResult(r => {
      if (!r) return r;
      const rows = [...r.aidRows];
      const mi = parseFloat(rows[idx].editedMi);
      rows[idx] = {
        ...rows[idx],
        at_mi: Number.isFinite(mi) ? Math.round(mi * 10) / 10 : rows[idx].at_mi,
        label: rows[idx].editedLabel || rows[idx].label,
        confidence: 'primary_source_verified',
        editingMi: false,
      };
      return { ...r, aidRows: rows.sort((a, b) => a.at_mi - b.at_mi) };
    });
  }

  // — Build Race Plan —
  // Feeds the analyzed track to /api/build-plan as the "demTrack" — the
  // pacing engine reads point eleM directly, so the StravaGPX-calibrated
  // elevations stand in for the old DEM-corrected channel.
  async function handleBuild() {
    if (!processResult || !gpxText || !goalFinishS) return;
    setBuildError(null);
    setPhase('building');
    try {
      const approvedStations = processResult.aidRows
        .filter(r => r.status === 'approved')
        .map(r => r.at_mi);

      const canonical = distanceId && distanceId !== 'custom'
        ? DISTANCES.find(d => d.id === distanceId)?.mi : null;

      // Mirror eleM into demEleM so downstream consumers that prefer
      // demEleM still resolve a value. No external DEM call needed.
      const trackWithEle = {
        ...processResult.analysis.track,
        points: processResult.analysis.track.points.map(p => ({ ...p, demEleM: p.eleM })),
        demGainFt: Math.round(processResult.analysis.stats.gainFt),
        demLossFt: Math.round(processResult.analysis.stats.lossFt),
      };

      const res = await fetch('/api/build-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gpxText,
          demTrack: trackWithEle,
          verifiedAidStationMiles: approvedStations,
          courseSlug,
          raceName: raceName.trim(),
          raceDate,
          goalFinishS,
          strategy,
          toleranceSPerMi: tolerance,
          fitness: {
            baselineName: 'Self-reported', baselineFinish: '0:00:00',
            baselineMonthsAgo: 0, weeklyMileage: 0, weeklyMileageTrend: 0,
            longestLongRunMi: 0, longestLongRunAgeWk: 0,
            restingHr: 0, restingHrTrend: 0,
          },
          claudeRationale: null,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Build failed (${res.status}): ${txt.slice(0, 200)}`);
      }
      const data: BuildResult = await res.json();
      const plan = JSON.parse(data.planJsonText) as FaffPlan;
      const headlineDistance = canonical ?? plan.race.distance_mi;

      // Save overrides sidecar in dev
      if (process.env.NODE_ENV === 'development' && courseSlug) {
        const overrides = {
          slug: courseSlug,
          locked_at: new Date().toISOString().slice(0, 10),
          locked_by: 'david',
          verified: false,
          verified_at: null,
          elevation: {
            source: 'StravaGPX threshold (2 m)',
            total_gain_ft: Math.round(processResult.analysis.stats.gainFt),
            total_loss_ft: Math.round(processResult.analysis.stats.lossFt),
          },
          aid_stations: approvedStations.length
            ? processResult.aidRows
                .filter(r => r.status === 'approved')
                .map(r => ({ at_mi: r.at_mi, label: r.label, source: r.source_url }))
            : null,
          field_locks: {},
        };
        await fetch('/api/save-overrides', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: courseSlug, overrides }),
        }).catch(() => {/* non-fatal */});
      }

      const saved: SavedRace = {
        slug: courseSlug,
        plan,
        gpxText,
        demElevations: data.demElevations,
        savedAt: new Date().toISOString(),
        meta: {
          name: data.summary.raceName,
          date: raceDate,
          distanceMi: headlineDistance,
          goalDisplay: data.summary.goalDisplay,
          courseSlug,
        },
      };
      await saveRace(saved);
      router.push(`/races/${saved.slug}`);
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e));
      setPhase('review');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Caption left="faff.run · races · new" right="ADD RACE" />
      <div className="stage">
        <Topbar activeTab="races" clock={<TopbarClock />} />
        <div className="body">

          {/* ── Header ── */}
          <div className="page-head">
            <div>
              <div className="eyebrow">Add a race</div>
              <h1>New race</h1>
              <div className="sub">
                Fill out the form, upload your GPX, then click <b>Process Race Data</b> to get real DEM elevation and extract aid stations.
              </div>
            </div>
            <div className="page-actions">
              <button onClick={() => router.push('/races')} className="btn btn--ghost">Cancel</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
            {/* ── LEFT: form + review ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* Step 1: Race basics */}
              <div className="tile">
                <div className="tile-h">
                  <div><div className="tile-sub">Step 1</div><div className="tile-lbl">Race basics</div></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
                  <div>
                    <label className="faff-label">Race name</label>
                    <input className="faff-input" placeholder="e.g. America's Finest City Half"
                      value={raceName} onChange={e => setRaceName(e.target.value)} />
                  </div>
                  <div>
                    <label className="faff-label">Date</label>
                    <input className="faff-input font-data" type="date"
                      value={raceDate} onChange={e => setRaceDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="faff-label">Start time</label>
                    <input className="faff-input font-data" type="time"
                      value={startTime} onChange={e => setStartTime(e.target.value)} />
                  </div>
                </div>

                {/* Official URL + optional fields */}
                <div style={{ marginTop: 14 }}>
                  <label className="faff-label">Official race URL <span style={{ color: 'var(--color-warning)' }}>*</span></label>
                  <input className="faff-input" type="url"
                    placeholder="https://www.afcmarathon.com/course"
                    value={officialUrl} onChange={e => setOfficialUrl(e.target.value)} />
                  {officialUrl && !isValidUrl(officialUrl) && (
                    <div className="hint" style={{ color: 'var(--color-warning)', marginTop: 4 }}>Enter a valid URL (include https://)</div>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                  <div>
                    <label className="faff-label">Athlete guide PDF URL <span style={{ color: 'var(--color-t3)' }}>(optional)</span></label>
                    <input className="faff-input" type="url"
                      placeholder="https://example.com/guide.pdf"
                      value={guideUrl} onChange={e => setGuideUrl(e.target.value)} />
                  </div>
                  <div>
                    <label className="faff-label">USATF cert # <span style={{ color: 'var(--color-t3)' }}>(optional)</span></label>
                    <input className="faff-input font-data"
                      placeholder="CA11106RS"
                      value={usatfCert} onChange={e => setUsatfCert(e.target.value.toUpperCase())} />
                    {usatfCert && !/^[A-Z]{2}\d{5}[A-Z]{2}$/.test(usatfCert) && (
                      <div className="hint" style={{ color: 'var(--color-t3)', marginTop: 4 }}>Format: 2 letters, 5 digits, 2 letters</div>
                    )}
                  </div>
                </div>

                {/* Distance picker */}
                <div style={{ marginTop: 14 }}>
                  <label className="faff-label">Distance</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {DISTANCES.map(d => {
                      const active = distanceId === d.id;
                      return (
                        <button key={d.id} type="button" onClick={() => pickDistance(d.id)} style={{
                          padding: '12px 10px', textAlign: 'center',
                          border: `1px solid ${active ? 'var(--color-attention)' : 'var(--color-l4)'}`,
                          background: active ? 'rgba(243,173,59,.10)' : 'var(--color-l2)',
                          borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-t0)',
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-display)', textTransform: 'uppercase' }}>{d.label}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--color-t3)', marginTop: 4, fontFamily: 'var(--font-data)', letterSpacing: '1.2px', fontWeight: 700 }}>
                            {d.mi > 0 ? `${d.mi.toFixed(d.id === '5k' || d.id === '10k' ? 1 : 2)} MI` : 'CUSTOM'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {courseSlug && (
                  <div className="hint" style={{ marginTop: 12 }}>
                    Slug · <b style={{ color: 'var(--color-t1)' }}>{courseSlug}</b>
                    {REGISTERED.some(r => r.slug === courseSlug)
                      ? <span style={{ marginLeft: 8, color: 'var(--color-success)' }}>✓ Registered course</span>
                      : <span style={{ marginLeft: 8 }}>Custom course</span>}
                  </div>
                )}
                {gpxDistanceMismatch && (
                  <div className="hint" style={{ marginTop: 8, color: 'var(--color-warning)' }}>
                    ⚠ GPX measures ~{gpxDistanceMismatch.gpxMi.toFixed(1)} mi but you picked {gpxDistanceMismatch.expectedLabel}.
                  </div>
                )}
              </div>

              {/* Step 2: GPX */}
              <div className="tile">
                <div className="tile-h">
                  <div><div className="tile-sub">Step 2</div><div className="tile-lbl">Course track (GPX)</div></div>
                </div>
                <div ref={dropRef}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); dropRef.current?.setAttribute('data-active', ''); }}
                  onDragLeave={e => { e.preventDefault(); dropRef.current?.removeAttribute('data-active'); }}
                  onDrop={e => { e.preventDefault(); dropRef.current?.removeAttribute('data-active'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                  style={{
                    border: '1.5px dashed var(--color-l5)', borderRadius: 12, padding: 36,
                    textAlign: 'center', background: 'var(--color-l2)', cursor: 'pointer',
                    transition: 'border-color 120ms ease, background 120ms ease',
                  }}>
                  <div style={{ fontSize: 32, marginBottom: 8, color: 'var(--color-attention)' }}>↑</div>
                  {gpxName ? (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{gpxName}</div>
                      {gpxDistanceMi && <div className="hint" style={{ marginBottom: 4 }}>{gpxDistanceMi.toFixed(2)} mi · GPS</div>}
                      <div className="hint">Click to replace</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Drop your GPX here</div>
                      <div className="hint" style={{ marginTop: 4 }}>.gpx or .tcx · parsed in-browser, never uploaded</div>
                    </>
                  )}
                  <input ref={fileInputRef} type="file" accept=".gpx,.tcx" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                </div>
                <div className="hint" style={{ marginTop: 10, fontSize: 11.5 }}>
                  StravaGPX exports work best — elevations are already terrain-corrected.
                </div>
              </div>

              {/* Step 3: Goal & strategy */}
              <div className="tile">
                <div className="tile-h">
                  <div><div className="tile-sub">Step 3</div><div className="tile-lbl">Goal & strategy</div></div>
                  <span className="chip chip--attention">Required</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
                  <div>
                    <label className="faff-label">Goal finish time</label>
                    <input className="faff-input font-data" style={{ fontSize: 18 }}
                      placeholder="h:mm:ss" value={goalHMS}
                      onChange={e => { setGoalHMS(e.target.value); setGoalDirty(true); }} />
                    <div className="hint" style={{ marginTop: 4 }}>
                      {goalFinishS ? `${(goalFinishS / 60).toFixed(1)} min`
                        : <span style={{ color: 'var(--color-warning)' }}>Use h:mm:ss</span>}
                    </div>
                  </div>
                  <div>
                    <label className="faff-label">Pacing strategy</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {([
                        { id: 'even_effort', name: 'Even effort', desc: 'Minetti GAP · default' },
                        { id: 'even_split', name: 'Even split', desc: 'Same pace everywhere' },
                        { id: 'negative_split', name: 'Negative split', desc: 'Conservative first half' },
                      ] as const).map(opt => (
                        <button key={opt.id} onClick={() => setStrategy(opt.id)} style={{
                          padding: '12px 14px', textAlign: 'left',
                          border: `1px solid ${strategy === opt.id ? 'var(--color-attention)' : 'var(--color-l4)'}`,
                          background: strategy === opt.id ? 'rgba(243,173,59,.08)' : 'var(--color-l2)',
                          borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--color-t0)',
                        }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{opt.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 3 }}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 18 }}>
                  <label className="faff-label">Watch tolerance · ±{tolerance} sec/mi</label>
                  <input type="range" min={5} max={15} value={tolerance}
                    onChange={e => setTolerance(Number(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-attention)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-t3)', fontFamily: 'var(--font-data)', letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700 }}>
                    <span>±5 strict</span><span>±15 loose</span>
                  </div>
                </div>
              </div>

              {/* Process button */}
              {phase === 'input' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {processError && (
                    <div className="tile" style={{ borderColor: 'rgba(252,77,84,.4)', background: 'rgba(252,77,84,.08)', color: '#FECDCB', fontSize: 13 }}>
                      <b style={{ color: 'var(--color-warning)' }}>Processing failed.</b> {processError}
                    </div>
                  )}
                  <button
                    onClick={handleProcess}
                    disabled={!canProcess}
                    className="btn btn--primary"
                    style={{ alignSelf: 'stretch', padding: '16px 24px', fontSize: 15 }}
                  >
                    Process Race Data →
                  </button>
                  {!canProcess && (
                    <div className="hint" style={{ textAlign: 'center' }}>
                      {!raceName.trim() ? 'Enter a race name' :
                       !gpxText ? 'Upload a GPX file' :
                       !officialUrl || !isValidUrl(officialUrl) ? 'Enter a valid official race URL' :
                       !goalFinishS ? 'Enter a goal time (h:mm:ss)' : ''}
                    </div>
                  )}
                </div>
              )}

              {/* Processing spinner */}
              {phase === 'processing' && (
                <div className="tile" style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ fontSize: 24, marginBottom: 12, color: 'var(--color-attention)' }}>⏳</div>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Analyzing course + extracting aid stations…</div>
                  <div className="hint">Parses the GPX in-browser and queries the official race URL. ~5–15 seconds.</div>
                </div>
              )}

              {/* ── Review panel ── */}
              {(phase === 'review' || phase === 'building') && processResult && (
                <>
                  {/* Course preview — full GPX analysis. Replaces the
                      old DEM elevation card. */}
                  <div className="tile">
                    <div className="tile-h">
                      <div>
                        <div className="tile-sub">Step 4 · Course preview</div>
                        <div className="tile-lbl">GPX analysis</div>
                      </div>
                      <button
                        onClick={() => { setProcessResult(null); setPhase('input'); }}
                        className="btn btn--ghost"
                        style={{ fontSize: 11 }}
                      >
                        ← Re-process
                      </button>
                    </div>
                    <CoursePreview analysis={processResult.analysis} compact />
                  </div>

                  {/* Aid station review card */}
                  <div className="tile">
                    <div className="tile-h">
                      <div>
                        <div className="tile-sub">Step 5 · Aid Stations</div>
                        <div className="tile-lbl">
                          {processResult.aidRows.length === 0 ? 'None extracted' :
                           `${processResult.aidRows.filter(r => r.status === 'approved').length} of ${processResult.aidRows.length} approved`}
                        </div>
                      </div>
                      <span className="chip" style={{ background: 'rgba(62,189,65,.15)', color: 'var(--color-success)' }}>
                        {processResult.extractionResult.method.toUpperCase()}
                      </span>
                    </div>

                    {processResult.aidRows.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {processResult.aidRows.map((row, idx) => (
                          <AidRow
                            key={idx}
                            row={row}
                            onToggle={() => toggleAidStatus(idx)}
                            onEdit={() => setProcessResult(r => r ? { ...r, aidRows: r.aidRows.map((x, i) => i === idx ? { ...x, editingMi: true } : x) } : r)}
                            onCommit={() => commitAidEdit(idx)}
                            onChangeMi={v => setProcessResult(r => r ? { ...r, aidRows: r.aidRows.map((x, i) => i === idx ? { ...x, editedMi: v } : x) } : r)}
                            onChangeLabel={v => setProcessResult(r => r ? { ...r, aidRows: r.aidRows.map((x, i) => i === idx ? { ...x, editedLabel: v } : x) } : r)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="hint" style={{ marginBottom: 8 }}>No aid stations could be extracted automatically from the race URL.</div>
                    )}

                    {/* Manual paste section */}
                    {(showPaste || processResult.aidRows.length < 3) && (
                      <div style={{ marginTop: 14, padding: 14, background: 'var(--color-l2)', borderRadius: 10, border: '1px solid var(--color-l4)' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--color-t1)' }}>
                          Aid station data not found automatically. Paste the aid station list here (one per line, e.g. &quot;Mile 3.2 – Water + Gels&quot;).
                        </div>
                        <textarea
                          value={manualPaste}
                          onChange={e => setManualPaste(e.target.value)}
                          rows={5}
                          placeholder="Mile 1.5 – Water&#10;Mile 3.2 – Water + Gels&#10;Mile 6.0 – Water + Gels + First Aid"
                          style={{
                            width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                            background: 'var(--color-l1)', border: '1px solid var(--color-l4)',
                            borderRadius: 8, color: 'var(--color-t0)', fontSize: 12,
                            fontFamily: 'var(--font-data)', resize: 'vertical',
                          }}
                        />
                        <button
                          onClick={handleRunPaste}
                          disabled={!manualPaste.trim()}
                          className="btn btn--ghost"
                          style={{ marginTop: 8, fontSize: 12 }}
                        >
                          Parse pasted text
                        </button>
                      </div>
                    )}
                  </div>

                  {/* USATF cert prompt if provided but JS-rendered */}
                  {usatfCert && (
                    <div className="tile" style={{ background: 'rgba(243,173,59,.05)', borderColor: 'rgba(243,173,59,.3)' }}>
                      <div className="tile-sub" style={{ marginBottom: 8, color: 'var(--color-attention)' }}>USATF Cert · {usatfCert}</div>
                      <p style={{ fontSize: 13, color: 'var(--color-t1)', margin: 0, lineHeight: 1.5 }}>
                        The USATF cert page is JavaScript-rendered and can&apos;t be fetched automatically.
                        Open <a href={`https://www.certifiedroadraces.com/course/?cert=${usatfCert}`} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--color-attention)' }}>certifiedroadraces.com/course/?cert={usatfCert}</a> and
                        note the <b>start elevation</b>, <b>finish elevation</b>, and <b>net drop</b> — then paste them into the
                        overrides sidecar after the plan is created.
                      </p>
                    </div>
                  )}

                  {/* Build button */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {buildError && (
                      <div className="tile" style={{ borderColor: 'rgba(252,77,84,.4)', background: 'rgba(252,77,84,.08)', color: '#FECDCB', fontSize: 13 }}>
                        <b style={{ color: 'var(--color-warning)' }}>Build failed.</b> {buildError}
                      </div>
                    )}
                    <button
                      onClick={handleBuild}
                      disabled={phase === 'building'}
                      className="btn btn--primary"
                      style={{ alignSelf: 'stretch', padding: '16px 24px', fontSize: 15 }}
                    >
                      {phase === 'building' ? 'Building plan…' : 'Create Race Plan →'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ── RIGHT: status rail ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <PhaseStatusCard phase={phase} processResult={processResult} />

              <div className="tile" style={{ background: 'rgba(0,143,236,.06)', borderColor: 'rgba(0,143,236,.2)' }}>
                <div className="tile-sub" style={{ marginBottom: 8, color: 'var(--color-corporate)' }}>How elevation is measured</div>
                <p style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.5, margin: 0 }}>
                  GPX is parsed in-browser. Gain/loss use a 2 m threshold filter calibrated against Strava on StravaGPX exports — typically within ~2% of Strava&apos;s reported number. For best accuracy, export from Strava routes (already DEM-corrected).
                </p>
              </div>

              <div className="tile" style={{ background: 'rgba(243,173,59,.06)', borderColor: 'rgba(243,173,59,.2)' }}>
                <div className="tile-sub" style={{ marginBottom: 8, color: 'var(--color-attention)' }}>Aid station extraction</div>
                <p style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.5, margin: 0 }}>
                  Aid stations are parsed from the official race URL or athlete guide PDF. If the page uses images or JavaScript, paste the aid station text manually. Claude fueling only fires when verified stations are present.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: 'var(--color-t3)', fontFamily: 'var(--font-data)', letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-data)', color: warn ? 'var(--color-warning)' : 'var(--color-t0)' }}>{value}</div>
    </div>
  );
}

function AidRow({ row, onToggle, onEdit, onCommit, onChangeMi, onChangeLabel }: {
  row: AidStationRow;
  onToggle: () => void;
  onEdit: () => void;
  onCommit: () => void;
  onChangeMi: (v: string) => void;
  onChangeLabel: (v: string) => void;
}) {
  const rejected = row.status === 'rejected';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', borderRadius: 8,
      background: rejected ? 'rgba(252,77,84,.06)' : 'var(--color-l2)',
      border: `1px solid ${rejected ? 'rgba(252,77,84,.3)' : 'var(--color-l4)'}`,
      opacity: rejected ? 0.6 : 1,
    }}>
      {/* Mile mark */}
      {row.editingMi ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={row.editedMi} onChange={e => onChangeMi(e.target.value)}
            style={{ width: 56, padding: '4px 8px', background: 'var(--color-l1)', border: '1px solid var(--color-l5)', borderRadius: 6, color: 'var(--color-t0)', fontSize: 12, fontFamily: 'var(--font-data)' }} />
          <input value={row.editedLabel} onChange={e => onChangeLabel(e.target.value)}
            style={{ flex: 1, padding: '4px 8px', background: 'var(--color-l1)', border: '1px solid var(--color-l5)', borderRadius: 6, color: 'var(--color-t0)', fontSize: 12 }} />
          <button onClick={onCommit} className="btn btn--ghost" style={{ fontSize: 11, padding: '4px 10px' }}>✓ Save</button>
        </div>
      ) : (
        <>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, letterSpacing: '1.2px', fontWeight: 700, color: 'var(--color-t2)', minWidth: 44 }}>Mi {row.at_mi.toFixed(1)}</span>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--color-t0)' }}>{row.label}</span>
          <span style={{ fontSize: 11, color: 'var(--color-t3)', marginRight: 4 }}>
            {row.confidence === 'primary_source_verified' ? '✓' : '~'}
          </span>
          <button onClick={onEdit} className="btn btn--ghost" style={{ fontSize: 11, padding: '4px 8px' }}>Edit</button>
        </>
      )}
      <button onClick={onToggle} className="btn btn--ghost" style={{
        fontSize: 11, padding: '4px 8px',
        color: rejected ? 'var(--color-success)' : 'var(--color-warning)',
      }}>
        {rejected ? 'Restore' : 'Reject'}
      </button>
    </div>
  );
}

function PhaseStatusCard({ phase, processResult }: { phase: FormPhase; processResult: ProcessResult | null }) {
  const steps = [
    { id: 'input', label: 'Fill form + upload GPX' },
    { id: 'processing', label: 'Course analysis + aid station extraction' },
    { id: 'review', label: 'Review + approve data' },
    { id: 'building', label: 'Build race plan' },
  ];
  const phaseOrder = ['input', 'processing', 'review', 'building'];
  const currentIdx = phaseOrder.indexOf(phase);

  return (
    <div className="tile">
      <div className="tile-sub" style={{ marginBottom: 12 }}>Progress</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
                background: done ? 'var(--color-success)' : active ? 'var(--color-attention)' : 'var(--color-l4)',
                color: done || active ? 'var(--color-l0)' : 'var(--color-t3)',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 12, color: active ? 'var(--color-t0)' : done ? 'var(--color-t1)' : 'var(--color-t3)', fontWeight: active ? 600 : 400 }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
      {processResult && phase === 'review' && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--color-l4)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-t3)', fontFamily: 'var(--font-data)', letterSpacing: '1.2px', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>Course analysis</div>
          <div style={{ fontSize: 12, color: 'var(--color-t1)', lineHeight: 1.6 }}>
            <div>Distance: <b>{(processResult.analysis.stats.totalDistM / 1609.344).toFixed(2)} mi</b></div>
            <div>Gain: <b>+{Math.round(processResult.analysis.stats.gainFt).toLocaleString()} ft</b></div>
            <div>Loss: <b>-{Math.round(processResult.analysis.stats.lossFt).toLocaleString()} ft</b></div>
            <div>Aid stations: <b>{processResult.aidRows.filter(r => r.status === 'approved').length} approved</b></div>
          </div>
        </div>
      )}
    </div>
  );
}
