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
import { autoSyncStrava } from '../../../lib/strava-auto';
import { getCourseFacts, type CourseFacts } from '../../../lib/course-facts';

// Phase color palette — 8 deterministic colors so any course with up to 8
// phases gets a distinct hue. Extends the 5-color rainbow used in the
// canonical Sombrero design with the additional palette tokens defined
// in runcino.css (pink, aqua, orange) so 6-phase races like Big Sur
// don't fall off the end with a gray-stub final segment.
const PHASE_COLORS = [
  '#3EBD41', // 1 · success green
  '#F3AD3B', // 2 · attention amber
  '#FC4D54', // 3 · warning red
  '#008FEC', // 4 · corporate blue
  '#9013FE', // 5 · xp purple
  '#CD317C', // 6 · pink
  '#27E087', // 7 · aqua
  '#E88221', // 8 · orange
];

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

/** True if the race is past AND we already have a recorded finish.
 *  Gates the pre-race planning tiles (weather forecast, race-morning
 *  brief, full mile-by-mile pacing plan, fueling target) — those
 *  re-render the same numbers ResultSection now shows in plan-vs-
 *  Strava form, so leaving them in is redundant or nonsensical. */
function isPastWithResult(race: SavedRace): boolean {
  return daysUntil(race.meta.date) < 0 && race.actualResult != null;
}

function fmtPace(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface ParsedPoint { lat: number; lon: number; eleM: number; cumMi: number; }

/** Parse GPX into points. When demElevations is provided (parallel array
 *  of DEM elevations in meters), overlay it onto the points so the
 *  elevation profile and peak marker match what the pacing engine used. */
function parseGpxClient(text: string, demElevations?: number[]): ParsedPoint[] {
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const nodes = dom.getElementsByTagName('trkpt');
  const out: { lat: number; lon: number; eleM: number }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const lat = parseFloat(n.getAttribute('lat') ?? '');
    const lon = parseFloat(n.getAttribute('lon') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleNode = n.getElementsByTagName('ele')[0];
    const gpsEleM = eleNode ? parseFloat(eleNode.textContent ?? '0') : 0;
    // Use DEM elevation when available; fall back to GPS
    const eleM = (demElevations && demElevations[out.length] !== undefined)
      ? demElevations[out.length]
      : gpsEleM;
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
    let cancelled = false;
    // Run seed migration on detail page too — users who land directly
    // on /races/<slug> via a bookmark or shared link get the latest
    // plan shape without having to visit / or /races first. Then
    // background-sync from Strava and re-read once it lands.
    (async () => {
      const initial = await getRace(slug);
      if (cancelled) return;
      setRace(initial);
      const sync = await autoSyncStrava();
      if (cancelled) return;
      if (sync.updatedSlugs.includes(slug)) {
        const refreshed = await getRace(slug);
        if (!cancelled) setRace(refreshed);
      }
    })();
    return () => { cancelled = true; };
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
  return <RaceDetailView
    race={race}
    onDelete={async () => { await deleteRace(race.slug); router.push('/races'); }}
    onUpdated={async () => { const fresh = await getRace(race.slug); if (fresh) setRace(fresh); }}
  />;
}

function RaceDetailView({ race, onDelete, onUpdated }: { race: SavedRace; onDelete: () => void; onUpdated: () => void }) {
  const points = useMemo(() => parseGpxClient(race.gpxText, race.demElevations), [race.gpxText, race.demElevations]);
  const days = daysUntil(race.meta.date);
  const totalMi = race.plan.race.distance_mi;
  const [editing, setEditing] = useState(false);
  const gpxPeakFt = useMemo(() => Math.max(...points.map(p => p.eleM)) * 3.28084, [points]);
  const gpxPeakMi = useMemo(() => {
    let bestIdx = 0;
    for (let i = 1; i < points.length; i++) if (points[i].eleM > points[bestIdx].eleM) bestIdx = i;
    return points[bestIdx]?.cumMi ?? 0;
  }, [points]);
  // Override GPX-computed peak with verified course facts when available.
  // GPS elevation has ±10-30 ft noise that compounds; curated facts are authoritative.
  const { peakFt, peakMi } = useMemo(() => {
    const facts = getCourseFacts(race.meta.courseSlug);
    return {
      peakFt: facts?.race.expected_facts.peak_elevation_ft ?? gpxPeakFt,
      peakMi: facts?.race.expected_facts.peak_mi ?? gpxPeakMi,
    };
  }, [race.meta.courseSlug, gpxPeakFt, gpxPeakMi]);

  // Enrich the race object with named phases from course facts (if registered).
  // All child components receive the enriched race so labels are consistent everywhere.
  const enrichedRace = useMemo(() => {
    const facts = getCourseFacts(race.meta.courseSlug);
    const enrichedPhases = enrichPhaseLabels(race.plan.phases, facts);
    const phasesDiffer = enrichedPhases.some((p, i) => p.label !== race.plan.phases[i].label);
    if (!phasesDiffer && !facts) return race;
    return {
      ...race,
      plan: { ...race.plan, phases: enrichedPhases },
    };
  }, [race]);

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
              <button className="btn btn--ghost" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn btn--ghost" onClick={onDelete}>Delete</button>
              <button className="btn btn--primary" onClick={downloadJson}>↓ Export .runcino.json</button>
            </div>
          </div>
          {editing && <EditRaceModal race={race} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onUpdated(); }} />}

          <PosterCard race={enrichedRace} points={points} days={days} totalMi={totalMi} peakFt={peakFt} peakMi={peakMi} onUpdated={onUpdated} />

          <PhaseCards race={enrichedRace} phases={enrichedRace.plan.phases} />

          <ResultSection race={enrichedRace} />

          {/* Pre-race planning tiles. Hidden once the race is past +
              has a recorded result — at that point the per-mile +
              per-phase plan-vs-Strava tables in ResultSection make
              these redundant or nonsensical (race-morning brief, etc). */}
          {!isPastWithResult(race) && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <WeatherTile points={points} />
                <BriefTile race={enrichedRace} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 10, marginTop: 10 }}>
                <MileSplits race={enrichedRace} />
                <FuelingTile race={enrichedRace} />
              </div>
            </>
          )}

          <ExportFooter race={enrichedRace} onDownload={downloadJson} />
        </div>
      </div>
    </>
  );
}

/* ── Race narratives ─────────────────────────────────────────
   Per-course copy for the poster body — lede paragraph, course
   description, start/weather paragraph, header label. Custom
   courses (synthesized facts) get a generic narrative built from
   the GPX shape. Pulled directly from the canonical
   designs/race-detail.html and designs/race-detail-sombrero.html. */
type Narrative = {
  round: string;
  subtitle: string;
  lede: React.ReactNode;
  para1: React.ReactNode;
  para2: React.ReactNode;
};
function narrativeFor(slug: string, race: SavedRace, peakMi: number, peakFt: number, totalGain: number): Narrative {
  const climbLen = 2;
  const climbGain = Math.round(totalGain * 0.55);
  if (slug === 'big-sur-marathon') {
    return {
      round: 'Round 01 · 2026 Season · Coastal Division',
      subtitle: 'International · Marathon · Sunday 26 April',
      lede: 'One of the most scenic road marathons on the continent — a point-to-point course carved into the Pacific edge, from redwoods at Big Sur Station to the coastal village of Carmel-by-the-Sea.',
      para1: <>The course is <b>five sectors</b>. It opens under the redwood canopy, unfolds into rolling coastal approach, steepens into the <em>Hurricane Point climb</em> at mile {peakMi.toFixed(1)} — a {climbLen}-mile, {climbGain}-foot ascent into a prevailing headwind — then releases into a long descent past <b>Bixby Bridge</b> and the cruise miles to Carmel Highlands.</>,
      para2: <>First run in 1986. Start 06:45 AM · Cutoff 6:00 · Field 4,500.</>,
    };
  }
  if (slug === 'sombrero-half') {
    return {
      round: 'Round 02 · 2026 Season · Tune-up Division',
      subtitle: 'Santa Clarita · Half Marathon · Sunday 3 May',
      lede: <>A homegrown Santa Clarita half — a rolling loop from <b>Heritage Park</b> through the Newhall Ranch neighborhoods, with one meaningful climb tucked in the middle and a descent home that pays it back.</>,
      para1: <>The course is <b>five sectors</b>. It opens flat across the park, builds into rolling neighborhood streets, steepens to the day&apos;s high point near mile {peakMi.toFixed(1)} — a {climbLen}-mile, {climbGain}-foot pull — then releases into a long net-downhill cruise back to the finish at Newhall Ranch Road.</>,
      para2: <>Start 07:15 AM · Loop course (start = finish). Weather window: <em>60°F · clear · light NE</em>. Tune-up before the season&apos;s A-races — leave room in the tank.</>,
    };
  }
  // Generic narrative for custom courses — synthesize from the GPX.
  return {
    round: '2026 Season',
    subtitle: `${race.meta.distanceMi.toFixed(1)} mi · ${fmtDate(race.meta.date)}`,
    lede: <>{race.meta.distanceMi.toFixed(1)}-mile course built from your uploaded GPX. Pacing plan, fueling schedule, and Watch intervals derived from the trace below.</>,
    para1: <>The course is <b>five sectors</b>, auto-detected from the elevation profile. The day&apos;s high point lands at mile {peakMi.toFixed(1)} ({Math.round(peakFt)} ft) — pace targets adjust per phase using the Minetti grade-adjusted-pace curve.</>,
    para2: <>Goal: <em>{race.meta.goalDisplay}</em>. Strategy: {race.plan.goal.strategy.replace(/_/g, ' ')}. Watch tolerance ±{race.plan.tolerance.pace_s_per_mi} s/mi.</>,
  };
}

/* ── Phase label enrichment ─────────────────────────────────
   For each plan phase, find the course-facts phase that overlaps
   the most (by mile range) and use its label. If no facts exist
   or no overlap is found, the original plan label is kept. */
function enrichPhaseLabels(
  planPhases: SavedRace['plan']['phases'],
  facts: CourseFacts | null
): SavedRace['plan']['phases'] {
  if (!facts || facts.phases.length === 0) return planPhases;

  // Each facts phase donates its label to exactly one plan phase — the one
  // with the greatest mile overlap. This prevents two plan phases that both
  // fall inside the same facts phase from sharing the same label.
  const labelMap = new Map<number, string>(); // planPhase index → facts label
  const claimedOverlap = new Map<number, number>(); // planPhase index → winning overlap

  for (const fp of facts.phases) {
    let bestIdx = -1;
    let bestOverlap = 0;
    for (let i = 0; i < planPhases.length; i++) {
      const p = planPhases[i];
      const overlap = Math.max(0, Math.min(p.end_mi, fp.end_mi) - Math.max(p.start_mi, fp.start_mi));
      if (overlap > bestOverlap) { bestOverlap = overlap; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestOverlap > 0) {
      // Only overwrite a previous claim if this facts phase has more overlap
      if (bestOverlap > (claimedOverlap.get(bestIdx) ?? 0)) {
        labelMap.set(bestIdx, fp.label);
        claimedOverlap.set(bestIdx, bestOverlap);
      }
    }
  }

  return planPhases.map((p, i) =>
    labelMap.has(i) ? { ...p, label: labelMap.get(i)! } : p
  );
}

/* ── Poster card ────────────────────────────────────────────
   The hero of the race-detail page. Single .poster-c container
   holding header (round + countdown), big race title, subtitle,
   2-col map+narrative grid, and full-width elevation strip with
   axis. Direct port of designs/race-detail-sombrero.html. */
function PosterCard({ race, points, days, totalMi, peakFt, peakMi, onUpdated }: {
  race: SavedRace;
  points: ParsedPoint[];
  days: number;
  totalMi: number;
  peakFt: number;
  peakMi: number;
  onUpdated?: () => void;
}) {
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalInput, setGoalInput] = useState(race.meta.goalDisplay);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);

  function parseGoalInput(s: string): number | null {
    const m = s.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  }

  async function submitGoal() {
    const goalS = parseGoalInput(goalInput);
    if (goalS == null) { setGoalError('Use h:mm:ss'); return; }
    setGoalBusy(true);
    setGoalError(null);
    try {
      const res = await fetch(`/api/races/${encodeURIComponent(race.slug)}/rebuild`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goalFinishS: goalS, raceDate: race.meta.date, raceName: race.meta.name }),
      });
      if (!res.ok) throw new Error(await res.text());
      setGoalEditing(false);
      onUpdated?.();
    } catch (e) {
      setGoalError(e instanceof Error ? e.message : String(e));
    } finally {
      setGoalBusy(false);
    }
  }

  const facts = getCourseFacts(race.meta.courseSlug);
  const totalGain = facts?.race.expected_facts.total_gain_ft ?? race.plan.race.total_gain_ft;
  const totalLoss = facts?.race.expected_facts.total_loss_ft ?? race.plan.race.total_loss_ft;
  const netElevFt = facts?.race.expected_facts.net_ft ?? (totalGain - totalLoss);
  // race.plan.phases already enriched by RaceDetailView
  const enrichedPhases = race.plan.phases;
  const narrative = narrativeFor(race.meta.courseSlug, race, peakMi, peakFt, totalGain);
  const isUpcoming = days >= 0;
  const result = race.actualResult ?? null;
  // The page operates in two modes:
  //   pre-race: countdown + plan-forward (goal time front-and-center)
  //   debrief:  past-race report (actual finish + delta vs goal lead;
  //             plan stays as supporting context further down)
  const isDebrief = !isUpcoming && result != null;
  const goalDeltaSec = result ? result.finishS - race.plan.goal.finish_time_s : 0;

  return (
    <div className="poster-c">
      {/* Header strip — page label + countdown. Debrief mode replaces
          the day-counter with the finish time; the layout stays
          consistent so the title never overlaps the badge. */}
      <div className="pc-head">
        <div className="rd">
          <b>{isDebrief ? 'Race report' : isUpcoming ? 'Coming up' : 'Race report'}</b>
          <span> · {fmtDate(race.meta.date)}</span>
        </div>
        {isDebrief && result ? (
          <div className="pc-countdown" style={{ alignItems: 'flex-end' }}>
            <span style={{
              fontFamily: 'Oswald, sans-serif',
              fontWeight: 700,
              fontSize: 64,
              lineHeight: .9,
              letterSpacing: '-.025em',
              color: '#7DD685',
              fontVariantNumeric: 'tabular-nums',
            }}>{result.finishDisplay}</span>
            <span className="lbl" style={{ color: goalDeltaSec <= 0 ? '#7DD685' : '#FC4D54' }}>
              {goalDeltaSec === 0 ? 'on goal' : (goalDeltaSec > 0 ? '+' : '−') + fmtTimeShort(Math.abs(goalDeltaSec)) + ' vs goal'}
            </span>
          </div>
        ) : (
          <div className="pc-countdown">
            <span className="big">{Math.abs(days)}</span>
            <span className="lbl">
              {isUpcoming
                ? (days === 0 ? 'Today' : days === 1 ? 'Day to go' : 'Days to go')
                : (Math.abs(days) === 1 ? 'Day ago' : 'Days ago')}
            </span>
          </div>
        )}
      </div>

      <h1 className="pc-title">{race.meta.name.replace(/marathon/i, 'Marathon').toUpperCase()}</h1>
      <div className="pc-subtitle">{narrative.subtitle}</div>

      <div className="pc-grid">
        {/* Course map (left column) */}
        <div className="pc-track">
          <PosterMapSvg points={points} race={race} peakMi={peakMi} peakFt={peakFt} />
        </div>

        {/* Narrative + stats + phase legend (right column) */}
        <div className="pc-body">
          {isDebrief && result ? (
            <>
              {/* Top stats — actual race results */}
              <div className="pc-stats">
                <div className="s">
                  <span className="l">Distance</span>
                  <span className="v">{totalMi.toFixed(1)}<small>mi</small></span>
                </div>
                <div className="s">
                  <span className="l">Avg pace</span>
                  <span className="v">{result.paceDisplay}<small>/mi</small></span>
                </div>
                <div className="s">
                  <span className="l">vs Goal {race.meta.goalDisplay.replace(/:00$/, '')}</span>
                  <span className="v" style={{ color: goalDeltaSec <= 0 ? '#7DD685' : '#FC4D54' }}>
                    {goalDeltaSec === 0 ? '±0' : (goalDeltaSec > 0 ? '+' : '−') + fmtTimeShort(Math.abs(goalDeltaSec))}
                  </span>
                </div>
                <div className="s">
                  <span className="l">Avg HR</span>
                  <span className="v">{result.avgHr ? Math.round(result.avgHr) : '—'}<small>{result.avgHr ? 'bpm' : ''}</small></span>
                </div>
              </div>
              {/* Second row — Strava enrichment */}
              <div className="pc-stats" style={{ marginTop: -20 }}>
                <div className="s">
                  <span className="l">Max HR</span>
                  <span className="v">{result.maxHr ? Math.round(result.maxHr) : '—'}<small>{result.maxHr ? 'bpm' : ''}</small></span>
                </div>
                <div className="s">
                  <span className="l">Cadence</span>
                  <span className="v">{result.avgCadence ? Math.round(result.avgCadence * 2) : '—'}<small>{result.avgCadence ? 'spm' : ''}</small></span>
                </div>
                <div className="s">
                  <span className="l">Elev gain</span>
                  <span className="v">+{result.totalGainFt ?? '—'}<small>{result.totalGainFt != null ? 'ft' : ''}</small></span>
                </div>
                <div className="s">
                  <span className="l">Source</span>
                  <span className="v" style={{ fontSize: 14 }}>
                    {result.source === 'strava' ? 'Strava' : 'Manual'}
                  </span>
                </div>
              </div>
              {result.activityName && (
                <p className="pc-lede" style={{ fontStyle: 'italic' }}>“{result.activityName}”</p>
              )}
              <p className="pc-para">
                {goalDeltaSec <= 0
                  ? <>Came in <em>{fmtTimeShort(Math.abs(goalDeltaSec))} under goal</em>.</>
                  : <>Came in <em>{fmtTimeShort(goalDeltaSec)} over goal</em>.</>}
                {' '}Plan was <b>{race.meta.goalDisplay}</b> at {fmtPace(race.plan.goal.flat_pace_s_per_mi)}/mi flat-equivalent.
                Actual: <b>{result.finishDisplay}</b> at {result.paceDisplay}/mi avg.
              </p>
              {result.notes && (
                <p className="pc-para" style={{ borderLeft: '2px solid rgba(255,255,255,.12)', paddingLeft: 14 }}>
                  {result.notes}
                </p>
              )}
            </>
          ) : (
            <>
              {/* Pre-race: planning view */}
              <div className="pc-stats">
                <div className="s">
                  <span className="l">Distance</span>
                  <span className="v">{totalMi.toFixed(1)}<small>mi</small></span>
                </div>
                <div className="s">
                  <span className="l">Elevation</span>
                  <span className="v" style={{ color: netElevFt < -50 ? 'var(--color-recovery)' : netElevFt > 50 ? 'var(--color-warn)' : 'inherit' }}>
                    {netElevFt >= 0 ? '+' : ''}{Math.round(netElevFt)}<small>ft net</small>
                  </span>
                </div>
                <div className="s" style={{ cursor: !goalEditing ? 'pointer' : 'default' }} onClick={() => { if (!goalEditing) { setGoalInput(race.meta.goalDisplay); setGoalError(null); setGoalEditing(true); } }}>
                  <span className="l">Goal Time {!goalEditing && <span style={{ fontSize: 9, opacity: 0.5, letterSpacing: '1px' }}>✎</span>}</span>
                  {goalEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }} onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={goalInput}
                        onChange={e => setGoalInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitGoal(); if (e.key === 'Escape') setGoalEditing(false); }}
                        style={{ fontFamily: 'var(--font-data)', fontSize: 22, fontWeight: 700, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.2)', borderRadius: 6, color: '#fff', padding: '2px 8px', width: 110 }}
                        placeholder="h:mm:ss"
                      />
                      {goalError && <span style={{ fontSize: 10, color: 'var(--color-warn)' }}>{goalError}</span>}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn--primary" style={{ padding: '3px 10px', fontSize: 11 }} disabled={goalBusy} onClick={submitGoal}>{goalBusy ? '…' : 'Rebuild'}</button>
                        <button className="btn btn--ghost" style={{ padding: '3px 10px', fontSize: 11 }} disabled={goalBusy} onClick={() => setGoalEditing(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <span className="v accent">{race.meta.goalDisplay.replace(/^0?:?/,'').replace(/:00$/, '')}</span>
                  )}
                </div>
                <div className="s">
                  <span className="l">Peak</span>
                  <span className="v">{Math.round(peakFt)}<small>ft</small></span>
                </div>
              </div>
              <p className="pc-lede">{narrative.lede}</p>
              <p className="pc-para">{narrative.para1}</p>
              <p className="pc-para">{narrative.para2}</p>
            </>
          )}

          {/* Phase legend — same in both modes; debrief mode adds an
              empty actual column placeholder until splits_metric lands. */}
          <div className="pc-legend">
            {enrichedPhases.map((p, i) => (
              <div className="row" key={i}>
                <div className="bar" style={{ background: PHASE_COLORS[i] ?? '#444' }} />
                <span className="name">{p.label}</span>
                <span className="mi">MI {p.start_mi.toFixed(1)} – {p.end_mi.toFixed(1)}</span>
                <span className="pace">{p.target_pace_display}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Elevation strip — full width below the grid, inside the same poster card */}
      <div className="pc-elev">
        <div className="head">
          <span className="l">Elevation Profile</span>
          <span className="r">Peak <em>{Math.round(peakFt)} ft · MI {peakMi.toFixed(1)}</em></span>
        </div>
        <PosterElevSvg points={points} race={race} totalMi={totalMi} peakMi={peakMi} peakFt={peakFt} />
        <div className="axis">
          <span>0</span>
          <span>{(totalMi / 2).toFixed(1)}</span>
          <span>{totalMi.toFixed(1)}</span>
        </div>
        {/* Mirrored phase strip — same phases as the cards below the
            poster, sized proportionally to each phase's mile share. */}
        <div className="pc-grade">
          <div className="lgd" style={{ display: 'grid', gridTemplateColumns: enrichedPhases.map(p => `${(p.distance_mi).toFixed(2)}fr`).join(' '), gap: 0 }}>
            {enrichedPhases.map((p, i) => (
              <div key={i} className="i" style={{ borderColor: PHASE_COLORS[i] ?? '#444' }}>
                <span className="l">{p.label}</span>
                <span className="v">{p.distance_mi.toFixed(1)}<small>mi</small></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Poster map SVG ──────────────────────────────────────────
   Internal helper. Projects lat/lon trackpoints into the .pc-track
   container. Phase-colored polyline + START / FINISH / PEAK dots. */
function PosterMapSvg({ points, race, peakMi, peakFt }: { points: ParsedPoint[]; race: SavedRace; peakMi: number; peakFt: number }) {
  if (points.length < 2) return <div style={{ padding: 32, color: 'rgba(255,255,255,.5)' }}>No GPX track points.</div>;
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const padX = 30, padY = 30, W = 600, H = 600;
  const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const spanLon = (maxLon - minLon) * cosLat || 1e-9;
  const spanLat = maxLat - minLat || 1e-9;
  const scale = Math.min((W - 2 * padX) / spanLon, (H - 2 * padY) / spanLat);
  const offX = padX + ((W - 2 * padX) - spanLon * scale) / 2;
  const offY = padY + ((H - 2 * padY) - spanLat * scale) / 2;
  const proj = (p: ParsedPoint): [number, number] => [
    offX + (p.lon - minLon) * cosLat * scale,
    offY + (maxLat - p.lat) * scale,
  ];
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
      }
      cur = [`M ${x.toFixed(1)} ${y.toFixed(1)}`];
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

  // Pre-project every route point once. Used to figure out which side
  // of each label dot has empty space, so we can place the label on
  // that side instead of running the text into the route line.
  const routePts: Array<[number, number]> = points.map(p => {
    const r = proj(p); return [r[0], r[1]];
  });

  // For each anchor dot, pick the side (N/E/S/W) with the fewest route
  // points within ~60px — that's the "empty" side, where the label
  // goes. Cheap O(N) per anchor, runs once per render.
  const peakLabelText = `PEAK · ${Math.round(peakFt)} FT`;
  const startSide = pickEmptySide(startP, routePts, 80, estLabelWidth('START'), 13, W, H);
  const endSide   = pickEmptySide(endP,   routePts, 80, estLabelWidth('FINISH'), 13, W, H);
  // When the peak is within 20px of START or FINISH, exclude the START/FINISH label's side
  // so PEAK is forced to a different quadrant and the two labels don't collide.
  const peakNearStart = peakP ? Math.hypot(peakP[0] - startP[0], peakP[1] - startP[1]) < 20 : false;
  const peakNearEnd   = peakP ? Math.hypot(peakP[0] - endP[0],   peakP[1] - endP[1])   < 20 : false;
  const peakSide  = peakP ? pickEmptySide(peakP, routePts, 80, estLabelWidth(peakLabelText), 13, W, H,
    peakNearStart ? startSide : peakNearEnd ? endSide : undefined) : 'E';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      {segs.map((s, i) => (
        <path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />
      ))}

      <circle cx={startP[0]} cy={startP[1]} r="9" fill="#3EBD41" stroke="#0d1218" strokeWidth="3" />
      <SideLabel anchor={startP} side={startSide} text="START" color="#3EBD41" />

      <circle cx={endP[0]} cy={endP[1]} r="9" fill="#9013FE" stroke="#0d1218" strokeWidth="3" />
      <SideLabel anchor={endP} side={endSide} text="FINISH" color="#9013FE" />

      {peakP && (
        <>
          <circle cx={peakP[0]} cy={peakP[1]} r="7" fill="#FC4D54" stroke="#0d1218" strokeWidth="3" />
          <SideLabel anchor={peakP} side={peakSide} text={peakLabelText} color="#FC4D54" />
        </>
      )}
    </svg>
  );
}

type Side = 'N' | 'E' | 'S' | 'W';

/** Pick the side of the anchor where the label fits — has the
 *  fewest route points to read into AND its bounding box stays
 *  inside the SVG viewport. Without the viewport check, anchors
 *  near the edges had labels clipped (e.g. a peak on the left edge
 *  with the label placed 'W' would slide off-canvas leaving only
 *  "FT" visible). */
function pickEmptySide(
  anchor: [number, number],
  routePts: Array<[number, number]>,
  radius: number,
  textWidth: number,
  textHeight: number,
  viewW: number,
  viewH: number,
  excludeSide?: Side,
): Side {
  const [ax, ay] = anchor;
  const counts: Record<Side, number> = { N: 0, E: 0, S: 0, W: 0 };
  for (const [rx, ry] of routePts) {
    const dx = rx - ax, dy = ry - ay;
    if (Math.hypot(dx, dy) > radius) continue;
    if (Math.abs(dx) >= Math.abs(dy)) (dx >= 0 ? counts.E++ : counts.W++);
    else (dy >= 0 ? counts.S++ : counts.N++);
  }

  const offset = 26;
  const margin = 4;
  // Compute the would-be bounding box for each side and rule out
  // any side whose bbox extends outside [margin, viewW-margin] x
  // [margin, viewH-margin]. Heavily penalize clipped sides so we
  // pick a non-clipping option even if it has more route points.
  const fits: Record<Side, boolean> = {
    N: ay - offset - textHeight >= margin && ax - textWidth / 2 >= margin && ax + textWidth / 2 <= viewW - margin,
    S: ay + offset + textHeight <= viewH - margin && ax - textWidth / 2 >= margin && ax + textWidth / 2 <= viewW - margin,
    E: ax + offset + textWidth <= viewW - margin && ay - textHeight / 2 >= margin && ay + textHeight / 2 <= viewH - margin,
    W: ax - offset - textWidth >= margin && ay - textHeight / 2 >= margin && ay + textHeight / 2 <= viewH - margin,
  };
  const score: Record<Side, number> = {
    N: counts.N + (fits.N ? 0 : 1000) + (excludeSide === 'N' ? 2000 : 0),
    S: counts.S + (fits.S ? 0 : 1000) + (excludeSide === 'S' ? 2000 : 0),
    E: counts.E + (fits.E ? 0 : 1000) + (excludeSide === 'E' ? 2000 : 0),
    W: counts.W + (fits.W ? 0 : 1000) + (excludeSide === 'W' ? 2000 : 0),
  };
  const order: Side[] = ['N', 'S', 'E', 'W'];
  return order.slice().sort((a, b) => score[a] - score[b])[0];
}

function SideLabel({ anchor, side, text, color }: { anchor: [number, number]; side: Side; text: string; color: string }) {
  const offset = 26;
  let x = anchor[0], y = anchor[1], textAnchor: 'start' | 'middle' | 'end' = 'middle';
  switch (side) {
    case 'N': y = anchor[1] - offset; textAnchor = 'middle'; break;
    case 'S': y = anchor[1] + offset + 4; textAnchor = 'middle'; break;
    case 'E': x = anchor[0] + offset; y = anchor[1] + 4; textAnchor = 'start'; break;
    case 'W': x = anchor[0] - offset; y = anchor[1] + 4; textAnchor = 'end'; break;
  }
  return (
    <text x={x} y={y} fontFamily="JetBrains Mono, monospace" fontSize="11" fill={color} textAnchor={textAnchor} fontWeight="700">{text}</text>
  );
}

/** Estimated label width at the SVG's font-size (11) for JetBrains
 *  Mono. Roughly 6.6 px/char + a bit of padding. */
function estLabelWidth(text: string): number {
  return text.length * 6.6 + 4;
}

/* ── Poster elevation SVG ────────────────────────────────────
   Internal helper. Phase-tinted silhouette spanning the .pc-elev
   strip. Y-axis shows peak / low; X-axis is below outside the SVG. */
function PosterElevSvg({ points, race, totalMi, peakMi, peakFt }: { points: ParsedPoint[]; race: SavedRace; totalMi: number; peakMi: number; peakFt: number }) {
  if (points.length < 2) return null;
  const W = 1200, H = 220, padL = 46, padR = 14, padT = 18, padB = 18;
  const elevsFt = points.map(p => p.eleM * 3.28084);
  const minFt = Math.min(...elevsFt);
  const maxFt = Math.max(...elevsFt);
  const fY = (e: number) => padT + (1 - (e - minFt) / Math.max(1, maxFt - minFt)) * (H - padT - padB);
  const fX = (mi: number) => padL + (mi / Math.max(1e-9, totalMi)) * (W - padL - padR);

  // Soft transitions: one stop per phase, anchored at its MIDPOINT so
  // the gradient interpolates between adjacent phase colors instead
  // of cutting hard. First/last anchored at 0%/100% so the ends still
  // read as their phase color. Matches the Sombrero design's strip.
  const stops: Array<{ offsetPct: number; color: string }> = race.plan.phases.map((p, i) => {
    const mid = ((p.start_mi + p.end_mi) / 2 / totalMi) * 100;
    const offset =
      i === 0                          ? 0   :
      i === race.plan.phases.length - 1 ? 100 :
      mid;
    return { offsetPct: offset, color: PHASE_COLORS[i] ?? '#444' };
  });

  const STEPS = 240;
  let topD = '';
  for (let i = 0; i <= STEPS; i++) {
    const mi = (i / STEPS) * totalMi;
    let lo = 0, hi = points.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (points[m].cumMi < mi) lo = m; else hi = m; }
    const t = (mi - points[lo].cumMi) / Math.max(1e-9, points[hi].cumMi - points[lo].cumMi);
    const eFt = (points[lo].eleM + t * (points[hi].eleM - points[lo].eleM)) * 3.28084;
    topD += (i === 0 ? 'M ' : 'L ') + fX(mi).toFixed(1) + ' ' + fY(eFt).toFixed(1) + ' ';
  }
  const fillD = topD + `L ${fX(totalMi).toFixed(1)} ${(H - padB)} L ${padL} ${(H - padB)} Z`;
  const peakXY = peakMi >= 0 ? [fX(peakMi), fY(peakFt)] : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="pcElevTint" x1="0" y1="0" x2="1" y2="0">
          {stops.map((s, i) => (
            <stop key={i} offset={s.offsetPct + '%'} stopColor={s.color} />
          ))}
        </linearGradient>
        <linearGradient id="pcElevFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity={.5} />
          <stop offset="100%" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <mask id="pcElevSilMask">
          <path d={fillD} fill="url(#pcElevFade)" />
        </mask>
      </defs>
      {[0.25, 0.5, 0.75].map((f, i) => (
        <line key={i} x1={padL} y1={padT + f * (H - padT - padB)} x2={W - padR} y2={padT + f * (H - padT - padB)} stroke="rgba(255,255,255,.06)" strokeDasharray="2 4" />
      ))}
      <rect x={padL} y={0} width={W - padL - padR} height={H - padB} fill="url(#pcElevTint)" mask="url(#pcElevSilMask)" opacity={.78} />
      <path d={topD} fill="none" stroke="url(#pcElevTint)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {race.plan.phases.slice(0, -1).map((p, i) => (
        <line key={i} x1={fX(p.end_mi)} y1={padT} x2={fX(p.end_mi)} y2={H - padB} stroke="rgba(255,255,255,.08)" strokeDasharray="2 4" />
      ))}
      <text x={padL - 8} y={padT + 8} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="rgba(255,255,255,.45)" textAnchor="end" fontWeight="700">{Math.round(maxFt)}</text>
      <text x={padL - 8} y={H - padB - 2} fontFamily="JetBrains Mono, monospace" fontSize="10" fill="rgba(255,255,255,.3)" textAnchor="end" fontWeight="700">{Math.round(minFt)}</text>
      {peakXY && (
        <>
          <line x1={peakXY[0]} y1={peakXY[1]} x2={peakXY[0]} y2={H - padB} stroke="rgba(252,77,84,.4)" strokeWidth="1" strokeDasharray="2 3" />
          <circle cx={peakXY[0]} cy={peakXY[1]} r="4" fill="#FC4D54" />
        </>
      )}
      {race.plan.phases.map((p, i) => (
        <rect key={i} x={fX(p.start_mi)} y={H - padB + 4} width={fX(p.end_mi) - fX(p.start_mi)} height="6" fill={PHASE_COLORS[i] ?? '#444'} />
      ))}
    </svg>
  );
}


function PhaseCards({ race, phases }: { race: SavedRace; phases: SavedRace['plan']['phases'] }) {
  return (
    <>
      <div className="section-h">
        <div>
          <div className="tile-sub" style={{ marginBottom: 4 }}>Terrain-aware race strategy</div>
          <h2>{phases.length} phases</h2>
        </div>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--color-t2)', fontWeight: 700 }}>
          <b style={{ color: 'var(--color-t1)' }}>Predicted</b> {race.meta.goalDisplay} · avg {fmtPace(race.plan.goal.flat_pace_s_per_mi)}/mi
        </span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${phases.length}, 1fr)`,
        gap: 10,
      }}>
        {phases.map((p, i) => (
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
  // Tail partial mile — labeled with the official race distance (the
  // value in race.meta.distanceMi) instead of the raw GPX-measured
  // remainder, so a half marathon shows "13.1" not "12.93".
  if (curMileTime > 0) {
    const len = cumMi - curMileStartMi;
    miles.push({
      mi: race.meta.distanceMi,
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
            <th style={{ textAlign: 'left', padding: '12px 18px', width: 96, whiteSpace: 'nowrap' }}>Mile</th>
            <th style={{ textAlign: 'left', padding: '12px 0' }}>Segment</th>
            <th style={{ textAlign: 'right', padding: '12px 18px', width: 100 }}>Target</th>
            <th style={{ textAlign: 'right', padding: '12px 18px', width: 110 }}>Cumulative</th>
            <th style={{ width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {miles.map((m, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--color-l4)' }}>
              <td style={{ padding: '14px 18px', whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ display: 'inline-block', width: 5, height: 18, background: PHASE_COLORS[m.phaseIdx] ?? '#444', borderRadius: 1.5, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t0)', fontWeight: 700 }}>{m.mi}</span>
                </span>
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
/* ── Race debrief tile ──────────────────────────────────────
   Sits below the poster card on past races. Contains the rich
   Strava enrichment that doesn't fit in the hero: per-phase
   plan-vs-actual breakdown, per-mile splits, best efforts (PRs),
   suffer score + description if present, plus the user's notes
   + an Edit button.
   The hero (PosterCard) covers the 4-up summary stats; this tile
   doesn't repeat them. */
function ResultSection({ race }: { race: SavedRace }) {
  const days = daysUntil(race.meta.date);
  const isPast = days < 0;
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<ActualResult | null>(race.actualResult ?? null);
  if (!isPast) return null;

  function onSaved() { setEditing(false); setVersion(v => v + 1); }

  // Reload the result whenever the form saves so the just-saved data
  // shows immediately. Server is the source of truth.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fresh = await getRace(race.slug);
      if (!cancelled) setResult(fresh?.actualResult ?? null);
    })();
    return () => { cancelled = true; };
  }, [race.slug, version]);

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
            <div className="tile-lbl">{result ? 'Edit notes' : 'How did it go?'}</div>
          </div>
          {result && <button className="btn btn--ghost" onClick={() => setEditing(false)}>Cancel</button>}
        </div>
        <ResultForm race={race} existing={result} onSaved={onSaved} key={version} />
      </div>
    );
  }

  return (
    <>
      <PerPhaseTable race={race} result={result} />
      {result.miles && result.miles.length > 0 && <PerMileTable race={race} result={result} />}
      {((result.bestEfforts && result.bestEfforts.length > 0) || result.sufferScore != null || result.kudosCount != null || result.description) && (
        <RaceMetaTile result={result} />
      )}
      {result.notes && (
        <div className="tile" style={{ marginTop: 10, padding: '20px 24px' }}>
          <div className="tile-h" style={{ marginBottom: 10 }}>
            <div className="tile-sub">Race notes</div>
            <button className="btn btn--ghost" onClick={() => setEditing(true)}>Edit</button>
          </div>
          <div style={{ fontSize: 14, color: 'var(--color-t1)', lineHeight: 1.6 }}>
            {result.notes}
          </div>
        </div>
      )}
      {!result.notes && (
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn--ghost" onClick={() => setEditing(true)}>+ Add race notes</button>
        </div>
      )}
    </>
  );
}

/* ── Per-phase plan vs actual ───────────────────────────────
   Aggregates the per-mile Strava splits into the planned phase
   buckets and shows planned-pace / actual-pace / delta side by
   side. Rows colored by phase. Skipped if no per-mile splits
   are available (i.e. activity wasn't synced from Strava). */
function PerPhaseTable({ race, result }: { race: SavedRace; result: ActualResult }) {
  const miles = result.miles;
  if (!miles || miles.length === 0) return null;

  // Build per-phase actuals by aggregating splits whose mile-marker
  // falls inside the phase's [start, end] range. Each split is the
  // mile ENDING at split.mile, so a split.mile=5 covers mi 4→5.
  const phaseActuals = race.plan.phases.map(p => {
    const inPhase = miles.filter(m => m.mile - 0.5 >= p.start_mi && m.mile - 0.5 <= p.end_mi);
    if (inPhase.length === 0) return null;
    const totalElapsed = inPhase.reduce((s, m) => s + m.elapsedS, 0);
    const totalMi = inPhase.length;  // each split ≈ 1 mile
    const paceS = Math.round(totalElapsed / totalMi);
    const avgHrSamples = inPhase.filter(m => m.avgHr != null).map(m => m.avgHr as number);
    const avgHr = avgHrSamples.length > 0 ? Math.round(avgHrSamples.reduce((s, v) => s + v, 0) / avgHrSamples.length) : null;
    return { paceS, paceDisplay: fmtTimeShort(paceS), avgHr, milesCounted: totalMi };
  });

  return (
    <div className="tile" style={{ marginTop: 10, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-l4)' }}>
        <div className="tile-sub">Plan vs actual</div>
        <div className="tile-lbl">Per-phase pacing</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--color-t3)', fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>
            <th style={{ textAlign: 'left', padding: '12px 18px', width: 32 }}></th>
            <th style={{ textAlign: 'left', padding: '12px 0' }}>Phase</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Target</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Actual</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Delta</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Avg HR</th>
          </tr>
        </thead>
        <tbody>
          {race.plan.phases.map((p, i) => {
            const a = phaseActuals[i];
            const delta = a ? a.paceS - p.target_pace_s_per_mi : null;
            return (
              <tr key={i} style={{ borderTop: '1px solid var(--color-l4)' }}>
                <td style={{ padding: '14px 18px' }}>
                  <span style={{ display: 'inline-block', width: 5, height: 22, background: PHASE_COLORS[i] ?? '#444', borderRadius: 2 }} />
                </td>
                <td style={{ padding: '14px 0' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: '-.005em', color: 'var(--color-t0)' }}>{p.label}</div>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--color-t3)', fontWeight: 700, marginTop: 2 }}>
                    MI {p.start_mi.toFixed(1)} – {p.end_mi.toFixed(1)}
                  </div>
                </td>
                <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--color-t1)' }}>
                  {p.target_pace_display}
                </td>
                <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--color-t0)' }}>
                  {a ? a.paceDisplay + '/mi' : '—'}
                </td>
                <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: delta == null ? 'var(--color-t3)' : (delta <= 0 ? 'var(--color-success)' : 'var(--color-warning)') }}>
                  {delta == null ? '—' : (delta === 0 ? '±0' : (delta > 0 ? '+' : '−') + fmtTimeShort(Math.abs(delta)))}
                </td>
                <td style={{ padding: '14px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t2)' }}>
                  {a?.avgHr ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Per-mile splits ────────────────────────────────────────
   Compact table showing target pace (from plan) vs actual pace
   (from Strava splits_standard) per mile. Color the delta column
   like the per-phase table. */
function PerMileTable({ race, result }: { race: SavedRace; result: ActualResult }) {
  const miles = result.miles!;
  // Build target-pace-per-mile from the plan's intervals.
  const targetByMile: Record<number, number> = {};
  for (const iv of race.plan.intervals) {
    if (iv.kind !== 'pace') continue;
    const start = Math.ceil(iv.at_mi);
    const end = Math.floor(iv.at_mi + iv.distance_mi);
    for (let m = start; m <= end; m++) targetByMile[m] = iv.target_pace_s_per_mi;
  }
  return (
    <div className="tile" style={{ marginTop: 10, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-l4)' }}>
        <div className="tile-sub">Splits</div>
        <div className="tile-lbl">Mile-by-mile · plan vs Strava</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: 'var(--color-t3)', fontFamily: 'var(--font-data)', fontSize: 9.5, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700 }}>
            <th style={{ textAlign: 'left', padding: '12px 18px', width: 90, whiteSpace: 'nowrap' }}>Mile</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Target</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Actual</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Delta</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>HR</th>
            <th style={{ textAlign: 'right', padding: '12px 18px' }}>Δ Elev</th>
          </tr>
        </thead>
        <tbody>
          {miles.map((m, i) => {
            const phase = race.plan.phases.findIndex(p => m.mile - 0.5 >= p.start_mi && m.mile - 0.5 <= p.end_mi);
            const targetS = targetByMile[m.mile] ?? null;
            const delta = targetS != null ? m.paceSPerMi - targetS : null;
            return (
              <tr key={i} style={{ borderTop: '1px solid var(--color-l4)' }}>
                <td style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-block', width: 4, height: 16, background: phase >= 0 ? (PHASE_COLORS[phase] ?? '#444') : 'transparent', borderRadius: 1, flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t1)', fontWeight: 700 }}>{m.mile}</span>
                  </span>
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t2)' }}>
                  {targetS != null ? fmtTimeShort(targetS) : '—'}
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t0)', fontWeight: 700 }}>
                  {m.paceDisplay}
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: delta == null ? 'var(--color-t3)' : (delta <= 0 ? 'var(--color-success)' : 'var(--color-warning)') }}>
                  {delta == null ? '—' : (delta === 0 ? '±0' : (delta > 0 ? '+' : '−') + fmtTimeShort(Math.abs(delta)))}
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t2)' }}>
                  {m.avgHr ? Math.round(m.avgHr) : '—'}
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: m.elevDeltaFt > 0 ? '#f9a87c' : m.elevDeltaFt < 0 ? '#7fd6a1' : 'var(--color-t3)' }}>
                  {m.elevDeltaFt > 0 ? '+' : ''}{m.elevDeltaFt}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Race meta tile (best efforts + suffer score + description) ── */
function RaceMetaTile({ result }: { result: ActualResult }) {
  return (
    <div className="tile" style={{ marginTop: 10, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="tile-h">
        <div>
          <div className="tile-sub">Race detail</div>
          <div className="tile-lbl">From Strava</div>
        </div>
        {result.stravaActivityId && (
          <a className="btn btn--ghost" target="_blank" rel="noopener noreferrer" href={`https://www.strava.com/activities/${result.stravaActivityId}`}>
            Open on Strava ↗
          </a>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
        {result.sufferScore != null && (
          <div>
            <div className="tile-sub">Suffer score</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--color-t0)', marginTop: 4 }}>{result.sufferScore}</div>
          </div>
        )}
        {result.kudosCount != null && (
          <div>
            <div className="tile-sub">Kudos</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--color-t0)', marginTop: 4 }}>{result.kudosCount}</div>
          </div>
        )}
        {result.achievementCount != null && result.achievementCount > 0 && (
          <div>
            <div className="tile-sub">Achievements</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: 'var(--color-attention)', marginTop: 4 }}>{result.achievementCount}</div>
          </div>
        )}
        {result.workoutType === 1 && (
          <div>
            <div className="tile-sub">Type</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--color-attention)', marginTop: 4 }}>RACE</div>
          </div>
        )}
      </div>
      {result.bestEfforts && result.bestEfforts.length > 0 && (
        <div>
          <div className="tile-sub" style={{ marginBottom: 10 }}>Best efforts during this race</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {result.bestEfforts.map((b, i) => (
              <div key={i} style={{
                display: 'inline-flex', alignItems: 'baseline', gap: 8,
                padding: '6px 12px',
                background: b.isPR ? 'rgba(243,173,59,.12)' : 'var(--color-l2)',
                border: `1px solid ${b.isPR ? 'rgba(243,173,59,.3)' : 'var(--color-l4)'}`,
                borderRadius: 6,
                fontSize: 12,
              }}>
                <span style={{ fontFamily: 'var(--font-data)', letterSpacing: '1.3px', textTransform: 'uppercase', color: b.isPR ? 'var(--color-attention)' : 'var(--color-t2)', fontWeight: 700, fontSize: 10 }}>{b.name}</span>
                <span style={{ fontFamily: 'var(--font-data)', fontVariantNumeric: 'tabular-nums', color: 'var(--color-t0)', fontWeight: 700 }}>{b.elapsedDisplay}</span>
                {b.isPR && <span className="chip chip--attention" style={{ fontSize: 8 }}>PR</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {result.description && (
        <div style={{ padding: 14, background: 'var(--color-l2)', borderRadius: 8, fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
          {result.description}
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
  const [isPR, setIsPR] = useState(existing?.isPR ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function parseFinish(s: string): number | null {
    const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }

  async function handleSave() {
    const finishS = parseFinish(hms);
    if (finishS === null || finishS < 60) {
      setError('Use h:mm:ss or m:ss format (e.g. 1:32:14 or 21:48).');
      return;
    }
    setError(null);
    setSaving(true);
    const distMi = race.meta.distanceMi;
    const paceSPerMi = Math.round(finishS / distMi);
    const result: ActualResult = {
      finishS,
      finishDisplay: fmtTimeShort(finishS),
      paceSPerMi,
      paceDisplay: fmtTimeShort(paceSPerMi),
      isPR,
      notes: notes.trim() || undefined,
      recordedAt: new Date().toISOString(),
      source: 'manual',
    };
    try { await setActualResult(race.slug, result); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  async function handleClear() {
    if (!existing) return;
    setSaving(true);
    try { await setActualResult(race.slug, null); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
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
        {existing && <button className="btn btn--ghost" onClick={handleClear} disabled={saving}>Clear result</button>}
        <button className="btn btn--primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save result'}</button>
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

/* ── Edit race modal ────────────────────────────────────────
   Lets the runner fix metadata that doesn't require a plan rebuild
   (race name, date, distance display) AND optionally rebuild the
   pacing plan against the saved GPX with new goal/strategy. The
   rebuild path is the only way to refresh stale plans (e.g., to
   pick up the new pace-floor clamp) without delete-and-recreate.

   Save vs Save & Rebuild:
   - Save: PATCH /api/races/[slug] with new meta. Plan stays.
   - Save & Rebuild: POST /api/races/[slug]/rebuild with the new
     meta. Server reuses the saved GPX, re-runs build-plan, persists
     fresh plan + meta. actualResult is preserved either way. */
const EDITABLE_DISTANCES = [
  { id: 'marathon', label: 'Marathon',     mi: 26.22 },
  { id: 'half',     label: 'Half marathon', mi: 13.10 },
  { id: '10k',      label: '10K',          mi: 6.21 },
  { id: '5k',       label: '5K',           mi: 3.10 },
  { id: 'custom',   label: 'Other',        mi: 0 },
] as const;
type EditDistanceId = typeof EDITABLE_DISTANCES[number]['id'];

function distanceIdFromMi(mi: number): EditDistanceId {
  for (const d of EDITABLE_DISTANCES) {
    if (d.mi > 0 && Math.abs(mi - d.mi) < 0.05) return d.id;
  }
  return 'custom';
}

function EditRaceModal({ race, onClose, onSaved }: { race: SavedRace; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(race.meta.name);
  const [date, setDate] = useState(race.meta.date);
  const [goal, setGoal] = useState(race.meta.goalDisplay);
  const [strategy, setStrategy] = useState<'even_effort' | 'even_split' | 'negative_split'>('even_effort');
  const [distanceId, setDistanceId] = useState<EditDistanceId>(distanceIdFromMi(race.meta.distanceMi));
  const [priority, setPriority] = useState<'A' | 'B' | 'C'>(race.meta.priority ?? 'A');
  const [busy, setBusy] = useState<null | 'save' | 'rebuild'>(null);
  const [error, setError] = useState<string | null>(null);

  function parseGoal(s: string): number | null {
    const m = s.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  }

  function effectiveDistance(): number {
    const d = EDITABLE_DISTANCES.find(x => x.id === distanceId);
    return d && d.id !== 'custom' && d.mi > 0 ? d.mi : race.meta.distanceMi;
  }

  async function save(rebuild: boolean) {
    setError(null);
    const goalS = parseGoal(goal);
    if (goalS == null) { setError('Goal time must be h:mm:ss (e.g. 1:30:00).'); return; }
    setBusy(rebuild ? 'rebuild' : 'save');
    try {
      if (rebuild) {
        const res = await fetch(`/api/races/${encodeURIComponent(race.slug)}/rebuild`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            raceName: name.trim(),
            raceDate: date,
            goalFinishS: goalS,
            strategy,
            distanceMi: effectiveDistance(),
          }),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await fetch(`/api/races/${encodeURIComponent(race.slug)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            meta: {
              name: name.trim(),
              date,
              distanceMi: effectiveDistance(),
              goalDisplay: goal,
              priority,
            },
          }),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="tile"
        style={{ width: '100%', maxWidth: 640, maxHeight: '88vh', overflow: 'auto', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--color-l1)' }}
      >
        <div className="tile-h">
          <div>
            <div className="tile-sub">Edit race</div>
            <div className="tile-lbl">{race.meta.name}</div>
          </div>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy != null}>Close</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <div>
            <label className="runcino-label">Race name</label>
            <input className="runcino-input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="runcino-label">Date</label>
            <input className="runcino-input font-data" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>

        {/* Race priority — drives how Coach treats this race in the
            cycle. A = primary target (full taper, full plan). B =
            secondary (light taper, treated as hard tempo). C = drop-in
            (no taper, slotted as a workout). Defaults to A. */}
        <div>
          <label className="runcino-label">Race priority</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {([
              { id: 'A', label: 'A · Primary', desc: 'Full taper · plan anchors here' },
              { id: 'B', label: 'B · Secondary', desc: 'Light 3-day taper · hard tempo' },
              { id: 'C', label: 'C · Drop-in', desc: 'No taper · slotted as a workout' },
            ] as const).map(p => {
              const active = priority === p.id;
              const accent = p.id === 'A' ? 'var(--color-attention)' : p.id === 'B' ? 'var(--color-corporate)' : 'var(--color-t2)';
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPriority(p.id)}
                  style={{
                    padding: '12px 14px',
                    textAlign: 'left',
                    border: `1px solid ${active ? accent : 'var(--color-l4)'}`,
                    background: active ? `color-mix(in srgb, ${accent} 8%, var(--color-l2))` : 'var(--color-l2)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    color: 'var(--color-t0)',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: '-.005em', color: active ? accent : 'var(--color-t0)' }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 4, lineHeight: 1.45 }}>{p.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="runcino-label">Distance</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
            {EDITABLE_DISTANCES.map(d => {
              const active = distanceId === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDistanceId(d.id)}
                  style={{
                    padding: '12px 8px',
                    textAlign: 'center',
                    border: `1px solid ${active ? 'var(--color-attention)' : 'var(--color-l4)'}`,
                    background: active ? 'rgba(243,173,59,.10)' : 'var(--color-l2)',
                    borderRadius: 10,
                    cursor: 'pointer',
                    color: 'var(--color-t0)',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '-.005em' }}>{d.label}</div>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--color-t3)', fontWeight: 700, letterSpacing: '1.2px', marginTop: 4 }}>
                    {d.mi > 0 ? `${d.mi.toFixed(d.id === '5k' || d.id === '10k' ? 1 : 2)} MI` : 'CUSTOM'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
          <div>
            <label className="runcino-label">Goal time</label>
            <input className="runcino-input font-data" placeholder="h:mm:ss" value={goal} onChange={e => setGoal(e.target.value)} style={{ fontSize: 18 }} />
          </div>
          <div>
            <label className="runcino-label">Pacing strategy <span style={{ color: 'var(--color-t3)', textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>(applies on rebuild)</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {([
                { id: 'even_effort',    name: 'Even effort' },
                { id: 'even_split',     name: 'Even split' },
                { id: 'negative_split', name: 'Negative' },
              ] as const).map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStrategy(s.id)}
                  style={{
                    padding: '10px',
                    border: `1px solid ${strategy === s.id ? 'var(--color-attention)' : 'var(--color-l4)'}`,
                    background: strategy === s.id ? 'rgba(243,173,59,.08)' : 'var(--color-l2)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: 'var(--color-t0)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >{s.name}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="hint" style={{ background: 'var(--color-l2)', padding: 12, borderRadius: 8, fontSize: 12.5, color: 'var(--color-t2)', lineHeight: 1.55 }}>
          <b style={{ color: 'var(--color-t1)' }}>Save</b> updates name / date / distance / goal time on the existing plan. <b style={{ color: 'var(--color-t1)' }}>Save & Rebuild</b> additionally re-runs the pacing pipeline with your new goal + strategy + the new pace-floor clamp (no segment more than 60s/mi faster than goal). Race results stay either way.
        </div>

        {error && (
          <div style={{ color: 'var(--color-warning)', fontSize: 12, padding: 10, background: 'rgba(252,77,84,.08)', border: '1px solid rgba(252,77,84,.3)', borderRadius: 8 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn btn--ghost" onClick={onClose} disabled={busy != null}>Cancel</button>
          <button className="btn" onClick={() => save(false)} disabled={busy != null}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn--primary" onClick={() => save(true)} disabled={busy != null}>
            {busy === 'rebuild' ? 'Rebuilding plan…' : '↻ Save & Rebuild plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
