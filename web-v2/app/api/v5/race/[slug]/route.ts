/**
 * GET /api/v5/race/[slug] · the v5 Race detail screen (handoff 8a).
 *
 * A pushed screen: AppBar + plain list, no gradient panel — the shell
 * exception the v5 README names — so `V5RaceDetail` carries no `panel`
 * field at all.
 *
 * Closes two backend gaps named in `docs/design/iphone-v5/BUILD-PLAN.md`:
 *   B11 · no taper-progress figure. Derived from the active plan's own
 *        `plan_phases` TAPER row + `plan_weeks` boundaries — 0…1 from the
 *        taper's first week through race day. Null when the block has no
 *        TAPER phase authored yet (the client draws nothing, not a zero).
 *   B14 · no gear plan. Composed from what genuinely exists — the shoe
 *        rotation's own racing recommendation (`lib/shoe/recommend.ts`,
 *        already the single recommender every other surface uses) plus the
 *        race-morning forecast when the course has GPS and the date is
 *        inside the forecast horizon. Empty array when neither resolves —
 *        never an invented kit list.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { loadRacesState } from '@/lib/coach/races-state';
import { parseRaceTime, formatRaceTime, predictRaceTime } from '@/lib/training/vdot';
import { loadLatestVdotWithAnchor } from '@/lib/training/projection-snapshots';
import { buildRacePacing, type CourseGeometryInput } from '@/lib/race/pacing';
import { resolveCourseElevation, type ResolveCourseElevationInput, type StoredGeometry } from '@/lib/race/course-elevation';
import { loadActivePlan } from '@/lib/plan/lookup';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { computeShoeMileage } from '@/lib/shoe/mileage';
import { coerceShoeType, resolveShoeCapMi } from '@/lib/shoe/lifespan';
import { recommendShoe, shoeDisplayName, type GarageShoe } from '@/lib/shoe/recommend';
import { computeRaceConditions } from '@/lib/training/race-conditions';

export const dynamic = 'force-dynamic';

interface V5NumberOut { text: string | null; modelled: boolean; }
interface V5RowOut { id: string; label: string; sub: string | null; value: V5NumberOut | null; action: string | null; }
const num = (text: string | null, modelled: boolean): V5NumberOut => ({ text, modelled });


/**
 * "Sunday 13 December 2026". The schedule list already learned this lesson
 * (see raceDateWords in app/api/v5/races/route.ts); the detail screen was
 * still printing the raw column.
 */
function raceDateWords(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return String(iso);
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
               'August', 'September', 'October', 'November', 'December'];
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;

  try {
    const racesState = await loadRacesState(userId);
    const race = [...racesState.aRaces, ...racesState.upcomingBs, ...racesState.upcomingCs, ...racesState.past]
      .find(r => r.slug === slug);
    if (!race) {
      // A reason, not a bare status. The phone treats a 4xx as a legible
      // decline only when the body carries one; without it this 404 wears the
      // outage treatment and tells the runner we went blind.
      return NextResponse.json(
        { error: 'race_not_found', reason: 'That race is not on your schedule any more.' },
        { status: 404 },
      );
    }

    const todayISO = await runnerToday(userId);
    const distanceMi = race.distance_mi ?? 0;
    const goalSec = parseRaceTime(race.goal);

    // ── geometry + course-aware pace plan ──────────────────────────────────
    const [geoRow, libRow] = await Promise.all([
      pool.query<{ course_geometry: StoredGeometry | null; course_source: string | null }>(
        `SELECT course_geometry, course_source FROM races WHERE slug = $1 AND user_uuid = $2`,
        [slug, userId],
      ).then(r => r.rows[0] ?? null).catch(() => null),
      pool.query<{ elevation_gain_ft: number | string | null; net_elevation_ft: number | string | null; geometry_json: unknown }>(
        `SELECT elevation_gain_ft, net_elevation_ft, geometry_json FROM course_library WHERE slug = $1`,
        [slug],
      ).then(r => r.rows[0] ?? null).catch(() => null),
    ]);
    const courseGeometry = geoRow?.course_geometry ?? null;

    const FT_PER_M = 3.28084;
    /** Downsample raw trackpoint elevations to a chart-sized series. Real
     *  measured points only — never interpolated beyond an even stride
     *  pick, and never fabricated when the geometry carries none. */
    function elevationSeriesFt(geom: StoredGeometry | null, maxPoints = 60): number[] {
      const g = geom as { trackPoints?: Array<{ ele?: number | null }> } | null;
      const eles = (g?.trackPoints ?? []).map(p => p?.ele).filter((e): e is number => typeof e === 'number');
      if (eles.length === 0) return [];
      if (eles.length <= maxPoints) return eles.map(e => Math.round(e * FT_PER_M));
      const stride = eles.length / maxPoints;
      const out: number[] = [];
      for (let i = 0; i < maxPoints; i++) out.push(Math.round(eles[Math.floor(i * stride)] * FT_PER_M));
      return out;
    }

    let elevation: number[] = [];
    let elevationFootnotes: string[] = [];
    let resolvedProvenance: string = 'unknown';
    try {
      elevation = elevationSeriesFt(courseGeometry);
      const resolveInput: ResolveCourseElevationInput = {
        lib: libRow ? { elevation_gain_ft: libRow.elevation_gain_ft, net_elevation_ft: libRow.net_elevation_ft } : null,
        geometry: courseGeometry, nominalDistanceMi: distanceMi || null,
      };
      const resolved = resolveCourseElevation(resolveInput);
      resolvedProvenance = resolved.provenance;
      if (resolved.elevationGainFt != null) {
        elevationFootnotes.push(`${Math.round(resolved.elevationGainFt)} ft gain`);
      }
      if (resolved.netElevationFt != null) {
        const net = Math.round(resolved.netElevationFt);
        elevationFootnotes.push(net === 0 ? 'Net flat' : net > 0 ? `Net +${net} ft` : `Net ${net} ft`);
      }
      if (resolved.conflict) {
        elevationFootnotes.push('Measured elevation differs from the listed course profile.');
      }
      if (elevationFootnotes.length === 0) elevationFootnotes = ['No elevation data yet.'];
      if (resolvedProvenance === 'measured') elevationFootnotes.push('Measured from GPS.');
    } catch { /* elevation is additive — never fail the detail over it */ }

    let pacePlan: V5RowOut[] = [];
    if (goalSec && distanceMi > 0) {
      try {
        const geometryForPacing = (libRow?.geometry_json ?? courseGeometry) as CourseGeometryInput | null;
        const pacing = buildRacePacing({ goalSec, distanceMi, geometry: geometryForPacing });
        pacePlan = (pacing.phases ?? []).map((p, i) => ({
          id: `phase-${i}`,
          label: `Miles ${Math.round(p.start_mi)}-${Math.round(p.end_mi)}`,
          sub: [p.label, p.cue].filter(Boolean).join(' · ') || null,
          // `display` already carries its unit ("6:58/mi"); appending
          // another produced "6:55/mi/mi" on screen.
          value: num(p.display, true),
          action: null,
        }));
      } catch { /* pacing is additive */ }
    }

    // Up to 3 marks, at each pace-phase boundary — real course structure,
    // not invented landmarks.
    const elevationMarks = pacePlan.slice(0, 3).map((row, i) => ({
      id: `mark-${i}`,
      at: distanceMi > 0 ? Math.min(1, Math.max(0, Number(row.label.replace('Miles ', '').split('-')[0]) / distanceMi)) : 0,
      label: row.sub?.split(' · ')[0] ?? row.label,
    }));

    // ── goal / projected / gap ─────────────────────────────────────────────
    const { vdot } = await loadLatestVdotWithAnchor(userId);
    const projectedSec = vdot != null && distanceMi > 0 ? predictRaceTime(vdot, distanceMi) : null;
    const gapSec = (projectedSec != null && goalSec != null) ? projectedSec - goalSec : null;

    // ── B11 · taper progress ───────────────────────────────────────────────
    let taperProgress: number | null = null;
    let taperEndpoints: string[] = [];
    let taperCentreLabel: string | null = null;
    try {
      const plan = await loadActivePlan(userId);
      if (plan && plan.race_id === slug) {
        const phase = await pool.query<{ start_week_idx: number; end_week_idx: number }>(
          `SELECT start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1 AND label = 'TAPER' LIMIT 1`,
          [plan.id],
        ).then(r => r.rows[0] ?? null).catch(() => null);
        if (phase) {
          const startWeek = await pool.query<{ week_start_iso: string }>(
            `SELECT week_start_iso::text AS week_start_iso FROM plan_weeks WHERE plan_id = $1 AND week_idx = $2 LIMIT 1`,
            [plan.id, phase.start_week_idx],
          ).then(r => r.rows[0] ?? null).catch(() => null);
          const taperStartISO = startWeek?.week_start_iso ?? null;
          const raceDateISO = race.date;
          if (taperStartISO && raceDateISO) {
            const startMs = Date.parse(taperStartISO + 'T12:00:00Z');
            const raceMs = Date.parse(raceDateISO + 'T12:00:00Z');
            const todayMs = Date.parse(todayISO + 'T12:00:00Z');
            const span = raceMs - startMs;
            taperProgress = span > 0 ? Math.min(1, Math.max(0, (todayMs - startMs) / span)) : null;
            const taperWeeksTotal = Math.max(1, Math.round((phase.end_week_idx - phase.start_week_idx + 1)));
            taperEndpoints = [`${taperWeeksTotal} week${taperWeeksTotal === 1 ? '' : 's'} out`, 'Race day'];
            const daysOut = Math.round((raceMs - todayMs) / 86400000);
            taperCentreLabel = daysOut <= 7 && daysOut >= 0
              ? 'Race week'
              : daysOut > 7
                ? `${Math.round(daysOut / 7)} week${Math.round(daysOut / 7) === 1 ? '' : 's'} out`
                : 'Race day';
          }
        }
      }
    } catch { /* taper is additive */ }

    // ── B14 · gear plan ─────────────────────────────────────────────────────
    const gear: V5RowOut[] = [];
    try {
      const [shoeRows, mileageMap] = await Promise.all([
        pool.query<{ id: number; brand: string; model: string; run_types: string[] | null; mileage_cap: number | null; shoe_type: string | null; baseline_mi: number | null; retired: boolean | null; preferred: boolean | null }>(
          `SELECT id, brand, model, run_types, mileage_cap::numeric AS mileage_cap,
                  to_jsonb(shoes.*) ->> 'shoe_type' AS shoe_type,
                  COALESCE(baseline_mi, 0)::numeric AS baseline_mi,
                  COALESCE(retired, false) AS retired, COALESCE(preferred, false) AS preferred
             FROM shoes WHERE user_uuid = $1`,
          [userId],
        ).then(r => r.rows).catch(() => []),
        computeShoeMileage(userId).catch(() => new Map<number, number>()),
      ]);
      const garage: GarageShoe[] = shoeRows.map(s => ({
        id: s.id, brand: s.brand, model: s.model, runTypes: s.run_types ?? [],
        mileage: (mileageMap.get(Number(s.id)) ?? 0) + Number(s.baseline_mi ?? 0),
        cap: resolveShoeCapMi(s.shoe_type, s.mileage_cap), preferred: s.preferred ?? false, retired: s.retired ?? false,
      }));
      const raceShoe = recommendShoe(garage, 'race');
      if (raceShoe) {
        const cap = raceShoe.cap ?? resolveShoeCapMi(null, null);
        const pctUsed = cap > 0 ? Math.round((raceShoe.mileage / cap) * 100) : 0;
        gear.push({
          id: `shoe-${raceShoe.id}`, label: shoeDisplayName(raceShoe) ?? 'Race shoe',
          sub: `${Math.round(raceShoe.mileage)} mi · ${pctUsed}% of its life`,
          value: null, action: 'open_shoe',
        });
      }
      // Race-morning forecast, only when the course has GPS and the date is
      // inside the real forecast horizon — never a climate-normal guess
      // presented as a gear fact.
      const g = courseGeometry as { trackPoints?: Array<{ lat?: number | null; lon?: number | null }> } | null;
      const tp = g?.trackPoints?.find(p => typeof p?.lat === 'number' && typeof p?.lon === 'number');
      if (tp?.lat != null && tp?.lon != null && race.date && distanceMi > 0 && goalSec) {
        const cond = await computeRaceConditions({
          raceSlug: slug, raceDateISO: race.date, location: race.location,
          raceLat: tp.lat, raceLng: tp.lon, distanceMi, goalSec, vdot,
          startTimeLocal: null, todayISO,
        }).catch(() => null);
        if (cond?.source === 'forecast' && cond.tempF != null) {
          gear.push({
            id: 'forecast', label: 'Race morning', sub: cond.summary,
            // MODELLED. A forecast is a model's opinion about a morning that
            // has not happened. Shipping it bare-faced beside a measured
            // finish time is exactly the sin rule one names, and it is the
            // more tempting version of it because a temperature FEELS like a
            // reading.
            value: num(`${cond.tempF}°F`, true), action: null,
          });
        }
      }
    } catch { /* gear is additive */ }

    const coachLine = gapSec != null
      ? (gapSec > 0
          ? `Today's fitness projects ${formatRaceTime(Math.abs(gapSec))} behind the goal. That can still close.`
          : `Today's fitness covers the goal with room. Race it as planned.`)
      : null;

    // ── result entry (Job 3) ────────────────────────────────────────────
    //
    // Rule one, concretely: `race.finishProvisional` (races-state.ts) is
    // true when the logged finish came from an auto-detected/watch-matched
    // run rather than a confirmed chip time — "Training effort · race to
    // lock in", NOT authoritative for fitness (CLAUDE.md's race-data
    // source-of-truth checklist). `status: 'provisional'` is exactly that
    // reading; `finish` carries `modelled: race.finishProvisional` so the
    // client's own `FaffValue` mechanism draws the amber tilde on a
    // provisional number without this route (or the client) hand-rolling
    // the mark. `status: 'confirmed'` (a real chip time already locked in)
    // is deliberately given no entry form at all — nothing left to ask.
    const resultEntry = {
      isPast: race.is_past,
      status: !race.is_past || race.finishTime == null
        ? null
        : (race.finishProvisional ? 'provisional' : 'confirmed'),
      finish: race.finishTime != null ? num(race.finishTime, race.finishProvisional) : null,
    };

    return NextResponse.json({
      slug: race.slug,
      name: race.name,
      dateLine: [raceDateWords(race.date), race.distance_label].filter(Boolean).join(' · '),
      goal: goalSec != null ? num(formatRaceTime(goalSec), false) : null,
      projected: projectedSec != null ? num(formatRaceTime(projectedSec), true) : null,
      gap: gapSec != null ? num(`${gapSec > 0 ? '+' : gapSec < 0 ? '−' : ''}${formatRaceTime(Math.abs(gapSec))}`, true) : null,
      elevation, elevationMarks, elevationFootnotes,
      pacePlan,
      taperProgress, taperEndpoints, taperCentreLabel,
      gear,
      coachLine,
      resultEntry,
    });
  } catch (err: any) {
    console.error('[api/v5/race/[slug]] failed:', err);
    return NextResponse.json({ error: err?.message ?? 'lookup failed' }, { status: 500 });
  }
}
