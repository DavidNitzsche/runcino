/**
 * GET /api/race/[slug]
 *
 * P40 — JSON race detail for the iPhone RaceDetailSheet. Mirrors what
 * web /races/[slug] composes server-side: race meta + course geometry +
 * derived proximity mode.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { loadRacesState } from '@/lib/coach/races-state';
import { requireUserId } from '@/lib/auth/session';
import { parseRaceTime } from '@/lib/training/vdot';
import { buildRacePacing, type CourseGeometryInput } from '@/lib/race/pacing';
import { elevationGainFt } from '@/lib/race/gpx-parser';
import { computeRaceFueling } from '@/lib/race/execution-plan';
import { resolveRaceFuel } from '@/lib/race/fuel-resolve';

export const dynamic = 'force-dynamic';

// ── Race-week live forecast (Open-Meteo · free, no API key) ──────────────────
// The race page shows TYPICAL weather (the crawl's historical norm) until the
// race is within 7 days, where the REAL race-day forecast loads and tracks
// (David 2026-06-17). Cached in-memory so we don't refetch on every page load.
const FORECAST_TTL_MS = 3 * 60 * 60 * 1000; // 3h
const forecastCache = new Map<string, { at: number; value: string | null }>();

function weatherWord(code: number): string {
  if (code === 0) return 'clear';
  if (code <= 3) return 'partly cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code <= 57) return 'drizzle';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'showers';
  if (code <= 86) return 'snow showers';
  return 'storms';
}

async function raceDayForecast(lat: number, lon: number, dateISO: string): Promise<string | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${dateISO}`;
  const hit = forecastCache.get(key);
  if (hit && Date.now() - hit.at < FORECAST_TTL_MS) return hit.value;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&temperature_unit=fahrenheit&timezone=auto&start_date=${dateISO}&end_date=${dateISO}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const d = ((await resp.json()) as {
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[]; weather_code?: number[] };
    }).daily;
    if (!d?.temperature_2m_max?.length) return null;
    const hi = Math.round(d.temperature_2m_max[0]);
    const lo = Math.round(d.temperature_2m_min?.[0] ?? hi);
    const pop = d.precipitation_probability_max?.[0];
    const cond = weatherWord(d.weather_code?.[0] ?? 0);
    let value = `${lo}-${hi}°F, ${cond}`;
    if (typeof pop === 'number') value += `, ${pop}% rain`;
    forecastCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;
  try {
    const races = await loadRacesState(userId);
    const race = [...races.aRaces, ...races.upcomingBs, ...races.upcomingCs, ...races.past]
      .find((r: any) => r?.slug === slug);
    if (!race) return NextResponse.json({ error: 'race not found' }, { status: 404 });

    // Scope course-geometry lookup by user_uuid so a slug guess can't leak
    // another runner's GPX even if a name collision would otherwise match.
    // Also pull meta — the per-race fuel keys (fuelProduct etc.) live there
    // and loadRacesState doesn't surface them.
    const geoRow = await pool.query<{ course_geometry: unknown; course_source: string | null; meta: Record<string, unknown> | null }>(
      `SELECT course_geometry, course_source, meta FROM races WHERE slug = $1 AND user_uuid = $2`,
      [slug, userId],
    ).catch(() => ({ rows: [] as Array<{ course_geometry: unknown; course_source: string | null; meta: Record<string, unknown> | null }> }));
    let courseGeometry = geoRow.rows[0]?.course_geometry ?? null;
    // Recompute elevation gain from the trackpoints with the noise threshold —
    // stored values were raw-summed, which GPS/barometric jitter inflated (AFC
    // read 923 ft vs Strava's 724). Overriding on read corrects every existing
    // course's displayed gain without a data backfill; new uploads are already
    // thresholded at parse time. (2026-06-17)
    if (courseGeometry && typeof courseGeometry === 'object') {
      const g = courseGeometry as { trackPoints?: Array<{ ele?: number | null }> };
      const eles = (g.trackPoints ?? [])
        .map((p) => p?.ele)
        .filter((e): e is number => typeof e === 'number');
      if (eles.length >= 2) {
        courseGeometry = { ...g, elevation_gain_ft: elevationGainFt(eles) };
      }
    }
    const courseSource = geoRow.rows[0]?.course_source ?? null;
    const raceMeta = geoRow.rows[0]?.meta ?? null;

    // Course-library provenance (2026-05-30 audit) — when the course came
    // from the shared library, surface `source` + `contributor_count` so
    // the iPhone can render "Crowd-sourced by N runners" on the race page.
    // 2026-06-09 · also pull geometry_json — the authored phase profile
    // feeds the course-aware goal splits below (race-killer F3).
    const libRow = await pool.query(
      `SELECT source, contributor_count, geometry_json FROM course_library WHERE slug = $1`,
      [slug],
    ).catch(() => ({ rows: [] }));
    const courseLibrary = libRow.rows[0] ? {
      source: libRow.rows[0].source ?? null,
      contributor_count: Number(libRow.rows[0].contributor_count ?? 0),
    } : null;

    // 2026-06-09 · race-killer F3 — course-aware goal splits. The splits
    // cards used to interpolate the goal linearly (flat-course splits on
    // every course). Distribute the goal over the authored phase profile
    // instead; degrades to the same linear ladder when no usable phases.
    // The goal string parses via the shared parser ("1:30" → 5400, not 90
    // — race-killer F2). Library phases win over user GPX geometry: the
    // library carries authored grade phases, GPX rarely does.
    let pacing = null;
    try {
      const goalSec = parseRaceTime((race as { goal?: string | null }).goal);
      const distanceMi = Number((race as { distance_mi?: number | null }).distance_mi);
      if (goalSec && distanceMi > 0) {
        pacing = buildRacePacing({
          goalSec,
          distanceMi,
          geometry: (libRow.rows[0]?.geometry_json ?? courseGeometry) as CourseGeometryInput | null,
        });
      }
    } catch { /* pacing is additive — never fail the detail over it */ }

    const proximity = (race as any).days < 0 ? 'post-race'
      : (race as any).days <= 7 ? 'race-week'
      : (race as any).days <= 60 ? 'sharpening'
      : 'building';

    // Structured fuel recommendation · servings + schedule + target rate +
    // product. Per-race meta (fuelProduct etc.) overrides the runner-level
    // default (users.fuel_*); documented defaults + isDefault when neither.
    // Same resolver + math as /execution-plan, so the two surfaces agree.
    // Cite Research/18 §1/§11.
    let fueling = null;
    try {
      const goalSec = parseRaceTime((race as { goal?: string | null }).goal);
      const distanceMi = Number((race as { distance_mi?: number | null }).distance_mi);
      if (goalSec && distanceMi > 0) {
        const fuelDefaults = (await pool.query<{ fuel_brand: string | null; fuel_gel_carbs_g: number | null; fuel_target_g_per_hr: number | null }>(
          `SELECT fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr FROM users WHERE id = $1 LIMIT 1`,
          [userId],
        ).then((r) => r.rows[0] ?? null).catch(() => null));
        const { fuel, fuelIsDefault } = resolveRaceFuel(raceMeta, fuelDefaults);
        fueling = computeRaceFueling({
          goalSec,
          distanceMi,
          goalPaceSPerMi: goalSec / distanceMi,
          fuel,
          isDefault: fuelIsDefault,
        });
      }
    } catch { /* fueling is additive — never fail the detail over it */ }

    // Race-week live forecast · only within 7 days, only with course coords.
    // Falls back silently to the typical norm (shown client-side) otherwise.
    let weatherForecast: string | null = null;
    try {
      if (proximity === 'race-week') {
        const g = courseGeometry as { trackPoints?: Array<{ lat?: number | null; lon?: number | null }> } | null;
        const tp = g?.trackPoints?.find((p) => typeof p?.lat === 'number' && typeof p?.lon === 'number');
        const raceDate = (race as { date?: string | null }).date;
        if (tp?.lat != null && tp?.lon != null && raceDate) {
          weatherForecast = await raceDayForecast(tp.lat, tp.lon, String(raceDate).slice(0, 10));
        }
      }
    } catch { /* forecast is additive — never fail the detail over it */ }

    return NextResponse.json({
      race: { ...race, weather_forecast: weatherForecast },
      proximity,
      course_geometry: courseGeometry,
      course_source: courseSource,
      course_library: courseLibrary,
      pacing,
      fueling,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/race/[slug] · goal renegotiation (Phase 2.4).
 *
 * Body: { goalSec: number, source?: 'renegotiate' | 'manual' }
 *
 * Accepts a new goal time, updates races.plan.goal.finish_time_s +
 * meta.goalDisplay, audits the change, busts the briefing cache, and
 * fires an auto-rebuild (plan needs new pace targets at the new goal).
 *
 * Engine NEVER picks the new goal · the runner chose it from the gap
 * report's A/B/C alternatives. PATCH is the seam where the runner's
 * choice becomes durable state.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.4
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const { slug } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const goalSec = Number(body.goalSec);
  if (!Number.isFinite(goalSec) || goalSec < 600 || goalSec > 21600) {
    return NextResponse.json(
      { error: 'goalSec required · must be 600 (10min) to 21600 (6h)' },
      { status: 400 },
    );
  }
  const source = (body.source === 'renegotiate' ? 'renegotiate' : 'manual') as 'renegotiate' | 'manual';

  // Format new display
  const h = Math.floor(goalSec / 3600);
  const m = Math.floor((goalSec % 3600) / 60);
  const s = goalSec % 60;
  const goalDisplay = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  // Load current race for audit · then update both meta + plan.goal
  const current = (await pool.query<{ meta: any; plan: any }>(
    `SELECT meta, plan FROM races WHERE user_uuid = $1::uuid AND slug = $2 LIMIT 1`,
    [userId, slug],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!current) return NextResponse.json({ error: 'race not found' }, { status: 404 });

  const oldGoalSec = Number(current.plan?.goal?.finish_time_s ?? 0);
  const newMeta = { ...current.meta, goalDisplay };
  const newPlan = {
    ...current.plan,
    goal: {
      ...current.plan?.goal,
      finish_time_s: goalSec,
      finish_time_display: goalDisplay,
    },
  };

  await pool.query(
    `UPDATE races SET meta = $1::jsonb, plan = $2::jsonb
      WHERE user_uuid = $3::uuid AND slug = $4`,
    [JSON.stringify(newMeta), JSON.stringify(newPlan), userId, slug],
  );

  // Audit the change
  await pool.query(
    `INSERT INTO coach_intents (user_id, user_uuid, ts, reason, field, value)
     VALUES ($1::uuid, $1::uuid, NOW(), 'goal_renegotiated', $2, $3::jsonb)`,
    [
      userId, slug,
      JSON.stringify({
        old_goal_sec: oldGoalSec,
        new_goal_sec: goalSec,
        old_display: current.meta?.goalDisplay ?? null,
        new_display: goalDisplay,
        source,
        citation: 'docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.4',
      }),
    ],
  ).catch(() => {/* audit failure shouldn't block */});

  // Fire auto-rebuild · paces shift at the new goal
  try {
    const { fireAutoRebuild } = await import('@/lib/plan/auto-rebuild');
    await fireAutoRebuild({
      userUuid: userId,
      raceSlug: slug,
      kind: 'goal_time_changed',
      reasons: {
        drift_kind: 'goal_renegotiated',
        old_goal_sec: oldGoalSec,
        new_goal_sec: goalSec,
        source,
      },
      source: 'goal_renegotiation',
    });
  } catch (e) {
    console.error('[race goal renegotiate] auto-rebuild failed:', e);
  }

  // Bust briefing cache
  try {
    const { bustBriefingCacheForEvent } = await import('@/lib/coach/cache');
    await bustBriefingCacheForEvent(userId, 'plan_swap');
  } catch {/* non-blocking */}

  return NextResponse.json({
    ok: true,
    goalSec,
    goalDisplay,
    oldGoalSec,
    rebuildTriggered: true,
  });
}
