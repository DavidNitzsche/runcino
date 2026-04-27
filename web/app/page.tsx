'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Nav, Footer } from '../components/nav';

type GoalRecommendation = {
  recommendedFinishS: number;
  recommendedDisplay: string;
  rangeLowDisplay: string;
  rangeHighDisplay: string;
  rationale: string;
  riskFlags: Array<{ severity: 'good' | 'watch' | 'risk'; text: string }>;
  stub: boolean;
};

type BuildResult = {
  planJsonText: string;
  summary: {
    raceName: string;
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

type FitnessInputs = {
  baselineName: string;
  baselineFinish: string;
  baselineMonthsAgo: number;
  weeklyMileage: number;
  weeklyMileageTrend: number;
  longestLongRunMi: number;
  longestLongRunAgeWk: number;
  restingHr: number;
  restingHrTrend: number;
  age: string;
  weightLb: string;
};

const DEFAULT_FITNESS: FitnessInputs = {
  baselineName: 'LA Marathon',
  baselineFinish: '3:40:00',
  baselineMonthsAgo: 5,
  weeklyMileage: 38,
  weeklyMileageTrend: -4,
  longestLongRunMi: 18,
  longestLongRunAgeWk: 3,
  restingHr: 48,
  restingHrTrend: -2,
  age: '',
  weightLb: '',
};

const COURSES = [
  { slug: 'big-sur-marathon' as const, label: 'Big Sur International Marathon', date: '2026-04-26' },
];

function defaultRaceSlug(courseSlug: string, raceDate: string): string {
  const year = raceDate.slice(0, 4);
  return year ? `${courseSlug}-${year}` : courseSlug;
}

export default function Home() {
  const router = useRouter();
  const [gpxName, setGpxName] = useState<string | null>(null);
  const [gpxText, setGpxText] = useState<string | null>(null);
  const [courseSlug, setCourseSlug] = useState<'big-sur-marathon'>('big-sur-marathon');
  const initialCourse = COURSES[0];
  const [raceDate, setRaceDate] = useState(initialCourse.date);
  const [raceSlug, setRaceSlug] = useState(defaultRaceSlug(initialCourse.slug, initialCourse.date));
  const [raceName, setRaceName] = useState(initialCourse.label);
  const [goalHMS, setGoalHMS] = useState('3:50:00');
  const [strategy, setStrategy] = useState<'even_effort' | 'even_split' | 'negative_split'>('even_effort');
  const [tolerance, setTolerance] = useState(10);
  const [fitness, setFitness] = useState<FitnessInputs>(DEFAULT_FITNESS);
  const [recommendation, setRecommendation] = useState<GoalRecommendation | null>(null);
  const [recommending, setRecommending] = useState(false);
  const [building, setBuilding] = useState(false);
  const [build, setBuild] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const courseMeta = COURSES.find(c => c.slug === courseSlug)!;

  const goalFinishS = useMemo(() => {
    const m = goalHMS.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }, [goalHMS]);

  function onFileSelected(file: File) {
    setError(null);
    if (!file.name.toLowerCase().endsWith('.gpx')) {
      setError('Please drop a .gpx file.');
      return;
    }
    setGpxName(file.name);
    const reader = new FileReader();
    reader.onload = e => setGpxText(String(e.target?.result ?? ''));
    reader.readAsText(file);
  }

  async function useSampleGpx() {
    try {
      const res = await fetch('/sample-bigsur.gpx');
      if (!res.ok) throw new Error(`Could not load sample GPX (${res.status})`);
      const text = await res.text();
      setGpxName('sample-bigsur.gpx (synthesized)');
      setGpxText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sample GPX');
    }
  }

  async function askClaude() {
    setError(null);
    setRecommending(true);
    try {
      const res = await fetch('/api/goal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ courseSlug, fitness }),
      });
      if (!res.ok) throw new Error(`Goal request failed: ${res.status}`);
      const data: GoalRecommendation = await res.json();
      setRecommendation(data);
      setGoalHMS(data.recommendedDisplay);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecommending(false);
    }
  }

  async function buildPlan() {
    if (!gpxText || !goalFinishS) {
      setError('Need a GPX and a valid goal time (h:mm:ss).');
      return;
    }
    setError(null);
    setBuilding(true);
    try {
      const res = await fetch('/api/build-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gpxText,
          courseSlug,
          raceDate,
          goalFinishS,
          strategy,
          toleranceSPerMi: tolerance,
          fitness,
          claudeRationale: recommendation?.rationale ?? null,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Build failed: ${text}`);
      }
      const data: BuildResult = await res.json();
      setBuild(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  }

  function downloadPlan() {
    if (!build) return;
    const blob = new Blob([build.planJsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${raceSlug || courseSlug}.runcino.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function saveToRaces() {
    if (!build) return;
    if (!raceSlug || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(raceSlug)) {
      setError('Race slug must be lowercase letters, digits, and hyphens (e.g. cim-2026).');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/races', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: raceSlug,
          name: raceName,
          courseSlug,
          raceDate,
          status: 'planned',
          plan: JSON.parse(build.planJsonText),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Save failed: ${text}`);
      }
      router.push(`/races/${raceSlug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const canBuild = Boolean(gpxText && goalFinishS);

  return (
    <main style={{ maxWidth: 1180, margin: '0 auto', padding: '0 32px' }}>
      <Nav active="plan" />

      <section style={{ padding: '56px 0 24px' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Build a race plan</div>
        <h1 style={{ fontSize: 52, maxWidth: '22ch', margin: '0 0 16px' }}>
          Run the course,<br />
          <span className="serif-italic">not the clock.</span>
        </h1>
        <p style={{ fontSize: 18, color: 'var(--color-ink-3)', maxWidth: '58ch', lineHeight: 1.5 }}>
          Upload a race GPX. Enter a fitness summary. Get a Minetti-adjusted pacing plan with fueling cues and Watch-ready intervals. Save it to your races, or export a <span className="font-mono" style={{ color: 'var(--color-ink)', fontSize: 14 }}>.runcino.json</span> to AirDrop to your phone.
        </p>
      </section>

      <section className="main-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="runcino-card">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Step 1 · Race course</div>
            <h3 style={{ fontSize: 22, marginBottom: 16 }}>Upload a GPX</h3>
            <div
              ref={dropRef}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); dropRef.current?.setAttribute('data-active', ''); }}
              onDragLeave={e => { e.preventDefault(); dropRef.current?.removeAttribute('data-active'); }}
              onDrop={e => {
                e.preventDefault();
                dropRef.current?.removeAttribute('data-active');
                const f = e.dataTransfer.files[0];
                if (f) onFileSelected(f);
              }}
              style={{
                border: '2px dashed var(--color-line)',
                borderRadius: 12,
                padding: 32,
                textAlign: 'center',
                background: 'var(--color-paper-2)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8, color: 'var(--color-terracotta)' }}>↑</div>
              {gpxName ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{gpxName}</div>
                  <div className="hint">Click to replace</div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Drop your GPX here</div>
                  <div className="hint">or click to browse · up to 50 MB</div>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".gpx"
                style={{ display: 'none' }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) onFileSelected(f);
                }}
              />
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="hint">No upload leaves this machine — GPX parsed in-browser.</div>
              <button className="btn btn-ghost" onClick={useSampleGpx}>Use sample Big Sur</button>
            </div>
          </div>

          <div className="runcino-card">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Step 2 · Goal time</div>
            <h3 style={{ fontSize: 22, marginBottom: 16 }}>What are you targeting?</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label className="runcino-label">Race</label>
                <select
                  className="runcino-input"
                  value={courseSlug}
                  onChange={e => {
                    const next = e.target.value as 'big-sur-marathon';
                    setCourseSlug(next);
                    const c = COURSES.find(x => x.slug === next)!;
                    setRaceName(c.label);
                    setRaceDate(c.date);
                    setRaceSlug(defaultRaceSlug(c.slug, c.date));
                  }}
                >
                  {COURSES.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                </select>
                <div className="hint">More courses via /research-course CLI</div>
              </div>
              <div>
                <label className="runcino-label">Goal finish time</label>
                <input
                  className="runcino-input font-mono"
                  style={{ fontSize: 18 }}
                  value={goalHMS}
                  onChange={e => setGoalHMS(e.target.value)}
                  placeholder="h:mm:ss"
                />
                <div className="hint">
                  {goalFinishS ? `= ${(goalFinishS / 60).toFixed(1)} min` : 'invalid — use h:mm:ss'}
                </div>
              </div>
              <div>
                <label className="runcino-label">Race date</label>
                <input
                  className="runcino-input font-mono"
                  type="date"
                  value={raceDate}
                  onChange={e => {
                    setRaceDate(e.target.value);
                    setRaceSlug(defaultRaceSlug(courseSlug, e.target.value));
                  }}
                />
              </div>
              <div>
                <label className="runcino-label">Race slug</label>
                <input
                  className="runcino-input font-mono"
                  value={raceSlug}
                  onChange={e => setRaceSlug(e.target.value)}
                  placeholder="cim-2026"
                />
                <div className="hint">Used in the URL: /races/{raceSlug || 'your-slug'}</div>
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <label className="runcino-label">Strategy</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {([
                  { id: 'even_effort', name: 'Even effort', desc: 'Minetti GAP · default' },
                  { id: 'even_split', name: 'Even split', desc: 'Same pace everywhere' },
                  { id: 'negative_split', name: 'Negative split', desc: 'Conservative first half' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setStrategy(opt.id)}
                    style={{
                      padding: 16,
                      textAlign: 'left',
                      border: `1px solid ${strategy === opt.id ? 'var(--color-terracotta)' : 'var(--color-line)'}`,
                      background: strategy === opt.id ? 'var(--color-terracotta-3)' : 'var(--color-paper)',
                      borderRadius: 12,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{opt.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <label className="runcino-label">Watch tolerance · ±{tolerance} sec/mi</label>
              <input
                type="range"
                min={5}
                max={15}
                value={tolerance}
                onChange={e => setTolerance(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-terracotta)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-ink-3)' }}>
                <span>±5 strict</span><span>±15 loose</span>
              </div>
            </div>
          </div>

          <div className="runcino-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div className="eyebrow">Step 3 · Ask Claude</div>
                <h3 style={{ fontSize: 22, marginTop: 8 }}>Fitness summary</h3>
              </div>
              <span className="runcino-pill">Manual for now · HealthKit in M1</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label className="runcino-label">Baseline race</label>
                <input className="runcino-input" value={fitness.baselineName} onChange={e => setFitness({ ...fitness, baselineName: e.target.value })} />
              </div>
              <div>
                <label className="runcino-label">Finish time</label>
                <input className="runcino-input font-mono" value={fitness.baselineFinish} onChange={e => setFitness({ ...fitness, baselineFinish: e.target.value })} />
              </div>
              <div>
                <label className="runcino-label">Months ago</label>
                <input className="runcino-input font-mono" type="number" value={fitness.baselineMonthsAgo} onChange={e => setFitness({ ...fitness, baselineMonthsAgo: Number(e.target.value) })} />
              </div>
              <div>
                <label className="runcino-label">Weekly mileage (avg)</label>
                <input className="runcino-input font-mono" type="number" value={fitness.weeklyMileage} onChange={e => setFitness({ ...fitness, weeklyMileage: Number(e.target.value) })} />
              </div>
              <div>
                <label className="runcino-label">Mileage trend Δ</label>
                <input className="runcino-input font-mono" type="number" value={fitness.weeklyMileageTrend} onChange={e => setFitness({ ...fitness, weeklyMileageTrend: Number(e.target.value) })} />
              </div>
              <div>
                <label className="runcino-label">Longest recent long run</label>
                <input className="runcino-input font-mono" type="number" value={fitness.longestLongRunMi} onChange={e => setFitness({ ...fitness, longestLongRunMi: Number(e.target.value) })} />
              </div>
              <div>
                <label className="runcino-label">Long run age (wk)</label>
                <input className="runcino-input font-mono" type="number" value={fitness.longestLongRunAgeWk} onChange={e => setFitness({ ...fitness, longestLongRunAgeWk: Number(e.target.value) })} />
              </div>
              <div>
                <label className="runcino-label">Resting HR</label>
                <input className="runcino-input font-mono" type="number" value={fitness.restingHr} onChange={e => setFitness({ ...fitness, restingHr: Number(e.target.value) })} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn btn-accent btn-lg" onClick={askClaude} disabled={recommending}>
                {recommending ? 'Asking Claude…' : 'Ask Claude for a goal'}
              </button>
            </div>
          </div>

          <div className="runcino-card" style={{ background: 'var(--color-ink)', color: 'var(--color-paper)', borderColor: 'var(--color-ink)' }}>
            <div className="eyebrow" style={{ color: 'var(--color-terracotta-2)', marginBottom: 8 }}>Step 4 · Ship it</div>
            <h3 style={{ fontSize: 22, color: 'var(--color-paper)', marginBottom: 12 }}>Build the plan</h3>
            <p style={{ margin: 0, color: 'var(--color-paper-3)', fontSize: 14 }}>
              Runs the Minetti pipeline, writes a <span className="font-mono" style={{ color: 'var(--color-paper)' }}>.runcino.json</span> with phases, fueling, landmarks, and IntervalSteps for Apple Watch.
            </p>
            <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-accent btn-lg" onClick={buildPlan} disabled={!canBuild || building}>
                {building ? 'Building…' : 'Build plan'}
              </button>
            </div>
            {error && (
              <div style={{ marginTop: 16, padding: 12, background: 'rgba(168,59,43,0.25)', borderRadius: 8, color: '#fecdcb', fontSize: 13 }}>
                {error}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {recommendation && (
            <div className="runcino-card" style={{ borderColor: 'var(--color-terracotta-3)' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-ink)', color: 'var(--color-paper)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 600 }}>C</div>
                <div className="eyebrow" style={{ color: 'var(--color-ink-3)' }}>
                  Claude's read{recommendation.stub && <span style={{ color: 'var(--color-ink-4)' }}> · stubbed</span>}
                </div>
              </div>
              <h3 style={{ fontSize: 28, marginBottom: 12 }}>
                Honest goal: <span style={{ color: 'var(--color-terracotta)' }}>{recommendation.rangeLowDisplay}–{recommendation.rangeHighDisplay}</span>.<br />
                <span className="serif-italic" style={{ color: 'var(--color-ink-3)', fontSize: 20 }}>Anchor at {recommendation.recommendedDisplay}.</span>
              </h3>
              <p style={{ color: 'var(--color-ink-2)', whiteSpace: 'pre-wrap' }}>{recommendation.rationale}</p>

              {recommendation.riskFlags.length > 0 && (
                <div style={{ marginTop: 16, padding: 16, background: 'var(--color-paper-2)', borderRadius: 12 }}>
                  <div className="eyebrow" style={{ color: 'var(--color-ink-3)', marginBottom: 8 }}>Risk flags</div>
                  {recommendation.riskFlags.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0,
                        background: f.severity === 'good' ? 'var(--color-ok)' : f.severity === 'watch' ? 'var(--color-gold)' : 'var(--color-danger)',
                      }} />
                      <span style={{ fontSize: 13 }}>{f.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {build && (
            <div className="runcino-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div className="eyebrow">Plan built</div>
                  <h3 style={{ fontSize: 22, marginTop: 6 }}>{build.summary.raceName}</h3>
                  <div className="font-mono" style={{ fontSize: 14, color: 'var(--color-ink-3)' }}>{build.summary.goalDisplay}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-accent" onClick={saveToRaces} disabled={saving}>
                    {saving ? 'Saving…' : 'Save to my races'}
                  </button>
                  <button className="btn btn-ghost" onClick={downloadPlan}>Download JSON</button>
                </div>
              </div>

              {build.summary.geometryWarnings.length > 0 && (
                <div style={{ marginBottom: 16, padding: 12, background: '#FFF4E0', borderRadius: 8, fontSize: 13 }}>
                  {build.summary.geometryWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
              {build.summary.geometryErrors.length > 0 && (
                <div style={{ marginBottom: 16, padding: 12, background: '#FCDBD7', borderRadius: 8, fontSize: 13 }}>
                  {build.summary.geometryErrors.map((e, i) => <div key={i}>✗ {e}</div>)}
                </div>
              )}

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ color: 'var(--color-ink-3)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    <th style={{ textAlign: 'left', padding: '8px 0' }}>Phase</th>
                    <th style={{ textAlign: 'right', padding: '8px 0' }}>Pace</th>
                    <th style={{ textAlign: 'right', padding: '8px 0' }}>Split</th>
                  </tr>
                </thead>
                <tbody>
                  {build.summary.phases.map((p, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--color-line)' }}>
                      <td style={{ padding: '12px 0' }}>
                        <div style={{ fontWeight: 500 }}>{p.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-ink-3)' }}>
                          mi {p.startMi.toFixed(1)}–{p.endMi.toFixed(1)} · {p.grade >= 0 ? '+' : ''}{p.grade}%
                        </div>
                      </td>
                      <td className="font-mono" style={{ padding: '12px 0', textAlign: 'right', fontWeight: 500 }}>{p.paceDisplay}</td>
                      <td className="font-mono" style={{ padding: '12px 0', textAlign: 'right', color: 'var(--color-ink-3)', fontSize: 13 }}>{p.cumulativeDisplay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-line)', display: 'flex', gap: 16, fontSize: 13, color: 'var(--color-ink-3)' }}>
                <span>{build.summary.gelCount} gels · {build.summary.totalCarbsG}g</span>
                <span>{build.summary.landmarkCount} landmarks</span>
                <span>{build.summary.intervalCount} intervals</span>
              </div>
            </div>
          )}

          <div className="runcino-card" style={{ background: 'var(--color-paper-2)' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>The loop</div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--color-ink-2)', lineHeight: 1.8 }}>
              <li>Drop GPX (or use sample)</li>
              <li>Pick race + goal time + slug</li>
              <li>Fill fitness summary, ask Claude</li>
              <li>Build plan</li>
              <li>Save to your races (or AirDrop the JSON)</li>
            </ol>
          </div>
        </div>
      </section>

      <Footer tag="build plan" />
    </main>
  );
}
