'use client';

/**
 * /races/[slug] — race detail view.
 *
 * Reads the saved race from localStorage by slug, then renders the full
 * pacing experience: hero, course map, elevation profile, five-phase
 * strategy cards, mile splits, fueling, and a one-click export of the
 * .runcino.json (the file the iOS app imports).
 *
 * Single source of truth: every numeric value displayed on this page
 * derives from `analyzeGpx(race.gpxText)` (the StravaGPX-calibrated
 * threshold analyzer). The saved plan supplies phase ranges + per-phase
 * target paces — those are themselves derived from analyzeGpx at plan-
 * build time, so they remain consistent. Course-facts overrides apply
 * to phase labels only (e.g. "Hurricane Point climb"); numeric facts
 * like peak elevation / total gain are not consulted.
 */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Caption, Nav } from '../../../components/nav';
import { deleteRace, getRace, setActualResult, type ActualResult, type SavedRace } from '../../../lib/storage';
import { autoSyncStrava } from '../../../lib/strava-auto';
import { analyzeGpx, autoNamePhases, type CourseAnalysis } from '../../../lib/gpx-analysis';
import {
  RouteMap, ElevationProfile,
  SplitsTables, ChartsRow, SpacingAndDistance, Insights,
} from '../../../components/CoursePreview';

const FT_PER_M = 3.28084;

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
  // Single source of truth: every numeric on this page derives from
  // this analysis. parseGpxClient + DEM-elevation fallbacks are gone.
  const analysis = useMemo<CourseAnalysis | null>(() => {
    try { return analyzeGpx(race.gpxText); } catch { return null; }
  }, [race.gpxText]);
  const days = daysUntil(race.meta.date);
  // Distance still leans on the saved plan for canonical race distance
  // (e.g. user picked "Half marathon" in the form). Falls back to the
  // analyzer when missing.
  const totalMi = race.plan.race.distance_mi
    ?? (analysis ? analysis.stats.totalDistM / 1609.344 : 0);
  const [editing, setEditing] = useState(false);
  const peakFt = analysis ? analysis.stats.maxEleM * FT_PER_M : 0;
  const peakMi = analysis ? analysis.cumDistM[analysis.stats.maxEleIdx] / 1609.344 : 0;
  const peakIdx = analysis?.stats.maxEleIdx ?? null;

  // Auto-generate descriptive phase names from the GPX shape — this
  // replaces the curated labels in course-facts.ts so EVERY race
  // (registered or not) gets the same scheme. AFC's "Point Loma Climb /
  // The Drop / Mission Bay" etc. were nice but inconsistent across the
  // app — Malibu and other unregistered courses landed on auto-detected
  // "ROLLING ROLLING ROLLING". Auto-naming gives every course a
  // descriptive, terrain-derived label set with zero curation.
  const enrichedRace = useMemo(() => {
    if (!analysis) return race;
    const names = autoNamePhases(analysis, race.plan.phases);
    if (names.length !== race.plan.phases.length) return race;
    const enrichedPhases = race.plan.phases.map((p, i) => ({ ...p, label: names[i] ?? p.label }));
    return {
      ...race,
      plan: { ...race.plan, phases: enrichedPhases },
    };
  }, [race, analysis]);

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

          {analysis ? (
            <PosterCard
              race={enrichedRace}
              analysis={analysis}
              days={days}
              totalMi={totalMi}
              peakFt={peakFt}
              peakMi={peakMi}
              peakIdx={peakIdx}
              onUpdated={onUpdated}
            />
          ) : (
            <div className="poster-c" style={{ padding: 32, color: 'rgba(255,255,255,.5)' }}>
              GPX could not be analyzed.
            </div>
          )}

          {/* Order, top to bottom on a pre-race page:
                hero (PosterCard) → phase strategy → race-day weather +
                race-morning brief → per-mile splits + fueling →
                course detail (deep stats) → export.
              The deep "Course detail" stats are valuable but the most
              actionable context (phases, weather, splits, fueling) is
              what runners reach for first. Course detail sits at the
              bottom for reference. ResultSection only renders post-
              race; it slots in between PhaseCards and the planning
              tiles so debrief mode shows results right under the plan. */}

          <PhaseCards race={enrichedRace} phases={enrichedRace.plan.phases} />

          <ResultSection race={enrichedRace} />

          {/* Pre-race planning tiles. Hidden once the race is past +
              has a recorded result — at that point the per-mile +
              per-phase plan-vs-Strava tables in ResultSection make
              these redundant or nonsensical (race-morning brief, etc). */}
          {!isPastWithResult(race) && (
            <>
              {/* Brief used to live to the right of weather; it's now
                  folded into the PosterCard description block above
                  (CoachBriefBlock) so the runner sees it on every
                  visit without a Generate gate. Weather stays as its
                  own tile, full-width below the hero. */}
              <div style={{ marginTop: 10 }}>
                <WeatherTile
                  start={analysis ? [analysis.trkpts[0][0], analysis.trkpts[0][1]] : null}
                  raceDate={race.meta.date}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 10, marginTop: 10 }}>
                <MileSplits race={enrichedRace} />
                <FuelingTile race={enrichedRace} />
              </div>
            </>
          )}

          {analysis && (
            <section style={{ marginTop: 18 }}>
              <div style={{
                fontSize: 11, color: 'var(--color-t3)',
                fontFamily: 'var(--font-data)', letterSpacing: '1.6px',
                fontWeight: 700, textTransform: 'uppercase', marginBottom: 12,
              }}>Course detail</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <SplitsTables analysis={analysis} />
                <ChartsRow analysis={analysis} />
                <SpacingAndDistance analysis={analysis} />
                <Insights analysis={analysis} />
              </div>
            </section>
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

/* ── Poster card ────────────────────────────────────────────
   The hero of the race-detail page. Single .poster-c container
   holding header (round + countdown), big race title, subtitle,
   2-col map+narrative grid, and full-width elevation strip with
   axis. Direct port of designs/race-detail-sombrero.html. */
function PosterCard({ race, analysis, days, totalMi, peakFt, peakMi, peakIdx, onUpdated }: {
  race: SavedRace;
  analysis: CourseAnalysis;
  days: number;
  totalMi: number;
  peakFt: number;
  peakMi: number;
  peakIdx: number | null;
  onUpdated?: () => void;
}) {
  // Hover sync — driven by the elevation profile, displayed by the map.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
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

  // All elevation numbers come from the analysis. Course facts are NOT
  // consulted for numeric data — only for phase labels (handled in
  // RaceDetailView via enrichPhaseLabels). This keeps the page a pure
  // function of the GPX + plan, per the single-source-of-truth rule.
  const totalGain = analysis.stats.gainFt;
  const totalLoss = analysis.stats.lossFt;
  const netElevFt = totalGain - totalLoss;
  // race.plan.phases already enriched by RaceDetailView
  const enrichedPhases = race.plan.phases;
  // Memoized PhaseRange[] for RouteMap + ElevationProfile. Without this
  // the array reference flips on every render, forcing the Leaflet map
  // to tear down and rebuild — visually it just blinks, but the cost
  // is real.
  const phaseRanges = useMemo(
    () => enrichedPhases.map(p => ({ start_mi: p.start_mi, end_mi: p.end_mi, label: p.label })),
    [enrichedPhases],
  );
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
        {/* Course map (left column). Same physical slot as the legacy
            SVG poster — but rendered with the exact RouteMap config
            from the original CoursePreview: Carto Dark tiles, S/F/T
            pins, dashed bbox, grade-tinted polyline, grade legend
            below, recenter button. */}
        <div className="pc-track">
          <RouteMap
            analysis={analysis}
            hoverIdx={hoverIdx}
            tinting="grade"
            tiles
            height={500}
            recenter
            showBbox={false}
            showLegend
          />
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
                  <span className="l">Elev gain</span>
                  <span className="v">+{Math.round(totalGain)}<small>ft</small></span>
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
              {/* Adaptive coach brief — auto-loads, adapts language by
                  daysUntil(raceDate). Folded into the poster
                  description block per design: same place every visit,
                  always relevant, never a "click to generate" gate. */}
              {!isDebrief && <CoachBriefBlock race={race} />}
            </>
          )}

          {/* Phase legend. Labels come from autoNamePhases() so every
              row gets a descriptive name derived from the GPX shape
              (Opening climb / The drop / Cruise / Final push / …). */}
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

      {/* Elevation strip — full width below the grid, inside the same
          poster card. Same physical slot as the legacy SVG; rendered
          with Chart.js now, phase-tinted, peak marker, axis, and phase
          strip below — all driven by the analyzer + plan phases. */}
      <div className="pc-elev">
        <div className="head">
          <span className="l">Elevation Profile</span>
          <span className="r">Peak <em>{Math.round(peakFt)} ft · MI {peakMi.toFixed(1)}</em></span>
        </div>
        <div style={{ height: 220, position: 'relative' }}>
          <ElevationProfile
            analysis={analysis}
            onHoverIdx={setHoverIdx}
            tinting="phase"
            phases={phaseRanges}
            phaseColors={PHASE_COLORS}
            peakIdx={peakIdx ?? undefined}
            showAxis={false}
            chartAxisVisible={false}
            showPhaseStrip={false}
            height={220}
            bare
          />
        </div>
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
   Auto-fetches on mount. Picks source based on days-to-race:

     T ≤ 7 days  → live NOAA forecast (CONUS-only)
     T > 7 days  → Open-Meteo historical for the same date last year

   Falls back to historical when NOAA fails (out of CONUS, no
   forecast yet, or service outage) so the tile always shows
   something actionable. The header label adapts to the source. */
type WeatherSummary = {
  start_period: WeatherPeriod;
  second_period: WeatherPeriod | null;
  narrative: string;
  source?: 'forecast' | 'historical';
  date?: string | null;
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

/** Same calendar date one year before `iso`. */
function sameDateLastYear(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const prev = new Date(Date.UTC(y - 1, m - 1, d));
  return prev.toISOString().slice(0, 10);
}

function WeatherTile({ start, raceDate }: { start: [number, number] | null; raceDate: string }) {
  const [data, setData] = useState<WeatherSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const lat = start?.[0];
  const lon = start?.[1];

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setErr('No GPX coordinates'); setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const days = daysUntil(raceDate);
      const useForecast = days >= 0 && days <= 7;
      // Try preferred source first, fall through to historical on
      // failure so out-of-CONUS races and far-future races still get
      // something useful on screen.
      const tryFetch = async (qs: string) => {
        const res = await fetch(`/api/weather?${qs}`);
        if (!res.ok) throw new Error(await res.text());
        return await res.json() as WeatherSummary;
      };
      try {
        if (useForecast) {
          try {
            const forecast = await tryFetch(`lat=${lat}&lon=${lon}`);
            if (!cancelled) setData(forecast);
            return;
          } catch {
            // NOAA failed — fall through to historical.
          }
        }
        const histDate = sameDateLastYear(raceDate);
        const hist = await tryFetch(`lat=${lat}&lon=${lon}&date=${histDate}`);
        if (!cancelled) setData(hist);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lat, lon, raceDate]);

  const isHistorical = data?.source === 'historical';
  const headerLabel = !data ? 'Loading…'
    : `${Math.round(data.start_period.temperature_f)}°F · ${data.start_period.short_forecast}`;
  const sourceChip = !data ? null
    : isHistorical ? 'LAST YEAR'
    : 'NOAA FORECAST';

  return (
    <div className="tile">
      <div className="tile-h">
        <div>
          <div className="tile-sub">Race-day weather</div>
          <div className="tile-lbl">{headerLabel}</div>
        </div>
        {sourceChip && (
          <span className="chip" style={{
            fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
            padding: '3px 7px', borderRadius: 3,
            background: isHistorical ? 'rgba(150,150,150,.18)' : 'rgba(38,127,255,.18)',
            color: isHistorical ? 'var(--color-t2)' : 'var(--color-corporate)',
          }}>{sourceChip}</span>
        )}
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
              {isHistorical && data.date && (
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)', display: 'block', marginBottom: 4 }}>
                  {data.date} · same date last year
                </span>
              )}
              {data.narrative}
            </div>
          )}
        </>
      )}
      {!data && loading && (
        <div className="hint" style={{ padding: 14 }}>Pulling weather…</div>
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

/* ── Race-morning brief tile (Coach-driven) ─────────────────
   Stage 2: routes through coach.briefRaceMorning() via /api/brief.
   The Coach's voice is governed by web/coach/voice.md and grounded
   in coaching-research.md. The "why?" affordance reveals citations
   without putting them in the body of the brief.
   Falls back to a deterministic stub when ANTHROPIC_API_KEY is unset. */
type Citation = { doc: string; section: string; snippet?: string };
type BriefResponse = {
  narrative: string;
  plan_adjustments: Array<{ phase_idx: number; pace_delta_s_per_mi: number; reason: string }>;
  stub?: boolean;
  coach?: {
    rationale: string;
    citations: Citation[];
    brain: 'deterministic' | 'llm';
    llmAvailable: boolean;
  };
};

/* ── Adaptive brief hook ─────────────────────────────────────
   Single source of truth for the Coach's race brief. Pulls weather
   (NOAA forecast within 7 days, Open-Meteo last-year actuals
   otherwise), feeds it into /api/brief, returns the result. Both
   the in-poster CoachBriefBlock and any debug surface share this
   hook so a single page render fires exactly one /api/brief call. */
function useAdaptiveBrief(race: SavedRace): {
  brief: BriefResponse | null;
  weather: WeatherSummary | null;
  loading: boolean;
  err: string | null;
  days: number;
} {
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const days = daysUntil(race.meta.date);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let weatherText = 'no specific forecast — assume seasonal norms';
      let weatherSummary: WeatherSummary | null = null;
      try {
        const a = analyzeGpx(race.gpxText);
        const lat0 = a.trkpts[0][0];
        const lon0 = a.trkpts[0][1];
        const useForecast = days >= 0 && days <= 7;
        const url = useForecast
          ? `/api/weather?lat=${lat0}&lon=${lon0}`
          : `/api/weather?lat=${lat0}&lon=${lon0}&date=${sameDateLastYear(race.meta.date)}`;
        const res = await fetch(url);
        if (res.ok) {
          weatherSummary = await res.json() as WeatherSummary;
          weatherText = weatherSummaryToText(weatherSummary);
        }
      } catch {
        // GPX un-parseable or weather fetch failed — leave default.
      }
      if (!cancelled) setWeather(weatherSummary);

      try {
        const res = await fetch('/api/brief', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            courseSlug: race.meta.courseSlug,
            raceName: race.meta.name,
            raceDate: race.meta.date,
            goalDisplay: race.meta.goalDisplay,
            weatherText,
            daysToRace: days,                  // drives the brief's horizon
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
        if (!cancelled) setBrief(await res.json());
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // race.slug is the page-level identity key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race.slug]);

  return { brief, weather, loading, err, days };
}

/** Build a forecast string from a WeatherSummary the same way the
 *  user would have pasted one. Goes into the brief prompt so the
 *  Coach has real numbers to work with even when we're 30 days out. */
function weatherSummaryToText(w: WeatherSummary | null): string {
  if (!w) return 'no specific forecast — assume seasonal norms';
  const a = w.start_period;
  const b = w.second_period;
  const wind = a.wind_speed_mph_max != null && a.wind_speed_mph_max > 0
    ? `${a.wind_direction} wind ${a.wind_speed_mph_max} mph`
    : 'calm';
  const finish = b ? `, ${Math.round(b.temperature_f)}°F finish` : '';
  const note = w.source === 'historical'
    ? ' (last year actuals — forecast not yet available)'
    : '';
  return `${Math.round(a.temperature_f)}°F start${finish}, ${wind}, ${a.short_forecast.toLowerCase()}${note}`;
}

/** Pick a contextual title based on time-to-race. The brief content
 *  itself stays in the same Coach voice — only the framing label
 *  changes so a 30-days-out reading doesn't say "Race-morning brief". */
function briefTitleFor(daysToRace: number): { sub: string; lbl: string } {
  if (daysToRace <= 0) return { sub: 'Race-morning brief',  lbl: 'Coach says:' };
  if (daysToRace <= 7)  return { sub: 'Race-week brief',     lbl: 'Coach says:' };
  if (daysToRace <= 21) return { sub: 'Approach brief',      lbl: 'Coach says:' };
  return { sub: 'Course brief', lbl: 'Coach says:' };
}

/* ── In-poster Coach brief block ─────────────────────────────
   Renders the adaptive Coach brief inside the PosterCard's
   description column, beneath the static course narrative. Styled
   to match the poster theme (dark background, white-mode typography)
   rather than the standard app tile look. The runner gets the brief
   automatically — no buttons, no textarea — and it adapts as race
   approaches via daysUntil-driven titles. */
function CoachBriefBlock({ race }: { race: SavedRace }) {
  const { brief, weather, loading, err, days } = useAdaptiveBrief(race);
  const titleParts = briefTitleFor(days);
  const showLastYrChip = weather?.source === 'historical' && !brief?.stub;

  return (
    <div style={{
      marginTop: 18,
      paddingTop: 16,
      borderTop: '1px solid rgba(255,255,255,.1)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700,
          letterSpacing: '1.6px', textTransform: 'uppercase',
          color: 'var(--race)',
        }}>{titleParts.sub}</span>
        {brief?.stub && (
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
            padding: '2px 7px', borderRadius: 3,
            background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.55)',
          }}>FALLBACK · NO API KEY</span>
        )}
        {showLastYrChip && (
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
            padding: '2px 7px', borderRadius: 3,
            background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.55)',
          }}>USING LAST YR WEATHER</span>
        )}
      </div>
      {loading && (
        <p className="pc-para" style={{ color: 'rgba(255,255,255,.45)', fontStyle: 'italic' }}>
          Coach is reading the course…
        </p>
      )}
      {brief && !loading && (
        <p className="pc-para" style={{
          color: 'rgba(255,255,255,.85)', whiteSpace: 'pre-wrap',
          borderLeft: '2px solid var(--race)', paddingLeft: 14,
        }}>
          {brief.narrative}
        </p>
      )}
      {err && !loading && (
        <p className="pc-para" style={{ color: 'rgba(252,77,84,.85)' }}>
          Coach unavailable: {err}
        </p>
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
