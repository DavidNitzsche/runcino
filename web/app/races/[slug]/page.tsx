'use client';

/**
 * /races/[slug] — race detail view.
 *
 * Reads the saved race from localStorage by slug, then renders the full
 * pacing experience: hero, projected course map, elevation profile,
 * five-phase strategy cards, mile splits, fueling, and a one-click
 * export of the .runcino.json (the file the iOS app imports).
 *
 * The math is already in the saved plan — this page is purely
 * presentation. The map + elevation SVGs are computed in-component from
 * the bundled GPX text so they always match what was planned against.
 */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Caption, Nav } from '../../../components/nav';
import { deleteRace, getRace, setActualResult, type ActualResult, type SavedRace } from '../../../lib/storage';

const PHASE_COLORS = ['#3EBD41', '#F3AD3B', '#FC4D54', '#008FEC', '#9013FE'];

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T12:00:00Z');
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function fmtPace(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface ParsedPoint { lat: number; lon: number; eleM: number; cumMi: number; }

function parseGpxClient(text: string): ParsedPoint[] {
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const nodes = dom.getElementsByTagName('trkpt');
  const out: { lat: number; lon: number; eleM: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const lat = parseFloat(n.getAttribute('lat') ?? '');
    const lon = parseFloat(n.getAttribute('lon') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleNode = n.getElementsByTagName('ele')[0];
    const eleM = eleNode ? parseFloat(eleNode.textContent ?? '0') : 0;
    out.push({ lat, lon, eleM });
  }
  // Cumulative miles via haversine.
  const result: ParsedPoint[] = [];
  let cum = 0;
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  for (let i = 0; i < out.length; i++) {
    if (i > 0) {
      const a = out[i - 1], b = out[i];
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const la1 = toRad(a.lat), la2 = toRad(b.lat);
      const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
      cum += 2 * R * Math.asin(Math.sqrt(x));
    }
    result.push({ lat: out[i].lat, lon: out[i].lon, eleM: out[i].eleM, cumMi: cum });
  }
  return result;
}

export default function RaceDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug;
  const [race, setRace] = useState<SavedRace | null | 'loading'>('loading');

  useEffect(() => {
    if (!slug) return;
    setRace(getRace(slug));
  }, [slug]);

  if (race === 'loading') {
    return <div style={{ padding: 80, textAlign: 'center', color: 'var(--color-t2)' }}>Loading…</div>;
  }
  if (!race) {
    return (
      <>
        <Caption left="Runcino · races" right="NOT FOUND" />
        <div className="stage">
          <Nav active="races" />
          <div className="body" style={{ padding: 80, textAlign: 'center' }}>
            <h1 style={{ fontSize: 56 }}>404</h1>
            <p style={{ color: 'var(--color-t2)', marginTop: 12 }}>No saved race for slug <code>{slug}</code>.</p>
            <Link href="/races" className="btn btn--primary" style={{ marginTop: 24 }}>← Back to races</Link>
          </div>
        </div>
      </>
    );
  }
  return <RaceDetailView race={race} onDelete={() => { deleteRace(race.slug); router.push('/races'); }} />;
}

function RaceDetailView({ race, onDelete }: { race: SavedRace; onDelete: () => void }) {
  const points = useMemo(() => parseGpxClient(race.gpxText), [race.gpxText]);
  const days = daysUntil(race.meta.date);
  const totalMi = race.plan.race.distance_mi;
  const peakFt = useMemo(() => Math.max(...points.map(p => p.eleM)) * 3.28084, [points]);
  const peakMi = useMemo(() => {
    let bestIdx = 0;
    for (let i = 1; i < points.length; i++) if (points[i].eleM > points[bestIdx].eleM) bestIdx = i;
    return points[bestIdx]?.cumMi ?? 0;
  }, [points]);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(race.plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${race.slug}.runcino.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Caption left={`Runcino · ${race.meta.name}`} right={`${race.meta.distanceMi.toFixed(1)} MI · GOAL ${race.meta.goalDisplay}`} />
      <div className="stage">
        <Nav active="races" />
        <div className="body">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <Link href="/races" style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--color-t2)', fontWeight: 700 }}>← All races</Link>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--ghost" onClick={onDelete}>Delete</button>
              <button className="btn btn--primary" onClick={downloadJson}>↓ Export .runcino.json</button>
            </div>
          </div>

          <Hero race={race} days={days} peakFt={peakFt} peakMi={peakMi} />

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 10, marginTop: 10 }}>
            <CourseMap points={points} race={race} peakMi={peakMi} peakFt={peakFt} />
            <ElevationChart points={points} race={race} totalMi={totalMi} peakMi={peakMi} peakFt={peakFt} />
          </div>

          <PhaseCards race={race} />

          <ResultSection race={race} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <WeatherTile points={points} />
            <BriefTile race={race} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 10, marginTop: 10 }}>
            <MileSplits race={race} />
            <FuelingTile race={race} />
          </div>

          <ExportFooter race={race} onDownload={downloadJson} />
        </div>
      </div>
    </>
  );
}

function Hero({ race, days, peakFt, peakMi }: { race: SavedRace; days: number; peakFt: number; peakMi: number }) {
  const isUpcoming = days >= 0;
  return (
    <div style={{
      background: 'radial-gradient(ellipse at 75% 30%, rgba(252,77,84,.08) 0%, rgba(10,14,20,0) 55%), radial-gradient(ellipse at 20% 85%, rgba(62,189,65,.06) 0%, rgba(10,14,20,0) 55%), var(--color-l0)',
      border: '1px solid var(--color-l4)',
      borderRadius: 20,
      padding: '40px 44px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 32 }}>
        <div style={{ flex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {isUpcoming ? `Next race · ${fmtDate(race.meta.date).split(',')[0]}` : `Completed · ${fmtDate(race.meta.date)}`}
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 88,
            letterSpacing: '-.01em',
            lineHeight: 0.88,
            textTransform: 'uppercase',
            color: 'var(--color-t0)',
          }}>{race.meta.name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: 36, marginTop: 28 }}>
            <Stat label="Date" value={fmtDate(race.meta.date).split(', ').slice(1).join(', ')} />
            <Stat label="Distance" value={`${race.meta.distanceMi.toFixed(1)} mi`} />
            <Stat label="Elevation" value={`+${race.plan.race.total_gain_ft} ft`} />
            <Stat label="Peak" value={`${Math.round(peakFt)} ft @ ${peakMi.toFixed(1)} mi`} />
          </div>
        </div>
        {isUpcoming && (
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 156,
              letterSpacing: '-.04em',
              lineHeight: 0.85,
              color: 'var(--color-attention)',
              fontVariantNumeric: 'tabular-nums',
            }}>{Math.max(0, days)}</div>
            <div style={{
              fontFamily: 'var(--font-data)',
              fontSize: 11,
              letterSpacing: '2.4px',
              textTransform: 'uppercase',
              color: 'var(--color-t2)',
              fontWeight: 700,
              marginTop: 8,
            }}>{days === 0 ? 'Today' : days === 1 ? 'Day to go' : 'Days to go'}</div>
            <div style={{ marginTop: 22, padding: '12px 16px', background: 'var(--color-l1)', border: '1px solid var(--color-l4)', borderRadius: 10 }}>
              <div className="tile-sub" style={{ marginBottom: 6 }}>Goal time</div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 44,
                letterSpacing: '-.02em',
                color: 'var(--color-attention)',
                lineHeight: 1,
              }}>{race.meta.goalDisplay}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tile-sub">{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, letterSpacing: '-.02em', color: 'var(--color-t0)', marginTop: 6 }}>{value}</div>
    </div>
  );
}

function CourseMap({ points, race, peakMi, peakFt }: { points: ParsedPoint[]; race: SavedRace; peakMi: number; peakFt: number }) {
  if (points.length < 2) return <div className="tile">No GPX track points.</div>;
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const padX = 40, padY = 40, W = 720, H = 420;
  const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const spanLon = (maxLon - minLon) * cosLat || 1e-9;
  const spanLat = maxLat - minLat || 1e-9;
  const scale = Math.min((W - 2 * padX) / spanLon, (H - 2 * padY) / spanLat);
  const offX = padX + ((W - 2 * padX) - spanLon * scale) / 2;
  const offY = padY + ((H - 2 * padY) - spanLat * scale) / 2;
  const proj = (p: ParsedPoint) => [
    offX + (p.lon - minLon) * cosLat * scale,
    offY + (maxLat - p.lat) * scale,
  ];
  const total = points[points.length - 1].cumMi;
  // Build segments colored by phase index (5 phases evenly distributed)
  const phaseAtMi = (mi: number) => {
    for (let i = 0; i < race.plan.phases.length; i++) {
      const p = race.plan.phases[i];
      if (mi >= p.start_mi && mi <= p.end_mi) return i;
    }
    return race.plan.phases.length - 1;
  };
  const segs: Array<{ d: string; color: string }> = [];
  let cur: string[] = [];
  let curPhase = -1;
  for (let i = 0; i < points.length; i++) {
    const phase = phaseAtMi(points[i].cumMi);
    const [x, y] = proj(points[i]);
    if (phase !== curPhase) {
      if (cur.length > 0) {
        segs.push({ d: cur.join(' '), color: PHASE_COLORS[curPhase] ?? PHASE_COLORS[0] });
        cur = [`M ${x.toFixed(1)} ${y.toFixed(1)}`];
      } else {
        cur = [`M ${x.toFixed(1)} ${y.toFixed(1)}`];
      }
      curPhase = phase;
    } else {
      cur.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
  }
  if (cur.length > 0) segs.push({ d: cur.join(' '), color: PHASE_COLORS[curPhase] ?? PHASE_COLORS[0] });

  const startP = proj(points[0]);
  const endP = proj(points[points.length - 1]);
  const peakIdx = points.findIndex(p => p.cumMi >= peakMi);
  const peakP = peakIdx >= 0 ? proj(points[peakIdx]) : null;

  return (
    <div className="tile" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px 8px' }}>
        <div className="tile-sub">Course</div>
        <div className="tile-lbl">{race.plan.race.distance_mi.toFixed(1)} mi · {peakIdx >= 0 ? `peak ${Math.round(peakFt)} ft` : 'flat'}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', display: 'block', background: 'var(--color-l0)' }}>
        {segs.map((s, i) => (
          <path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        <circle cx={startP[0]} cy={startP[1]} r="8" fill="#3EBD41" stroke="var(--color-l0)" strokeWidth="3" />
        <text x={startP[0]} y={startP[1] - 14} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#3EBD41" textAnchor="middle" fontWeight="700">START</text>
        <circle cx={endP[0]} cy={endP[1]} r="8" fill="#9013FE" stroke="var(--color-l0)" strokeWidth="3" />
        <text x={endP[0]} y={endP[1] + 22} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#9013FE" textAnchor="middle" fontWeight="700">FINISH</text>
        {peakP && (
          <>
            <circle cx={peakP[0]} cy={peakP[1]} r="6" fill="#FC4D54" stroke="var(--color-l0)" strokeWidth="3" />
            <text x={peakP[0] + 12} y={peakP[1] + 4} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#FC4D54" fontWeight="700">PEAK · {Math.round(peakFt)} FT</text>
          </>
        )}
      </svg>
    </div>
  );
}

function ElevationChart({ points, race, totalMi, peakMi, peakFt }: { points: ParsedPoint[]; race: SavedRace; totalMi: number; peakMi: number; peakFt: number }) {
  if (points.length < 2) return <div className="tile">No elevation data.</div>;
  const W = 600, H = 420, padL = 38, padR = 16, padT = 60, padB = 36;
  const elevsFt = points.map(p => p.eleM * 3.28084);
  const minFt = Math.min(...elevsFt);
  const maxFt = Math.max(...elevsFt);
  const fY = (e: number) => padT + (1 - (e - minFt) / Math.max(1, maxFt - minFt)) * (H - padT - padB);
  const fX = (mi: number) => padL + (mi / Math.max(1e-9, totalMi)) * (W - padL - padR);

  // Build gradient stops from phase boundaries (matches the bottom phase strip)
  const stops: Array<{ offsetPct: number; color: string }> = [];
  stops.push({ offsetPct: 0, color: PHASE_COLORS[0] });
  for (let i = 0; i < race.plan.phases.length - 1; i++) {
    const pct = (race.plan.phases[i].end_mi / totalMi) * 100;
    stops.push({ offsetPct: pct, color: PHASE_COLORS[i] });
    stops.push({ offsetPct: pct, color: PHASE_COLORS[i + 1] });
  }
  stops.push({ offsetPct: 100, color: PHASE_COLORS[Math.min(race.plan.phases.length - 1, PHASE_COLORS.length - 1)] });

  // Silhouette path
  const STEPS = 200;
  let topD = '';
  for (let i = 0; i <= STEPS; i++) {
    const mi = (i / STEPS) * totalMi;
    // interpolate elevation at mi
    let lo = 0, hi = points.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (points[m].cumMi < mi) lo = m; else hi = m; }
    const t = (mi - points[lo].cumMi) / Math.max(1e-9, points[hi].cumMi - points[lo].cumMi);
    const eFt = (points[lo].eleM + t * (points[hi].eleM - points[lo].eleM)) * 3.28084;
    topD += (i === 0 ? 'M ' : 'L ') + fX(mi).toFixed(1) + ' ' + fY(eFt).toFixed(1) + ' ';
  }
  const fillD = topD + `L ${fX(totalMi).toFixed(1)} ${(H - padB)} L ${padL} ${(H - padB)} Z`;

  return (
    <div className="tile" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px 4px' }}>
        <div className="tile-sub">Elevation</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
          <div className="tile-lbl">+{race.plan.race.total_gain_ft} / −{race.plan.race.total_loss_ft} ft</div>
          <div className="hint" style={{ marginTop: 0 }}>Peak {Math.round(peakFt)} ft · MI {peakMi.toFixed(1)}</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', display: 'block', height: 380 }}>
        <defs>
          <linearGradient id="phaseTint" x1="0" y1="0" x2="1" y2="0">
            {stops.map((s, i) => (
              <stop key={i} offset={s.offsetPct + '%'} stopColor={s.color} />
            ))}
          </linearGradient>
          <linearGradient id="vfade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
          <mask id="silMask">
            <path d={fillD} fill="url(#vfade)" />
          </mask>
        </defs>
        <rect x={padL} y={0} width={W - padL - padR} height={H - padB} fill="url(#phaseTint)" mask="url(#silMask)" opacity={0.75} />
        <path d={topD} fill="none" stroke="url(#phaseTint)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* Phase boundary ticks */}
        {race.plan.phases.slice(0, -1).map((p, i) => (
          <line key={i} x1={fX(p.end_mi)} y1={padT} x2={fX(p.end_mi)} y2={H - padB} stroke="rgba(255,255,255,.08)" strokeDasharray="2 4" />
        ))}
        {/* Y axis */}
        <text x={padL - 6} y={padT + 8} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="rgba(255,255,255,.45)" textAnchor="end" fontWeight="700">{Math.round(maxFt)}</text>
        <text x={padL - 6} y={H - padB - 2} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="rgba(255,255,255,.3)" textAnchor="end" fontWeight="700">{Math.round(minFt)}</text>
        {/* Phase strip below chart */}
        {race.plan.phases.map((p, i) => (
          <rect key={i} x={fX(p.start_mi)} y={H - padB + 4} width={fX(p.end_mi) - fX(p.start_mi)} height="8" fill={PHASE_COLORS[i] ?? '#444'} />
        ))}
        {/* X axis */}
        <text x={padL} y={H - 4} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="rgba(255,255,255,.3)" fontWeight="700">0</text>
        <text x={W - padR} y={H - 4} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="rgba(255,255,255,.3)" fontWeight="700">{totalMi.toFixed(1)}</text>
      </svg>
    </div>
  );
}

function PhaseCards({ race }: { race: SavedRace }) {
  return (
    <>
      <div className="section-h">
        <div>
          <div className="tile-sub" style={{ marginBottom: 4 }}>Terrain-aware race strategy</div>
          <h2>{race.plan.phases.length} phases</h2>
        </div>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--color-t2)', fontWeight: 700 }}>
          <b style={{ color: 'var(--color-t1)' }}>Predicted</b> {race.meta.goalDisplay} · avg {fmtPace(race.plan.goal.flat_pace_s_per_mi)}/mi
        </span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${race.plan.phases.length}, 1fr)`,
        gap: 10,
      }}>
        {race.plan.phases.map((p, i) => (
          <div key={i} className="tile" style={{ borderLeft: `3px solid ${PHASE_COLORS[i] ?? '#444'}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div className="tile-sub">PHASE {i + 1}</div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 22,
                textTransform: 'uppercase',
                letterSpacing: '-.005em',
                marginTop: 4,
                color: 'var(--color-t0)',
              }}>{p.label}</div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, letterSpacing: '1.4px', color: 'var(--color-t3)', fontWeight: 700, marginTop: 6 }}>
                MI {p.start_mi.toFixed(1)} – {p.end_mi.toFixed(1)} · {p.mean_grade_pct >= 0 ? '+' : ''}{p.mean_grade_pct.toFixed(1)}%
              </div>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, letterSpacing: '-.02em', color: PHASE_COLORS[i] ?? 'var(--color-t0)' }}>
              {p.target_pace_display}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.5, flex: 1 }}>{p.note}</div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'var(--font-data)',
              fontSize: 10,
              letterSpacing: '1.4px',
              textTransform: 'uppercase',
              color: 'var(--color-t3)',
              fontWeight: 700,
              paddingTop: 10,
              borderTop: '1px solid var(--color-l4)',
            }}>
              <span>{p.distance_mi.toFixed(1)} MI</span>
              <span>{p.cumulative_time_display}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function MileSplits({ race }: { race: SavedRace }) {
  // Build a per-mile view from the intervals.
  const miles: Array<{ mi: number; phaseIdx: number; phaseLabel: string; paceS: number; cumS: number; gel?: number }> = [];
  // Group pace intervals into whole miles by walking the intervals list.
  const paceIntervals = race.plan.intervals.filter((i): i is Extract<typeof race.plan.intervals[number], { kind: 'pace' }> => i.kind === 'pace');
  let cumMi = 0, cumS = 0;
  let curMile = 1;
  let curMileStartMi = 0;
  let curMileTime = 0;
  for (const seg of paceIntervals) {
    let segLen = seg.distance_mi;
    let segStart = seg.at_mi;
    while (segLen > 0) {
      const remaining = curMile - segStart;
      const take = Math.min(remaining, segLen);
      const t = take * seg.target_pace_s_per_mi;
      curMileTime += t;
      cumS += t;
      segLen -= take;
      segStart += take;
      cumMi = segStart;
      if (segStart >= curMile - 1e-6) {
        miles.push({
          mi: curMile,
          phaseIdx: seg.phase_idx,
          phaseLabel: race.plan.phases[seg.phase_idx]?.label ?? '',
          paceS: curMileTime / Math.max(1e-9, curMile - curMileStartMi),
          cumS,
        });
        curMile += 1;
        curMileStartMi = segStart;
        curMileTime = 0;
      }
    }
  }
  // Tail partial mile
  if (curMileTime > 0) {
    const len = cumMi - curMileStartMi;
    miles.push({
      mi: Math.round(cumMi * 100) / 100,
      phaseIdx: race.plan.phases.length - 1,
      phaseLabel: race.plan.phases[race.plan.phases.length - 1].label,
      paceS: curMileTime / Math.max(1e-9, len),
      cumS,
    });
  }
  // Mark gel miles
  const gelMis = race.plan.intervals.filter(i => i.kind === 'fuel').map(i => i.at_mi);
  for (const m of miles) {
    const hit = gelMis.find(g => Math.abs(g - m.mi) < 0.6);
    if (hit !== undefined) m.gel = race.plan.intervals.filter(i => i.kind === 'fuel' && i.at_mi <= m.mi).length;
  }

  return (
    <div className="tile" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 22px', borderBottom: '1px solid var(--color-l4)' }}>
        <div className="tile-sub">Terrain-aware mile splits</div>
        <div className="tile-lbl">Mile-by-mile pacing plan</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--color-t3)', fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>
            <th style={{ textAlign: 'left', padding: '12px 18px', width: 60 }}>Mile</th>
            <th style={{ textAlign: 'left', padding: '12px 0' }}>Segment</th>
            <th style={{ textAlign: 'right', padding: '12px 18px', width: 100 }}>Target</th>
            <th style={{ textAlign: 'right', padding: '12px 18px', width: 110 }}>Cumulative</th>
            <th style={{ width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {miles.map((m, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--color-l4)' }}>
              <td style={{ padding: '14px 18px' }}>
                <span style={{ display: 'inline-block', width: 5, height: 18, background: PHASE_COLORS[m.phaseIdx] ?? '#444', borderRadius: 1.5, marginRight: 10, verticalAlign: 'middle' }} />
                <span style={{ fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t0)', fontWeight: 700 }}>{m.mi}</span>
              </td>
              <td style={{ padding: '14px 0', fontFamily: 'var(--font-data)', fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--color-t3)', fontWeight: 700 }}>
                {m.phaseLabel}
              </td>
              <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--color-t0)' }}>
                {fmtPace(m.paceS)}
              </td>
              <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t1)' }}>
                {fmtTime(m.cumS)}
              </td>
              <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                {m.gel && <span className="chip chip--attention">GEL {m.gel}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function FuelingTile({ race }: { race: SavedRace }) {
  const f = race.plan.fueling;
  const gels = race.plan.intervals.filter(i => i.kind === 'fuel');
  return (
    <div className="tile">
      <div className="tile-h">
        <div>
          <div className="tile-sub">Fueling plan</div>
          <div className="tile-lbl">{f.gel_count} gels · {f.total_carbs_g}g carbs</div>
        </div>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--color-t3)', fontWeight: 700 }}>
          {f.gel_brand} · {f.carb_target_g_per_hr}g/hr target
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {gels.map((g, i) => g.kind === 'fuel' ? (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--color-l2)', borderRadius: 8, border: '1px solid var(--color-l4)' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, letterSpacing: '1.4px', color: 'var(--color-attention)', fontWeight: 700, textTransform: 'uppercase' }}>Gel {g.gel_number}</div>
              <div style={{ fontSize: 13, color: 'var(--color-t1)', marginTop: 4 }}>{g.item}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: 'var(--color-t0)' }}>MI {g.at_mi.toFixed(1)}</div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.4px', color: 'var(--color-t3)', fontWeight: 700, marginTop: 2 }}>{f.gel_carbs_g}g carbs</div>
            </div>
          </div>
        ) : null)}
      </div>
      {f.notes && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--color-l2)', borderRadius: 8, fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.5 }}>
          {f.notes}
        </div>
      )}
    </div>
  );
}

/* ── Result section ──────────────────────────────────────────
   Visible only after the race date has passed. If actualResult is
   already on file, shows the result + delta-vs-goal. Otherwise shows
   a form to record finish time / place / PR / notes.

   This is the on-ramp for race results until M2 wires Strava — at
   which point the matching Strava activity auto-fills this block
   and the form becomes "edit / verify". */
function ResultSection({ race }: { race: SavedRace }) {
  const days = daysUntil(race.meta.date);
  const isPast = days < 0;
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0); // re-render after save
  if (!isPast) return null;

  const result = getRace(race.slug)?.actualResult ?? null;

  function onSaved() {
    setEditing(false);
    setVersion(v => v + 1);
  }

  if (!result || editing) {
    return (
      <div className="tile" style={{
        marginTop: 10,
        borderStyle: result ? 'solid' : 'dashed',
        background: result ? 'var(--color-l1)' : 'transparent',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div className="tile-h">
          <div>
            <div className="tile-sub" style={{ color: 'var(--color-attention)' }}>Race result · {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} ago</div>
            <div className="tile-lbl">{result ? 'Edit result' : 'How did it go?'}</div>
          </div>
          {result && <button className="btn btn--ghost" onClick={() => setEditing(false)}>Cancel</button>}
        </div>
        <ResultForm race={race} existing={result} onSaved={onSaved} key={version} />
      </div>
    );
  }

  const goalDelta = result.finishS - race.plan.goal.finish_time_s;
  return (
    <div className="tile" style={{
      marginTop: 10,
      display: 'flex', flexDirection: 'column', gap: 16,
      background: 'linear-gradient(135deg, rgba(62,189,65,.08), var(--color-l1))',
      borderColor: 'rgba(62,189,65,.3)',
    }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub" style={{ color: 'var(--color-success)' }}>Result · {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} ago</div>
          <div className="tile-lbl">Finished</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {result.isPR && <span className="chip chip--attention">PR</span>}
          <button className="btn btn--ghost" onClick={() => setEditing(true)}>Edit</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 24, alignItems: 'flex-end' }}>
        <ResultStat label="Finish" value={result.finishDisplay} large />
        <ResultStat label="Avg pace" value={`${result.paceDisplay}/mi`} />
        <ResultStat
          label="vs Goal"
          value={`${goalDelta === 0 ? '±0' : goalDelta > 0 ? '+' : '−'}${fmtTimeShort(Math.abs(goalDelta))}`}
          color={goalDelta <= 0 ? 'var(--color-success)' : 'var(--color-warning)'}
        />
        <ResultStat
          label="Place"
          value={result.place != null ? (result.fieldSize != null ? `${result.place}/${result.fieldSize}` : `#${result.place}`) : '—'}
        />
      </div>
      {result.notes && (
        <div style={{ padding: 14, background: 'var(--color-l2)', borderRadius: 8, fontSize: 13.5, color: 'var(--color-t1)', lineHeight: 1.55 }}>
          {result.notes}
        </div>
      )}
    </div>
  );
}

function ResultStat({ label, value, large, color }: { label: string; value: string; large?: boolean; color?: string }) {
  return (
    <div>
      <div className="tile-sub" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: large ? 48 : 30,
        letterSpacing: '-.02em',
        lineHeight: 1,
        color: color ?? 'var(--color-t0)',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
}

function fmtTimeShort(s: number): string {
  // Output without leading zeros: "0:42" or "12:18" or "1:32:14"
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function ResultForm({ race, existing, onSaved }: { race: SavedRace; existing: ActualResult | null; onSaved: () => void }) {
  const [hms, setHms] = useState(existing?.finishDisplay ?? '');
  const [place, setPlace] = useState(existing?.place != null ? String(existing.place) : '');
  const [fieldSize, setFieldSize] = useState(existing?.fieldSize != null ? String(existing.fieldSize) : '');
  const [isPR, setIsPR] = useState(existing?.isPR ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  function parseFinish(s: string): number | null {
    const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }

  function handleSave() {
    const finishS = parseFinish(hms);
    if (finishS === null || finishS < 60) {
      setError('Use h:mm:ss or m:ss format (e.g. 1:32:14 or 21:48).');
      return;
    }
    setError(null);
    const distMi = race.meta.distanceMi;
    const paceSPerMi = Math.round(finishS / distMi);
    const result: ActualResult = {
      finishS,
      finishDisplay: fmtTimeShort(finishS),
      paceSPerMi,
      paceDisplay: fmtTimeShort(paceSPerMi),
      place: place ? Number(place) : null,
      fieldSize: fieldSize ? Number(fieldSize) : null,
      isPR,
      notes: notes.trim() || undefined,
      recordedAt: new Date().toISOString(),
    };
    setActualResult(race.slug, result);
    onSaved();
  }

  function handleClear() {
    if (!existing) return;
    setActualResult(race.slug, null);
    onSaved();
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr', gap: 14 }}>
        <div>
          <label className="runcino-label">Finish time</label>
          <input
            className="runcino-input font-data"
            placeholder={`h:mm:ss · goal ${race.meta.goalDisplay}`}
            value={hms}
            onChange={e => setHms(e.target.value)}
            style={{ fontSize: 18 }}
          />
        </div>
        <div>
          <label className="runcino-label">Place</label>
          <input className="runcino-input font-data" type="number" placeholder="—" value={place} onChange={e => setPlace(e.target.value)} />
        </div>
        <div>
          <label className="runcino-label">Field size</label>
          <input className="runcino-input font-data" type="number" placeholder="—" value={fieldSize} onChange={e => setFieldSize(e.target.value)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-t1)', cursor: 'pointer' }}>
            <input type="checkbox" checked={isPR} onChange={e => setIsPR(e.target.checked)} style={{ accentColor: 'var(--color-attention)' }} />
            Personal record
          </label>
        </div>
      </div>
      <div>
        <label className="runcino-label">Notes</label>
        <textarea
          className="runcino-input"
          rows={2}
          placeholder="How did the day go? Conditions? What worked / what didn't?"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }}
        />
      </div>
      {error && (
        <div style={{ color: 'var(--color-warning)', fontSize: 12, padding: 8, background: 'rgba(252,77,84,.08)', border: '1px solid rgba(252,77,84,.3)', borderRadius: 8 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {existing && <button className="btn btn--ghost" onClick={handleClear}>Clear result</button>}
        <button className="btn btn--primary" onClick={handleSave}>Save result</button>
      </div>
    </>
  );
}

/* ── Weather tile ────────────────────────────────────────────
   Calls /api/weather with the GPX start lat/lon and renders
   NOAA's first two forecast periods (typically race-day morning
   and afternoon). Shows the start temperature, wind, and short
   forecast — enough to inform the Claude brief below it. */
type WeatherSummary = {
  start_period: WeatherPeriod;
  second_period: WeatherPeriod | null;
  narrative: string;
};
type WeatherPeriod = {
  name: string;
  temperature_f: number;
  wind_speed_mph_min: number | null;
  wind_speed_mph_max: number | null;
  wind_direction: string;
  short_forecast: string;
  precipitation_pct: number;
};

function WeatherTile({ points }: { points: ParsedPoint[] }) {
  const [data, setData] = useState<WeatherSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lat = points[0]?.lat;
  const lon = points[0]?.lon;

  async function fetchWeather() {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setErr('No GPX coordinates'); return;
    }
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tile">
      <div className="tile-h">
        <div>
          <div className="tile-sub">Race-day weather</div>
          <div className="tile-lbl">{data ? `${Math.round(data.start_period.temperature_f)}°F · ${data.start_period.short_forecast}` : 'NOAA forecast'}</div>
        </div>
        <button className="btn btn--ghost" onClick={fetchWeather} disabled={loading}>
          {loading ? 'Fetching…' : data ? '↻ Refresh' : '↓ Fetch forecast'}
        </button>
      </div>
      {err && (
        <div style={{ color: 'var(--color-warning)', fontSize: 12, padding: 8, background: 'rgba(252,77,84,.08)', border: '1px solid rgba(252,77,84,.3)', borderRadius: 8 }}>
          {err}
        </div>
      )}
      {data && (
        <>
          <PeriodRow p={data.start_period} primary />
          {data.second_period && <PeriodRow p={data.second_period} />}
          {data.narrative && (
            <div style={{ marginTop: 8, padding: 12, background: 'var(--color-l2)', borderRadius: 8, fontSize: 12.5, color: 'var(--color-t2)', lineHeight: 1.5 }}>
              {data.narrative}
            </div>
          )}
        </>
      )}
      {!data && !loading && !err && (
        <div className="hint" style={{ padding: 14 }}>NOAA forecast is CONUS-only; Big Sur + Santa Clarita are covered. Fetch when you&apos;re within a week of race day for best accuracy.</div>
      )}
    </div>
  );
}

function PeriodRow({ p, primary }: { p: WeatherPeriod; primary?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 14px',
      background: primary ? 'var(--color-l2)' : 'transparent',
      border: primary ? '1px solid var(--color-l4)' : '1px solid transparent',
      borderTop: !primary ? '1px solid var(--color-l4)' : undefined,
      borderRadius: primary ? 8 : 0,
    }}>
      <div>
        <div className="tile-sub">{p.name}</div>
        <div style={{ fontSize: 13, color: 'var(--color-t1)', marginTop: 4 }}>{p.short_forecast}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: primary ? 28 : 20, color: 'var(--color-t0)', letterSpacing: '-.02em', lineHeight: 1 }}>
          {Math.round(p.temperature_f)}°
        </div>
        <div className="tile-sub" style={{ marginTop: 2 }}>
          {p.wind_speed_mph_max != null ? `${p.wind_direction} ${p.wind_speed_mph_max} mph` : 'calm'}
        </div>
      </div>
    </div>
  );
}

/* ── Claude race-morning brief tile ─────────────────────────
   Calls /api/brief with the plan's phases + a weather text
   description. Returns a short narrative + optional pace deltas
   per phase. Output is a stub when ANTHROPIC_API_KEY isn't set. */
type BriefResponse = {
  narrative: string;
  plan_adjustments: Array<{ phase_idx: number; pace_delta_s_per_mi: number; reason: string }>;
  stub?: boolean;
};

function BriefTile({ race }: { race: SavedRace }) {
  const [weather, setWeather] = useState('');
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setLoading(true); setErr(null);
    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          courseSlug: race.meta.courseSlug,
          weatherText: weather || 'no specific forecast — assume seasonal norms',
          phases: race.plan.phases.map(p => ({
            index: p.index,
            label: p.label,
            startMi: p.start_mi,
            endMi: p.end_mi,
            paceSPerMi: p.target_pace_s_per_mi,
            grade: p.mean_grade_pct,
          })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setBrief(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="tile">
      <div className="tile-h">
        <div>
          <div className="tile-sub">Race-morning brief</div>
          <div className="tile-lbl">{brief ? 'Claude says:' : 'Generate brief'}</div>
        </div>
        {brief?.stub && <span className="chip">STUB · NO API KEY</span>}
      </div>
      {!brief && (
        <>
          <textarea
            className="runcino-input"
            placeholder="Paste forecast (e.g., '52°F start, 60°F finish, NW wind 8 mph, overcast') — or leave blank for seasonal default."
            value={weather}
            onChange={e => setWeather(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }}
          />
          <button className="btn btn--primary" onClick={generate} disabled={loading} style={{ alignSelf: 'flex-start' }}>
            {loading ? 'Asking Claude…' : '✦ Generate'}
          </button>
        </>
      )}
      {brief && (
        <>
          <div style={{ padding: 14, background: 'var(--color-l2)', borderRadius: 8, fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.55 }}>
            {brief.narrative}
          </div>
          {brief.plan_adjustments.length > 0 && (
            <div>
              <div className="tile-sub" style={{ marginBottom: 8 }}>Suggested pace tweaks</div>
              {brief.plan_adjustments.map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: i > 0 ? '1px solid var(--color-l4)' : 'none', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--color-t1)' }}>
                    Phase {a.phase_idx + 1} · {race.plan.phases[a.phase_idx]?.label}
                  </span>
                  <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, color: a.pace_delta_s_per_mi >= 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                    {a.pace_delta_s_per_mi >= 0 ? '+' : ''}{a.pace_delta_s_per_mi}s/mi · {a.reason}
                  </span>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn--ghost" onClick={() => setBrief(null)} style={{ alignSelf: 'flex-start' }}>↻ Regenerate</button>
        </>
      )}
      {err && (
        <div style={{ color: 'var(--color-warning)', fontSize: 12, padding: 8, background: 'rgba(252,77,84,.08)', border: '1px solid rgba(252,77,84,.3)', borderRadius: 8 }}>
          {err}
        </div>
      )}
    </div>
  );
}

function ExportFooter({ race, onDownload }: { race: SavedRace; onDownload: () => void }) {
  return (
    <div className="tile" style={{
      marginTop: 10,
      background: 'var(--color-l0)',
      borderColor: 'var(--color-l5)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 24,
    }}>
      <div>
        <div className="eyebrow">Ship it to the watch</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, marginTop: 4, textTransform: 'uppercase' }}>
          .runcino.json · {race.plan.intervals.length} intervals
        </div>
        <div style={{ color: 'var(--color-t2)', fontSize: 13, marginTop: 4 }}>
          AirDrop to your phone → open in Runcino → push to Watch via WorkoutKit.
        </div>
      </div>
      <button className="btn btn--primary" onClick={onDownload} style={{ padding: '14px 24px' }}>
        ↓ Download .runcino.json
      </button>
    </div>
  );
}
