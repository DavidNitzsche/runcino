/**
 * /races/[slug], race plan detail (v4 port).
 *
 * Server component. Reads the saved race from Postgres via lib/race-store,
 * then renders the canonical v4 layout from designs/race-plan-v4.html:
 *
 *   1. Breadcrumb back to /races
 *   2. Coach strip + Countdown card
 *   3. A-race hero (single column, big title + 3 anchor stats)
 *   4. Course Profile (SVG elevation chart + phase strip below)
 *   5. Phase-by-Phase Plan (one card per phase, pace + cumulative time)
 *   6. Fueling Plan (4 stat cells + timeline with gel markers)
 *   7. Race-Day Execution (T-7 brief empty state + linked workouts)
 *
 * Replaces the old client-side localStorage page (kept as
 * page.legacy.tsx.bak for reference).
 */

import { redirect, notFound } from 'next/navigation';
import { Topbar } from '@/app/components';
import { requireActiveUser } from '@/lib/auth';
import { getRaceDB } from '@/lib/race-store';
import { query } from '@/lib/db';
import { computeAggregateVdot } from '@/lib/compute-vdot';
import { vdotRow } from '@/lib/vdot';
import { resolveTrainingPaces } from '@/lib/training-paces-resolver';
import { todayISO, userTimezone } from '@/lib/synthetic-plan';
import { getActivePlanWeeks } from '@/lib/plan-weeks';
import { parseGpx } from '@/lib/gpx';
import type { FaffPlan } from '@/lib/types';
import { GoalEditIsland } from './GoalEditIsland';
import { RouteMapIsland } from './RouteMapIsland';
import { FuelEditIsland } from './FuelEditIsland';
import { EffortLevelEditIsland } from './EffortLevelEditIsland';
import './race-plan-v4.css';

export const dynamic = 'force-dynamic';

interface PageProps { params: Promise<{ slug: string }> }

function fmtFullDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function fmtShortMonthDay(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function fmtTime(sec: number): string {
  if (!sec || sec <= 0) return ', ';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}
function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + 'T00:00:00Z');
  const b = Date.parse(toISO + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** Map a phase's mean grade to a v4 color class. */
function phaseColor(gradePct: number): 'amber' | 'blue' | 'green' | 'orange' {
  if (gradePct >= 2)    return 'orange'; // hard climb
  if (gradePct >= 0.3)  return 'amber';  // gentle climb
  if (gradePct <= -1.5) return 'blue';   // descent · control
  return 'green';                        // flat / rolling
}
function gradeLabel(gradePct: number): string {
  if (Math.abs(gradePct) < 0.15) return 'flat 0.0%';
  if (gradePct >= 2)    return `+${gradePct.toFixed(1)}% hard climb`;
  if (gradePct >= 0.3)  return `+${gradePct.toFixed(1)}% climb`;
  if (gradePct <= -1.5) return `${gradePct.toFixed(1)}% descent`;
  return `${gradePct > 0 ? '+' : ''}${gradePct.toFixed(1)}% rolling`;
}

/** Initials-style short title for the hero: "Americas Finest City" → "AFC" */
function heroTitle(name: string, distanceMi: number): { line1: string; line2: string } {
  const words = name.split(/\s+/);
  const initials = words.length >= 3 ? words.map((w) => w[0]).join('').toUpperCase().slice(0, 4) : name.toUpperCase();
  const distLine = distanceMi >= 26.1 ? 'MARATHON'
    : distanceMi >= 13.0 ? 'HALF'
    : distanceMi >= 6.1  ? '10K'
    : distanceMi >= 3.0  ? '5K' : '';
  return { line1: initials, line2: distLine };
}

/** Build a smooth elevation profile from raw GPX trackpoints.
 *  Resamples to ~80 distance-evenly-spaced bins for a clean curve,
 *  then renders as straight segments between samples (dense enough
 *  that it reads as smooth). Falls back to phase-derived synthesis
 *  if the GPX can't be parsed. */
function buildElevationPath(
  phases: FaffPlan['phases'],
  gpxText: string | null,
): {
  pathD: string;
  areaD: string;
  ticks: number[];
  totalMi: number;
  yMaxFt: number;
  yMinFt: number;
  yLabels: Array<{ ft: number; y: number }>;
} {
  const VIEW_W = 1180;
  const VIEW_H = 280;
  const TOP_PAD = 20;
  const BOTTOM_PAD = 40;
  const plotH = VIEW_H - TOP_PAD - BOTTOM_PAD;
  const FT_PER_M = 3.28084;

  let samples: Array<{ mi: number; ft: number }> = [];
  let totalMi = phases.length > 0 ? phases[phases.length - 1].end_mi : 0;

  // Try to use raw GPX trackpoints first, smoother + truer
  if (gpxText && gpxText.length > 50) {
    try {
      const track = parseGpx(gpxText, { smoothWindow: 5 });
      const pts = track.points;
      if (pts.length > 2) {
        const totalM = track.totalDistanceM;
        totalMi = totalM / 1609.344;
        // Resample to 80 evenly-spaced distance bins
        const BINS = 80;
        const targetDistM = (idx: number) => (idx / BINS) * totalM;
        let ptIdx = 0;
        for (let i = 0; i <= BINS; i++) {
          const target = targetDistM(i);
          while (ptIdx < pts.length - 1 && pts[ptIdx + 1].distM < target) ptIdx++;
          const p = pts[ptIdx];
          const mi = p.distM / 1609.344;
          // Use DEM elevation if injected, else GPS elevation
          const eleM = p.demEleM ?? p.eleM;
          samples.push({ mi, ft: eleM * FT_PER_M });
        }
      }
    } catch {
      // fall through to phase-based synthesis
    }
  }

  // Fallback: synthesize from phase gain/loss (less smooth, but always works)
  if (samples.length === 0 && phases.length > 0) {
    let elev = 0;
    samples = [{ mi: 0, ft: 0 }];
    for (const p of phases) {
      const net = (p.elevation_gain_ft || 0) - (p.elevation_loss_ft || 0);
      elev += net;
      samples.push({ mi: p.end_mi, ft: elev });
    }
  }
  if (samples.length === 0) {
    return { pathD: '', areaD: '', ticks: [], totalMi: 0, yMaxFt: 0, yMinFt: 0, yLabels: [] };
  }

  const minFt = Math.min(...samples.map((s) => s.ft));
  const maxFt = Math.max(...samples.map((s) => s.ft));
  // Normalize so the chart's y-axis starts at zero relative to course minimum
  const relSamples = samples.map((s) => ({ mi: s.mi, ft: s.ft - minFt }));
  const relMax = Math.max(1, maxFt - minFt);

  function x(mi: number): number { return (mi / Math.max(0.01, totalMi)) * VIEW_W; }
  function y(ft: number): number {
    const norm = ft / relMax;                // 0..1 (relative to course)
    return TOP_PAD + (1 - norm) * plotH;
  }

  const pts = relSamples.map((s) => `${x(s.mi).toFixed(1)},${y(s.ft).toFixed(1)}`);
  const pathD = `M ${pts.join(' L ')}`;
  const areaD = `${pathD} L ${VIEW_W},${VIEW_H - BOTTOM_PAD} L 0,${VIEW_H - BOTTOM_PAD} Z`;

  // Mile ticks
  const ticks: number[] = [];
  for (let mi = 1; mi <= totalMi; mi++) ticks.push(mi);

  // Y-axis labels, pick rounded ft values across the range
  const yLabels: Array<{ ft: number; y: number }> = [];
  const niceStep = (range: number) => {
    if (range <= 50)   return 10;
    if (range <= 150)  return 25;
    if (range <= 300)  return 50;
    if (range <= 600)  return 100;
    if (range <= 1200) return 200;
    return 500;
  };
  const step = niceStep(relMax);
  for (let ft = 0; ft <= relMax + step / 2; ft += step) {
    yLabels.push({ ft: Math.round(ft + minFt), y: y(ft) });
  }

  return { pathD, areaD, ticks, totalMi, yMaxFt: maxFt, yMinFt: minFt, yLabels };
}

/** Downsample GPX trackpoints into a coords array for Leaflet. */
function buildRouteCoords(gpxText: string | null): Array<[number, number]> {
  if (!gpxText || gpxText.length < 50) return [];
  try {
    const track = parseGpx(gpxText, { smoothWindow: 1 });
    const pts = track.points;
    if (pts.length === 0) return [];
    const TARGET = 400;
    const step = Math.max(1, Math.floor(pts.length / TARGET));
    const coords: Array<[number, number]> = [];
    for (let i = 0; i < pts.length; i += step) {
      coords.push([pts[i].lat, pts[i].lon]);
    }
    // Always include the last point so the route closes correctly
    const last = pts[pts.length - 1];
    const tail = coords[coords.length - 1];
    if (!tail || tail[0] !== last.lat || tail[1] !== last.lon) {
      coords.push([last.lat, last.lon]);
    }
    return coords;
  } catch {
    return [];
  }
}

export default async function RacePlanPage({ params }: PageProps) {
  const auth = await requireActiveUser();
  const { slug } = await params;

  const race = await getRaceDB(slug, auth.id);
  if (!race) notFound();

  // Compute days-to-race
  const tz = userTimezone(auth.location);
  const today = todayISO(tz);
  const daysAway = Math.max(0, daysBetween(today, race.meta.date));

  // Priority defaults to 'A' when unset, matches /races page behavior
  // so the same race doesn't show as A-RACE on the calendar and
  // C-RACE on the detail page. Users explicitly set B/C; null means
  // "haven't decided" which is closer to A than C.
  const priority = race.meta.priority ?? 'A';
  const priorityLabel: string = (() => {
    switch (priority) {
      case 'A':              return 'A-RACE';
      case 'B':              return 'B-RACE';
      case 'C':              return 'C-RACE';
      case 'tune-up':        return 'TUNE-UP';
      case 'training-run':   return 'TRAINING RUN';
      case 'hilly-excluded': return 'HILLY · EXCLUDED FROM VDOT';
      default:               return 'A-RACE';
    }
  })();
  const briefGenIso = (() => {
    // 7 days before the race
    const d = new Date(race.meta.date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const briefGenDaysAway = Math.max(0, daysBetween(today, briefGenIso));

  // Hero title pieces
  const hero = heroTitle(race.meta.name, race.meta.distanceMi);

  // Elevation profile from raw GPX (with phase-derived fallback)
  const phases = race.plan?.phases ?? [];
  const profile = buildElevationPath(phases, race.gpxText ?? null);
  // Route polyline coords for the map
  const routeCoords = buildRouteCoords(race.gpxText ?? null);

  // Total elev gain / loss
  const totalGainFt = phases.reduce((s, p) => s + (p.elevation_gain_ft || 0), 0);
  const totalLossFt = phases.reduce((s, p) => s + (p.elevation_loss_ft || 0), 0);
  const netFt = Math.round(totalGainFt - totalLossFt);

  // Phase strip grid columns proportional to distance
  const phaseGridTemplate = phases
    .map((p) => `${(p.distance_mi || 0).toFixed(2)}fr`)
    .join(' ') || '1fr';

  // Fueling (if present in plan)
  const fueling = race.plan?.fueling;
  const goalFinishS = race.plan?.goal?.finish_time_s ?? 0;
  const fuelMarkers = (race.plan?.intervals ?? []).filter((it) => it.kind === 'fuel');

  // Find race-pointed workouts from the runner's REAL plan
  // (only show if the race falls within the plan's date range).
  // Race-pace band derived from THIS race's goal, single source of
  // truth for every workout that says "half-marathon goal pace".
  // (1:30:00 / 13.1 mi = 6:52/mi ± 10 sec tolerance.)
  const racePaceLow = Math.max(0, Math.round(goalFinishS / race.meta.distanceMi) - 10);
  const racePaceHigh = Math.round(goalFinishS / race.meta.distanceMi) + 10;
  const fmtPaceS = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const racePaceDisplay = goalFinishS > 0 && race.meta.distanceMi > 0
    ? `${fmtPaceS(racePaceLow)}–${fmtPaceS(racePaceHigh)}`
    : '-';

  const synthWeeks = await getActivePlanWeeks();
  const planFirstDate = synthWeeks[0]?.startDate ?? '';
  const planLastDate = synthWeeks[synthWeeks.length - 1]?.endDate ?? '';
  const linkedWorkouts: Array<{ weekNum: number; date: string; label: string; sub: string; pace: string; paceSub: string; tag: 'threshold' | 'long' | 'race-sim' }> = [];
  if (race.meta.date >= planFirstDate && race.meta.date <= planLastDate) {
    for (const w of synthWeeks) {
      for (const d of w.days) {
        if (d.type === 'quality' && (d.label.includes('HM') || d.label.includes('Tempo'))) {
          linkedWorkouts.push({
            weekNum: w.weekNum,
            date: fmtShortMonthDay(d.date),
            label: d.label,
            sub: 'Key threshold session, anchors race pace',
            pace: racePaceDisplay,
            paceSub: '/mi target',
            tag: 'threshold',
          });
        } else if (d.type === 'long' && (d.label.includes('HM Finish') || d.label.includes('Progression'))) {
          linkedWorkouts.push({
            weekNum: w.weekNum,
            date: fmtShortMonthDay(d.date),
            label: d.label,
            sub: 'Race-pace block on tired legs',
            pace: racePaceDisplay,
            paceSub: '/mi block',
            tag: 'long',
          });
        }
      }
    }
  }
  const linkedTop = linkedWorkouts.slice(0, 4);

  // ── Readiness math: where you are vs where the goal is ────────
  // Pulls current aggregate VDOT, looks up the predicted finish at
  // this race's distance, computes the VDOT delta + T-pace delta to
  // hit the goal. Surfaces in the countdown card so the user sees
  // both the days-to-race AND the fitness gap in one place.
  type ReadinessVdot = {
    currentVdot: number;
    currentVdotLabel: string;
    predictedFinishS: number;
    predictedFinishDisplay: string;
    goalFinishS: number;
    goalVdot: number | null;
    vdotGap: number | null;
    paceTGapS: number | null;
    onPace: boolean;
  } | null;
  let readiness: ReadinessVdot = null;
  if (goalFinishS > 0 && race.meta.distanceMi > 0) {
    try {
      const agg = await computeAggregateVdot(auth.id);
      if (agg && agg.value > 0) {
        const cv = agg.value;
        const row = vdotRow(cv);
        // Predicted finish at current VDOT for this race's distance.
        const distKey: 'mileS' | 'km5S' | 'km10S' | 'km15S' | 'halfS' | 'marathonS' | null = (() => {
          const m = race.meta.distanceMi;
          if (Math.abs(m - 13.109) < 0.55) return 'halfS';
          if (Math.abs(m - 26.219) < 1.05) return 'marathonS';
          if (Math.abs(m - 6.214) < 0.31) return 'km10S';
          if (Math.abs(m - 9.32) < 0.47) return 'km15S';
          if (Math.abs(m - 3.107) < 0.155) return 'km5S';
          return null;
        })();
        if (row && distKey) {
          const predicted = row[distKey] as number;
          // Find the VDOT that would produce the goal finish at this
          // distance. Walk the VDOT table.
          let goalVdot: number | null = null;
          // Pull table rows in order, bracket and interpolate.
          // We can use vdotRow at integer VDOTs from 30 to 85.
          for (let v = 30; v <= 85; v++) {
            const r = vdotRow(v);
            if (!r) continue;
            const t = r[distKey] as number;
            if (t <= goalFinishS) {
              if (v === 30) { goalVdot = 30; break; }
              const prev = vdotRow(v - 1);
              if (!prev) { goalVdot = v; break; }
              const tPrev = prev[distKey] as number;
              const span = tPrev - t;
              const frac = span === 0 ? 0 : (tPrev - goalFinishS) / span;
              goalVdot = Math.round(((v - 1) + frac) * 10) / 10;
              break;
            }
          }
          // T-pace gap (canonical Daniels per mile)
          let paceTGapS: number | null = null;
          if (goalVdot != null) {
            const currentT = resolveTrainingPaces(cv).tMileS;
            const goalT = resolveTrainingPaces(goalVdot).tMileS;
            paceTGapS = currentT - goalT; // positive = current is slower
          }
          readiness = {
            currentVdot: cv,
            currentVdotLabel: agg.windowLabel,
            predictedFinishS: predicted,
            predictedFinishDisplay: fmtTime(predicted),
            goalFinishS,
            goalVdot,
            vdotGap: goalVdot != null ? Math.round((goalVdot - cv) * 10) / 10 : null,
            paceTGapS,
            onPace: predicted <= goalFinishS,
          };
        }
      }
    } catch {
      // Fail-soft: don't block the page if readiness math errors.
    }
  }

  // ── Chip-time vs Strava divergence ─────────────────────────────
  // When the curated actualResult.finishS differs from the matched
  // Strava activity's canonicalFinishS / movingTimeS, surface a
  // banner so the user can see WHY the aggregate VDOT is using a
  // different finish time than what Strava shows. Option-B locked
  // races.actual_result as the source of truth; this banner makes
  // the divergence visible at the race-detail level.
  let divergence: { chipS: number; stravaS: number; deltaS: number; chipDisplay: string; stravaDisplay: string } | null = null;
  if (race.actualResult?.finishS && race.actualResult?.stravaActivityId && race.actualResult?.source === 'manual') {
    try {
      const rows = await query<{ canonical_finish_s: number | null; moving_time_s: number | null }>(
        `SELECT
            (data->>'canonicalFinishS')::NUMERIC AS canonical_finish_s,
            (data->>'movingTimeS')::NUMERIC AS moving_time_s
           FROM strava_activities
          WHERE id::BIGINT = $1
          LIMIT 1`,
        [race.actualResult.stravaActivityId],
      );
      const sa = rows[0];
      if (sa) {
        const stravaS = sa.canonical_finish_s != null ? Number(sa.canonical_finish_s) : Number(sa.moving_time_s ?? 0);
        const chipS = race.actualResult.finishS;
        const deltaS = chipS - stravaS;
        if (stravaS > 0 && Math.abs(deltaS) >= 2) {
          divergence = {
            chipS,
            stravaS,
            deltaS,
            chipDisplay: fmtTime(chipS),
            stravaDisplay: fmtTime(stravaS),
          };
        }
      }
    } catch {
      // Fail-soft: if the lookup errors, just skip the banner.
    }
  }

  return (
    <div className="race-plan-v4-page">
      <Topbar activeTab="races" showAdmin={auth.is_admin} />

      <div className="page">

        {/* Breadcrumb */}
        <div className="crumb">
          <a href="/races">Races</a>
          <span className="crumb-sep">/</span>
          <span>{race.meta.name}</span>
        </div>

        {/* ── CHIP-TIME DIVERGENCE BANNER ── */}
        {divergence && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(80, 40, 180, 0.06), rgba(80, 40, 180, 0.02))',
              border: '1px solid rgba(80, 40, 180, 0.25)',
              borderRadius: 12,
              padding: '14px 18px',
              marginBottom: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              style={{
                fontFamily: 'Oswald, sans-serif',
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: 1.5,
                color: '#5028b4',
                textTransform: 'uppercase',
              }}
            >
              ⏱ Chip time used · Strava elapsed differs
            </div>
            <div
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 13,
                lineHeight: 1.55,
                color: 'rgba(8,8,8,.85)',
              }}
            >
              Your <strong>chip time</strong> of <strong>{divergence.chipDisplay}</strong> is what
              the coach uses for VDOT computation (Option-B source-of-truth: curated chip
              time wins over Strava elapsed). The matched Strava activity shows{' '}
              <strong>{divergence.stravaDisplay}</strong>, {' '}
              <strong>
                {divergence.deltaS > 0 ? `${divergence.deltaS}s slower` : `${-divergence.deltaS}s faster`}
              </strong>
              {' '}than your watch recorded.
            </div>
            <div
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 11,
                lineHeight: 1.5,
                color: 'rgba(8,8,8,.55)',
              }}
            >
              The gap is usually start-corral walking before the chip mat (gun-to-mat lag) or
              GPS drift through tall buildings. Chip time is the official race result; we use
              it for fitness math, but your training analysis below still reads from the
              Strava activity&apos;s splits and HR data.
            </div>
          </div>
        )}

        {/* ── COACH STRIP + COUNTDOWN ── */}
        <div className="coach-strip">
          <div className="coach-left">
            <div className="coach-label">
              <span className="dot-orange"></span>
              COACH · RACE PLAN · {priorityLabel}
            </div>
            {/* Effort-level editor, controls how this race weights in
                aggregate VDOT. Shipped 2026-05-19 round 2 to fix the
                Sombrero=full-weight tune-up problem. */}
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <EffortLevelEditIsland slug={slug} currentPriority={priority as 'A' | 'B' | 'C' | 'tune-up' | 'training-run' | 'hilly-excluded'} />
            </div>
            <p className="coach-briefing">
              <strong>{fmtFullDate(race.meta.date)}.</strong>{' '}
              {race.plan?.goal?.claude_rationale
                ? race.plan.goal.claude_rationale
                : readiness && readiness.goalVdot != null && readiness.vdotGap != null
                  ? (() => {
                      const weeks = Math.max(1, Math.round(daysAway / 7));
                      const perWk = readiness.vdotGap / weeks;
                      const feas = readiness.vdotGap <= 0
                        ? `you're already there on current fitness, the work now is sharpening and staying healthy.`
                        : perWk <= 0.25
                          ? `that's a realistic lift at this timeline if you hit the key sessions.`
                          : perWk <= 0.45
                            ? `ambitious but doable, it needs consistent threshold work and no missed blocks.`
                            : `a real stretch, it would need everything to click; a slightly softer goal may serve you better.`;
                      return <>You&apos;re at VDOT <strong>{readiness.currentVdot.toFixed(1)}</strong>, which projects <strong>{readiness.predictedFinishDisplay}</strong> here. Your {race.meta.goalDisplay} goal needs VDOT <strong>{readiness.goalVdot.toFixed(1)}</strong>, a {readiness.vdotGap.toFixed(1)}-point lift over {weeks} weeks ({feas}) The plan&apos;s threshold + race-pace blocks are built to close that gap; hit them and the projection moves with you.</>;
                    })()
                  : <>The full 14-week plan points here. Log a recent race or a few quality runs and the coach will show your current fitness, the gap to {race.meta.goalDisplay}, and the path to close it.</>}
            </p>
          </div>

          <div className="countdown-card">
            <div className="countdown-label">Countdown</div>
            <div className="countdown-row">
              <span className="countdown-num">{daysAway}</span>
              <span className="countdown-unit">days<br />to go</span>
            </div>
            <div className="countdown-divider"></div>
            <div className="countdown-meta">
              <strong>{fmtFullDate(race.meta.date)}</strong><br />
              {race.meta.distanceMi >= 26.1 ? 'Marathon' : race.meta.distanceMi >= 13.0 ? 'Half Marathon' : `${race.meta.distanceMi.toFixed(2)} mi`} · {race.meta.distanceMi.toFixed(2)} mi
            </div>
            {/* Readiness math: surfaces the fitness gap to the goal
                so the user sees daysAway AND vdotGap together. */}
            {readiness && (
              <div
                style={{
                  borderTop: '1px solid rgba(8,8,8,.08)',
                  marginTop: 12,
                  paddingTop: 12,
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: 'rgba(8,8,8,.85)',
                }}
              >
                <div
                  style={{
                    fontFamily: 'Oswald, sans-serif',
                    fontWeight: 700,
                    fontSize: 9,
                    letterSpacing: 1.2,
                    color: 'rgba(8,8,8,.55)',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  Readiness
                </div>
                <div style={{ fontSize: 12 }}>
                  Projected at current VDOT <strong>{readiness.currentVdot.toFixed(1)}</strong>:
                  <span style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: 17, marginLeft: 6, letterSpacing: 0.5 }}>
                    {readiness.predictedFinishDisplay}
                  </span>
                </div>
                {readiness.goalVdot != null && readiness.vdotGap != null && (
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    Goal{' '}
                    <strong>{fmtTime(readiness.goalFinishS)}</strong>{' '}
                    requires VDOT{' '}
                    <strong>{readiness.goalVdot.toFixed(1)}</strong>
                  </div>
                )}
                {readiness.vdotGap != null && (
                  <div
                    style={{
                      fontSize: 11,
                      marginTop: 6,
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: readiness.onPace
                        ? 'rgba(62,189,65,.08)'
                        : 'rgba(232,128,33,.06)',
                      color: readiness.onPace ? '#3EBD41' : 'var(--accent, #E85D26)',
                    }}
                  >
                    {readiness.onPace ? (
                      <>✓ <strong>On pace</strong>, projected is faster than goal by{' '}
                      {fmtTime(readiness.goalFinishS - readiness.predictedFinishS)}.</>
                    ) : (
                      <>
                        Gap: <strong>{readiness.vdotGap.toFixed(1)} VDOT points</strong>
                        {readiness.paceTGapS != null && (
                          <>
                            {' '}/ <strong>~{Math.abs(readiness.paceTGapS)} sec/mi</strong> T pace
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── A-RACE HERO ── */}
        <div className="a-race-card">
          <div className="a-race-hero-split">
            <div className="a-race-hero-left">
              <div className="a-race-hero-text">
                <div className="a-race-eyebrow">
                  {priorityLabel} · GOAL TIME {race.meta.goalDisplay}
                </div>
                <div className="a-race-title">
                  {hero.line1}{hero.line2 && <><br />{hero.line2}</>}
                </div>
                <div className="a-race-sub">{race.meta.name} · {fmtShortMonthDay(race.meta.date)}</div>
              </div>

              <div className="path-stats path-stats-stacked">
                <GoalEditIsland
                  slug={race.slug}
                  goalDisplay={race.meta.goalDisplay}
                  goalFinishS={goalFinishS}
                  raceDistanceMi={race.meta.distanceMi}
                />
                <div className="path-stat">
                  <div className="path-stat-label">Predicted</div>
                  {readiness ? (
                    <>
                      <div className="path-stat-value orange">{readiness.predictedFinishDisplay}</div>
                      <div className="path-stat-sub">At current VDOT {readiness.currentVdot.toFixed(1)}</div>
                    </>
                  ) : (
                    <>
                      <div className="path-stat-value orange">, </div>
                      <div className="path-stat-sub">No data, set your VDOT</div>
                    </>
                  )}
                </div>
                <div className="path-stat">
                  <div className="path-stat-label">Strategy</div>
                  <div className="path-stat-value green">{(race.plan?.goal?.strategy ?? 'Even effort').replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</div>
                  <div className="path-stat-sub">±{race.plan?.tolerance?.pace_s_per_mi ?? 10} s/mi tolerance</div>
                </div>
              </div>
            </div>

            {routeCoords.length > 1 && (
              <div className="a-race-hero-map">
                <RouteMapIsland coords={routeCoords} height="100%" />
              </div>
            )}
          </div>
        </div>

        {/* ── COURSE PROFILE ── */}
        {phases.length > 0 && (
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-title">Course Profile</div>
                <div className="card-sub">
                  <strong>{race.meta.distanceMi.toFixed(2)} mi</strong>
                  {' · '}+{Math.round(totalGainFt)} ft gain / −{Math.round(totalLossFt)} ft loss
                  {' · '}net {netFt >= 0 ? '+' : ''}{netFt} ft
                </div>
              </div>
              <div className="card-meta">From the GPX · <strong>{phases.length} phases</strong></div>
            </div>

            <div className="profile-wrap">
              <div className="profile-svg-wrap">
                <svg className="profile-svg" viewBox="0 0 1180 280" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Phase boundary verticals */}
                  {phases.slice(0, -1).map((p, i) => {
                    const x = (p.end_mi / Math.max(0.01, profile.totalMi)) * 1180;
                    return <line key={`v-${i}`} x1={x} y1={20} x2={x} y2={240} stroke="rgba(8,8,8,.08)" strokeWidth="1" strokeDasharray="3 3" />;
                  })}
                  {/* Mile ticks */}
                  {profile.ticks.map((mi) => {
                    const x = (mi / Math.max(0.01, profile.totalMi)) * 1180;
                    return <line key={`tick-${mi}`} x1={x} y1={240} x2={x} y2={245} stroke="rgba(8,8,8,.06)" strokeWidth="1" />;
                  })}
                  {/* Y-axis elevation gridlines + labels */}
                  {profile.yLabels.map((label, i) => (
                    <g key={`yl-${i}`}>
                      <line x1={40} y1={label.y} x2={1180} y2={label.y} stroke="rgba(8,8,8,.05)" strokeWidth="1" />
                      <text x={6} y={label.y + 3} fontFamily="Inter, sans-serif" fontSize="10" fill="rgba(8,8,8,.40)" fontWeight="500">{label.ft} ft</text>
                    </g>
                  ))}
                  {/* Elevation area, filled per phase with that phase's
                      difficulty color, as a soft vertical gradient. Each
                      colored rect is clipped to the area-under-the-curve
                      shape; soft seams at the boundaries read as gentle
                      transitions between phases. */}
                  {profile.areaD && phases.length > 0 ? (
                    <>
                      <defs>
                        <clipPath id="elev-area-clip"><path d={profile.areaD} /></clipPath>
                        {(['amber', 'blue', 'green', 'orange'] as const).map((c) => {
                          const hex = c === 'amber' ? '#F3AD38' : c === 'blue' ? '#008FEC' : c === 'green' ? '#3EBD41' : '#E85D26';
                          return (
                            <linearGradient key={`grad-${c}`} id={`elev-grad-${c}`} x1="0" y1="20" x2="0" y2="240" gradientUnits="userSpaceOnUse">
                              <stop offset="0" stopColor={hex} stopOpacity="0.06" />
                              <stop offset="1" stopColor={hex} stopOpacity="0.34" />
                            </linearGradient>
                          );
                        })}
                      </defs>
                      <g clipPath="url(#elev-area-clip)">
                        {phases.map((p, i) => {
                          const x1 = (p.start_mi / Math.max(0.01, profile.totalMi)) * 1180;
                          const x2 = (p.end_mi / Math.max(0.01, profile.totalMi)) * 1180;
                          const color = phaseColor(p.mean_grade_pct);
                          return <rect key={`fill-${i}`} x={x1} y={20} width={Math.max(0, x2 - x1)} height={220} fill={`url(#elev-grad-${color})`} />;
                        })}
                        {/* Soft seams blend one phase color into the next */}
                        {phases.slice(0, -1).map((p, i) => {
                          const x = (p.end_mi / Math.max(0.01, profile.totalMi)) * 1180;
                          return <rect key={`seam-${i}`} x={x - 7} y={20} width={14} height={220} fill="#fff" opacity={0.10} />;
                        })}
                      </g>
                    </>
                  ) : (
                    profile.areaD && <path d={profile.areaD} fill="rgba(8,8,8,.05)" />
                  )}
                  {profile.pathD && <path d={profile.pathD} fill="none" stroke="#080808" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
                </svg>
              </div>

              {/* Phase strip below chart */}
              <div className="profile-phase-labels" style={{ gridTemplateColumns: phaseGridTemplate }}>
                {phases.map((p, i) => {
                  const color = phaseColor(p.mean_grade_pct);
                  return (
                    <div key={`pcell-${i}`} className={`profile-phase-cell ${color}`}>
                      <span className="pcell-name">{p.label}</span>
                      <span className="pcell-mi">{p.start_mi.toFixed(1)} → {p.end_mi.toFixed(1)} mi · {p.distance_mi.toFixed(1)} mi</span>
                      <span className="pcell-grade">{gradeLabel(p.mean_grade_pct).split(' ')[0]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── PHASE-BY-PHASE PLAN ── */}
        {phases.length > 0 && (
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-title">Phase-by-Phase Plan</div>
                <div className="card-sub">
                  <strong>{phases.length} sections</strong>
                  {' · pace tolerance ±'}{race.plan?.tolerance?.pace_s_per_mi ?? 10}
                  {' s/mi · cumulative time builds to '}{race.meta.goalDisplay}
                </div>
              </div>
              <div className="card-meta">Coach-computed from elevation + goal</div>
            </div>

            <div className="phase-list">
              {phases.map((p, i) => {
                const color = phaseColor(p.mean_grade_pct);
                const isLast = i === phases.length - 1;
                return (
                  <div key={`phase-${i}`} className={`phase-card ${color}`}>
                    <div className="phase-num">{i + 1}<small>/{phases.length}</small></div>
                    <div className="phase-body">
                      <div className="phase-name">{p.label}</div>
                      <div className="phase-range">
                        Mile {p.start_mi.toFixed(1)} → {p.end_mi.toFixed(1)} · {p.distance_mi.toFixed(1)} mi
                        <span className={`grade-pill ${color}`}>{gradeLabel(p.mean_grade_pct)}</span>
                      </div>
                      <div className="phase-elev">
                        <span className="up">↑ {Math.round(p.elevation_gain_ft)} ft</span>
                        {' · '}
                        <span className="down">↓ {Math.round(p.elevation_loss_ft)} ft</span>
                        {' · net '}
                        {(p.elevation_gain_ft - p.elevation_loss_ft) >= 0 ? '+' : ''}
                        {Math.round(p.elevation_gain_ft - p.elevation_loss_ft)} ft
                      </div>
                      {p.note && <p className="phase-note">{p.note}</p>}
                    </div>
                    <div className="phase-pace">
                      <div className="phase-pace-num">{p.target_pace_display}</div>
                      <div className="phase-pace-unit">target /mi</div>
                    </div>
                    <div className="phase-cum">
                      <div className="phase-cum-label">{isLast ? 'FINISH' : 'Cumulative'}</div>
                      <div className="phase-cum-time" style={isLast ? { color: '#E85D26' } : undefined}>
                        {p.cumulative_time_display}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── FUELING PLAN ── */}
        {fueling && (
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-title">Fueling Plan</div>
                <div className="card-sub">
                  {fueling.gel_brand && <><strong>{fueling.gel_brand}</strong> · </>}
                  anchored to phase boundaries, not the clock
                </div>
              </div>
              <div className="card-meta">Coach-tuned for {race.meta.goalDisplay} effort</div>
            </div>

            <FuelEditIsland
              slug={race.slug}
              gelBrand={fueling.gel_brand}
              gelCount={fueling.gel_count}
              gelCarbsG={fueling.gel_carbs_g}
              totalCarbsG={fueling.total_carbs_g}
              carbRateGPerHr={goalFinishS > 0 ? (fueling.total_carbs_g / (goalFinishS / 3600)) : fueling.carb_target_g_per_hr}
              carbTargetGPerHr={fueling.carb_target_g_per_hr}
              goalDisplay={race.meta.goalDisplay}
            />

            {fuelMarkers.length > 0 && (
              <div className="fuel-timeline">
                <div className="fuel-timeline-track">
                  <div className="fuel-timeline-line"></div>
                  {phases.map((p, i) => {
                    const left = (p.end_mi / Math.max(0.01, profile.totalMi)) * 100;
                    return <div key={`tt-${i}`} className="fuel-timeline-tick" style={{ left: `${left}%` }} />;
                  })}
                  {fuelMarkers.map((m, idx) => {
                    if (m.kind !== 'fuel') return null;
                    const left = (m.at_mi / Math.max(0.01, profile.totalMi)) * 100;
                    return (
                      <div key={`fuel-${idx}`} className="fuel-marker" style={{ left: `${left}%` }}>
                        <div className="fuel-marker-dot">{m.gel_number}</div>
                        <div className="fuel-marker-meta">
                          <strong>Mile {m.at_mi.toFixed(1)}</strong><br />
                          {fmtTime(m.duration_s)} · {fueling.gel_carbs_g} g
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {fueling.notes && (
              <p style={{ padding: '14px 40px 28px', fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.55, color: 'rgba(8,8,8,.55)', fontStyle: 'italic' }}>
                {fueling.notes}
              </p>
            )}
          </div>
        )}

        {/* ── RACE-DAY EXECUTION ── */}
        <div className="card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-title">Race-Day Execution</div>
              <div className="card-sub">Race-week brief · packing list · wake-up timing · pre-race fueling</div>
            </div>
            <div className="card-meta">Generates <strong>{fmtShortMonthDay(briefGenIso)}</strong> (T−7d)</div>
          </div>

          <div className="brief-empty">
            <div className="brief-empty-dot"></div>
            <div className="brief-empty-body">
              <div className="brief-empty-title">Ready {fmtShortMonthDay(briefGenIso)}</div>
              <div className="brief-empty-text">
                Your race-day brief, shakeout, kit, wake-up timing, fueling, and weather-adjusted pace targets, 
                lands 7 days out, once we have the real weather window and your taper-week readiness.
              </div>
              <div className="brief-empty-when">
                {fmtFullDate(briefGenIso)} · {briefGenDaysAway} days away
              </div>
            </div>
          </div>

          {linkedTop.length > 0 && (
            <>
              <div className="card-header" style={{ paddingTop: 0 }}>
                <div className="card-title-group">
                  <div className="card-title" style={{ fontSize: 16 }}>Workouts pointed at this race</div>
                  <div className="card-sub">Key sessions in the 14-week plan that dial in your goal pace</div>
                </div>
              </div>
              <div className="linked-workouts">
                {linkedTop.map((w, i) => (
                  <div key={`lw-${i}`} className="linked-row">
                    <div className="linked-week">Week {w.weekNum}</div>
                    <div className="linked-date">{w.date}</div>
                    <div>
                      <div className="linked-name">{w.label}</div>
                      <div className="linked-name-sub">{w.sub}</div>
                    </div>
                    <div>
                      <div className="linked-pace">{w.pace}</div>
                      <div className="linked-pace-sub">{w.paceSub}</div>
                    </div>
                    <div className={`linked-tag ${w.tag}`}>
                      {w.tag === 'threshold' ? 'Threshold' : w.tag === 'long' ? 'Long' : 'Race Sim'}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Silence unused-import warning if redirect isn't used in some branches
void redirect;
