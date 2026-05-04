'use client';

/**
 * /races/new — the user's flagship flow: type a race + drop a GPX +
 * set a goal → get a full plan + watch-ready intervals.
 *
 * Pipeline:
 *   1. Form captures race name, date, start time, goal time, GPX file.
 *   2. Submit POSTs to /api/build-plan (which falls through to
 *      synthesizeCourseFacts for unknown slugs).
 *   3. On success we persist {plan, gpxText, meta} to localStorage and
 *      router.push('/races/[slug]') to the detail view.
 *
 * The fitness summary (used by Claude for goal recs) is collapsed into
 * an "Advanced" disclosure — for an M0 manual flow, the goal time entry
 * is the load-bearing input.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Caption, Nav } from '../../../components/nav';
import { saveRace, listRaces, slugifyRaceName, type SavedRace } from '../../../lib/storage';
import { parseGpx } from '../../../lib/gpx';
import type { RuncinoPlan } from '../../../lib/types';

type BuildResult = {
  planJsonText: string;
  summary: {
    raceName: string;
    courseSlug: string;
    goalDisplay: string;
    phases: Array<{
      label: string;
      startMi: number;
      endMi: number;
      paceDisplay: string;
      grade: number;
      cumulativeDisplay: string;
    }>;
    gelCount: number;
    totalCarbsG: number;
    landmarkCount: number;
    intervalCount: number;
    geometryWarnings: string[];
    geometryErrors: string[];
  };
};

const REGISTERED = [
  { slug: 'big-sur-marathon', label: 'Big Sur International Marathon' },
  { slug: 'sombrero-half',    label: 'Sombrero Half Marathon' },
] as const;

/** Canonical race distances. Picking one pre-fills the goal-time
 *  placeholder + lets us soft-warn if the uploaded GPX doesn't match. */
const DISTANCES = [
  { id: 'marathon', label: 'Marathon',     mi: 26.22, defaultGoal: '3:30:00' },
  { id: 'half',     label: 'Half marathon', mi: 13.10, defaultGoal: '1:35:00' },
  { id: '10k',      label: '10K',          mi: 6.21,  defaultGoal: '0:45:00' },
  { id: '5k',       label: '5K',           mi: 3.10,  defaultGoal: '0:22:00' },
  { id: 'custom',   label: 'Other',        mi: 0,     defaultGoal: '1:30:00' },
] as const;
type DistanceId = typeof DISTANCES[number]['id'];

export default function NewRacePage() {
  const router = useRouter();
  const [raceName, setRaceName]   = useState('');
  const [raceDate, setRaceDate]   = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState('07:00');
  const [distanceId, setDistanceId] = useState<DistanceId | null>(null);
  const [goalHMS, setGoalHMS]     = useState('1:30:00');
  const [goalDirty, setGoalDirty] = useState(false);  // true once user has typed in goal
  const [strategy, setStrategy]   = useState<'even_effort' | 'even_split' | 'negative_split'>('even_effort');
  const [tolerance, setTolerance] = useState(10);

  // When user picks a distance, refresh the goal-time field with that
  // distance's default — but only if they haven't typed their own
  // goal yet. Avoids stomping on a value they entered first.
  function pickDistance(id: DistanceId) {
    setDistanceId(id);
    if (!goalDirty) {
      const d = DISTANCES.find(x => x.id === id);
      if (d) setGoalHMS(d.defaultGoal);
    }
  }

  const [gpxName, setGpxName] = useState<string | null>(null);
  const [gpxText, setGpxText] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [takenSlugs, setTakenSlugs] = useState<Set<string>>(new Set());
  useEffect(() => {
    listRaces().then(rs => setTakenSlugs(new Set(rs.map(r => r.slug))));
  }, []);

  const goalFinishS = useMemo(() => {
    const m = goalHMS.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
  }, [goalHMS]);

  // Parse the uploaded GPX to its raw distance once. Used to soft-warn
  // when the picked distance and the actual GPX disagree.
  const gpxDistanceMi = useMemo(() => {
    if (!gpxText) return null;
    try { return parseGpx(gpxText).totalDistanceM / 1609.344; }
    catch { return null; }
  }, [gpxText]);

  // Soft warning if the picked distance is more than 15% off the GPX.
  // Within 15% covers most races (marathons routinely measure 26.4mi
  // due to GPS drift + tangent-cutting, halves often 13.2mi, etc).
  const gpxDistanceMismatch = useMemo(() => {
    if (gpxDistanceMi == null || !distanceId || distanceId === 'custom') return null;
    const expected = DISTANCES.find(d => d.id === distanceId);
    if (!expected || expected.mi <= 0) return null;
    const drift = Math.abs(gpxDistanceMi - expected.mi) / expected.mi;
    if (drift < 0.15) return null;
    return { gpxMi: gpxDistanceMi, expectedLabel: expected.label };
  }, [gpxDistanceMi, distanceId]);

  function handleFile(file: File) {
    setError(null);
    if (!file.name.toLowerCase().match(/\.(gpx|tcx)$/)) {
      setError('Please drop a .gpx or .tcx file.');
      return;
    }
    setGpxName(file.name);
    const reader = new FileReader();
    reader.onload = e => setGpxText(String(e.target?.result ?? ''));
    reader.readAsText(file);
  }

  // Auto-pick a registered course slug if the user types a recognized
  // name (Big Sur, Sombrero…). Otherwise we slugify the typed name and
  // pass it through as a custom course.
  const courseSlug = useMemo(() => {
    const lower = raceName.trim().toLowerCase();
    const match = REGISTERED.find(r => lower.includes(r.label.toLowerCase().slice(0, 8)));
    if (match) return match.slug;
    if (!raceName.trim()) return '';
    return slugifyRaceName(raceName, takenSlugs);
  }, [raceName, takenSlugs]);

  const canBuild = Boolean(raceName.trim() && raceDate && goalFinishS && gpxText && courseSlug);

  async function handleBuild() {
    if (!canBuild || !gpxText || !goalFinishS) return;
    setError(null);
    setBuilding(true);
    try {
      const res = await fetch('/api/build-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gpxText,
          courseSlug,
          raceName: raceName.trim(),
          raceDate,
          goalFinishS,
          strategy,
          toleranceSPerMi: tolerance,
          fitness: {
            // Manual flow: provide neutral defaults so /api/build-plan's
            // FitnessSummary block stays well-formed. Users edit it later
            // from the race-detail page (M1 wiring).
            baselineName: 'Self-reported',
            baselineFinish: '0:00:00',
            baselineMonthsAgo: 0,
            weeklyMileage: 0,
            weeklyMileageTrend: 0,
            longestLongRunMi: 0,
            longestLongRunAgeWk: 0,
            restingHr: 0,
            restingHrTrend: 0,
          },
          claudeRationale: null,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Build failed (${res.status}): ${txt.slice(0, 200)}`);
      }
      const data: BuildResult = await res.json();
      const plan = JSON.parse(data.planJsonText) as RuncinoPlan;
      // If the user picked a canonical distance (Marathon / Half / 10K /
      // 5K), use that as the headline distance instead of the GPX-
      // measured value. GPS routinely measures a half at 13.16-13.25mi
      // due to drift + tangent-cutting; the runner thinks of it as
      // "13.1mi" and so should the app. The plan internals still use
      // GPX distance for terrain pacing — that 0.5% gap is within noise.
      const canonical = distanceId && distanceId !== 'custom'
        ? DISTANCES.find(d => d.id === distanceId)?.mi
        : null;
      const headlineDistance = canonical ?? plan.race.distance_mi;
      const saved: SavedRace = {
        slug: data.summary.courseSlug,
        plan,
        gpxText,
        savedAt: new Date().toISOString(),
        meta: {
          name: data.summary.raceName,
          date: raceDate,
          distanceMi: headlineDistance,
          goalDisplay: data.summary.goalDisplay,
          courseSlug: data.summary.courseSlug,
        },
      };
      await saveRace(saved);
      router.push(`/races/${saved.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBuilding(false);
    }
  }

  return (
    <>
      <Caption left="Runcino · races · new" right="ADD RACE" />
      <div className="stage">
        <Nav active="races" />
        <div className="body">
          <div className="page-head">
            <div>
              <div className="eyebrow">Add a race</div>
              <h1>New race</h1>
              <div className="sub">
                <b>Three things:</b> what it&apos;s called + when, a GPX of the course, your goal time. Plan + fueling + Watch intervals fall out.
              </div>
            </div>
            <div className="page-actions">
              <button onClick={() => router.push('/races')} className="btn btn--ghost">Cancel</button>
              <button
                onClick={handleBuild}
                disabled={!canBuild || building}
                className="btn btn--primary"
              >
                {building ? 'Building…' : 'Build race plan →'}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10 }}>
            {/* ── LEFT: form ────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="tile">
                <div className="tile-h">
                  <div>
                    <div className="tile-sub">Step 1</div>
                    <div className="tile-lbl">Race basics</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
                  <div>
                    <label className="runcino-label">Race name</label>
                    <input
                      className="runcino-input"
                      placeholder="e.g. Sombrero Half Marathon"
                      value={raceName}
                      onChange={e => setRaceName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="runcino-label">Date</label>
                    <input
                      className="runcino-input font-data"
                      type="date"
                      value={raceDate}
                      onChange={e => setRaceDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="runcino-label">Start time</label>
                    <input
                      className="runcino-input font-data"
                      type="time"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <label className="runcino-label">Distance</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {DISTANCES.map(d => {
                      const active = distanceId === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => pickDistance(d.id)}
                          style={{
                            padding: '12px 10px',
                            textAlign: 'center',
                            border: `1px solid ${active ? 'var(--color-attention)' : 'var(--color-l4)'}`,
                            background: active ? 'rgba(243,173,59,.10)' : 'var(--color-l2)',
                            borderRadius: 10,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            color: 'var(--color-t0)',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-display)', letterSpacing: '-.005em', textTransform: 'uppercase' }}>{d.label}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--color-t3)', marginTop: 4, fontFamily: 'var(--font-data)', letterSpacing: '1.2px', fontWeight: 700 }}>
                            {d.mi > 0 ? `${d.mi.toFixed(d.id === '5k' || d.id === '10k' ? 1 : 2)} MI` : 'CUSTOM'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {courseSlug && courseSlug !== '' && (
                  <div className="hint" style={{ marginTop: 12 }}>
                    Slug · <b style={{ color: 'var(--color-t1)' }}>{courseSlug}</b>
                    {REGISTERED.some(r => r.slug === courseSlug)
                      ? <span style={{ marginLeft: 8, color: 'var(--color-success)' }}>✓ Curated course (landmarks + fact-checked phases)</span>
                      : <span style={{ marginLeft: 8 }}>Custom course — phases auto-detected from GPX, no curated landmarks</span>}
                  </div>
                )}
                {gpxDistanceMismatch && (
                  <div className="hint" style={{ marginTop: 8, color: 'var(--color-warning)' }}>
                    ⚠ The GPX measures roughly {gpxDistanceMismatch.gpxMi.toFixed(1)} mi but you picked {gpxDistanceMismatch.expectedLabel}. Pick the matching distance or upload a different GPX.
                  </div>
                )}
              </div>

              <div className="tile">
                <div className="tile-h">
                  <div>
                    <div className="tile-sub">Step 2</div>
                    <div className="tile-lbl">Course track (GPX)</div>
                  </div>
                </div>
                <div
                  ref={dropRef}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); dropRef.current?.setAttribute('data-active', ''); }}
                  onDragLeave={e => { e.preventDefault(); dropRef.current?.removeAttribute('data-active'); }}
                  onDrop={e => {
                    e.preventDefault();
                    dropRef.current?.removeAttribute('data-active');
                    const f = e.dataTransfer.files[0];
                    if (f) handleFile(f);
                  }}
                  style={{
                    border: '1.5px dashed var(--color-l5)',
                    borderRadius: 12,
                    padding: 36,
                    textAlign: 'center',
                    background: 'var(--color-l2)',
                    cursor: 'pointer',
                    transition: 'border-color 120ms ease, background 120ms ease',
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 8, color: 'var(--color-attention)' }}>↑</div>
                  {gpxName ? (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{gpxName}</div>
                      <div className="hint" style={{ marginTop: 4 }}>Click to replace</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Drop your GPX here</div>
                      <div className="hint" style={{ marginTop: 4 }}>.gpx or .tcx · parsed in-browser, never uploaded</div>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".gpx,.tcx"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                </div>
              </div>

              <div className="tile">
                <div className="tile-h">
                  <div>
                    <div className="tile-sub">Step 3</div>
                    <div className="tile-lbl">Goal & strategy</div>
                  </div>
                  <span className="chip chip--attention">Required</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
                  <div>
                    <label className="runcino-label">Goal finish time</label>
                    <input
                      className="runcino-input font-data"
                      style={{ fontSize: 18 }}
                      placeholder="h:mm:ss"
                      value={goalHMS}
                      onChange={e => { setGoalHMS(e.target.value); setGoalDirty(true); }}
                    />
                    <div className="hint" style={{ marginTop: 4 }}>
                      {goalFinishS
                        ? `${(goalFinishS / 60).toFixed(1)} min`
                        : <span style={{ color: 'var(--color-warning)' }}>Use h:mm:ss</span>}
                    </div>
                  </div>
                  <div>
                    <label className="runcino-label">Pacing strategy</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {([
                        { id: 'even_effort',    name: 'Even effort',    desc: 'Minetti GAP · default' },
                        { id: 'even_split',     name: 'Even split',     desc: 'Same pace everywhere' },
                        { id: 'negative_split', name: 'Negative split', desc: 'Conservative first half' },
                      ] as const).map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setStrategy(opt.id)}
                          style={{
                            padding: '12px 14px',
                            textAlign: 'left',
                            border: `1px solid ${strategy === opt.id ? 'var(--color-attention)' : 'var(--color-l4)'}`,
                            background: strategy === opt.id ? 'rgba(243,173,59,.08)' : 'var(--color-l2)',
                            borderRadius: 10,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            color: 'var(--color-t0)',
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{opt.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 3 }}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 18 }}>
                  <label className="runcino-label">Watch tolerance · ±{tolerance} sec/mi</label>
                  <input
                    type="range"
                    min={5}
                    max={15}
                    value={tolerance}
                    onChange={e => setTolerance(Number(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--color-attention)' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-t3)', fontFamily: 'var(--font-data)', letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700 }}>
                    <span>±5 strict</span>
                    <span>±15 loose</span>
                  </div>
                </div>
              </div>

              {error && (
                <div className="tile" style={{
                  borderColor: 'rgba(252,77,84,.4)',
                  background: 'rgba(252,77,84,.08)',
                  color: '#FECDCB',
                  fontSize: 13,
                }}>
                  <b style={{ color: 'var(--color-warning)' }}>Build failed.</b> {error}
                </div>
              )}
            </div>

            {/* ── RIGHT: helper rail ────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="tile">
                <div className="tile-sub" style={{ marginBottom: 12 }}>What you&apos;re about to build</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.7 }}>
                  <li><b style={{ color: 'var(--color-t0)' }}>GPX parsed</b> in-browser → distance, gain, loss</li>
                  <li><b style={{ color: 'var(--color-t0)' }}>Minetti GAP</b> → grade-adjusted pace per 800m segment</li>
                  <li><b style={{ color: 'var(--color-t0)' }}>5–6 phases</b> auto-grouped by terrain shifts</li>
                  <li><b style={{ color: 'var(--color-t0)' }}>Fueling plan</b> → gels anchored to phase boundaries</li>
                  <li><b style={{ color: 'var(--color-t0)' }}>Intervals</b> → flat ordered list ready for WorkoutKit</li>
                  <li><b style={{ color: 'var(--color-t0)' }}>.runcino.json</b> → AirDrop to phone, push to Watch</li>
                </ol>
              </div>

              <div className="tile" style={{ background: 'rgba(0,143,236,.06)', borderColor: 'rgba(0,143,236,.2)' }}>
                <div className="tile-sub" style={{ marginBottom: 8, color: 'var(--color-corporate)' }}>How the slug works</div>
                <p style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.5, margin: 0 }}>
                  Type <em>Big Sur</em> or <em>Sombrero</em> and we recognize them — full curated landmarks + fact-checked phases. Anything else gets a custom slug from your race name; phases are auto-detected from your GPX.
                </p>
              </div>

              <div className="tile" style={{ background: 'rgba(243,173,59,.06)', borderColor: 'rgba(243,173,59,.2)' }}>
                <div className="tile-sub" style={{ marginBottom: 8, color: 'var(--color-attention)' }}>What&apos;s coming after this build</div>
                <p style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.5, margin: 0 }}>
                  Race-day forecast (NOAA), Claude race-morning brief, fitness summary, and Watch sync. Each lives on the race detail page once the plan exists.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
